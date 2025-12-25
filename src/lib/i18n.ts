import fs from 'fs';
import path from 'path';
import { Locale } from 'discord.js';

type LocaleMap = Record<string, any>;

export class I18n {
    private static locales: Record<string, LocaleMap> = {};
    private static defaultLocale = 'en';
    // Map Discord locales to our file names if different, though ours match Discord's standard mostly
    // Discord sends 'es-ES', we access 'es-ES'

    static init() {
        const localesPath = path.join(__dirname, '../locales');
        if (!fs.existsSync(localesPath)) {
            console.warn('Locales directory not found');
            return;
        }

        const files = fs.readdirSync(localesPath).filter(file => file.endsWith('.json'));
        for (const file of files) {
            const localeName = path.basename(file, '.json');
            try {
                const content = fs.readFileSync(path.join(localesPath, file), 'utf-8');
                this.locales[localeName] = JSON.parse(content);
                console.log(`Loaded locale: ${localeName}`);
            } catch (err) {
                console.error(`Failed to load locale ${localeName}:`, err);
            }
        }
    }

    static t(key: string, locale: Locale | string, args?: Record<string, any>): string {
        // Fallback to default locale if specific locale not found
        const targetLocale = this.locales[locale] ? locale : this.defaultLocale;

        let value = this.getNestedValue(this.locales[targetLocale], key);

        // If not found in target locale, try default locale
        if (!value && targetLocale !== this.defaultLocale) {
            value = this.getNestedValue(this.locales[this.defaultLocale], key);
        }

        if (!value) return key; // Return key if translation missing completely

        if (args) {
            for (const [argKey, argValue] of Object.entries(args)) {
                value = value.replace(new RegExp(`{{${argKey}}}`, 'g'), String(argValue));
            }
        }

        return value;
    }

    private static getNestedValue(obj: any, key: string): string | undefined {
        return key.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
    }

    // Helper for Discord command localizations
    // Returns { "es-ES": "translation", ... }
    static getLocalizations(key: string): Record<string, string> {
        const localizations: Record<string, string> = {};
        for (const locale of Object.keys(this.locales)) {
            if (locale === this.defaultLocale) continue; // Skip default (English uses the base value)

            const value = this.getNestedValue(this.locales[locale], key);
            if (value) {
                localizations[locale] = value;
            }
        }
        return localizations;
    }
}
