import { Page } from 'playwright';
import { I18n } from './i18n';

export interface RenderOptions {
    title: string;
    description: string;
    options: string[];
    votes?: number[]; // Array of vote counts corresponding to options
    totalVotes?: number;
    creator: string;
    locale?: string;
    closed?: boolean; // Add closed here for convenience
}

export interface StatsRenderOptions {
    totalPolls: number;
    totalVotes: number;
    activeServers: number;
    uptime: string;
    shards: number;
    cpuLoad: number; // 0-100
    memoryUsage: number; // 0-100
    labels: {
        title: string;
        subtitle: string;
        uptime: string;
        shards: string;
        activeServers: string;
        totalVotes: string;
        totalPolls: string;
        cpuLoad: string;
        memoryUsage: string;
    };
}

export class RenderBackend {
    static async renderPoll(page: Page, data: RenderOptions): Promise<Buffer> {
        // Prepare Data for Rendering
        let displayItems = data.options.map((opt, i) => {
            const count = data.votes ? data.votes[i] || 0 : 0;
            return {
                label: opt,
                count: count,
                originalIndex: i
            };
        });

        if (data.closed) {
            // Sort by votes descending
            displayItems.sort((a, b) => b.count - a.count);
        }

        const highestVote = Math.max(...displayItems.map(i => i.count));

        // Updated "fancy" HTML template
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: 'Inter', sans-serif;
                    background-color: #1e1f22; /* Discord Dark */
                    color: #ffffff;
                    margin: 0;
                    padding: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    width: 600px; /* Fixed width for consistency */
                }
                .card {
                    background: #2b2d31;
                    padding: 24px;
                    border-radius: 12px;
                    width: 100%;
                    box-sizing: border-box;
                    position: relative;
                    overflow: hidden;
                    border-left: 6px solid ${data.closed ? '#ED4245' : '#5865F2'}; /* Red if closed, Blurple if open */
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                }
                .header {
                    margin-bottom: 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                }
                .header-content {
                    flex: 1;
                }
                .status-badge {
                    background: ${data.closed ? '#ED4245' : '#5865F2'};
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: 700;
                    text-transform: uppercase;
                    margin-left: 12px;
                    white-space: nowrap;
                }
                .title {
                    font-size: 24px;
                    font-weight: 700;
                    margin: 0 0 8px 0;
                    line-height: 1.2;
                }
                .description {
                    font-size: 16px;
                    color: #dbdee1;
                    line-height: 1.5;
                    white-space: pre-wrap; /* Preserve newlines */
                }
                .divider {
                    height: 1px;
                    background: #3f4147;
                    margin: 16px 0;
                }
                .options-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .option-container {
                    position: relative;
                    background: #313338;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid #1e1f22;
                }
                .option-container.winner {
                    border: 1px solid #FEE75C; /* Gold Border for Winner */
                    box-shadow: 0 0 8px rgba(254, 231, 92, 0.2);
                }
                .progress-fill {
                    position: absolute;
                    top: 0;
                    left: 0;
                    height: 100%;
                    background: rgba(88, 101, 242, 0.2); /* Transparent Blurple */
                    transition: width 0.3s ease;
                    z-index: 1;
                }
                .option-container.winner .progress-fill {
                    background: rgba(254, 231, 92, 0.2); /* Gold tint for winner */
                }
                .option-content {
                    position: relative;
                    padding: 12px 16px;
                    display: flex;
                    justify-content: space-between; /* Space betwen text and count */
                    align-items: center;
                    z-index: 2; /* Text above progress bar */
                }
                .option-left {
                    display: flex;
                    align-items: center;
                    font-size: 15px;
                    font-weight: 500;
                }
                .option-right {
                    font-size: 13px;
                    color: #b5bac1;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .option-badge {
                    background: #404249;
                    color: #b5bac1;
                    font-size: 12px;
                    padding: 4px 8px;
                    border-radius: 4px;
                    margin-right: 12px;
                    font-family: monospace;
                }
                .winner-icon {
                    color: #FEE75C;
                    margin-right: 8px;
                }
                .footer {
                    margin-top: 20px;
                    color: #949ba4;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .footer-icon {
                    width: 16px;
                    height: 16px;
                    background: ${data.closed ? '#ED4245' : '#5865F2'};
                    border-radius: 50%;
                }
                /* Google Fonts */
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap');
            </style>
        </head>
        <body>
            <div class="card">
                <div class="header">
                    <div class="header-content">
                        <h1 class="title">${escapeHtml(data.title)}</h1>
                        <div class="description">${escapeHtml(data.description)}</div>
                    </div>
                    ${data.closed ? `<div class="status-badge">${I18n.t('messages.renderer.closed', data.locale || 'en')}</div>` : ''}
                </div>
                
                <div class="divider"></div>

                <div class="options-list">
                    ${displayItems.map((item, i) => {
            const votes = item.count;
            const total = data.totalVotes || 0;
            const percent = total > 0 ? (votes / total) * 100 : 0;
            const percentageString = total > 0 ? `${Math.round(percent)}%` : '';

            // Winner Logic: Closed AND has votes AND is equal to highest vote (handle ties)
            const isWinner = data.closed && votes > 0 && votes === highestVote;

            return `
                        <div class="option-container ${isWinner ? 'winner' : ''}">
                            ${data.votes ? `<div class="progress-fill" style="width: ${percent}%;"></div>` : ''}
                            <div class="option-content">
                                <div class="option-left">
                                    <span class="option-badge">#${item.originalIndex + 1}</span>
                                    ${isWinner ? '<span class="winner-icon">👑</span>' : ''}
                                    ${escapeHtml(item.label)}
                                </div>
                                ${data.votes ? `
                                <div class="option-right">
                                    ${votes} ${I18n.t('messages.renderer.votes_lower', data.locale || 'en')} ${percentageString ? `(${percentageString})` : ''}
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        `;
        }).join('')}
                </div>

                <div class="footer">
                    <div class="footer-icon"></div>
                    ${I18n.t('messages.renderer.created_by', data.locale || 'en')} ${escapeHtml(data.creator)} ${data.totalVotes ? `• ${data.totalVotes} ${I18n.t('messages.renderer.total_votes_lower', data.locale || 'en')}` : ''}
                    ${data.closed ? `• ${I18n.t('messages.renderer.final_results', data.locale || 'en')}` : ''}
                </div>
            </div>
        </body>
        </html>
        `;

        await page.setContent(html);

        // Screenshot the .card element specifically for clean borders
        const element = await page.$('.card');
        if (!element) throw new Error('Could not find card element');

        const buffer = await element.screenshot({ type: 'png' });
        return buffer;
    }

    static async renderStats(page: Page, data: StatsRenderOptions): Promise<Buffer> {
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: 'Inter', sans-serif;
                    background-color: #111214; /* Darker background */
                    color: #ffffff;
                    margin: 0;
                    padding: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    width: 700px;
                }
                .stats-card {
                    background: #1e1f22; /* Card background */
                    padding: 40px;
                    border-radius: 12px;
                    width: 100%;
                    box-sizing: border-box;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                }
                .header-title {
                    font-family: 'Inter', sans-serif; /* Ensure bold font */
                    font-size: 42px;
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-bottom: 8px;
                    text-align: center;
                }
                .header-subtitle {
                    font-size: 16px;
                    color: #949ba4;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 30px;
                    font-weight: 500;
                }
                
                .top-stats {
                    display: flex;
                    gap: 60px;
                    margin-bottom: 30px;
                }
                .mini-stat {
                    text-align: center;
                }
                .mini-label {
                    color: #949ba4;
                    font-size: 13px;
                    font-weight: 700;
                    text-transform: uppercase;
                    margin-bottom: 6px;
                }
                .mini-value {
                    font-family: monospace;
                    font-size: 18px;
                    font-weight: 700;
                    color: #ffffff;
                }
                
                /* New Layout: Active Servers Top Center */
                .highlight-stat {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .highlight-label {
                    color: #5865F2;
                    font-size: 16px;
                    font-weight: 800;
                    text-transform: uppercase;
                    margin-bottom: 4px;
                }
                .highlight-value {
                    font-size: 72px; /* Huge */
                    font-weight: 800;
                    line-height: 1;
                    color: #ffffff;
                }

                .main-stats-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 60px;
                    width: 100%;
                    margin-bottom: 40px;
                    justify-items: center; /* Center items in grid */
                }
                .big-stat {
                    text-align: center;
                }
                .big-label {
                    color: #23A559; /* Green for these */
                    font-size: 15px;
                    font-weight: 800;
                    text-transform: uppercase;
                    margin-bottom: 8px;
                }
                .big-label.blue { color: #5865F2; }

                .big-value {
                    font-size: 48px;
                    font-weight: 800;
                    line-height: 1;
                }

                .bars-container {
                    width: 100%;
                    background: #111214;
                    padding: 20px;
                    border-radius: 8px;
                }
                .bar-row {
                    margin-bottom: 16px;
                }
                .bar-row:last-child { margin-bottom: 0; }
                
                .bar-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 12px;
                    font-weight: 700;
                    color: #949ba4;
                    text-transform: uppercase;
                }
                .bar-track {
                    height: 8px;
                    background: #2b2d31;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .bar-fill {
                    height: 100%;
                    background: #5865F2; /* Blurple default */
                    border-radius: 4px;
                }
                .bar-fill.yellow { background: #FEE75C; } 
                
                /* Google Fonts */
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap');
            </style>
        </head>
        <body>
            <div class="stats-card">
                <div class="header-title">${escapeHtml(data.labels.title)}</div>
                <div class="header-subtitle">${escapeHtml(data.labels.subtitle)}</div>

                <div class="top-stats">
                    <div class="mini-stat">
                        <div class="mini-label">${escapeHtml(data.labels.uptime)}:</div>
                        <div class="mini-value">${data.uptime}</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-label">${escapeHtml(data.labels.shards)}:</div>
                        <div class="mini-value">${data.shards}</div>
                    </div>
                </div>
            
                <!-- Active Servers (Peak) -->
                <div class="highlight-stat">
                    <div class="highlight-label">${escapeHtml(data.labels.activeServers)}</div>
                    <div class="highlight-value">${data.activeServers}</div>
                </div>

                <!-- Polls & Votes Side by Side -->
                <div class="main-stats-grid">
                    <div class="big-stat">
                        <div class="big-label">${escapeHtml(data.labels.totalPolls)}</div>
                        <div class="big-value">${data.totalPolls}</div>
                    </div>
                    <div class="big-stat">
                        <div class="big-label blue">${escapeHtml(data.labels.totalVotes)}</div>
                        <div class="big-value">${data.totalVotes}</div>
                    </div>
                </div>

                <div class="bars-container">
                    <div class="bar-row">
                        <div class="bar-header">
                            <span>${escapeHtml(data.labels.cpuLoad)}</span>
                            <span>${data.cpuLoad.toFixed(1)}%</span>
                        </div>
                        <div class="bar-track">
                            <div class="bar-fill" style="width: ${Math.min(data.cpuLoad, 100)}%;"></div>
                        </div>
                    </div>
                    <div class="bar-row">
                        <div class="bar-header">
                            <span>${escapeHtml(data.labels.memoryUsage)}</span>
                            <span>${data.memoryUsage.toFixed(1)}%</span>
                        </div>
                        <div class="bar-track">
                            <div class="bar-fill yellow" style="width: ${Math.min(data.memoryUsage, 100)}%;"></div>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;

        await page.setContent(html);
        const element = await page.$('.stats-card');
        if (!element) throw new Error('Could not find stats-card element');
        const buffer = await element.screenshot({ type: 'png' });
        return buffer;
    }

    static async renderDetailedView(page: Page, data: RenderOptions): Promise<Buffer> {
        // Calculate Totals and Winner
        const votes = data.votes || data.options.map(() => 0);
        const totalVotes = votes.reduce((a, b) => a + b, 0);
        const highestVote = Math.max(...votes);

        // Prepare Data for Chart/List
        const items = data.options.map((opt, i) => {
            const count = votes[i] || 0; // Use local 'votes' var which has default
            const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
            return {
                label: opt,
                count: count,
                percentage: percentage,
                isWinner: count > 0 && count === highestVote
            };
        });

        const locale = data.locale || 'en';

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: 'Inter', sans-serif;
                    background-color: #111214;
                    color: #ffffff;
                    margin: 0;
                    padding: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    width: 700px;
                }
                .dashboard-card {
                    background: #1e1f22;
                    padding: 32px;
                    border-radius: 12px;
                    width: 100%;
                    box-sizing: border-box;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                    border-top: 4px solid #FEE75C; /* Premium Gold */
                }
                .header-section {
                    margin-bottom: 24px;
                    text-align: center;
                }
                .header-title {
                    font-size: 24px;
                    font-weight: 800;
                    margin-bottom: 8px;
                    color: #ffffff;
                }
                .header-meta {
                    font-size: 14px;
                    color: #949ba4;
                    display: flex;
                    justify-content: center;
                    gap: 12px;
                    font-weight: 500;
                }
                .meta-badge {
                    background: #2b2d31;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                }

                .stats-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr; /* 2 Columns: Chart Area | Key Stats */
                    gap: 24px;
                    margin-bottom: 24px;
                }
                
                /* Chart Simulation (Bars) */
                .chart-container {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 12px;
                }
                .chart-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .chart-label {
                    width: 30px; /* #1, #2 */
                    font-size: 12px;
                    color: #949ba4;
                    text-align: right;
                }
                .chart-bar-area {
                    flex: 1;
                    background: #2b2d31;
                    height: 8px;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .chart-bar-fill {
                    height: 100%;
                    background: #5865F2;
                    border-radius: 4px;
                }
                .winner-fill { background: #FEE75C; }
                .chart-value {
                    font-size: 12px;
                    font-weight: 600;
                    color: #dbdee1;
                    width: 40px; 
                }

                /* Key Stats */
                .key-stats {
                    display: flex;
                    flex-direction: column;
                    justify-content: space-around;
                    background: #2b2d31;
                    border-radius: 8px;
                    padding: 16px;
                }
                .stat-item {
                    text-align: center;
                    margin-bottom: 12px;
                }
                .stat-item:last-child { margin-bottom: 0; }
                .stat-label {
                    font-size: 12px;
                    color: #949ba4;
                    text-transform: uppercase;
                    font-weight: 700;
                    margin-bottom: 4px;
                }
                .stat-value {
                    font-size: 24px;
                    font-weight: 800;
                    color: #ffffff;
                }
                .gold-text { color: #FEE75C; }

                .footer {
                    margin-top: 16px;
                    border-top: 1px solid #2b2d31;
                    padding-top: 12px;
                    text-align: center;
                    font-size: 12px;
                    color: #5d6067;
                }

                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap');
            </style>
        </head>
        <body>
            <div class="dashboard-card">
                <div class="header-section">
                    <div class="header-title">${escapeHtml(data.title)}</div>
                    <div class="header-meta">
                        <span class="meta-badge">${I18n.t('messages.renderer.created_by', locale)} ${escapeHtml(data.creator)}</span>
                        ${data.closed ? `<span class="meta-badge" style="background:#ED4245;color:white">${I18n.t('messages.renderer.closed', locale)}</span>` : ''}
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="chart-container">
                        ${items.map((item, i) => `
                        <div class="chart-row">
                            <div class="chart-label">#${i + 1}</div>
                            <div class="chart-bar-area">
                                <div class="chart-bar-fill ${item.isWinner ? 'winner-fill' : ''}" style="width: ${item.percentage}%;"></div>
                            </div>
                            <div class="chart-value">${Math.round(item.percentage)}%</div>
                        </div>
                        `).join('')}
                    </div>

                    <div class="key-stats">
                        <div class="stat-item">
                            <div class="stat-label">${I18n.t('messages.renderer.total_votes_lower', locale).toUpperCase()}</div>
                            <div class="stat-value">${totalVotes}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">${I18n.t('view.winner_upper', locale)}</div> <!-- Localized "Winner" -->
                            <div class="stat-value gold-text">
                                ${getWinnersHtml(items)}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="footer">
                    Generated by PollBot Premium
                </div>
            </div>
        </body>
        </html>
        `;

        await page.setContent(html);
        const element = await page.$('.dashboard-card');
        if (!element) throw new Error('Could not find dashboard-card element');
        return await element.screenshot({ type: 'png' });
    }

}


// Basic HTML escape to prevent injection
function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getWinnersHtml(items: any[]): string {
    const winners = items.filter(i => i.isWinner);
    if (winners.length === 0) return '-';

    return winners.map(w => {
        const label = escapeHtml(w.label);
        // Dynamic sizing based on length
        // Base size 24px per CSS .stat-value
        let style = '';
        if (label.length > 20) style = 'font-size: 16px;';
        else if (label.length > 15) style = 'font-size: 20px;';

        return `<div style="${style} white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${label}</div>`;
    }).join('');
}
