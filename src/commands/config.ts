import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, MessageFlags, GuildMember } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';

export default {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure Poll Bot settings for this server')
        .addSubcommand(subcommand =>
            subcommand
                .setName('poll-buttons')
                .setDescription('Enable or disable poll buttons (Close/Reopen)')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Whether to enable poll buttons')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('locale')
                .setDescription('Set the preferred locale for this server')
                .addStringOption(option =>
                    option.setName('lang')
                        .setDescription('The language to use')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('weights')
                .setDescription('Manage global vote weights for roles')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('set')
                        .setDescription('Set weight for a role')
                        .addRoleOption(option =>
                            option.setName('role')
                                .setDescription('The role to assign weight to')
                                .setRequired(true))
                        .addIntegerOption(option =>
                            option.setName('value')
                                .setDescription('The vote weight value')
                                .setRequired(true)
                                .setMinValue(1)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('remove')
                        .setDescription('Remove weight for a role')
                        .addRoleOption(option =>
                            option.setName('role')
                                .setDescription('The role to remove weight from')
                                .setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('view')
                        .setDescription('View current weight configuration'))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('clear')
                        .setDescription('Clear all weight configurations'))
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const member = interaction.member as GuildMember;
        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: I18n.t('messages.common.no_permission', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        let subcommand, subcommandGroup;
        try {
            subcommand = interaction.options.getSubcommand();
            subcommandGroup = interaction.options.getSubcommandGroup();
        } catch (e) {
            // Should not happen if builder is correct
        }

        const guildId = interaction.guildId!;

        if (subcommandGroup === 'weights') {
            // Fetch current settings
            const { data: currentSettings, error: fetchError } = await supabase
                .from('guild_settings')
                .select('vote_weights')
                .eq('guild_id', guildId)
                .single();

            if (fetchError && fetchError.code !== 'PGRST116') { // Ignore not found, treat as empty
                logger.error('Failed to fetch guild settings:', fetchError);
                return interaction.reply({ content: I18n.t('messages.config.update_fail', interaction.locale), flags: MessageFlags.Ephemeral });
            }

            let weights = (currentSettings?.vote_weights as Record<string, number>) || {};

            if (subcommand === 'set') {
                const role = interaction.options.getRole('role', true);
                const value = interaction.options.getInteger('value', true);
                weights[role.id] = value;

                const { error } = await supabase
                    .from('guild_settings')
                    .upsert({
                        guild_id: guildId,
                        vote_weights: weights,
                        updated_at: new Date().toISOString()
                    });

                if (error) {
                    logger.error('Failed to update weights:', error);
                    return interaction.reply({ content: I18n.t('messages.config.update_fail', interaction.locale), flags: MessageFlags.Ephemeral });
                }

                return interaction.reply({ content: I18n.t('messages.config.weight_updated', interaction.locale, { role: role.name, value: value }), flags: MessageFlags.Ephemeral });

            } else if (subcommand === 'remove') {
                const role = interaction.options.getRole('role', true);
                if (weights[role.id]) {
                    delete weights[role.id];

                    const { error } = await supabase
                        .from('guild_settings')
                        .upsert({
                            guild_id: guildId,
                            vote_weights: weights,
                            updated_at: new Date().toISOString()
                        });

                    if (error) {
                        logger.error('Failed to update weights:', error);
                        return interaction.reply({ content: I18n.t('messages.config.update_fail', interaction.locale), flags: MessageFlags.Ephemeral });
                    }
                    return interaction.reply({ content: I18n.t('messages.config.weight_removed', interaction.locale, { role: role.name }), flags: MessageFlags.Ephemeral });
                } else {
                    return interaction.reply({ content: I18n.t('messages.config.weight_none', interaction.locale, { role: role.name }), flags: MessageFlags.Ephemeral });
                }

            } else if (subcommand === 'view') {
                if (Object.keys(weights).length === 0) {
                    return interaction.reply({ content: I18n.t('messages.config.weight_empty', interaction.locale), flags: MessageFlags.Ephemeral });
                }

                const lines = Object.entries(weights).map(([roleId, weight]) => `<@&${roleId}>: ${weight}`);
                return interaction.reply({ content: I18n.t('messages.config.weight_list', interaction.locale, { list: lines.join('\n') }), flags: MessageFlags.Ephemeral });

            } else if (subcommand === 'clear') {
                const { error } = await supabase
                    .from('guild_settings')
                    .upsert({
                        guild_id: guildId,
                        vote_weights: {},
                        updated_at: new Date().toISOString()
                    });

                if (error) {
                    logger.error('Failed to clear weights:', error);
                    return interaction.reply({ content: I18n.t('messages.config.update_fail', interaction.locale), flags: MessageFlags.Ephemeral });
                }
                return interaction.reply({ content: I18n.t('messages.config.weight_cleared', interaction.locale), flags: MessageFlags.Ephemeral });
            }
        }

        if (subcommand === 'poll-buttons') {
            const enabled = interaction.options.getBoolean('enabled', true);
            const { error } = await supabase
                .from('guild_settings')
                .upsert({
                    guild_id: guildId,
                    allow_poll_buttons: enabled,
                    updated_at: new Date().toISOString()
                });

            if (error) {
                logger.error('Failed to update guild settings:', error);
                return interaction.reply({ content: I18n.t('messages.config.update_fail', interaction.locale), flags: MessageFlags.Ephemeral });
            }

            const successKey = enabled ? 'messages.config.update_success_enabled' : 'messages.config.update_success_disabled';
            await interaction.reply({
                content: I18n.t(successKey, interaction.locale),
                flags: MessageFlags.Ephemeral
            });
            logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /config poll-buttons with parameters "enabled:${enabled}"`);
        } else if (subcommand === 'locale') {
            const lang = interaction.options.getString('lang', true);

            // Validate locale
            const available = I18n.getAvailableLocales();
            if (!available.includes(lang)) {
                return interaction.reply({
                    content: I18n.t('messages.config.invalid_locale', interaction.locale, { available: available.join(', ') }),
                    flags: MessageFlags.Ephemeral
                });
            }

            const { error } = await supabase
                .from('guild_settings')
                .upsert({
                    guild_id: guildId,
                    locale: lang,
                    updated_at: new Date().toISOString()
                });

            if (error) {
                logger.error('Failed to update guild settings (locale):', error);
                return interaction.reply({ content: I18n.t('messages.config.update_fail', interaction.locale), flags: MessageFlags.Ephemeral });
            }

            await interaction.reply({
                content: I18n.t('messages.config.locale_success', lang, { lang }), // Respond in the NEW locale if possible, or interaction locale. Let's use new locale to demonstrate.
                flags: MessageFlags.Ephemeral
            });
            logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /config locale with parameters "lang:${lang}"`);
        }
    },
    async autocomplete(interaction: any) {
        const focusedValue = interaction.options.getFocused();
        const choices = I18n.getAvailableLocales();
        const filtered = choices.filter(choice => choice.startsWith(focusedValue));
        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice }))
        );
    }
};
