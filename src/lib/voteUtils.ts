import { supabase } from './db';
import { logger } from './logger';

/**
 * Vote aggregation result containing counts per option and totals.
 */
export interface VoteAggregation {
    /** Weighted vote count per option index */
    counts: number[];
    /** Sum of all vote weights */
    totalWeight: number;
    /** Number of distinct voters (raw count, not weighted) */
    uniqueVoters: number;
}

/**
 * Aggregates votes for a poll, calculating weighted counts per option.
 * 
 * This is the single source of truth for vote counting logic.
 * All code that needs vote counts should use this function.
 * 
 * @param pollId - The poll message ID
 * @param optionCount - Number of options in the poll
 * @returns VoteAggregation with counts, totalWeight, and uniqueVoters
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
        };
    }

    const counts = new Array(optionCount).fill(0);
    let totalWeight = 0;
    const uniqueUserIds = new Set<string>();

    if (votes) {
        for (const vote of votes) {
            const weight = vote.weight || 1; // Default to 1 if null
            const optionIndex = vote.option_index;

            if (optionIndex >= 0 && optionIndex < optionCount) {
                counts[optionIndex] += weight;
                totalWeight += weight;
            }

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
 * Gets vote counts as a Record for API responses.
 * 
 * @param pollId - The poll message ID
 * @param options - Array of poll options (used for length)
 * @returns Record mapping option index to weighted vote count
 */
export async function getVoteCountsForPoll(
    pollId: string,
    options: string[]
): Promise<{ voteCounts: Record<number, number>; totalVotes: number }> {
    const aggregation = await aggregateVotes(pollId, options.length);

    const voteCounts: Record<number, number> = {};
    aggregation.counts.forEach((count, index) => {
        voteCounts[index] = count;
    });

    return {
        voteCounts,
        totalVotes: aggregation.totalWeight,
    };
}

/**
 * Gets raw vote counts (unweighted) for a poll.
 * Used for display when weights are not relevant.
 * 
 * @param pollId - The poll message ID
 * @param optionCount - Number of options
 * @returns Array of raw counts per option
 */
export async function getRawVoteCounts(pollId: string, optionCount: number): Promise<number[]> {
    const { data: votes, error } = await supabase
        .from('votes')
        .select('option_index')
        .eq('poll_id', pollId);

    if (error || !votes) {
        return new Array(optionCount).fill(0);
    }

    const counts = new Array(optionCount).fill(0);
    for (const vote of votes) {
        if (vote.option_index >= 0 && vote.option_index < optionCount) {
            counts[vote.option_index]++;
        }
    }

    return counts;
}
