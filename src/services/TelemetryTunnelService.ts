import { logger } from '../lib/logger';
import { ManagedTunnelHandle, startManagedTunnel } from '../lib/cloudflaredTunnel';

export class TelemetryTunnelService {
    private tunnelHandle: ManagedTunnelHandle | null = null;
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

        logger.info(`[TelemetryTunnel] Starting tunnel for Telemetry Panel on port ${this.port}...`);
        this.tunnelHandle = startManagedTunnel({
            name: 'telemetry',
            token,
            extraArgs: ['--url', `http://localhost:${this.port}`],
            quiet: true,
        });
    }

    public stop() {
        if (this.tunnelHandle) {
            this.tunnelHandle.stop();
            this.tunnelHandle = null;
        }
    }
}
