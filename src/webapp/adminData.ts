import { Router, Request, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { logger } from '../lib/logger';

/**
 * Admin-scoped PostgREST proxy.
 *
 * The dashboard's admin surfaces (global poll browser, server browser, server
 * detail, telemetry charts) used to query Supabase straight from the browser
 * with the anon key. That made every one of those reads available to anybody
 * who opened the JS bundle, because the anon key is public by definition and
 * the tables carried `FOR SELECT USING (true)` policies. The client-side
 * `is_admin` check only decided what got *rendered*.
 *
 * Those reads now come through here: same PostgREST query language (so the
 * client query code is unchanged), but the request is authenticated as an
 * admin first and only then replayed upstream with the service key. The anon
 * key no longer has read access to any of it.
 *
 * Deliberately narrow: reads only, and only against an allowlist. This is a
 * service-key-backed passthrough, so the allowlist is the security boundary —
 * do not widen it to a table without checking what an admin browsing that
 * table implies.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

/** Tables an admin may read through the proxy. */
const ALLOWED_TABLES = new Set([
    'polls',
    'votes',
    'guilds',
    'global_stats',
]);

/** Aggregate RPCs backing the admin telemetry panel. */
const ALLOWED_RPCS = new Set([
    'get_active_voter_count',
    'get_total_members',
    'get_top_creators',
    'get_top_guilds',
    'get_guild_vote_counts',
    'get_poll_vote_counts',
    'get_vote_history',
    'get_global_peak_hours',
    'get_usage_summary',
    'get_botlist_vote_history',
    'get_botlist_vote_totals',
]);

// Headers we pass upstream. PostgREST needs Accept (`.single()` asks for
// application/vnd.pgrst.object+json), Prefer (`{ count: 'exact' }`) and Range
// (pagination) to behave the way the client expects.
const FORWARD_REQUEST_HEADERS = ['accept', 'accept-profile', 'prefer', 'range', 'range-unit'];
// content-range carries the row count back for `{ count: 'exact' }`.
const FORWARD_RESPONSE_HEADERS = ['content-range', 'content-type'];

const router = Router();

router.use(requireAdmin);

router.use(async (req: Request, res: Response) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        logger.error('[Admin Data] SUPABASE_URL / SUPABASE_KEY not configured');
        return res.status(503).json({ error: 'Data backend not configured' });
    }

    // req.path is the remainder after the /api/admin/db mount point. supabase-js
    // builds its own `/rest/v1` prefix, so strip that first:
    //   /rest/v1/polls                -> table read
    //   /rest/v1/rpc/get_top_creators -> aggregate RPC
    const segments = req.path.split('/').filter(Boolean);
    if (segments[0] === 'rest' && segments[1] === 'v1') segments.splice(0, 2);
    const [first, second] = segments;

    let upstreamPath: string;
    if (segments.length === 1 && first && ALLOWED_TABLES.has(first)) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return res.status(405).json({ error: 'Read-only endpoint' });
        }
        upstreamPath = first;
    } else if (segments.length === 2 && first === 'rpc' && second && ALLOWED_RPCS.has(second)) {
        // supabase-js issues RPCs as POST; these are all read-only aggregates.
        if (req.method !== 'POST' && req.method !== 'GET') {
            return res.status(405).json({ error: 'Read-only endpoint' });
        }
        upstreamPath = `rpc/${second}`;
    } else {
        logger.warn(`[Admin Data] Rejected ${req.method} ${req.path}`);
        return res.status(404).json({ error: 'Unknown or disallowed resource' });
    }

    const queryString = req.originalUrl.includes('?')
        ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
        : '';
    const upstreamUrl = `${SUPABASE_URL}/rest/v1/${upstreamPath}${queryString}`;

    const headers: Record<string, string> = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
    };
    for (const name of FORWARD_REQUEST_HEADERS) {
        const value = req.headers[name];
        if (typeof value === 'string') headers[name] = value;
    }

    const init: RequestInit = { method: req.method, headers };
    if (req.method === 'POST') {
        headers['content-type'] = 'application/json';
        // express.json() already consumed the stream, so re-serialize it.
        init.body = JSON.stringify(req.body ?? {});
    }

    try {
        const upstream = await fetch(upstreamUrl, init);

        for (const name of FORWARD_RESPONSE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
        }

        const text = await upstream.text();
        return res.status(upstream.status).send(text);
    } catch (error) {
        logger.error(`[Admin Data] Upstream request failed for ${upstreamPath}:`, error);
        return res.status(502).json({ error: 'Upstream data request failed' });
    }
});

export const adminDataRouter = router;
