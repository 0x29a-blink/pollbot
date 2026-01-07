import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { logger } from '../lib/logger';

export class TelemetryTunnelService {
    private tunnelProcess: ChildProcess | null = null;
    private readonly port = 6000;

    constructor() {
        this.start();
    }

    private start() {
        const token = process.env.TELEMETRY_TOKEN;
        if (!token) {
            logger.warn('[TelemetryTunnel] TELEMETRY_TOKEN not found. Skipping tunnel startup.');
            return;
        }

        logger.info('[TelemetryTunnel] Starting tunnel for Telemetry Panel on port 6000...');

        try {
            // Locate cloudflared binary (same logic as webhook.ts)
            const cloudflaredDir = path.dirname(require.resolve('cloudflared'));
            const binaryName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
            const binaryPath = path.join(cloudflaredDir, '..', 'bin', binaryName);

            this.tunnelProcess = spawn(binaryPath, ['tunnel', 'run', '--token', token, '--url', `http://localhost:${this.port}`]);

            this.tunnelProcess.stdout?.on('data', (data) => {
                // logger.debug(`[TelemetryTunnel] ${data.toString().trim()}`);
            });

            this.tunnelProcess.stderr?.on('data', (data) => {
                // Helper to detect success
                const msg = data.toString();
                if (msg.includes('Registered tunnel connection')) {
                    logger.info('[TelemetryTunnel] Tunnel connected successfully!');
                }
                // logger.debug(`[TelemetryTunnel] ${msg.trim()}`);
            });

            this.tunnelProcess.on('error', (err) => {
                logger.error('[TelemetryTunnel] Failed to spawn cloudflared:', err);
            });

            this.tunnelProcess.on('close', (code) => {
                logger.warn(`[TelemetryTunnel] Process exited with code ${code}`);
            });

            // Handle shutdown
            process.on('SIGINT', () => this.stop());
            process.on('SIGTERM', () => this.stop());

        } catch (error) {
            logger.error('[TelemetryTunnel] Error starting tunnel:', error);
        }
    }

    public stop() {
        if (this.tunnelProcess) {
            logger.info('[TelemetryTunnel] Stopping tunnel...');
            this.tunnelProcess.kill();
            this.tunnelProcess = null;
        }
    }
}
