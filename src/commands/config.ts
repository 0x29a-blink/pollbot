import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';
import { memberHasManageGuild } from '../lib/guildUtils';

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
                                .setDescription('The vote weight value (1–100)')
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(100)))
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

        if (!memberHasManageGuild(interaction.member)) {
            return interaction.reply({ content: I18n.t('messages.common.no_permission', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        let subcommand: string | undefined;
        let subcommandGroup: string | null = null;
        try {
            subcommand = interaction.options.getSubcommand();
            subcommandGroup = interaction.options.getSubcommandGroup(false);
        } catch {
            // Should not happen if builder is correct
        }

        // Validate locale synchronously before deferring if setting locale
        if (!subcommandGroup && subcommand === 'locale') {
            const lang = interaction.options.getString('lang', true);
            const available = I18n.getAvailableLocales();
            if (!available.includes(lang)) {
                return interaction.reply({
                    content: I18n.t('messages.config.invalid_locale', interaction.locale, { available: available.join(', ') }),
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId!;

        if (subcommandGroup === 'weights') {
            // Fetch current settings
            const { data: currentSettings, error: fetchError } = await supabase
                .from('guild_settings')
                .select('vote_weights')
                .eq('guild_id', guildId)
                .maybeSingle();

            if (fetchError && fetchError.code !== 'PGRST116') { // Ignore not found, treat as empty
                logger.error('Failed to fetch guild settings:', fetchError);
                return interaction.editReply({ content: I18n.t('messages.config.update_fail', interaction.locale) });
            }

            const weights = { ...((currentSettings?.vote_weights as Record<string, number>) || {}) };

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
                    return interaction.editReply({ content: I18n.t('messages.config.update_fail', interaction.locale) });
                }

                return interaction.editReply({ content: I18n.t('messages.config.weight_updated', interaction.locale, { role: role.name, value: value }) });

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
                        return interaction.editReply({ content: I18n.t('messages.config.update_fail', interaction.locale) });
                    }
                    return interaction.editReply({ content: I18n.t('messages.config.weight_removed', interaction.locale, { role: role.name }) });
                } else {
                    return interaction.editReply({ content: I18n.t('messages.config.weight_none', interaction.locale, { role: role.name }) });
                }

            } else if (subcommand === 'view') {
                if (Object.keys(weights).length === 0) {
                    return interaction.editReply({ content: I18n.t('messages.config.weight_empty', interaction.locale) });
                }

                const lines = Object.entries(weights).map(([roleId, weight]) => `<@&${roleId}>: ${weight}`);
                return interaction.editReply({ content: I18n.t('messages.config.weight_list', interaction.locale, { list: lines.join('\n') }) });

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
                    return interaction.editReply({ content: I18n.t('messages.config.update_fail', interaction.locale) });
                }
                return interaction.editReply({ content: I18n.t('messages.config.weight_cleared', interaction.locale) });
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
                return interaction.editReply({ content: I18n.t('messages.config.update_fail', interaction.locale) });
            }

            const successKey = enabled ? 'messages.config.update_success_enabled' : 'messages.config.update_success_disabled';
            await interaction.editReply({
                content: I18n.t(successKey, interaction.locale),
            });
            logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /config poll-buttons with parameters "enabled:${enabled}"`);
        } else if (subcommand === 'locale') {
            const lang = interaction.options.getString('lang', true);

            const { error } = await supabase
                .from('guild_settings')
                .upsert({
                    guild_id: guildId,
                    locale: lang,
                    updated_at: new Date().toISOString()
                });

            if (error) {
                logger.error('Failed to update guild settings (locale):', error);
                return interaction.editReply({ content: I18n.t('messages.config.update_fail', interaction.locale) });
            }

            await interaction.editReply({
                content: I18n.t('messages.config.locale_success', lang, { lang }),
            });
            logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /config locale with parameters "lang:${lang}"`);
        }
    },
    async autocomplete(interaction: any) {
        const focusedValue = String(interaction.options.getFocused() || '').toLowerCase();
        const choices = I18n.getAvailableLocales();
        const filtered = choices.filter(choice => choice.toLowerCase().startsWith(focusedValue)).slice(0, 25);
        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice }))
        );
    }
};
