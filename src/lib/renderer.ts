import { browserPool } from './browserPool';

export interface RenderOptions {
    title: string;
    description: string;
    options: string[];
    votes?: number[]; // Array of vote counts corresponding to options
    totalVotes?: number;
    creator: string;
}

export class Renderer {
    static async renderPoll(data: RenderOptions & { closed?: boolean }): Promise<Buffer> {
        const page = await browserPool.getPage();

        try {
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
                        ${data.closed ? '<div class="status-badge">CLOSED</div>' : ''}
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
                                        ${votes} votes ${percentageString ? `(${percentageString})` : ''}
                                    </div>
                                    ` : ''}
                                </div>
                            </div>
                            `;
            }).join('')}
                    </div>

                    <div class="footer">
                        <div class="footer-icon"></div>
                        Created by ${escapeHtml(data.creator)} ${data.totalVotes ? `• ${data.totalVotes} total votes` : ''}
                        ${data.closed ? '• Final Results' : ''}
                    </div>
                </div>
            </body>
            </html>
            `;

            await page.setContent(html);

            // Wait for content to render cleanly (optional, but safe)
            // await page.waitForTimeout(50); 

            // Screenshot the .card element specifically for clean borders
            const element = await page.$('.card');
            if (!element) throw new Error('Could not find card element');

            const buffer = await element.screenshot({ type: 'png' });
            return buffer;

        } finally {
            await page.close();
        }
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
