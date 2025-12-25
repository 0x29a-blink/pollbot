import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { I18n } from '../lib/i18n';

dotenv.config();

// Initialize I18n
I18n.init();

const commands: any[] = [];
const foldersPath = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(foldersPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

// Recursive function to apply localizations to command JSON
function localizeCommand(cmdJson: any, localeKeyPrefix: string) {
    // Localize Name
    const nameLocs = I18n.getLocalizations(`${localeKeyPrefix}.name`);
    if (Object.keys(nameLocs).length) cmdJson.name_localizations = nameLocs;

    // Localize Description
    const descLocs = I18n.getLocalizations(`${localeKeyPrefix}.description`);
    if (Object.keys(descLocs).length) cmdJson.description_localizations = descLocs;

    // Options / Subcommands
    if (cmdJson.options) {
        for (const option of cmdJson.options) {
            // Check if Subcommand (Type 1) or SubcommandGroup (Type 2)
            // Note: Discord.js toJSON() options usually have integer types.
            // 1=SUB_COMMAND, 2=SUB_COMMAND_GROUP
            if (option.type === 1 || option.type === 2) {
                localizeCommand(option, `${localeKeyPrefix}.subcommands.${option.name}`);
            } else {
                localizeCommand(option, `${localeKeyPrefix}.options.${option.name}`);
            }
        }
    }
}

for (const file of commandFiles) {
    const filePath = path.join(foldersPath, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const command = require(filePath).default || require(filePath);
    if ('data' in command && 'execute' in command) {
        const cmdJson = command.data.toJSON();

        // Apply Localizations
        // format: commands.poll
        localizeCommand(cmdJson, `commands.${cmdJson.name}`);

        commands.push(cmdJson);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

(async () => {
    try {
        const isDev = process.env.DEV_ONLY_MODE === 'true';
        console.log(`Started refreshing ${commands.length} application (/) commands. Mode: ${isDev ? 'DEV (Guild Only)' : 'GLOBAL'}`);

        const clientId = process.env.DISCORD_CLIENT_ID;
        if (!clientId) throw new Error("DISCORD_CLIENT_ID is missing in .env");

        if (isDev) {
            const guildId = process.env.DEV_GUILD_ID;
            if (!guildId) throw new Error("DEV_GUILD_ID is missing in .env but DEV_ONLY_MODE is true");

            // Deploy to specific guild
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );
            console.log(`Successfully reloaded ${commands.length} application (/) commands for Guild ${guildId}.`);

            // Clear Global commands to avoid duplicates/stale commands
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: [] },
            );
            console.log('Successfully deleted all Global application (/) commands.');
        } else {
            // Global deployment
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
            console.log(`Successfully reloaded ${commands.length} application (/) commands GLOBALLY.`);

            // Clear Guild commands for the dev guild to avoid duplicates
            const guildId = process.env.DEV_GUILD_ID;
            if (guildId) {
                await rest.put(
                    Routes.applicationGuildCommands(clientId, guildId),
                    { body: [] },
                );
                console.log(`Successfully deleted all Guild application (/) commands for ${guildId}.`);
            }
        }
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
