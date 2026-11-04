import { describe, expect, it } from 'vitest';
import { Renderer } from './renderer';
import { isAllowedDiscordUrl, parseRichTokens } from './canvasUtils';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(buf: Buffer): { width: number; height: number } {
    expect(buf.length).toBeGreaterThan(24);
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
    };
}

describe('canvasUtils security & token helpers', () => {
    it('only allows https Discord CDN hosts for custom emoji fetches', () => {
        expect(isAllowedDiscordUrl('https://cdn.discordapp.com/emojis/123456789012345678.png?size=64')).toBe(true);
        expect(isAllowedDiscordUrl('https://media.discordapp.net/attachments/1/2/x.png')).toBe(true);
        expect(isAllowedDiscordUrl('http://cdn.discordapp.com/emojis/123.png')).toBe(false);
        expect(isAllowedDiscordUrl('https://127.0.0.1:3000/secret')).toBe(false);
        expect(isAllowedDiscordUrl('https://evil.example.com/cdn.discordapp.com.png')).toBe(false);
    });

    it('parses text and Discord custom emoji tokens accurately', () => {
        const tokens = parseRichTokens('Vote <:party:123456789012345678> or <a:spin:987654321098765432> now!');
        expect(tokens).toEqual([
            { type: 'text', value: 'Vote ' },
            {
                type: 'emoji',
                name: 'party',
                id: '123456789012345678',
                url: 'https://cdn.discordapp.com/emojis/123456789012345678.png?size=64',
            },
            { type: 'text', value: ' or ' },
            {
                type: 'emoji',
                name: 'spin',
                id: '987654321098765432',
                url: 'https://cdn.discordapp.com/emojis/987654321098765432.png?size=64',
            },
            { type: 'text', value: ' now!' },
        ]);
    });
});

describe('Renderer (@napi-rs/canvas)', () => {
    it('renders an open poll card at @2x HiDPI (1200px wide PNG)', async () => {
        const buf = await Renderer.renderPoll({
            title: 'Which feature should we ship next?',
            description: 'Pick up to two options.\nResults update in real time!',
            options: ['Canvas Renderer', 'DiscordForge v2 Webhooks', 'Vote Time Stacking'],
            votes: [14, 9, 11],
            totalVotes: 34,
            creator: 'blink.dclxvi',
            locale: 'en',
            closed: false,
        });

        const { width, height } = readPngDimensions(buf);
        expect(width).toBe(1200); // 600px logical * 2x scale
        expect(height).toBeGreaterThan(500);
    });

    it('renders a closed poll with tied winners, Spanish locale, and 25 options cleanly', async () => {
        const options = Array.from({ length: 25 }, (_, i) => `Option ${i + 1} with a descriptive label`);
        const votes = options.map((_, i) => (i === 2 || i === 7 ? 20 : i));
        const totalVotes = votes.reduce((a, b) => a + b, 0);

        const buf = await Renderer.renderPoll({
            title: 'Encuesta Finalizada con 25 Opciones',
            description: '',
            options,
            votes,
            totalVotes,
            creator: 'AdminUser',
            locale: 'es-ES',
            closed: true,
        });

        const { width, height } = readPngDimensions(buf);
        expect(width).toBe(1200);
        expect(height).toBeGreaterThan(2000);
    });

    it('renders the system stats card at @2x HiDPI (1400px wide PNG)', async () => {
        const buf = await Renderer.renderStats({
            totalPolls: 18_420,
            totalVotes: 294_115,
            activeServers: 1_532,
            uptime: '14d 6h 22m',
            shards: 2,
            cpuLoad: 12.4,
            memoryUsage: 38.7,
            labels: {
                title: 'PollBot',
                subtitle: 'System Analytics',
                uptime: 'Uptime',
                shards: 'Shards',
                activeServers: 'Active Servers (Peak)',
                totalVotes: 'Total Votes',
                totalPolls: 'Total Polls',
                cpuLoad: 'CPU Load',
                memoryUsage: 'Memory Usage',
            },
        });

        const { width, height } = readPngDimensions(buf);
        expect(width).toBe(1400); // 700px logical * 2x scale
        expect(height).toBe(1080); // 540px logical * 2x scale
    });

    it('renders detailed view cards for both zero-vote and multi-winner polls', async () => {
        const emptyBuf = await Renderer.renderDetailedView({
            title: 'Brand New Poll',
            description: '',
            options: ['Yes', 'No'],
            votes: [0, 0],
            totalVotes: 0,
            creator: 'Creator',
            locale: 'en',
            closed: false,
        });
        expect(readPngDimensions(emptyBuf).width).toBe(1400);

        const tieBuf = await Renderer.renderDetailedView({
            title: 'Weekend Movie Night',
            description: 'Pick one!',
            options: ['Dune: Part Two', 'Interstellar', 'Arrival'],
            votes: [15, 15, 6],
            totalVotes: 36,
            creator: 'blink.dclxvi',
            locale: 'en',
            closed: true,
        });
        expect(readPngDimensions(tieBuf).width).toBe(1400);
    });
});
