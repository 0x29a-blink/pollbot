import { Client, Collection, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { logger } from './lib/logger';
import { I18n } from './lib/i18n';

I18n.init();

dotenv.config();

// Extended Client Interface to include commands property
export interface ExtendedClient extends Client {
    commands: Collection<string, any>;
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        // GatewayIntentBits.MessageContent // Requires toggling in Dev Portal
    ]
}) as ExtendedClient;

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
// Ensure commands directory exists
if (!fs.existsSync(foldersPath)) {
    fs.mkdirSync(foldersPath);
}

const commandFiles = fs.readdirSync(foldersPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

// Load Commands
for (const file of commandFiles) {
    const filePath = path.join(foldersPath, file);
    // Dynamic import
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const command = require(filePath).default || require(filePath);

    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        logger.info(`Loaded command ${command.data.name}`);
    } else {
        logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Load Events
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath).default || require(filePath);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
        } else {
            client.on(event.name, (...args) => event.execute(...args));
        }
    }
} else {
    fs.mkdirSync(eventsPath);
}

const token = process.env.DISCORD_TOKEN;

if (!token) {
    logger.error("DISCORD_TOKEN is not defined in the environment variables.");
    process.exit(1);
}

client.login(token).catch(err => {
    logger.error("Failed to login:", err);
});

export default client;
