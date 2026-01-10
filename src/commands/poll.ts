import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionsBitField, GuildMember, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags, ButtonBuilder, ButtonStyle } from 'discord.js';
import { supabase } from '../lib/db';
import { Renderer } from '../lib/renderer';
import { logger } from '../lib/logger';
import { PollManager } from '../lib/pollManager';
import { I18n } from '../lib/i18n';

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
                .setDescription('Limit who can vote to a specific role')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('weights')
                .setDescription('Vote weights. e.g. @Admin=5, @Mod=2')
                .setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        // 1. Permission Check
        const member = interaction.member as GuildMember;
        // Check for 'Poll Creator' role or 'Manage Guild' permission
        const hasRole = member.roles.cache.some(r => r.name === 'Poll Creator');
        const hasPermission = member.permissions.has(PermissionsBitField.Flags.ManageGuild);

        if (!hasRole && !hasPermission) {
            return interaction.reply({
                content: I18n.t('messages.common.no_permission', interaction.locale),
                flags: MessageFlags.Ephemeral
            });
        }

        // 2. Input Parsing & Validation
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
        const weightsRaw = interaction.options.getString('weights');
        const allowExports = interaction.options.getBoolean('allow_exports') ?? true;

        const allowedRoles = targetRole ? [targetRole.id] : [];
        const voteWeights = weightsRaw ? PollManager.parseWeights(weightsRaw) : {};

        // Fetch Guild Settings
        let serverAllowsButtons = true;
        let serverLocale = 'en'; // Default to English if not set or not in guild

        if (interaction.inGuild()) {
            const { data: guildSettings } = await supabase
                .from('guild_settings')
                .select('allow_poll_buttons, locale')
                .eq('guild_id', interaction.guildId)
                .single();
            if (guildSettings) {
                serverAllowsButtons = guildSettings.allow_poll_buttons;
                if (guildSettings.locale) serverLocale = guildSettings.locale;
            }
        }

        const userWantsButtons = interaction.options.getBoolean('close_button');
        // If server disables, force false. If server allows, use user choice (default true).
        const allowClose = serverAllowsButtons ? (userWantsButtons ?? true) : false;

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

        await interaction.deferReply();

        try {
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

            // 4. Create Components
            const components: ActionRowBuilder<any>[] = [];

            // Row 1: Select Menu
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('poll_vote')
                .setPlaceholder(I18n.t('messages.manager.select_placeholder', serverLocale)) // Use Server Locale
                .setMinValues(minVotes)
                .setMaxValues(maxVotes)
                .addOptions(
                    items.map((item, index) =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(item.substring(0, 100))
                            .setValue(index.toString())
                            .setDescription(I18n.t('messages.manager.vote_option_desc', serverLocale, { index: index + 1 })) // Use Server Locale
                    )
                );

            components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));

            // Row 2: Close Button (if enabled) & View Details Button
            const row2 = new ActionRowBuilder<ButtonBuilder>();

            if (allowClose) {
                const closeButton = new ButtonBuilder()
                    .setCustomId('poll_close')
                    .setLabel(I18n.t('messages.manager.close_button', serverLocale)) // Use Server Locale
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒');
                row2.addComponents(closeButton);
            }

            // View Details Button (Always added if buttons allowed, or maybe just always?)
            // User requested: "If the user has buttons enabled for polls it will add a 'View Details' button"
            if (serverAllowsButtons) {
                const viewButton = new ButtonBuilder()
                    .setCustomId('view_details') // Static ID, we get ID from message context
                    .setLabel(I18n.t('messages.manager.view_details_button', serverLocale))
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊');
                row2.addComponents(viewButton);
            }

            if (row2.components.length > 0) {
                components.push(row2);
            }

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
                const { error } = await supabase.from('polls').insert({
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
                        allow_exports: allowExports
                    },
                    active: true,
                    created_at: new Date().toISOString()
                });

                if (error) {
                    logger.error('Failed to save poll to DB:', error);
                    await interaction.followUp({
                        content: I18n.t('messages.poll.db_fail', interaction.locale),
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} created a poll with the following parameters "/poll title:${title} items:${items.join(', ')} max_votes:${maxVotes} min_votes:${minVotes} public:${isPublic} thread:${createThread} close_button:${allowClose} allowed_roles:${targetRole ? targetRole.name : 'None'} weights:${weightsRaw}"`);
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
