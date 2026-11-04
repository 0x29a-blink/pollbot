import { I18n } from './i18n';
import { logger } from './logger';
import {
    collectEmojiUrls,
    createHiDpiCanvas,
    drawCrownIcon,
    drawRichLine,
    fillRoundRect,
    fontSpec,
    getMeasureContext,
    prefetchImages,
    roundRectPath,
    strokeRoundRect,
    truncatePlainText,
    wrapTextParagraphs,
} from './canvasUtils';

export interface RenderOptions {
    title: string;
    description: string;
    options: string[];
    votes?: number[]; // Array of vote counts corresponding to options
    totalVotes?: number;
    creator: string;
    locale?: string;
    closed?: boolean;
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

const COLORS = {
    cardPollBg: '#2b2d31',
    cardDarkBg: '#1e1f22',
    deepDarkBg: '#111214',
    optionBg: '#313338',
    optionBorder: '#1e1f22',
    badgeBg: '#404249',
    divider: '#3f4147',
    blurple: '#5865F2',
    blurpleFill: 'rgba(88, 101, 242, 0.22)',
    red: '#ED4245',
    gold: '#FEE75C',
    goldFill: 'rgba(254, 231, 92, 0.20)',
    green: '#23A559',
    white: '#ffffff',
    textSecondary: '#dbdee1',
    textMuted: '#b5bac1',
    textSubtle: '#949ba4',
    textDim: '#6d7078',
};

export class Renderer {
    static async renderPoll(data: RenderOptions): Promise<Buffer> {
        try {
            I18n.ensureInitialized();
            const locale = data.locale || 'en';
            const isClosed = Boolean(data.closed);
            const hasVotes = Array.isArray(data.votes);
            const totalVotes = data.totalVotes || 0;

            const displayItems = (data.options || []).map((opt, i) => ({
                label: String(opt ?? ''),
                count: hasVotes ? (data.votes![i] || 0) : 0,
                originalIndex: i,
            }));

            if (isClosed) {
                displayItems.sort((a, b) => b.count - a.count);
            }

            const highestVote = displayItems.length > 0
                ? Math.max(...displayItems.map(item => item.count))
                : 0;

            const emojiMap = await prefetchImages(
                collectEmojiUrls([data.title, data.description, ...displayItems.map(i => i.label)])
            );

            const CARD_W = 600;
            const ACCENT_W = 6;
            const PAD_LEFT = ACCENT_W + 22; // 28
            const PAD_RIGHT = 24;
            const PAD_TOP = 24;
            const PAD_BOTTOM = 22;
            const INNER_W = CARD_W - PAD_LEFT - PAD_RIGHT; // 548

            const mctx = getMeasureContext();

            // Measure closed status pill if closed
            const closedLabel = I18n.t('messages.renderer.closed', locale).toUpperCase();
            let statusBadgeW = 0;
            const STATUS_BADGE_H = 22;
            if (isClosed) {
                mctx.font = fontSpec(12, 700);
                statusBadgeW = Math.ceil(mctx.measureText(closedLabel).width) + 16;
            }

            // Measure title lines
            const titleMaxW = isClosed ? INNER_W - statusBadgeW - 12 : INNER_W;
            const TITLE_FONT = 24;
            const TITLE_LH = 30;
            mctx.font = fontSpec(TITLE_FONT, 700);
            const rawTitleLines = wrapTextParagraphs(mctx, data.title || 'Poll', titleMaxW, 4);
            const titleLines = rawTitleLines.length > 0 ? rawTitleLines : ['Poll'];

            // Measure description lines (optional)
            const DESC_FONT = 15;
            const DESC_LH = 22;
            mctx.font = fontSpec(DESC_FONT, 400);
            const descLines = data.description && data.description.trim().length > 0
                ? wrapTextParagraphs(mctx, data.description, INNER_W, 14)
                : [];

            const headerContentH = titleLines.length * TITLE_LH
                + (descLines.length > 0 ? 8 + descLines.length * DESC_LH : 0);
            const headerH = Math.max(headerContentH, isClosed ? STATUS_BADGE_H : 0);

            // Pre-layout each option row so multi-line option labels fit cleanly
            const votesWord = I18n.t('messages.renderer.votes_lower', locale);
            const OPTION_GAP = 10;
            const OPT_PAD_X = 14;
            const OPT_LINE_H = 20;

            interface PreparedOption {
                badgeText: string;
                badgeW: number;
                isWinner: boolean;
                percent: number;
                rightText: string;
                rightW: number;
                labelLines: string[];
                boxH: number;
                labelMaxW: number;
            }

            const preparedOptions: PreparedOption[] = displayItems.map(item => {
                const votes = item.count;
                const percent = totalVotes > 0 ? Math.min(100, Math.max(0, (votes / totalVotes) * 100)) : 0;
                const pctStr = totalVotes > 0 ? ` (${Math.round(percent)}%)` : '';
                const isWinner = isClosed && votes > 0 && votes === highestVote;

                const badgeText = `#${item.originalIndex + 1}`;
                mctx.font = fontSpec(12, 600, 'normal', true);
                const badgeW = Math.ceil(mctx.measureText(badgeText).width) + 14;

                let rightText = '';
                let rightW = 0;
                if (hasVotes) {
                    rightText = `${votes} ${votesWord}${pctStr}`;
                    mctx.font = fontSpec(13, 600);
                    rightW = Math.ceil(mctx.measureText(rightText).width) + 14;
                }

                const crownReserve = isWinner ? 23 : 0; // 15px crown + 8px gap
                const labelMaxW = Math.max(80, INNER_W - OPT_PAD_X * 2 - badgeW - 12 - crownReserve - rightW);

                mctx.font = fontSpec(15, 500);
                const wrapped = wrapTextParagraphs(mctx, item.label, labelMaxW, 2);
                const labelLines = wrapped.length > 0 ? wrapped : [''];
                const boxH = Math.max(46, 22 + labelLines.length * OPT_LINE_H);

                return {
                    badgeText,
                    badgeW,
                    isWinner,
                    percent,
                    rightText,
                    rightW,
                    labelLines,
                    boxH,
                    labelMaxW,
                };
            });

            const optionsTotalH = preparedOptions.reduce((sum, o) => sum + o.boxH, 0)
                + Math.max(0, preparedOptions.length - 1) * OPTION_GAP;

            // Divider + Footer heights
            const DIVIDER_BLOCK_H = 16 + 1 + 16; // 16px top + 1px line + 16px bottom
            const FOOTER_TOP_GAP = 18;
            const FOOTER_H = 18;

            const CARD_H = PAD_TOP + headerH + DIVIDER_BLOCK_H + optionsTotalH + FOOTER_TOP_GAP + FOOTER_H + PAD_BOTTOM;

            // Create @2x HiDPI Canvas
            const { canvas, ctx } = createHiDpiCanvas(CARD_W, CARD_H, 2, 12);

            // Card background + Left status accent bar
            ctx.fillStyle = COLORS.cardPollBg;
            ctx.fillRect(0, 0, CARD_W, CARD_H);

            ctx.fillStyle = isClosed ? COLORS.red : COLORS.blurple;
            ctx.fillRect(0, 0, ACCENT_W, CARD_H);

            // Subtle outer card border inside clip
            strokeRoundRect(ctx, 0.5, 0.5, CARD_W - 1, CARD_H - 1, 12, 'rgba(255, 255, 255, 0.05)', 1);

            let cursorY = PAD_TOP;

            // Status pill (top-right when closed)
            if (isClosed) {
                const bx = CARD_W - PAD_RIGHT - statusBadgeW;
                const by = cursorY + 2;
                fillRoundRect(ctx, bx, by, statusBadgeW, STATUS_BADGE_H, 4, COLORS.red);
                ctx.font = fontSpec(12, 700);
                ctx.fillStyle = COLORS.white;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(closedLabel, bx + statusBadgeW / 2, by + STATUS_BADGE_H / 2);
            }

            // Title
            ctx.font = fontSpec(TITLE_FONT, 700);
            ctx.fillStyle = COLORS.white;
            for (let i = 0; i < titleLines.length; i++) {
                const lineCenterY = cursorY + i * TITLE_LH + TITLE_LH / 2;
                drawRichLine(ctx, titleLines[i]!, PAD_LEFT, lineCenterY, titleMaxW, emojiMap, {
                    align: 'left',
                    fontSize: TITLE_FONT,
                });
            }

            // Description
            if (descLines.length > 0) {
                const descStartY = cursorY + titleLines.length * TITLE_LH + 8;
                ctx.font = fontSpec(DESC_FONT, 400);
                ctx.fillStyle = COLORS.textSecondary;
                for (let i = 0; i < descLines.length; i++) {
                    const lineText = descLines[i]!;
                    if (!lineText) continue;
                    const lineCenterY = descStartY + i * DESC_LH + DESC_LH / 2;
                    drawRichLine(ctx, lineText, PAD_LEFT, lineCenterY, INNER_W, emojiMap, {
                        align: 'left',
                        fontSize: DESC_FONT,
                    });
                }
            }

            cursorY += headerH;

            // Divider
            cursorY += 16;
            ctx.fillStyle = COLORS.divider;
            ctx.fillRect(PAD_LEFT, cursorY, INNER_W, 1);
            cursorY += 1 + 16;

            // Options list
            for (let i = 0; i < preparedOptions.length; i++) {
                const opt = preparedOptions[i]!;
                const boxX = PAD_LEFT;
                const boxY = cursorY;
                const boxW = INNER_W;
                const boxH = opt.boxH;

                // Option box + clipped progress bar fill
                ctx.save();
                roundRectPath(ctx, boxX, boxY, boxW, boxH, 8);
                ctx.clip();

                ctx.fillStyle = COLORS.optionBg;
                ctx.fillRect(boxX, boxY, boxW, boxH);

                if (hasVotes && opt.percent > 0) {
                    const fillW = Math.max(4, (boxW * opt.percent) / 100);
                    ctx.fillStyle = opt.isWinner ? COLORS.goldFill : COLORS.blurpleFill;
                    ctx.fillRect(boxX, boxY, fillW, boxH);
                }
                ctx.restore();

                strokeRoundRect(
                    ctx,
                    boxX + 0.5,
                    boxY + 0.5,
                    boxW - 1,
                    boxH - 1,
                    8,
                    opt.isWinner ? COLORS.gold : COLORS.optionBorder,
                    opt.isWinner ? 1.5 : 1
                );

                const centerY = boxY + boxH / 2;
                let leftCursor = boxX + OPT_PAD_X;

                // #N index badge
                const badgeH = 22;
                fillRoundRect(ctx, leftCursor, centerY - badgeH / 2, opt.badgeW, badgeH, 4, COLORS.badgeBg);
                ctx.font = fontSpec(12, 600, 'normal', true);
                ctx.fillStyle = COLORS.textMuted;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(opt.badgeText, leftCursor + opt.badgeW / 2, centerY);
                leftCursor += opt.badgeW + 12;

                // Winner gold crown icon
                if (opt.isWinner) {
                    drawCrownIcon(ctx, leftCursor, centerY, 15, COLORS.gold);
                    leftCursor += 23;
                }

                // Option label (1 or 2 lines)
                ctx.font = fontSpec(15, 500);
                ctx.fillStyle = COLORS.white;
                const totalLabelH = opt.labelLines.length * OPT_LINE_H;
                const firstLineCenterY = centerY - totalLabelH / 2 + OPT_LINE_H / 2;
                for (let lIdx = 0; lIdx < opt.labelLines.length; lIdx++) {
                    drawRichLine(
                        ctx,
                        opt.labelLines[lIdx]!,
                        leftCursor,
                        firstLineCenterY + lIdx * OPT_LINE_H,
                        opt.labelMaxW,
                        emojiMap,
                        { align: 'left', fontSize: 15 }
                    );
                }

                // Right vote count & percentage
                if (hasVotes && opt.rightText) {
                    ctx.font = fontSpec(13, 600);
                    ctx.fillStyle = COLORS.textMuted;
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(opt.rightText, boxX + boxW - OPT_PAD_X, centerY);
                }

                cursorY += boxH + (i < preparedOptions.length - 1 ? OPTION_GAP : 0);
            }

            // Footer
            cursorY += FOOTER_TOP_GAP;
            const footerCy = cursorY + FOOTER_H / 2;
            const dotRadius = 7;

            ctx.save();
            ctx.beginPath();
            ctx.arc(PAD_LEFT + dotRadius, footerCy, dotRadius, 0, Math.PI * 2);
            ctx.fillStyle = isClosed ? COLORS.red : COLORS.blurple;
            ctx.fill();
            ctx.restore();

            const footerParts = [
                `${I18n.t('messages.renderer.created_by', locale)} ${data.creator || 'Unknown'}`,
            ];
            if (totalVotes > 0) {
                footerParts.push(`${totalVotes} ${I18n.t('messages.renderer.total_votes_lower', locale)}`);
            }
            if (isClosed) {
                footerParts.push(I18n.t('messages.renderer.final_results', locale));
            }

            const footerX = PAD_LEFT + dotRadius * 2 + 8;
            const footerMaxW = CARD_W - PAD_RIGHT - footerX;
            ctx.font = fontSpec(12, 500);
            ctx.fillStyle = COLORS.textSubtle;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(truncatePlainText(ctx, footerParts.join(' • '), footerMaxW), footerX, footerCy);

            return await canvas.encode('png');
        } catch (error) {
            logger.error('[Renderer] Failed to render poll card:', error);
            throw new Error('Failed to generate image. Please try again later.');
        }
    }

    static async renderStats(data: StatsRenderOptions): Promise<Buffer> {
        try {
            I18n.ensureInitialized();
            const CARD_W = 700;
            const CARD_H = 540;
            const PAD = 40;
            const INNER_W = CARD_W - PAD * 2; // 620

            const { canvas, ctx } = createHiDpiCanvas(CARD_W, CARD_H, 2, 12);

            // Card background + subtle ambient blurple top glow
            ctx.fillStyle = COLORS.cardDarkBg;
            ctx.fillRect(0, 0, CARD_W, CARD_H);

            const glow = ctx.createRadialGradient(CARD_W / 2, 0, 10, CARD_W / 2, 0, 340);
            glow.addColorStop(0, 'rgba(88, 101, 242, 0.14)');
            glow.addColorStop(1, 'rgba(88, 101, 242, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, CARD_W, CARD_H);

            strokeRoundRect(ctx, 0.5, 0.5, CARD_W - 1, CARD_H - 1, 12, 'rgba(255, 255, 255, 0.06)', 1);

            let y = PAD;

            // Title
            ctx.font = fontSpec(38, 800);
            ctx.fillStyle = COLORS.white;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(truncatePlainText(ctx, String(data.labels.title || 'POLLBOT').toUpperCase(), INNER_W), CARD_W / 2, y);
            y += 46;

            // Subtitle
            ctx.font = fontSpec(15, 600);
            ctx.fillStyle = COLORS.textSubtle;
            ctx.fillText(truncatePlainText(ctx, String(data.labels.subtitle || '').toUpperCase(), INNER_W), CARD_W / 2, y);
            y += 42;

            // Top mini-stats (Uptime & Shards)
            const miniLeftX = CARD_W / 2 - 80;
            const miniRightX = CARD_W / 2 + 80;

            ctx.font = fontSpec(12, 700);
            ctx.fillStyle = COLORS.textSubtle;
            ctx.fillText(`${String(data.labels.uptime || 'UPTIME').toUpperCase()}:`, miniLeftX, y);
            ctx.fillText(`${String(data.labels.shards || 'SHARDS').toUpperCase()}:`, miniRightX, y);
            y += 20;

            ctx.font = fontSpec(18, 700, 'normal', true);
            ctx.fillStyle = COLORS.white;
            ctx.fillText(String(data.uptime ?? '0m'), miniLeftX, y);
            ctx.fillText(String(data.shards ?? 1), miniRightX, y);
            y += 46;

            // Center highlight stat (Active Servers)
            ctx.font = fontSpec(15, 800);
            ctx.fillStyle = COLORS.blurple;
            ctx.fillText(truncatePlainText(ctx, String(data.labels.activeServers || 'ACTIVE SERVERS').toUpperCase(), INNER_W), CARD_W / 2, y);
            y += 22;

            ctx.font = fontSpec(66, 800);
            ctx.fillStyle = COLORS.white;
            ctx.fillText(Number(data.activeServers || 0).toLocaleString('en-US'), CARD_W / 2, y);
            y += 88;

            // 2-column main stats grid (Total Polls | Total Votes)
            const colLeftX = PAD + INNER_W * 0.25;
            const colRightX = PAD + INNER_W * 0.75;

            ctx.font = fontSpec(14, 800);
            ctx.fillStyle = COLORS.green;
            ctx.fillText(truncatePlainText(ctx, String(data.labels.totalPolls || 'TOTAL POLLS').toUpperCase(), INNER_W * 0.45), colLeftX, y);

            ctx.fillStyle = COLORS.blurple;
            ctx.fillText(truncatePlainText(ctx, String(data.labels.totalVotes || 'TOTAL VOTES').toUpperCase(), INNER_W * 0.45), colRightX, y);
            y += 22;

            ctx.font = fontSpec(44, 800);
            ctx.fillStyle = COLORS.white;
            ctx.fillText(Number(data.totalPolls || 0).toLocaleString('en-US'), colLeftX, y);
            ctx.fillText(Number(data.totalVotes || 0).toLocaleString('en-US'), colRightX, y);
            y += 72;

            // Bottom resource usage bars container
            const BARS_PAD = 20;
            const BARS_H = 104;
            fillRoundRect(ctx, PAD, y, INNER_W, BARS_H, 8, COLORS.deepDarkBg);

            const drawUsageBar = (
                rowY: number,
                label: string,
                rawPct: number,
                fillColor: string
            ) => {
                const safeVal = Number.isFinite(rawPct) ? rawPct : 0;
                const clampedPct = Math.max(0, Math.min(100, safeVal));
                const trackX = PAD + BARS_PAD;
                const trackW = INNER_W - BARS_PAD * 2;

                ctx.font = fontSpec(12, 700);
                ctx.fillStyle = COLORS.textSubtle;
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.fillText(truncatePlainText(ctx, label.toUpperCase(), trackW - 70), trackX, rowY);

                ctx.textAlign = 'right';
                ctx.fillText(`${safeVal.toFixed(1)}%`, trackX + trackW, rowY);

                const barY = rowY + 20;
                fillRoundRect(ctx, trackX, barY, trackW, 8, 4, COLORS.cardPollBg);
                if (clampedPct > 0) {
                    fillRoundRect(ctx, trackX, barY, Math.max(6, (trackW * clampedPct) / 100), 8, 4, fillColor);
                }
            };

            drawUsageBar(y + 18, String(data.labels.cpuLoad || 'CPU LOAD'), data.cpuLoad, COLORS.blurple);
            drawUsageBar(y + 60, String(data.labels.memoryUsage || 'MEMORY USAGE'), data.memoryUsage, COLORS.gold);

            return await canvas.encode('png');
        } catch (error) {
            logger.error('[Renderer] Failed to render stats card:', error);
            throw new Error('Failed to generate image. Please try again later.');
        }
    }

    static async renderDetailedView(data: RenderOptions): Promise<Buffer> {
        try {
            I18n.ensureInitialized();
            const locale = data.locale || 'en';
            const options = data.options || [];
            const votes = data.votes || options.map(() => 0);
            const totalVotes = data.totalVotes ?? votes.reduce((a, b) => a + b, 0);
            const highestVote = votes.length > 0 ? Math.max(...votes, 0) : 0;

            const items = options.map((opt, i) => {
                const count = votes[i] || 0;
                const percentage = totalVotes > 0 ? Math.min(100, Math.max(0, (count / totalVotes) * 100)) : 0;
                return {
                    label: String(opt ?? ''),
                    count,
                    percentage,
                    isWinner: count > 0 && count === highestVote,
                };
            });

            const winners = items.filter(item => item.isWinner);
            const emojiMap = await prefetchImages(
                collectEmojiUrls([data.title, ...winners.map(w => w.label)])
            );

            const CARD_W = 700;
            const TOP_ACCENT_H = 4;
            const PAD = 32;
            const INNER_W = CARD_W - PAD * 2; // 636

            const mctx = getMeasureContext();

            // Measure centered title (up to 3 lines)
            const TITLE_FONT = 24;
            const TITLE_LH = 30;
            mctx.font = fontSpec(TITLE_FONT, 800);
            const rawTitleLines = wrapTextParagraphs(mctx, data.title || 'Poll Results', INNER_W - 20, 3);
            const titleLines = rawTitleLines.length > 0 ? rawTitleLines : ['Poll Results'];

            const META_H = 24;
            const HEADER_H = titleLines.length * TITLE_LH + 10 + META_H;

            // Grid dimensions
            const COL_GAP = 24;
            const COL_W = (INNER_W - COL_GAP) / 2; // 306
            const CHART_ROW_H = 20;
            const CHART_ROW_GAP = 10;
            const chartContentH = items.length > 0
                ? items.length * CHART_ROW_H + (items.length - 1) * CHART_ROW_GAP
                : CHART_ROW_H;

            const displayedWinners = winners.slice(0, 4);
            const extraWinnersCount = Math.max(0, winners.length - 4);
            const winnerFontSize = displayedWinners.some(w => w.label.length > 20)
                ? 16
                : displayedWinners.some(w => w.label.length > 14)
                    ? 19
                    : 22;
            const winnerLineH = winnerFontSize + 6;
            const winnerLinesTotal = Math.max(1, displayedWinners.length + (extraWinnersCount > 0 ? 1 : 0));

            const keyStatsMinH = 32 + 48 + 20 + 18 + winnerLinesTotal * winnerLineH;
            const gridH = Math.max(chartContentH + 16, keyStatsMinH, 148);

            const FOOTER_BLOCK_H = 24 + 1 + 12 + 16;
            const CARD_H = TOP_ACCENT_H + PAD + HEADER_H + 24 + gridH + FOOTER_BLOCK_H + 24;

            const { canvas, ctx } = createHiDpiCanvas(CARD_W, CARD_H, 2, 12);

            // Background + Gold top accent bar
            ctx.fillStyle = COLORS.cardDarkBg;
            ctx.fillRect(0, 0, CARD_W, CARD_H);

            ctx.fillStyle = COLORS.gold;
            ctx.fillRect(0, 0, CARD_W, TOP_ACCENT_H);

            strokeRoundRect(ctx, 0.5, 0.5, CARD_W - 1, CARD_H - 1, 12, 'rgba(255, 255, 255, 0.06)', 1);

            let cursorY = TOP_ACCENT_H + PAD;

            // Centered header title
            ctx.font = fontSpec(TITLE_FONT, 800);
            ctx.fillStyle = COLORS.white;
            for (let i = 0; i < titleLines.length; i++) {
                drawRichLine(
                    ctx,
                    titleLines[i]!,
                    CARD_W / 2,
                    cursorY + i * TITLE_LH + TITLE_LH / 2,
                    INNER_W - 20,
                    emojiMap,
                    { align: 'center', fontSize: TITLE_FONT }
                );
            }
            cursorY += titleLines.length * TITLE_LH + 10;

            // Meta pills (Created by ... + optional CLOSED pill)
            const createdPillText = `${I18n.t('messages.renderer.created_by', locale)} ${data.creator || 'Unknown'}`;
            ctx.font = fontSpec(12, 600);
            const createdTextFit = truncatePlainText(ctx, createdPillText, INNER_W - 140);
            const createdPillW = Math.ceil(ctx.measureText(createdTextFit).width) + 20;

            const closedPillText = I18n.t('messages.renderer.closed', locale).toUpperCase();
            let closedPillW = 0;
            if (data.closed) {
                ctx.font = fontSpec(12, 700);
                closedPillW = Math.ceil(ctx.measureText(closedPillText).width) + 20;
            }

            const totalPillsW = createdPillW + (closedPillW > 0 ? 10 + closedPillW : 0);
            let pillX = (CARD_W - totalPillsW) / 2;

            fillRoundRect(ctx, pillX, cursorY, createdPillW, META_H, 12, COLORS.cardPollBg);
            ctx.font = fontSpec(12, 600);
            ctx.fillStyle = COLORS.textSubtle;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(createdTextFit, pillX + createdPillW / 2, cursorY + META_H / 2);
            pillX += createdPillW + 10;

            if (closedPillW > 0) {
                fillRoundRect(ctx, pillX, cursorY, closedPillW, META_H, 12, COLORS.red);
                ctx.font = fontSpec(12, 700);
                ctx.fillStyle = COLORS.white;
                ctx.fillText(closedPillText, pillX + closedPillW / 2, cursorY + META_H / 2);
            }

            cursorY += META_H + 24;

            // Left Column: Horizontal Bar Chart
            const leftColX = PAD;
            const chartStartY = cursorY + (gridH - chartContentH) / 2;
            const labelColW = 32;
            const pctColW = 42;
            const barTrackX = leftColX + labelColW + 8;
            const barTrackW = COL_W - labelColW - 8 - 8 - pctColW;

            for (let i = 0; i < items.length; i++) {
                const item = items[i]!;
                const rowCy = chartStartY + i * (CHART_ROW_H + CHART_ROW_GAP) + CHART_ROW_H / 2;

                ctx.font = fontSpec(12, 600, 'normal', true);
                ctx.fillStyle = COLORS.textSubtle;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(`#${i + 1}`, leftColX + labelColW, rowCy);

                fillRoundRect(ctx, barTrackX, rowCy - 4, barTrackW, 8, 4, COLORS.cardPollBg);
                if (item.percentage > 0) {
                    const fillW = Math.max(5, (barTrackW * item.percentage) / 100);
                    fillRoundRect(
                        ctx,
                        barTrackX,
                        rowCy - 4,
                        fillW,
                        8,
                        4,
                        item.isWinner ? COLORS.gold : COLORS.blurple
                    );
                }

                ctx.font = fontSpec(12, 600);
                ctx.fillStyle = COLORS.textSecondary;
                ctx.textAlign = 'left';
                ctx.fillText(`${Math.round(item.percentage)}%`, barTrackX + barTrackW + 8, rowCy);
            }

            // Right Column: Key Stats Panel
            const rightColX = PAD + COL_W + COL_GAP;
            const rightCenterX = rightColX + COL_W / 2;
            fillRoundRect(ctx, rightColX, cursorY, COL_W, gridH, 8, COLORS.cardPollBg);

            const statsBlockH = 16 + 32 + 22 + 16 + winnerLinesTotal * winnerLineH;
            let statY = cursorY + Math.max(16, (gridH - statsBlockH) / 2);

            // Stat 1: TOTAL VOTES
            const totalVotesLabel = I18n.t('messages.renderer.total_votes_lower', locale).toUpperCase();
            ctx.font = fontSpec(12, 700);
            ctx.fillStyle = COLORS.textSubtle;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(truncatePlainText(ctx, totalVotesLabel, COL_W - 24), rightCenterX, statY);
            statY += 18;

            ctx.font = fontSpec(26, 800);
            ctx.fillStyle = COLORS.white;
            ctx.fillText(Number(totalVotes).toLocaleString('en-US'), rightCenterX, statY);
            statY += 48;

            // Stat 2: WINNER
            const winnerUpperLabel = I18n.t('view.winner_upper', locale);
            ctx.font = fontSpec(12, 700);
            ctx.fillStyle = COLORS.textSubtle;
            ctx.fillText(truncatePlainText(ctx, winnerUpperLabel, COL_W - 24), rightCenterX, statY);
            statY += 20;

            ctx.font = fontSpec(winnerFontSize, 800);
            ctx.fillStyle = COLORS.gold;
            if (displayedWinners.length === 0) {
                ctx.textBaseline = 'middle';
                ctx.fillText('-', rightCenterX, statY + winnerLineH / 2);
            } else {
                for (let wIdx = 0; wIdx < displayedWinners.length; wIdx++) {
                    drawRichLine(
                        ctx,
                        displayedWinners[wIdx]!.label,
                        rightCenterX,
                        statY + wIdx * winnerLineH + winnerLineH / 2,
                        COL_W - 28,
                        emojiMap,
                        { align: 'center', fontSize: winnerFontSize }
                    );
                }
                if (extraWinnersCount > 0) {
                    ctx.font = fontSpec(13, 700);
                    ctx.fillStyle = COLORS.textSubtle;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(
                        `+${extraWinnersCount} more`,
                        rightCenterX,
                        statY + displayedWinners.length * winnerLineH + winnerLineH / 2
                    );
                }
            }

            cursorY += gridH + 24;

            // Footer
            ctx.fillStyle = COLORS.cardPollBg;
            ctx.fillRect(PAD, cursorY, INNER_W, 1);
            cursorY += 1 + 12;

            ctx.font = fontSpec(12, 500);
            ctx.fillStyle = COLORS.textDim;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(
                truncatePlainText(ctx, I18n.t('view.generated_by', locale), INNER_W),
                CARD_W / 2,
                cursorY
            );

            return await canvas.encode('png');
        } catch (error) {
            logger.error('[Renderer] Failed to render detailed view card:', error);
            throw new Error('Failed to generate image. Please try again later.');
        }
    }
}
