import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { I18n } from './i18n';
import {
    shouldShowDashboardPromo,
    resetDashboardPromoCooldowns,
    getDashboardPromoText,
    buildDashboardPromoRow,
    PROMO_USER_COOLDOWN_MS,
} from './dashboardPromo';

describe('dashboardPromo', () => {
    beforeAll(() => {
        I18n.init();
    });

    beforeEach(() => {
        resetDashboardPromoCooldowns();
        delete process.env.ENABLE_DASHBOARD;
    });

    it('triggers when random roll is under the context threshold and enforces per-user cooldown', () => {
        const now = 1_700_000_000_000;
        expect(shouldShowDashboardPromo('u1', 'poll_create', { nowMs: now, random: () => 0.10 })).toBe(true);

        // Immediate second call within cooldown must be suppressed even on a 0.0 roll
        expect(shouldShowDashboardPromo('u1', 'poll_create', { nowMs: now + 1000, random: () => 0.0 })).toBe(false);

        // Different user is independent
        expect(shouldShowDashboardPromo('u2', 'command', { nowMs: now + 1000, random: () => 0.05 })).toBe(true);

        // After cooldown expires, user u1 is eligible again
        expect(
            shouldShowDashboardPromo('u1', 'poll_create', {
                nowMs: now + PROMO_USER_COOLDOWN_MS + 1,
                random: () => 0.10,
            })
        ).toBe(true);
    });

    it('does not burn cooldown when the random roll misses', () => {
        const now = 1_700_000_000_000;
        expect(shouldShowDashboardPromo('u1', 'vote', { nowMs: now, random: () => 0.95 })).toBe(false);
        expect(shouldShowDashboardPromo('u1', 'vote', { nowMs: now + 500, random: () => 0.01 })).toBe(true);
    });

    it('disables promos when ENABLE_DASHBOARD=false (bot-only self-hosting)', () => {
        process.env.ENABLE_DASHBOARD = 'false';
        expect(shouldShowDashboardPromo('u1', 'poll_create', { random: () => 0.0 })).toBe(false);
    });

    it('builds localized promo copy and link button pointing to pollbot.win', () => {
        const voterText = getDashboardPromoText('vote', 'en');
        const managerText = getDashboardPromoText('poll_create', 'en');
        expect(voterText).toContain('https://pollbot.win');
        expect(managerText).toContain('https://pollbot.win');

        const esText = getDashboardPromoText('vote', 'es-ES');
        expect(esText).toContain('https://pollbot.win');

        const row = buildDashboardPromoRow('en').toJSON();
        expect(row.components).toHaveLength(1);
        expect((row.components[0] as any).url).toBe('https://pollbot.win');
    });
});
