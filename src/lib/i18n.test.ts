import { describe, it, expect, beforeAll } from 'vitest';
import { I18n } from './i18n';

describe('I18n', () => {
    beforeAll(() => {
        I18n.init();
    });

    it('interpolates {{option}} in view.export_content in both en and es-ES', () => {
        const en = I18n.t('view.export_content', 'en', { option: 'Pizza' });
        const es = I18n.t('view.export_content', 'es-ES', { option: 'Pizza' });
        expect(en).toContain('Pizza');
        expect(en).not.toContain('{option}');
        expect(es).toContain('Pizza');
        expect(es).not.toContain('{option}');
    });

    it('preserves literal $ signs in replacement arguments without regex backreference corruption', () => {
        const rendered = I18n.t('view.export_content', 'en', { option: 'Tier $1 & $& ($100)' });
        expect(rendered).toContain('Tier $1 & $& ($100)');
    });

    it('falls back across regional language prefixes (e.g. es-419 -> es-ES) and unknown locales -> en', () => {
        const esLatam = I18n.t('messages.common.generic_error', 'es-419');
        const esSpain = I18n.t('messages.common.generic_error', 'es-ES');
        expect(esLatam).toBe(esSpain);

        const unknown = I18n.t('messages.common.generic_error', 'ja');
        const english = I18n.t('messages.common.generic_error', 'en');
        expect(unknown).toBe(english);
    });
});
