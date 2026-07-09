import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { logger } from './logger';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    // It's okay to fail hard here if we can't connect to DB, but for now we'll just warn
    // so development without DB is partially possible if desired (though pollbot needs it)
    logger.warn('Supabase URL or Key not provided in environment variables.');
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

/**
 * Check database connection with a simple query.
 * @returns true if connection is healthy, false otherwise
 */
export async function checkDbConnection(): Promise<boolean> {
    const { count, error } = await supabase.from('polls').select('*', { count: 'exact', head: true });
    if (error) {
        logger.error('Database connection failed:', error.message);
        return false;
    }
    return true;
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check database connection with exponential backoff retry logic.
 * 
 * @param maxRetries - Maximum number of retry attempts (default: 5)
 * @param initialDelayMs - Initial delay in milliseconds (default: 1000)
 * @returns true if connection is healthy, false if all retries failed
 */
export async function checkDbConnectionWithRetry(
    maxRetries = 5,
    initialDelayMs = 1000
): Promise<boolean> {
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        logger.info(`[Database] Connection check attempt ${attempt}/${maxRetries}...`);

        const { error } = await supabase.from('polls').select('*', { count: 'exact', head: true });

        if (!error) {
            logger.info('[Database] Connection verified successfully.');
            return true;
        }

        logger.warn(`[Database] Connection attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
            logger.info(`[Database] Retrying in ${delay}ms...`);
            await sleep(delay);
            delay *= 2; // Exponential backoff
        }
    }

    logger.error(`[Database] All ${maxRetries} connection attempts failed. Database may be unavailable.`);
    return false;
}
