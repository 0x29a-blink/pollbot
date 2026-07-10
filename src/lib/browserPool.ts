import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from './logger';

export class BrowserPool {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private renderCount = 0;
    private activePages = 0;
    private initPromise: Promise<void> | null = null;
    private readonly MAX_RENDERS_BEFORE_RESTART = 100;

    constructor() {
        // Warm up in the background; getPage() also ensures init on demand.
        void this.ensureBrowser().catch(() => { /* already logged in init */ });
    }

    private async init(): Promise<void> {
        logger.info('[BrowserPool] Launching Chromium...');
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Optimization for some envs
        });
        const context = await browser.newContext({
            viewport: { width: 800, height: 600 }, // Default, can be overridden by page
            deviceScaleFactor: 2 // High DPI for better screenshots
        });
        this.browser = browser;
        this.context = context;
        logger.info('[BrowserPool] Browser warmed up.');
    }

    /**
     * Single-flight browser init: concurrent callers share one launch instead of
     * each launching (and leaking) their own browser. On failure the promise is
     * cleared so a later call can retry rather than dereferencing a null context.
     */
    private async ensureBrowser(): Promise<void> {
        if (this.browser && this.context) return;
        if (!this.initPromise) {
            this.initPromise = this.init()
                .catch(err => {
                    logger.error('[BrowserPool] Failed to launch browser:', err);
                    this.browser = null;
                    this.context = null;
                    throw err;
                })
                .finally(() => { this.initPromise = null; });
        }
        await this.initPromise;
    }

    public async getPage(): Promise<Page> {
        await this.ensureBrowser();

        // Rotate the browser only when it is idle, so a rotation can never close
        // the browser out from under other in-flight renders (which previously
        // threw "Target closed" roughly every 100th render under concurrency).
        if (this.renderCount >= this.MAX_RENDERS_BEFORE_RESTART && this.activePages === 0) {
            logger.info('[BrowserPool] Rotating browser instance...');
            await this.restart();
        }

        if (!this.context) {
            throw new Error('[BrowserPool] Browser context unavailable');
        }

        this.renderCount++;
        const page = await this.context.newPage();
        this.activePages++;
        page.once('close', () => {
            this.activePages = Math.max(0, this.activePages - 1);
        });
        return page;
    }

    private async restart(): Promise<void> {
        const old = this.browser;
        this.browser = null;
        this.context = null;
        this.renderCount = 0;
        if (old) {
            await old.close().catch(() => { });
        }
        await this.ensureBrowser();
    }

    public async destroy(): Promise<void> {
        const old = this.browser;
        this.browser = null;
        this.context = null;
        if (old) {
            await old.close().catch(() => { });
        }
    }
}

// Export singleton
export const browserPool = new BrowserPool();
