import http from 'http';
import dotenv from 'dotenv';
import { browserPool } from '../lib/browserPool';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';
import { RenderBackend } from '../lib/renderBackend';

dotenv.config();

I18n.init();

const PORT = process.env.RENDER_SERVICE_PORT ? parseInt(process.env.RENDER_SERVICE_PORT) : 3000;

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/render') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            // 1. Parse Data
            let data;
            try {
                data = JSON.parse(body);
            } catch (e) {
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
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    logger.info(`[RenderService] Listening on port ${PORT}`);
});

// Handle Shutdown
process.on('SIGTERM', async () => {
    logger.info('[RenderService] SIGTERM received. Shutting down...');
    await browserPool.destroy();
    server.close();
    process.exit(0);
});
