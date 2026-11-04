import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, RepliableInteraction } from 'discord.js';
import { DASHBOARD_URL } from './botListVotes';
import { I18n } from './i18n';
import { logger } from './logger';

export type DashboardPromoContext = 'poll_create' | 'command' | 'vote';

/** Default randomized trigger probabilities per interaction type. */
export const PROMO_CHANCES: Record<DashboardPromoContext, number> = {
    poll_create: 0.40,
    command: 0.20,
    vote: 0.10,
};

/** Minimum gap before nudging the same Discord user again (30 minutes). */
export const PROMO_USER_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_TRACKED_USERS = 10_000;

const lastNudgeByUser = new Map<string, number>();

export interface ShouldShowPromoOptions {
    nowMs?: number;
    random?: () => number;
    cooldownMs?: number;
    chanceOverride?: number;
}

/**
 * Decide whether to show a randomized dashboard nudge to `userId`, enforcing
 * a per-user cooldown so active managers/voters are never spammed back-to-back.
 */
export function shouldShowDashboardPromo(
    userId: string,
    context: DashboardPromoContext,
    options: ShouldShowPromoOptions = {}
): boolean {
    if (process.env.ENABLE_DASHBOARD === 'false') return false;

    const nowMs = options.nowMs ?? Date.now();
    const cooldownMs = options.cooldownMs ?? PROMO_USER_COOLDOWN_MS;
    const chance = options.chanceOverride ?? PROMO_CHANCES[context];

    const prev = lastNudgeByUser.get(userId);
    if (prev !== undefined && nowMs - prev < cooldownMs) {
        return false;
    }

    const roll = (options.random ?? Math.random)();
    if (roll >= chance) {
        return false;
    }

    if (lastNudgeByUser.size >= MAX_TRACKED_USERS) {
        // Evict oldest entry (Map preserves insertion order) to bound memory.
        const oldestKey = lastNudgeByUser.keys().next().value;
        if (oldestKey !== undefined) lastNudgeByUser.delete(oldestKey);
    }
    lastNudgeByUser.set(userId, nowMs);
    return true;
}

/** Clear cooldown state (for unit tests). */
export function resetDashboardPromoCooldowns(): void {
    lastNudgeByUser.clear();
}

export function buildDashboardPromoRow(locale: string = 'en'): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel(I18n.t('messages.promo.open_dashboard_btn', locale))
            .setStyle(ButtonStyle.Link)
            .setURL(DASHBOARD_URL)
    );
}

export function getDashboardPromoText(context: DashboardPromoContext, locale: string = 'en'): string {
    const key = context === 'vote'
        ? 'messages.promo.dashboard_voter'
        : 'messages.promo.dashboard_manager';
    return I18n.t(key, locale, { url: DASHBOARD_URL });
}

/**
 * Roll the randomized chance for `context` and, if hit, send a non-intrusive
 * ephemeral follow-up advertising the web dashboard with a direct link button.
 * Errors are swallowed so a promo nudge can never break a command.
 */
export async function maybeSendDashboardPromo(
    interaction: RepliableInteraction,
    context: DashboardPromoContext
): Promise<boolean> {
    if (!interaction.replied && !interaction.deferred) return false;
    if (!shouldShowDashboardPromo(interaction.user.id, context)) return false;

    try {
        await interaction.followUp({
            content: getDashboardPromoText(context, interaction.locale),
            components: [buildDashboardPromoRow(interaction.locale)],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    } catch (err) {
        logger.debug(`[DashboardPromo] Skipped follow-up nudge (${context}):`, err);
        return false;
    }
}
