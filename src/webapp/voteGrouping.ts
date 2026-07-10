/**
 * Pure grouping logic for the "My Votes" endpoint. A user's multi-select vote
 * is stored as one row per chosen option; the dashboard wants one entry per
 * poll with all chosen options together.
 */

export interface MyVoteRow {
    poll_id: string;
    option_index: number;
    weight: number;
    created_at: string;
    polls: {
        message_id: string;
        title: string;
        guild_id: string;
        channel_id: string;
        active: boolean;
        options: string[];
        guilds: {
            name: string;
            icon_url: string | null;
        };
    };
}

export interface MyVote {
    poll_id: string;
    title: string;
    guild_id: string;
    guild_name: string;
    guild_icon_url: string | null;
    channel_id: string;
    active: boolean;
    chosen_options: string[];
    weight: number;
    voted_at: string;
}

/**
 * Groups raw vote rows (newest-first) into one MyVote per poll, mapping each
 * option_index into the poll's options array (out-of-range indices fall back
 * to "Option N"). Row order is preserved: a poll appears at the position of
 * its most recent vote row.
 */
export function groupVoteRows(rows: MyVoteRow[]): MyVote[] {
    const byPoll = new Map<string, MyVote>();

    for (const row of rows) {
        const poll = row.polls;
        if (!poll) continue; // defensive: inner join should guarantee presence

        const optionLabel = poll.options?.[row.option_index] ?? `Option ${row.option_index + 1}`;

        const existing = byPoll.get(row.poll_id);
        if (existing) {
            existing.chosen_options.push(optionLabel);
            // Keep the newest timestamp (rows arrive newest-first)
            if (row.created_at > existing.voted_at) existing.voted_at = row.created_at;
        } else {
            byPoll.set(row.poll_id, {
                poll_id: row.poll_id,
                title: poll.title,
                guild_id: poll.guild_id,
                guild_name: poll.guilds?.name ?? 'Unknown Server',
                guild_icon_url: poll.guilds?.icon_url ?? null,
                channel_id: poll.channel_id,
                active: poll.active,
                chosen_options: [optionLabel],
                weight: row.weight,
                voted_at: row.created_at,
            });
        }
    }

    return [...byPoll.values()];
}
