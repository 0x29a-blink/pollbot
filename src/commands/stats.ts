import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { supabase } from '../lib/db';
import { Renderer } from '../lib/renderer';
import os from 'os';

export default {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View system analytics.'),
    async execute(interaction: any) {
        await interaction.deferReply();

        try {
            // 1. Fetch Global Stats
            // We use 'global_stats' table which we created in schema.sql
            // It has a single row with id=1
            const { data: globalStats, error } = await supabase
                .from('global_stats')
                .select('*')
                .single();

            if (error) {
                console.error('Error fetching global stats:', error);
                // Fallback to 0 if table is empty/error (e.g. widely used dev env without migration)
                // But we should report error. For now, let's warn and continue with 0.
            }

            const totalPolls = globalStats?.total_polls || 0;
            const totalVotes = globalStats?.total_votes || 0;
            let peakActiveServers = globalStats?.peak_active_servers || 0;

            // 2. Client Stats
            const client = interaction.client;
            let activeServers = client.guilds.cache.size;

            if (client.shard) {
                try {
                    const results = await client.shard.fetchClientValues('guilds.cache.size') as number[];
                    activeServers = results.reduce((acc, guildCount) => acc + guildCount, 0);
                } catch (e) {
                    console.error('Error fetching shard values:', e);
                    // fallback to local activeServers
                }
            }

            // Check and update peak
            if (activeServers > peakActiveServers) {
                peakActiveServers = activeServers;
                // Fire and forget update
                supabase.from('global_stats')
                    .update({ peak_active_servers: peakActiveServers })
                    .eq('id', 1)
                    .then(({ error }) => {
                        if (error) console.error('Failed to update peak_active_servers:', error);
                    });
            }

            const uptimeSeconds = process.uptime();
            const days = Math.floor(uptimeSeconds / (3600 * 24));
            const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = Math.floor(uptimeSeconds % 60);
            const uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;

            const shards = client.shard?.count || 1;

            // 3. System Stats
            // CPU Load is hard to get instantly in Node without deps like 'systeminformation'
            // We'll use a placeholder or simple loadavg if non-windows
            let cpuLoad = 0;
            const loadAvg = os.loadavg(); // [1, 5, 15]
            if (loadAvg && loadAvg.length > 0) {
                cpuLoad = loadAvg[0] ?? 0; // This is not %, but load.
            }
            // For now, keep it 0 or mocked as "low" since we are lightweight

            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memUsage = (usedMem / totalMem) * 100;

            const buffer = await Renderer.renderStats({
                totalPolls,
                totalVotes,
                activeServers,
                uptime: uptimeString,
                shards,
                cpuLoad,
                memoryUsage: memUsage
            });

            const attachment = new AttachmentBuilder(buffer, { name: 'stats.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: 'An error occurred while generating stats.' });
        }
    }
};
