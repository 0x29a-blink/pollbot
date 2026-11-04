import { Guild } from 'discord.js';
import { supabase } from './db';
import { logger } from './logger';
import { fetchMembersChunked, formatCsvCell } from './guildUtils';
import { fetchAllPollVotes } from './voteUtils';

export class ExportManager {
    /**
     * Generates a CSV string of votes for a given poll.
     * @param pollId The message ID of the poll.
     * @param guild The Guild object to fetch members from (also enforces same-guild scoping).
     * @param _locale The locale for localization (header names, etc. if needed, though CSV usually standard).
     * @returns A string containing the CSV data, or null if poll not found/error.
     */
    static async generateCsv(pollId: string, guild: Guild, _locale: string = 'en'): Promise<string | null> {
        try {
            // 1. Validate Poll & Fetch Options (scoped to guild.id to prevent cross-server IDOR)
            const { data: pollData, error: pollError } = await supabase
                .from('polls')
                .select('options, title, guild_id')
                .eq('message_id', pollId)
                .eq('guild_id', guild.id)
                .maybeSingle();

            if (pollError || !pollData) {
                logger.warn(`Export failed: Poll ${pollId} not found or error: ${pollError?.message}`);
                return null;
            }

            const options = pollData.options as string[];

            // 2. Fetch Votes (paginated past PostgREST 1,000-row cap)
            const { data: votes, error: votesError } = await fetchAllPollVotes(pollId);

            if (votesError) {
                logger.error(`Export failed: Error fetching votes for ${pollId}: ${votesError.message}`);
                throw new Error('Failed to fetch votes');
            }

            if (!votes || votes.length === 0) {
                return 'No votes found for this poll.';
            }

            // 3. Batch Fetch Members (chunked at 100 IDs per Gateway request)
            const userIds = [...new Set(votes.map(v => v.user_id))];

            const membersMap = new Map<string, { username: string, displayName: string, nickname: string | null }>();
            const fetchedMembers = await fetchMembersChunked(guild, userIds);
            fetchedMembers.forEach(member => {
                membersMap.set(member.id, {
                    username: member.user.username,
                    displayName: member.user.globalName || member.user.username,
                    nickname: member.nickname
                });
            });

            // 4. Build CSV
            // Headers
            const headers = ['User ID', 'Username', 'Display Name', 'Nickname', 'Option Index', 'Option Label', 'Timestamp (ISO)'];
            const rows = votes.map(vote => {
                const memberData = membersMap.get(vote.user_id);
                // Fallbacks for missing members (left guild, etc.)
                const username = memberData?.username || 'Unknown (Left Guild)';
                const displayName = memberData?.displayName || 'Unknown';
                const nickname = memberData?.nickname || 'N/A';

                const optionIdx = vote.option_index ?? -1;
                const optionLabel = (optionIdx >= 0 && optionIdx < options.length)
                    ? options[optionIdx]
                    : 'Unknown Option';

                return [
                    formatCsvCell(vote.user_id),
                    formatCsvCell(username),
                    formatCsvCell(displayName),
                    formatCsvCell(nickname),
                    optionIdx,
                    formatCsvCell(optionLabel),
                    formatCsvCell(vote.created_at)
                ].join(',');
            });

            return [headers.join(','), ...rows].join('\n');

        } catch (error) {
            logger.error(`ExportManager Error: ${error}`);
            throw error;
        }
    }
}
