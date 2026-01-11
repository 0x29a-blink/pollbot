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
app.use('/api', createProxyMiddleware({
    target: 'http://localhost:5000/api',
    changeOrigin: true,
    ws: true,
}));

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
