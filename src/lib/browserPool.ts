import { chromium, Browser, BrowserContext } from 'playwright';
import { logger } from './logger';

export class BrowserPool {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private renderCount = 0;
    private readonly MAX_RENDERS_BEFORE_RESTART = 100;

    constructor() {
        this.init();
    }

    private async init() {
        if (this.browser) return;
        try {
            logger.info('[BrowserPool] Launching Chromium...');
            this.browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'] // Optimization for some envs
            });
            this.context = await this.browser.newContext({
                viewport: { width: 800, height: 600 }, // Default, can be overridden by page
                deviceScaleFactor: 2 // High DPI for better screenshots
            });
            logger.info('[BrowserPool] Browser warmed up.');
        } catch (error) {
            logger.error('[BrowserPool] Failed to launch browser:', error);
        }
    }

    public async getPage() {
        if (!this.browser || !this.context) {
            await this.init();
        }

        // Rotation check
        if (this.renderCount >= this.MAX_RENDERS_BEFORE_RESTART) {
            console.log('[BrowserPool] Rotating browser instance...');
            await this.restart();
        }

        this.renderCount++;
        return await this.context!.newPage();
    }

    private async restart() {
        if (this.browser) {
            await this.browser.close().catch(() => { });
        }
        this.browser = null;
        this.context = null;
        this.renderCount = 0;
        await this.init();
    }

    public async destroy() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

// Export singleton
export const browserPool = new BrowserPool();
