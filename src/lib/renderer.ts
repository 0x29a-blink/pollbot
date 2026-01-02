import { fetch } from 'undici';
import { logger } from './logger';

export interface RenderOptions {
    title: string;
    description: string;
    options: string[];
    votes?: number[]; // Array of vote counts corresponding to options
    totalVotes?: number;
    creator: string;
    locale?: string;
    closed?: boolean;
}

export interface StatsRenderOptions {
    totalPolls: number;
    totalVotes: number;
    activeServers: number;
    uptime: string;
    shards: number;
    cpuLoad: number; // 0-100
    memoryUsage: number; // 0-100
    labels: {
        title: string;
        subtitle: string;
        uptime: string;
        shards: string;
        activeServers: string;
        totalVotes: string;
        totalPolls: string;
        cpuLoad: string;
        memoryUsage: string;
    };
}

const RENDER_SERVICE_PORT = process.env.RENDER_SERVICE_PORT ? parseInt(process.env.RENDER_SERVICE_PORT) : 3000;
const RENDER_SERVICE_URL = `http://localhost:${RENDER_SERVICE_PORT}/render`;

export class Renderer {
    static async renderPoll(data: RenderOptions): Promise<Buffer> {
        return this.sendRequest({ type: 'poll', ...data });
    }

    static async renderStats(data: StatsRenderOptions): Promise<Buffer> {
        return this.sendRequest({ type: 'stats', ...data });
    }

    static async renderDetailedView(data: RenderOptions): Promise<Buffer> {
        return this.sendRequest({ type: 'detailed_view', ...data });
    }

    private static async sendRequest(payload: any): Promise<Buffer> {
        try {
            const response = await fetch(RENDER_SERVICE_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Render Service Error (${response.status}): ${text}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);

        } catch (error) {
            logger.error('[RendererClient] Failed to connect to Render Service:', error);
            throw new Error('Failed to generate image. Please try again later.');
        }
    }
}
