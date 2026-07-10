import { logger } from './logger';

/**
 * Per-poll coalescing of poll-image re-renders.
 *
 * Every vote triggers a full Playwright render plus a Discord message edit. On a
 * popular poll receiving many votes in quick succession that means N renders and
 * N edits (and Discord rate-limits edits to ~5 per 5s per channel), for a final
 * image that only needs to be produced once.
 *
 * scheduleRender() debounces on a trailing edge per poll: rapid successive calls
 * for the same poll collapse into a single render that runs shortly after the
 * last vote, always executing the most recently supplied job (which re-reads the
 * current vote totals at execution time).
 */
type RenderJob = () => Promise<void>;

const DEBOUNCE_MS = 1000;

const pendingTimers = new Map<string, NodeJS.Timeout>();

export function scheduleRender(pollId: string, job: RenderJob): void {
    const existing = pendingTimers.get(pollId);
    if (existing) {
        clearTimeout(existing);
    }

    const timer = setTimeout(() => {
        pendingTimers.delete(pollId);
        job().catch(err => {
            logger.error(`[RenderQueue] Coalesced render failed for poll ${pollId}:`, err);
        });
    }, DEBOUNCE_MS);

    // Don't let a pending render keep the process alive on its own.
    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    pendingTimers.set(pollId, timer);
}
