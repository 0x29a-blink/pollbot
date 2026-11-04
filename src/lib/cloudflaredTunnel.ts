import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { bin as cloudflaredBin, install as installCloudflared } from 'cloudflared';
import { logger } from './logger';

let installPromise: Promise<string> | null = null;

/**
 * Ensures the cloudflared binary exists at the path resolved by the
 * `cloudflared` npm package (or CLOUDFLARED_BIN env override), installing the
 * latest binary automatically if missing.
 */
export async function ensureCloudflaredBinary(): Promise<string> {
    if (fs.existsSync(cloudflaredBin)) {
        return cloudflaredBin;
    }

    if (!installPromise) {
        logger.info(`[cloudflared] Binary not found at ${cloudflaredBin}. Installing latest cloudflared binary...`);
        installPromise = installCloudflared(cloudflaredBin)
            .then((installedPath) => {
                logger.info(`[cloudflared] Installed binary at ${installedPath}`);
                return installedPath;
            })
            .finally(() => {
                installPromise = null;
            });
    }

    return installPromise;
}

export interface ManagedTunnelOptions {
    name: string;
    token: string;
    extraArgs?: string[];
    /** If true, routine stdout/stderr lines are only logged when registering a connection. */
    quiet?: boolean;
}

export interface ManagedTunnelHandle {
    stop: () => void;
}

const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;
const HEALTHY_UPTIME_MS = 60000;

/**
 * Starts and supervises a `cloudflared tunnel run` child process with
 * exponential-backoff auto-restart on unexpected exits and clean shutdown on
 * SIGINT/SIGTERM.
 */
export function startManagedTunnel(options: ManagedTunnelOptions): ManagedTunnelHandle {
    const { name, token, extraArgs = [], quiet = false } = options;
    let currentChild: ChildProcess | null = null;
    let restartTimer: NodeJS.Timeout | null = null;
    let stopped = false;
    let attempt = 0;

    const cleanupSignals = () => {
        stop();
    };

    const launch = async () => {
        if (stopped) return;

        let binaryPath: string;
        try {
            binaryPath = await ensureCloudflaredBinary();
        } catch (err) {
            logger.error(`[cloudflared:${name}] Failed to ensure binary:`, err);
            scheduleRestart();
            return;
        }

        if (stopped) return;

        const startedAt = Date.now();
        try {
            // Pass TUNNEL_TOKEN via environment variable rather than --token CLI argv
            // so the secret is never exposed in /proc/<pid>/cmdline, ps, or systemctl status.
            const args = ['tunnel', 'run', ...extraArgs];
            const child = spawn(binaryPath, args, {
                env: {
                    ...process.env,
                    TUNNEL_TOKEN: token,
                },
            });
            currentChild = child;

            child.stdout?.on('data', (data: Buffer) => {
                const msg = data.toString().trim();
                if (!quiet && msg) {
                    logger.info(`[cloudflared:${name}] ${msg}`);
                }
            });

            child.stderr?.on('data', (data: Buffer) => {
                const msg = data.toString().trim();
                if (!msg) return;
                if (quiet) {
                    if (msg.includes('Registered tunnel connection')) {
                        logger.info(`[cloudflared:${name}] Tunnel connected successfully!`);
                    }
                } else {
                    logger.info(`[cloudflared:${name}] ${msg}`);
                }
            });

            child.on('error', (err) => {
                logger.error(`[cloudflared:${name}] Process error:`, err);
            });

            child.on('close', (code, signal) => {
                if (currentChild === child) {
                    currentChild = null;
                }
                if (stopped) {
                    logger.info(`[cloudflared:${name}] Tunnel stopped.`);
                    return;
                }
                if (Date.now() - startedAt >= HEALTHY_UPTIME_MS) {
                    attempt = 0;
                }
                logger.warn(`[cloudflared:${name}] Exited unexpectedly (code=${code}, signal=${signal}). Scheduling restart...`);
                scheduleRestart();
            });
        } catch (err) {
            logger.error(`[cloudflared:${name}] Error spawning tunnel:`, err);
            scheduleRestart();
        }
    };

    const scheduleRestart = () => {
        if (stopped || restartTimer) return;
        attempt++;
        const delayMs = Math.min(INITIAL_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        restartTimer = setTimeout(() => {
            restartTimer = null;
            void launch();
        }, delayMs);
        if (typeof restartTimer.unref === 'function') {
            restartTimer.unref();
        }
    };

    const stop = () => {
        if (stopped) return;
        stopped = true;
        process.off('SIGINT', cleanupSignals);
        process.off('SIGTERM', cleanupSignals);
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
        if (currentChild) {
            logger.info(`[cloudflared:${name}] Stopping tunnel...`);
            currentChild.kill();
            currentChild = null;
        }
    };

    process.once('SIGINT', cleanupSignals);
    process.once('SIGTERM', cleanupSignals);

    void launch();

    return { stop };
}
