import { Client, Guild, User } from 'discord.js';
import { supabase } from './db';
import { logger } from './logger';
import { I18n } from './i18n';

export class ExportManager {
    /**
     * Generates a CSV string of votes for a given poll.
     * @param pollId The message ID of the poll.
     * @param guild The Guild object to fetch members from.
     * @param locale The locale for localization (header names, etc. if needed, though CSV usually standard).
     * @returns A string containing the CSV data, or null if poll not found/error.
     */
    static async generateCsv(pollId: string, guild: Guild, locale: string = 'en'): Promise<string | null> {
        try {
            // 1. Validate Poll & Fetch Options
            const { data: pollData, error: pollError } = await supabase
                .from('polls')
                .select('options, title')
                .eq('message_id', pollId)
                .single();

            if (pollError || !pollData) {
                logger.warn(`Export failed: Poll ${pollId} not found or error: ${pollError?.message}`);
                return null;
            }

            const options = pollData.options as string[];

            // 2. Fetch Votes
            const { data: votes, error: votesError } = await supabase
                .from('votes')
                .select('user_id, option_index, created_at')
                .eq('poll_id', pollId);

            if (votesError) {
                logger.error(`Export failed: Error fetching votes for ${pollId}: ${votesError.message}`);
                throw new Error('Failed to fetch votes');
            }

            if (!votes || votes.length === 0) {
                return 'No votes found for this poll.';
            }

            // 3. Batch Fetch Members
            const userIds = [...new Set(votes.map(v => v.user_id))];

            let membersMap = new Map<string, { username: string, displayName: string, nickname: string | null }>();

            try {
                // Fetch members in a single batch
                const fetchedMembers = await guild.members.fetch({ user: userIds });

                fetchedMembers.forEach(member => {
                    membersMap.set(member.id, {
                        username: member.user.username,
                        displayName: member.user.globalName || member.user.username,
                        nickname: member.nickname
                    });
                });
            } catch (err) {
                logger.warn(`Export: partial or failed member fetch for poll ${pollId}. Proceeding with missing data. Error: ${err}`);
            }

            // 4. Build CSV
            // Headers
            const headers = ['User ID', 'Username', 'Display Name', 'Nickname', 'Option Index', 'Option Label', 'Timestamp (ISO)'];
            const rows = votes.map(vote => {
                const memberData = membersMap.get(vote.user_id);
                // Fallbacks for missing members (left guild, etc.)
                const username = memberData?.username || 'Unknown (Left Guild)';
                const displayName = memberData?.displayName || 'Unknown';
                const nickname = memberData?.nickname || 'N/A';

                const optionLabel = (vote.option_index >= 0 && vote.option_index < options.length)
                    ? options[vote.option_index]
                    : 'Unknown Option';

                // Escape double quotes in fields to prevent CSV breakage
                const safe = (str: string | null | undefined) => {
                    if (!str) return '';
                    return `"${str.replace(/"/g, '""')}"`;
                };

                return [
                    safe(vote.user_id),
                    safe(username),
                    safe(displayName),
                    safe(nickname),
                    vote.option_index, // Number doesn't strictly need quotes but safe() handles strings
                    safe(optionLabel),
                    safe(vote.created_at)
                ].join(',');
            });

            return [headers.join(','), ...rows].join('\n');

        } catch (error) {
            logger.error(`ExportManager Error: ${error}`);
            throw error;
        }
    }
}
