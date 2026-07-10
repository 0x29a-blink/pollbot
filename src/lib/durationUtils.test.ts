import { describe, it, expect } from 'vitest';
import { POLL_DURATIONS, endsAtFromDuration, validateEndsAt } from './durationUtils';

describe('endsAtFromDuration', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    it('maps every allowed duration to now + offset', () => {
        expect(endsAtFromDuration('1h', now)).toBe('2026-01-01T01:00:00.000Z');
        expect(endsAtFromDuration('6h', now)).toBe('2026-01-01T06:00:00.000Z');
        expect(endsAtFromDuration('12h', now)).toBe('2026-01-01T12:00:00.000Z');
        expect(endsAtFromDuration('24h', now)).toBe('2026-01-02T00:00:00.000Z');
        expect(endsAtFromDuration('48h', now)).toBe('2026-01-03T00:00:00.000Z');
        expect(endsAtFromDuration('7d', now)).toBe('2026-01-08T00:00:00.000Z');
    });

    it('returns null for unknown keys', () => {
        expect(endsAtFromDuration('2w', now)).toBeNull();
        expect(endsAtFromDuration('', now)).toBeNull();
        expect(endsAtFromDuration('1000000h', now)).toBeNull();
    });

    it('covers every key in POLL_DURATIONS', () => {
        for (const key of Object.keys(POLL_DURATIONS)) {
            expect(endsAtFromDuration(key, now)).not.toBeNull();
        }
    });
});

describe('validateEndsAt', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    it('accepts a valid future timestamp within 90 days', () => {
        expect(validateEndsAt('2026-01-02T00:00:00.000Z', now)).toBe(true);
        expect(validateEndsAt('2026-03-31T00:00:00.000Z', now)).toBe(true);
    });

    it('rejects past timestamps', () => {
        expect(validateEndsAt('2025-12-31T23:59:59.000Z', now)).toBe(false);
        expect(validateEndsAt(now.toISOString(), now)).toBe(false);
    });

    it('rejects unparseable values', () => {
        expect(validateEndsAt('not-a-date', now)).toBe(false);
        expect(validateEndsAt('', now)).toBe(false);
    });

    it('rejects timestamps more than 90 days out', () => {
        expect(validateEndsAt('2026-06-01T00:00:00.000Z', now)).toBe(false);
    });
});
