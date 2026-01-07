-- Add locale column to guilds table
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en-US';
