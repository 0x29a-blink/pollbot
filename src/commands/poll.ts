import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, AttachmentBuilder, MessageFlags } from 'discord.js';
import { supabase } from '../lib/db';
import { Renderer } from '../lib/renderer';
import { logger } from '../lib/logger';
import { PollManager } from '../lib/pollManager';
import { I18n } from '../lib/i18n';
import { upsertGuildRow, guildToRow, memberHasManageGuild, memberHasRoleName } from '../lib/guildUtils';
import { endsAtFromDuration } from '../lib/durationUtils';

export default {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create a new poll')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The title for the message embed (max 256 chars)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('items')
                .setDescription('Comma separated items (max 25 items)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('max_votes')
                .setDescription('Maximum number of options a user can select (default: 1)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('min_votes')
                .setDescription('Minimum number of options a user must select (default: 1)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('The description for the message embed (use \\n for newline)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('allow_exports')
                .setDescription('Allow users to view detailed results/export (default: true)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('public')
                .setDescription('Whether to display current vote counts (default: true)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('close_button')
                .setDescription('Whether to add a Close Poll button')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('thread')
                .setDescription('Whether to attach a thread to the poll')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('allowed_role')
                .setDescription('Limit voting to a specific role. Visit pollbot.win to add more roles!')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Auto-close the poll after this long (default: never)')
                .setRequired(false)
                .addChoices(
                    { name: '1 hour', value: '1h' },
                    { name: '6 hours', value: '6h' },
                    { name: '12 hours', value: '12h' },
                    { name: '24 hours', value: '24h' },
                    { name: '48 hours', value: '48h' },
                    { name: '7 days', value: '7d' },
                )),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        // 1. Permission Check (safe when member is evicted from GuildMemberManager cache)
        const hasRole = memberHasRoleName(interaction.guild, interaction.member, 'Poll Creator');
        const hasPermission = memberHasManageGuild(interaction.member);

        if (!hasRole && !hasPermission) {
            return interaction.reply({
                content: I18n.t('messages.common.no_permission', interaction.locale),
                flags: MessageFlags.Ephemeral
            });
        }

        // 2. Input Parsing & Synchronous Validation (run BEFORE DB queries so deferReply never misses Discord's 3s deadline)
        const title = interaction.options.getString('title', true);
        const descriptionRaw = interaction.options.getString('description') || '';
        const itemsRaw = interaction.options.getString('items', true);
        const isPublic = interaction.options.getBoolean('public') ?? true;
        let createThread = interaction.options.getBoolean('thread') ?? false;
        const minVotes = interaction.options.getInteger('min_votes') ?? 1;
        let maxVotes = interaction.options.getInteger('max_votes');

        if (maxVotes === null) {
            maxVotes = Math.max(1, minVotes);
        }
        const targetRole = interaction.options.getRole('allowed_role');
        const allowExports = interaction.options.getBoolean('allow_exports') ?? true;
        const duration = interaction.options.getString('duration');
        const endsAt = duration ? endsAtFromDuration(duration) : null;
        const userWantsButtons = interaction.options.getBoolean('close_button');

        const allowedRoles = targetRole ? [targetRole.id] : [];
        const voteWeights = {}; // Vote weights now managed via dashboard at pollbot.win

        // Title Limit
        if (title.length > 256) {
            return interaction.reply({
                content: I18n.t('messages.poll.title_too_long', interaction.locale, { length: title.length }),
                flags: MessageFlags.Ephemeral
            });
        }

        // Description processing
        const description = descriptionRaw.replace(/\\n/g, '\n');

        if (description.length > 4096) {
            return interaction.reply({
                content: I18n.t('messages.poll.description_too_long', interaction.locale, { length: description.length }),
                flags: MessageFlags.Ephemeral
            });
        }

        // Items processing
        const items = itemsRaw.split(',').map(item => item.trim()).filter(item => item.length > 0);

        if (items.length === 0) {
            return interaction.reply({
                content: I18n.t('messages.poll.items_required', interaction.locale),
                flags: MessageFlags.Ephemeral
            });
        }
        if (items.length > 25) {
            return interaction.reply({
                content: I18n.t('messages.poll.items_too_many', interaction.locale, { count: items.length }),
                flags: MessageFlags.Ephemeral
            });
        }

        // Max/Min Votes Validation
        if (maxVotes > items.length) {
            return interaction.reply({
                content: I18n.t('messages.poll.max_votes_exceeded', interaction.locale, { max: maxVotes, items: items.length }),
                flags: MessageFlags.Ephemeral
            });
        }
        if (minVotes > maxVotes) {
            return interaction.reply({
                content: I18n.t('messages.poll.min_votes_error', interaction.locale, { min: minVotes, max: maxVotes }),
                flags: MessageFlags.Ephemeral
            });
        }
        if (minVotes > items.length) {
            return interaction.reply({
                content: I18n.t('messages.poll.min_votes_exceeded', interaction.locale, { min: minVotes, items: items.length }),
                flags: MessageFlags.Ephemeral
            });
        }

        // Item char limit check
        const invalidItems = items.filter(i => i.length > 100);
        if (invalidItems.length > 0) {
            return interaction.reply({
                content: I18n.t('messages.poll.item_too_long', interaction.locale, { items: invalidItems.join('\n') }),
                flags: MessageFlags.Ephemeral
            });
        }

        // Check bot permissions in this channel before creating the poll
        const botMember = interaction.guild?.members.me;
        const channel = interaction.channel;
        
        if (botMember && channel && 'permissionsFor' in channel) {
            const botPerms = channel.permissionsFor(botMember);
            const requiredPerms = [
                { flag: PermissionsBitField.Flags.ViewChannel, name: 'View Channel' },
                { flag: PermissionsBitField.Flags.SendMessages, name: 'Send Messages' },
                { flag: PermissionsBitField.Flags.AttachFiles, name: 'Attach Files' },
                { flag: PermissionsBitField.Flags.EmbedLinks, name: 'Embed Links' },
            ];
            
            const missingPerms = requiredPerms.filter(p => !botPerms?.has(p.flag));
            
            if (missingPerms.length > 0) {
                const missingList = missingPerms.map(p => p.name).join(', ');
                return interaction.reply({
                    content: I18n.t('messages.poll.missing_bot_perms', interaction.locale, { permissions: missingList }),
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        await interaction.deferReply();

        try {
            // Fetch Guild Settings after deferring so network latency never causes Unknown Interaction
            let serverAllowsButtons = true;
            let serverLocale = 'en';

            const { data: guildSettings } = await supabase
                .from('guild_settings')
                .select('allow_poll_buttons, locale')
                .eq('guild_id', interaction.guildId)
                .maybeSingle();
            if (guildSettings) {
                serverAllowsButtons = guildSettings.allow_poll_buttons;
                if (guildSettings.locale) serverLocale = guildSettings.locale;
            }

            // If server disables, force false. If server allows, use user choice (default true).
            const allowClose = serverAllowsButtons ? (userWantsButtons ?? true) : false;

            // 3. Render Poll Image (Playwright)
            const resolvedTitle = await PollManager.resolveMentions(title, interaction.guild);
            const resolvedDescription = await PollManager.resolveMentions(description, interaction.guild);
            const resolvedItems = await Promise.all(items.map(async (item) => await PollManager.resolveMentions(item, interaction.guild)));

            const imageBuffer = await Renderer.renderPoll({
                title: resolvedTitle,
                description: resolvedDescription,
                options: resolvedItems,
                creator: interaction.user.tag,
                locale: serverLocale
            });

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

            // 4. Create Components via centralized helper
            const components = PollManager.buildPollComponents({
                options: items,
                settings: {
                    min_votes: minVotes,
                    max_votes: maxVotes,
                    allow_close: allowClose,
                },
                active: true,
                serverAllowsButtons,
                serverLocale,
            });

            // Send Message
            const message = await interaction.editReply({
                files: [attachment],
                components: components
            });

            // 5. Create Thread if requested
            if (createThread) {
                try {
                    await message.startThread({
                        name: title.substring(0, 100),
                        autoArchiveDuration: 1440,
                    });
                } catch (threadError: any) {
                    if (threadError.code === 50001 || threadError.code === 50013) {
                        logger.warn(`Failed to create thread for poll ${message.id}: Missing Permissions`);
                        await interaction.followUp({
                            content: I18n.t('messages.poll.thread_fail', interaction.locale),
                            flags: MessageFlags.Ephemeral
                        });
                        createThread = false; // Update state so DB knows thread wasn't created
                    } else {
                        // Re-throw other unexpected errors? Or just log and ignore to save the poll?
                        // Better to log and continue so the poll itself isn't lost.
                        logger.error('Unexpected error creating thread:', threadError);
                    }
                }
            }

            // 6. Save to Database
            if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
                // Build role metadata for dashboard display
                const roleMetadata: Record<string, { name: string; color: number }> = {};
                if (targetRole) {
                    roleMetadata[targetRole.id] = {
                        name: targetRole.name,
                        color: typeof targetRole.color === 'number' ? targetRole.color : 0
                    };
                }

                const pollRow = {
                    message_id: message.id,
                    channel_id: interaction.channelId,
                    guild_id: interaction.guildId,
                    creator_id: interaction.user.id,
                    title: title,
                    description: description,
                    options: items, // As JSONB array
                    settings: {
                        public: isPublic,
                        allow_thread: createThread,
                        allow_close: allowClose,
                        max_votes: maxVotes,
                        min_votes: minVotes,
                        allowed_roles: allowedRoles,
                        vote_weights: voteWeights,
                        allow_exports: allowExports,
                        role_metadata: Object.keys(roleMetadata).length > 0 ? roleMetadata : undefined
                    },
                    active: true,
                    created_at: new Date().toISOString(),
                    ends_at: endsAt
                };

                let { error } = await supabase.from('polls').insert(pollRow);

                // FK violation (23503): the guild row can be missing if the bot joined
                // this guild while offline or the sync failed. Sync it and retry once.
                if (error?.code === '23503' && interaction.guild) {
                    logger.warn(`Guild ${interaction.guildId} missing from guilds table. Syncing and retrying poll insert...`);
                    if (await upsertGuildRow(guildToRow(interaction.guild))) {
                        ({ error } = await supabase.from('polls').insert(pollRow));
                    }
                }

                if (error) {
                    logger.error('Failed to save poll to DB:', error);
                    await interaction.followUp({
                        content: I18n.t('messages.poll.db_fail', interaction.locale),
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} created a poll with the following parameters "/poll title:${title} items:${items.join(', ')} max_votes:${maxVotes} min_votes:${minVotes} public:${isPublic} thread:${createThread} close_button:${allowClose} allowed_role:${targetRole ? targetRole.name : 'None'}"`);
                    
                    // Notify user about the web dashboard
                    await interaction.followUp({
                        content: '✨ **New!** Manage your polls and see votes in a cleaner, modern view on our web dashboard: https://pollbot.win',
                        flags: MessageFlags.Ephemeral
                    });
                }
            } else {
                logger.warn('Skipping DB save (no credentials)');
            }

        } catch (err) {
            logger.error('Error processing poll:', err);
            await interaction.followUp({
                content: I18n.t('messages.poll.generic_error', interaction.locale),
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
