import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        // The bot pulls in discord.js / playwright; unit tests should stay fast
        // and dependency-free, so we do not set up any global environment here.
    },
});
