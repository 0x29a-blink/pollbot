import http from 'http';
import dotenv from 'dotenv';
import { browserPool } from '../lib/browserPool';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';
import { RenderBackend } from '../lib/renderBackend';

dotenv.config();

I18n.init();

const HOST = process.env.RENDER_SERVICE_HOST || '127.0.0.1';
const PORT = process.env.RENDER_SERVICE_PORT ? parseInt(process.env.RENDER_SERVICE_PORT, 10) : 3000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB cap

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/render') {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let aborted = false;

        req.on('data', (chunk: Buffer) => {
            if (aborted) return;
            totalBytes += chunk.length;
            if (totalBytes > MAX_BODY_BYTES) {
                aborted = true;
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Payload too large' }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', async () => {
            if (aborted) return;
            const body = Buffer.concat(chunks).toString('utf8');

            // 1. Parse Data
            let data;
            try {
                data = JSON.parse(body);
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
            }

            // 2. Determine Render Type (Poll vs Stats) & Render
            try {
                // Render on a pooled Chromium page. RenderBackend holds the shared
                // HTML-generation + screenshot logic used by every render type.
                const page = await browserPool.getPage();
                try {
                    const { type, ...options } = data;
                    let buffer: Buffer;

                    if (type === 'stats') {
                        buffer = await RenderBackend.renderStats(page, options);
                    } else if (type === 'detailed_view') {
                        buffer = await RenderBackend.renderDetailedView(page, options);
                    } else {
                        buffer = await RenderBackend.renderPoll(page, options);
                    }

                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Content-Length': buffer.length
                    });
                    res.end(buffer);
                } finally {
                    await page.close();
                }

            } catch (err: any) {
                logger.error('[RenderService] Error:', err);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Render failed' }));
                }
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, HOST, () => {
    logger.info(`[RenderService] Listening on http://${HOST}:${PORT}`);
});

// Handle Shutdown
let shuttingDown = false;
const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[RenderService] ${signal} received. Shutting down...`);
    await browserPool.destroy();
    server.close();
    process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
