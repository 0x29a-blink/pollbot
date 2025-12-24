import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const commands = [];
const foldersPath = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(foldersPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(foldersPath, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const command = require(filePath).default || require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
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
        } else {
            // Global deployment
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
            console.log(`Successfully reloaded ${commands.length} application (/) commands GLOBALLY.`);
        }

    } catch (error) {
        console.error(error);
    }
})();
