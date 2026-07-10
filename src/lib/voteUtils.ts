import { supabase } from './db';
import { logger } from './logger';

/**
 * A single vote row as stored in the `votes` table (only the columns
 * relevant to aggregation).
 */
export interface VoteRow {
    option_index: number | null;
    weight?: number | null;
    user_id?: string | null;
}

/**
 * Vote aggregation result containing counts per option and totals.
 */
export interface VoteAggregation {
    /** Weighted vote count per option index */
    counts: number[];
    /** Sum of all vote weights (weighted total) */
    totalWeight: number;
    /** Number of distinct voters (raw count, not weighted) */
    uniqueVoters: number;
    /**
     * True when the underlying query failed and `counts`/`totalWeight` are a
     * zero-filled fallback rather than real data. Callers that render the poll
     * image MUST check this and skip re-rendering, otherwise a transient DB
     * error would overwrite the live poll with "0 votes".
     */
    error: boolean;
}

/**
 * Pure aggregation over already-fetched vote rows. This is the single source of
 * truth for how weighted counts are computed and is trivially unit-testable
 * (no database dependency).
 *
 * - Weight defaults to 1 when null/undefined/0-ish per row.
 * - Rows whose `option_index` is out of range are excluded from the per-option
 *   counts and from `totalWeight`, but still counted toward `uniqueVoters`.
 */
export function aggregateVoteRows(votes: VoteRow[], optionCount: number): Omit<VoteAggregation, 'error'> {
    const counts = new Array(optionCount).fill(0);
    let totalWeight = 0;
    const uniqueUserIds = new Set<string>();

    for (const vote of votes) {
        const weight = vote.weight || 1; // Default to 1 if null/0
        const optionIndex = vote.option_index;

        if (optionIndex !== null && optionIndex >= 0 && optionIndex < optionCount) {
            counts[optionIndex] += weight;
            totalWeight += weight;
        }

        if (vote.user_id) {
            uniqueUserIds.add(vote.user_id);
        }
    }

    return {
        counts,
        totalWeight,
        uniqueVoters: uniqueUserIds.size,
    };
}

/**
 * Aggregates votes for a poll, calculating weighted counts per option.
 *
 * This is the single source of truth for vote counting logic. All code that
 * needs vote counts should use this function so that weighting is applied
 * consistently everywhere (live voting, close/reopen, dashboard, export).
 *
 * On query failure it returns a zero-filled result with `error: true` so the
 * caller can decide whether to skip rendering rather than silently displaying
 * zeros.
 *
 * @param pollId - The poll message ID
 * @param optionCount - Number of options in the poll
 */
export async function aggregateVotes(pollId: string, optionCount: number): Promise<VoteAggregation> {
    const { data: votes, error } = await supabase
        .from('votes')
        .select('option_index, weight, user_id')
        .eq('poll_id', pollId);

    if (error) {
        logger.error(`[VoteUtils] Failed to aggregate votes for poll ${pollId}:`, error);
        return {
            counts: new Array(optionCount).fill(0),
            totalWeight: 0,
            uniqueVoters: 0,
            error: true,
        };
    }

    return {
        ...aggregateVoteRows((votes as VoteRow[]) || [], optionCount),
        error: false,
    };
}

export interface ReplaceVotesResult {
    ok: boolean;
    /** True when the poll row is missing (FK violation, Postgres 23503). */
    fkViolation?: boolean;
}

/**
 * Atomically replaces a user's votes on a poll with a new set of option indices.
 *
 * Prefers the `replace_vote` Postgres function, which performs the delete+insert
 * inside a single transaction so a failed insert can never leave the user with
 * zero recorded votes. If that function is not present (migration not applied
 * yet), it falls back to an insert-first / delete-stale ordering that is still
 * safe: a failure at any point leaves the user's previous votes intact rather
 * than erasing them.
 */
export async function replaceUserVotes(
    pollId: string,
    userId: string,
    optionIndices: number[],
    weight: number
): Promise<ReplaceVotesResult> {
    const { error } = await supabase.rpc('replace_vote', {
        p_poll_id: pollId,
        p_user_id: userId,
        p_options: optionIndices,
        p_weight: weight,
    });

    if (!error) {
        return { ok: true };
    }

    if (error.code === '23503') {
        return { ok: false, fkViolation: true };
    }

    // PostgREST reports a missing function as PGRST202; Postgres itself as 42883.
    const missingFunction =
        error.code === 'PGRST202' ||
        error.code === '42883' ||
        /replace_vote/i.test(error.message || '');

    if (!missingFunction) {
        logger.error('[VoteUtils] replace_vote RPC failed:', error);
        return { ok: false };
    }

    return replaceUserVotesFallback(pollId, userId, optionIndices, weight);
}

/**
 * Fallback for {@link replaceUserVotes} when the atomic RPC is unavailable.
 * Insert-first ordering guarantees a partial failure never zeroes out a vote.
 */
async function replaceUserVotesFallback(
    pollId: string,
    userId: string,
    optionIndices: number[],
    weight: number
): Promise<ReplaceVotesResult> {
    const rows = optionIndices.map(index => ({
        poll_id: pollId,
        user_id: userId,
        option_index: index,
        weight,
    }));

    const { error: upsertError } = await supabase
        .from('votes')
        .upsert(rows, { onConflict: 'poll_id,user_id,option_index' });

    if (upsertError) {
        if (upsertError.code === '23503') {
            return { ok: false, fkViolation: true };
        }
        logger.error('[VoteUtils] Vote upsert failed:', upsertError);
        return { ok: false };
    }

    // Remove any previously-selected options the user no longer wants. If this
    // cleanup fails the user simply keeps extra (stale) options until their next
    // vote — never worse than losing their vote entirely.
    if (optionIndices.length > 0) {
        const { error: deleteError } = await supabase
            .from('votes')
            .delete()
            .eq('poll_id', pollId)
            .eq('user_id', userId)
            .not('option_index', 'in', `(${optionIndices.join(',')})`);

        if (deleteError) {
            logger.warn('[VoteUtils] Stale vote cleanup failed (non-fatal):', deleteError);
        }
    }

    return { ok: true };
}

/**
 * Gets weighted vote counts as a Record for API responses.
 *
 * @returns `voteCounts` keyed by option index, `totalVotes` (weighted total),
 *          and `error` propagated from {@link aggregateVotes}.
 */
export async function getVoteCountsForPoll(
    pollId: string,
    options: string[]
): Promise<{ voteCounts: Record<number, number>; totalVotes: number; error: boolean }> {
    const aggregation = await aggregateVotes(pollId, options.length);

    const voteCounts: Record<number, number> = {};
    aggregation.counts.forEach((count, index) => {
        voteCounts[index] = count;
    });

    return {
        voteCounts,
        totalVotes: aggregation.totalWeight,
        error: aggregation.error,
    };
}
