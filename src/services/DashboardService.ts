import express from 'express';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';
import { logger } from '../lib/logger';

dotenv.config();

const app = express();
const PORT = 7500;
const API_TARGET = 'http://localhost:5000';

// Logging middleware
app.use((req, res, next) => {
    logger.debug(`[DashboardService] ${req.method} ${req.url}`);
    next();
});

// Proxy /api requests to the Bot/API process
// Note: app.use('/api', ...) strips '/api' from the req.url
// So we proxy to http://localhost:5000/api to restore it.
// Proxy /api requests to the Bot/API process
// Root mount + pathFilter is the safest way to preserve paths
app.use(createProxyMiddleware({
    target: 'http://127.0.0.1:5000',
    changeOrigin: true,
    ws: true,
    pathFilter: ['/api', '/api/**'],
    // @ts-ignore - v3 types might differ, but this is the standard error handler key
    on: {
        error: (err: any, req: any, res: any) => {
            logger.error('[DashboardService] Proxy error:', err);
            res.status(502).json({ error: 'Proxy Error', details: err.message });
        },
        proxyReq: (proxyReq: any, req: any, res: any) => {
            // Log outgoing proxy requests for debug
            // console.log(`[DashboardService] Proxying ${req.method} ${req.url} -> ${proxyReq.path}`);
        }
    }
}));

// Safety Net: If proxy falls through (shouldn't happen for /api), catch it here.
// API requests should NEVER serve index.html
app.use('/api', (req, res) => {
    logger.warn(`[DashboardService] Unhandled API request fell through: ${req.url}`);
    res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Proxy /supabase requests if we are proxying Supabase Realtime (optional, based on vite config)
// The previous vite config proxied /supabase to the actual Supabase URL.
// If the dashboard uses the Supabase Client interacting with the Bot's proxy, we need this.
// Checking vite.config.ts from previous turns, it was proxying /supabase to env.VITE_SUPABASE_URL.
// Since we are now serving static files, that Vite proxy is GONE.
// We should replicate that proxy behavior here if the client relies on it for avoiding CORS or similar.
// However, Supabase client usually calls Supabase directly. usage of /supabase proxy in vite suggests they might be hiding the URL or handling auth cookies? 
// The Vite config had: 
// '/supabase': { target: supabaseUrl, changeOrigin: true, rewrite: path => path.replace(/^\/supabase/, '') }
// We should support that.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;

if (SUPABASE_URL) {
    app.use('/supabase', createProxyMiddleware({
        target: SUPABASE_URL,
        changeOrigin: true,
        ws: true,
        pathRewrite: {
            '^/supabase': ''
        }
    }));
}

// Serve Static Dashboard Files
const dashboardDist = path.join(__dirname, '../../dashboard/dist');
app.use(express.static(dashboardDist));

// Fallback for SPA routing - send index.html for non-API 404s
app.get('*', (req, res) => {
    res.sendFile(path.join(dashboardDist, 'index.html'));
});

app.listen(PORT, () => {
    logger.info(`[DashboardService] Dashboard running at http://localhost:${PORT}`);
    logger.info(`[DashboardService] Proxying /api to ${API_TARGET}`);
    if (SUPABASE_URL) {
        logger.info(`[DashboardService] Proxying /supabase to ${SUPABASE_URL}`);
    }
});
