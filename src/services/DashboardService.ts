// Copyright (c) 2026 Simple Solutions.
// Licensed under the MIT License. See LICENSE in the project root for details.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';
import { logger } from '../lib/logger';

dotenv.config();

const app = express();
app.disable('x-powered-by');

const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const PORT = 7500;
const API_TARGET = 'http://127.0.0.1:5000';

// Standard HTTP security headers
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// Logging middleware
app.use((req, _res, next) => {
    logger.debug(`[DashboardService] ${req.method} ${req.url}`);
    next();
});

function handleProxyError(label: string) {
    return (err: any, _req: any, res: any) => {
        logger.error(`[DashboardService] ${label} proxy error:`, err);
        if (res && typeof res.status === 'function' && !res.headersSent) {
            res.status(502).json({ error: 'Upstream service unavailable' });
        } else if (res && typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Upstream service unavailable' }));
        } else if (res && typeof res.destroy === 'function') {
            res.destroy();
        }
    };
}

// Proxy /api requests to the Bot/API process
// Explicitly mount on /api. Express strips '/api', so we add it back in the target.
app.use('/api', createProxyMiddleware({
    target: `${API_TARGET}/api`, // Re-adds /api prefix
    changeOrigin: true,
    ws: false,
    on: {
        error: handleProxyError('API'),
    }
}));

// Safety Net: If proxy falls through (shouldn't happen for /api), catch it here.
// API requests should NEVER serve index.html
app.use('/api', (req, res) => {
    logger.warn(`[DashboardService] Unhandled API request fell through: ${req.url}`);
    res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Serve Static Dashboard Files (optional when running bot-only without dashboard/dist)
const dashboardDist = path.join(__dirname, '../../dashboard/dist');
const dashboardIndex = path.join(dashboardDist, 'index.html');

if (!fs.existsSync(dashboardIndex)) {
    logger.warn('[DashboardService] dashboard/dist/index.html not found — /api proxy is active; SPA routes will return 503 until the dashboard is built.');
}

app.use(express.static(dashboardDist));

// Fallback for SPA routing - send index.html for non-API routes when built,
// or a clean 503 message instead of throwing ENOENT in bot-only / unbuilt setups.
// Using RegExp to bypass string path parsing issues in Express 5 / path-to-regexp
app.get(/.*/, (_req, res) => {
    if (!fs.existsSync(dashboardIndex)) {
        res.status(503)
            .type('text/plain')
            .send('Web dashboard is not built (dashboard/dist/index.html not found). Run "cd dashboard && npm run build" or set ENABLE_DASHBOARD=false for bot-only mode.');
        return;
    }
    res.sendFile(dashboardIndex);
});

app.listen(PORT, HOST, () => {
    logger.info(`[DashboardService] Dashboard running at http://${HOST}:${PORT}`);
    logger.info(`[DashboardService] Proxying /api to ${API_TARGET}`);
});
