import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionsBitField, GuildMember, ChannelType } from 'discord.js';
import { supabase } from '../lib/db';

export default {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create a new poll')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The title for the message embed (max 256 chars)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('The description for the message embed (use \\n for newline)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('items')
                .setDescription('Comma separated items (max 25 items)')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('public')
                .setDescription('Whether to display current vote counts')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('thread')
                .setDescription('Whether to attach a thread to the poll')
                .setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
        // 1. Permission Check
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        const member = interaction.member as GuildMember;
        const hasManageGuild = member.permissions.has(PermissionsBitField.Flags.ManageGuild);

        // Check for Poll Manager role
        const pollManagerRole = member.roles.cache.find(r => r.name === 'Poll Manager');
        const hasRole = !!pollManagerRole;

        if (!hasManageGuild && !hasRole) {
            // Check if the role even exists in the guild
            const guildRoleExists = interaction.guild?.roles.cache.find(r => r.name === 'Poll Manager');

            if (!guildRoleExists) {
                return interaction.reply({
                    content: 'You do not have the required permissions. This server also lacks the "Poll Manager" role configuration. Ask an admin to create a role named "Poll Manager" and assign it to you, or have "Manage Server" permissions.',
                    ephemeral: true
                });
            }

            return interaction.reply({
                content: 'You do not have permission to create polls. You need the "Manage Server" permission or the "Poll Manager" role.',
                ephemeral: true
            });
        }

        // 2. Input Parsing & Validation
        const title = interaction.options.getString('title', true);
        const descriptionRaw = interaction.options.getString('description', true);
        const itemsRaw = interaction.options.getString('items', true);
        const isPublic = interaction.options.getBoolean('public', true);
        const createThread = interaction.options.getBoolean('thread') || false;

        // Title Limit
        if (title.length > 256) {
            return interaction.reply({ content: `Title is too long! (${title.length}/256 characters)`, ephemeral: true });
        }

        // Description processing (\n literal to newline)
        // Only replace literal "\n" strings that user typed
        const description = descriptionRaw.replace(/\\n/g, '\n');

        if (description.length > 4096) {
            return interaction.reply({ content: `Description is too long! (${description.length}/4096 characters)`, ephemeral: true });
        }

        // Items processing
        const items = itemsRaw.split(',').map(item => item.trim()).filter(item => item.length > 0);

        if (items.length === 0) {
            return interaction.reply({ content: 'You must provide at least one valid item.', ephemeral: true });
        }
        if (items.length > 25) {
            return interaction.reply({ content: `Too many items! You provided ${items.length}, max is 25.`, ephemeral: true });
        }

        // Item char limit check
        const invalidItems = items.filter(i => i.length > 100);
        if (invalidItems.length > 0) {
            return interaction.reply({ content: `The following items exceed 100 characters:\n${invalidItems.join('\n')}`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            // 3. Create Embed
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(0x00AE86) // Teal-ish color
                .setTimestamp()
                .setFooter({ text: `Created by ${interaction.user.tag}` });

            // Add fields for items? Or just description? 
            // The prompt says "Polls are created...". Usually polls use reactions or buttons.
            // Since "recreating the bot", I need to assume how voting works.
            // Standard discord polls often map items to emojis. 
            // OR use Button Components. 
            // Given "highly detailed and complex", Button components are better for "Pollbot" 2.0.
            // But for simple "single voting polls" structure now, I'll list options in the embed.

            // For now, I will format the items in the description or fields to show options.
            // Let's add them as a list in the embed description for clarity if not using fields.
            // Actually, let's append them to the description for now.

            // Let's construct a formatted options block
            const optionsFormatted = items.map((item, index) => {
                // If we were using standard emojis we'd map here.
                // For now just bullet points.
                return `• ${item}`;
            }).join('\n');

            embed.addFields({ name: 'Options', value: optionsFormatted });

            const message = await interaction.editReply({ embeds: [embed] });

            // 4. Create Thread if requested
            if (createThread) {
                await message.startThread({
                    name: title.substring(0, 100), // Max thread name is 100?
                    autoArchiveDuration: 1440, // 24 hours
                });
            }

            // 5. Save to Database
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
                        allow_thread: createThread
                    },
                    active: true,
                    created_at: new Date().toISOString()
                });

                if (error) {
                    console.error('Failed to save poll to DB:', error);
                    await interaction.followUp({ content: 'Poll created, but failed to save to database. Persistence may be compromised.', ephemeral: true });
                }
            } else {
                console.warn('Skipping DB save (no credentials)');
            }

            // TODO: Add Buttons/Reactions for voting in the next step.
            // The prompt "To start let's get the single voting polls structured" implies getting the data model and display right first.
            // I haven't added the "voting" mechanic (interaction collector) yet, just the creation.

        } catch (err) {
            console.error(err);
            await interaction.followUp({ content: 'Something went wrong processing your poll.', ephemeral: true });
        }
    }
};
