import http from 'http';
import dotenv from 'dotenv';
import { browserPool } from '../lib/browserPool';
import { logger } from '../lib/logger';

dotenv.config();

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
                // To reuse the BrowserPool & Renderer logic *without* refactoring everything immediately,
                // we can dynamically import the Renderer class here since it now just needs a page.
                // WAIT: The Renderer class in `lib/renderer.ts` CURRENTLY uses `browserPool.getPage()`.
                // WE MUST REFACTOR `lib/renderer.ts` FIRST OR COPY LOGIC.

                // Better approach for `renderService.ts`:
                // It should hold the `Renderer` logic *internally* or import a version of it that uses the local pool.
                // But `lib/renderer.ts` is going to be updated to be a *Client*.

                // So let's extract the actual *rendering logic* (HTML generation + screenshot) into a helper
                // OR (easier for now): 
                // We keep the `Renderer` class largely as is but give it the page, 
                // AND we make a `RendererClient` for the bot to use. 
                // But `Renderer` currently imports `browserPool`.

                // Let's modify `src/lib/renderer.ts` to *not* import browserPool directly but accept a page?
                // No, sticking to the plan: `src/lib/renderer.ts` becomes the client.

                // So I will copy the *HTML Generation* logic into a new `src/lib/renderLogic.ts` OR just put it here for now?
                // Putting 500 lines of HTML in this file is messy.
                // Let's create `src/lib/renderTemplates.ts` or similar? 

                // ALTERNATIVE: Import `Renderer` from `../lib/renderer` but `renderer` will be modified.
                // So I should Rename `src/lib/renderer.ts` to `src/lib/renderLogic.ts` (keeping the logic),
                // and create a NEW `src/lib/renderer.ts` that acts as the client.

                // I'll stick to: `renderService.ts` handles the request. 
                // I will move the HTML generation to `src/lib/htmlGenerator.ts` to share or import.

                // ACTUALLY: The easiest path is:
                // 1. Rename `src/lib/renderer.ts` -> `src/lib/renderCore.ts` (The actual logic).
                // 2. `src/services/renderService.ts` imports `RenderCore` and `browserPool`.
                // 3. New `src/lib/renderer.ts` (The Client) calls the service.

                // However, I can't rename files easily with tools (delete + write).
                // So I will Duplicate `renderer.ts` content effectively into `renderService.ts` usage 
                // via a refactor of `renderer.ts` later.

                // Let's assume for a moment I can import `Renderer` from `../lib/renderer` BEFORE I change it? - No, sequential.

                // PLAN:
                // 1. I will write `src/services/renderService.ts` assuming `src/lib/rendererBackend.ts` exists.
                // 2. I will Rename `renderer.ts` to `rendererBackend.ts` (read, write new, delete old?). 
                //    Or just write `rendererBackend.ts` with the content of `renderer.ts` but modified to accept a page or use pool locally.

                // Let's go with: `src/lib/rendererBackend.ts` holds the logic.

                // I'll write `renderService.ts` to delegate to `rendererBackend`.

                // Temp placeholder logic until backend is created.

                // Actually, I'll write the full service logic including the "Core" rendering here for simplicity if I can import types.
                // No, reusing the code is better.

                // Let's start by creating `renderService.ts` with the HTTP scaffold.

                const page = await browserPool.getPage();
                try {
                    // Logic to discern type
                    const { type, ...options } = data;
                    let buffer: Buffer;

                    // We need the ACTUAL rendering logic here. 
                    // Since I haven't split the file yet, I will import `RenderBackend` (which I'll create next).
                    // import { RenderBackend } from '../lib/renderBackend';

                    if (type === 'stats') {
                        buffer = await RenderBackend.renderStats(page, options);
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

import { RenderBackend } from '../lib/renderBackend'; // We will create this.

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
