import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotListService, HEARTBEAT_INTERVAL_MS, STATS_INTERVAL_MS } from './BotListService';
import { DiscordForgeError } from '../lib/discordForge';

class FakeShard extends EventEmitter {
    public ready: boolean;
    public evalImpl: () => Promise<boolean>;

    constructor(
        public readonly id: number,
        ready = false,
        evalImpl: () => Promise<boolean> = async () => true
    ) {
        super();
        this.ready = ready;
        this.evalImpl = evalImpl;
    }

    async eval(): Promise<boolean> {
        return await this.evalImpl();
    }
}

class FakeManager extends EventEmitter {
    public shards = new Map<number, FakeShard>();
    public totalShards: number | 'auto' = 'auto';
    public broadcastEval = vi.fn<() => Promise<Array<{ guilds: number; members: number }>>>();

    addShard(shard: FakeShard): void {
        this.shards.set(shard.id, shard);
        this.emit('shardCreate', shard);
    }
}

describe('BotListService', () => {
    const savedToken = process.env.DISCORD_TOKEN;
    const savedClientId = process.env.DISCORD_CLIENT_ID;

    beforeEach(() => {
        vi.useFakeTimers();
        delete process.env.DISCORD_TOKEN;
        delete process.env.DISCORD_CLIENT_ID;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (savedToken !== undefined) process.env.DISCORD_TOKEN = savedToken;
        if (savedClientId !== undefined) process.env.DISCORD_CLIENT_ID = savedClientId;
    });

    function makeForgeStub() {
        return {
            heartbeat: vi.fn().mockResolvedValue({
                success: true,
                message: 'Heartbeat recorded successfully',
                status: 'online',
                uptimeChecks: 100,
                uptimeOnline: 100,
            }),
            postStats: vi.fn().mockResolvedValue(undefined),
            syncCommands: vi.fn().mockResolvedValue(undefined),
        };
    }

    it('sends an immediate heartbeat when the first shard becomes ready and ticks every 5m10s', async () => {
        const manager = new FakeManager();
        manager.totalShards = 2;
        const forge = makeForgeStub();
        const svc = new BotListService(manager as any, 'df_test', forge as any);

        svc.start();
        expect(forge.heartbeat).not.toHaveBeenCalled();

        // Shard 0 spawns and connects while Shard 1 is still spawning
        const shard0 = new FakeShard(0, false);
        manager.addShard(shard0);
        shard0.ready = true;
        shard0.emit('ready');

        await vi.advanceTimersByTimeAsync(0);
        expect(forge.heartbeat).toHaveBeenCalledTimes(1);
        expect(forge.postStats).not.toHaveBeenCalled(); // Shard 1 not spawned yet

        // Does NOT double-ping inside the 5-minute window (which would reset DiscordForge's cooldown)
        await vi.advanceTimersByTimeAsync(60_000);
        expect(forge.heartbeat).toHaveBeenCalledTimes(1);

        // Next ping fires after the full 5m10s post-completion delay
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS - 60_000);
        expect(forge.heartbeat).toHaveBeenCalledTimes(2);

        svc.stop();
    });

    it('keeps sending heartbeats when 1 of N shards is disconnected or fails eval', async () => {
        const manager = new FakeManager();
        manager.totalShards = 2;
        const healthyShard = new FakeShard(0, true, async () => true);
        const brokenShard = new FakeShard(1, true, async () => {
            throw new Error('IPC channel closed');
        });
        manager.shards.set(0, healthyShard);
        manager.shards.set(1, brokenShard);

        const forge = makeForgeStub();
        const svc = new BotListService(manager as any, 'df_test', forge as any);

        await svc.sendHeartbeat();
        expect(forge.heartbeat).toHaveBeenCalledTimes(1);
    });

    it('skips heartbeat when no shard client reports isReady() === true', async () => {
        const manager = new FakeManager();
        manager.shards.set(0, new FakeShard(0, true, async () => false));

        const forge = makeForgeStub();
        const svc = new BotListService(manager as any, 'df_test', forge as any);

        await svc.sendHeartbeat();
        expect(forge.heartbeat).not.toHaveBeenCalled();
    });

    it('decouples stats failures/429s from heartbeats and waits for all shards before posting stats', async () => {
        const manager = new FakeManager();
        manager.totalShards = 2;
        const shard0 = new FakeShard(0, true);
        const shard1 = new FakeShard(1, false);
        manager.shards.set(0, shard0);
        manager.shards.set(1, shard1);
        manager.broadcastEval.mockResolvedValue([
            { guilds: 4500, members: 800000 },
            { guilds: 4687, members: 926121 },
        ]);

        const forge = makeForgeStub();
        forge.postStats.mockRejectedValueOnce(new DiscordForgeError('Rate limited', 429, 250));
        const svc = new BotListService(manager as any, 'df_test', forge as any);

        // Partial readiness: skips stats so partial guild count is never posted
        await svc.postStats();
        expect(forge.postStats).not.toHaveBeenCalled();

        // All shards ready: onShardsSpawned fires stats and triggers initial heartbeat if none sent yet
        shard1.ready = true;
        svc.onShardsSpawned();
        await vi.advanceTimersByTimeAsync(0);

        expect(forge.postStats).toHaveBeenCalledTimes(1);
        expect(forge.postStats).toHaveBeenCalledWith({
            server_count: 9187,
            shard_count: 2,
            user_count: 1726121,
        });
        expect(forge.heartbeat).toHaveBeenCalledTimes(1);

        // Calling onShardsSpawned again does NOT emit a duplicate heartbeat inside 5m
        svc.onShardsSpawned();
        await vi.advanceTimersByTimeAsync(0);
        expect(forge.heartbeat).toHaveBeenCalledTimes(1);

        // Next 10m stats interval succeeds cleanly
        svc.start();
        await vi.advanceTimersByTimeAsync(STATS_INTERVAL_MS);
        expect(forge.postStats).toHaveBeenCalledTimes(3);
        svc.stop();
    });

    it('logs a warning and still waits the full 5m10s if DiscordForge replies rate-limited', async () => {
        const manager = new FakeManager();
        manager.shards.set(0, new FakeShard(0, true));
        const forge = makeForgeStub();
        forge.heartbeat
            .mockResolvedValueOnce({
                success: true,
                message: 'Heartbeat received (rate-limited)',
                status: 'online',
                uptimeChecks: 4826,
                uptimeOnline: 2597,
            })
            .mockResolvedValueOnce({
                success: true,
                message: 'Heartbeat recorded successfully',
                status: 'online',
                uptimeChecks: 4827,
                uptimeOnline: 2598,
            });

        const svc = new BotListService(manager as any, 'df_test', forge as any);
        svc.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(forge.heartbeat).toHaveBeenCalledTimes(1);

        // Must still wait the full 5m10s before the next heartbeat so it clears the cooldown
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS - 1000);
        expect(forge.heartbeat).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(forge.heartbeat).toHaveBeenCalledTimes(2);
        svc.stop();
    });
});
