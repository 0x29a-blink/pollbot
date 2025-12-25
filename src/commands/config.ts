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
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const member = interaction.member as GuildMember;
        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: I18n.t('messages.common.no_permission', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'poll-buttons') {
            const enabled = interaction.options.getBoolean('enabled', true);
            const guildId = interaction.guildId!;

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
            const guildId = interaction.guildId!;

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
