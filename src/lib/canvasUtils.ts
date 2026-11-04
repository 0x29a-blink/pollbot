import fs from 'fs';
import { Canvas, createCanvas, GlobalFonts, Image, loadImage, SKRSContext2D } from '@napi-rs/canvas';
import { logger } from './logger';

let fontsInitialized = false;
let measureCanvas: Canvas | null = null;

export function initFonts(): void {
    if (fontsInitialized) return;
    fontsInitialized = true;

    const candidates: Array<[string, string]> = [
        // Linux (Ubuntu / Noto)
        ['/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', 'PB Sans'],
        ['/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', 'PB Sans'],
        ['/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf', 'PB Sans'],
        ['/usr/share/fonts/truetype/noto/NotoSans-BoldItalic.ttf', 'PB Sans'],
        ['/usr/share/fonts/truetype/noto/NotoMono-Regular.ttf', 'PB Mono'],
        ['/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf', 'PB Symbols'],
        ['/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf', 'PB Symbols'],
        ['/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', 'PB Emoji'],
        // Linux fallback (DejaVu)
        ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'PB Sans'],
        ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'PB Sans'],
        ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 'PB Mono'],
        // Windows (Segoe UI / Consolas)
        ['C:\\Windows\\Fonts\\segoeui.ttf', 'PB Sans'],
        ['C:\\Windows\\Fonts\\segoeuib.ttf', 'PB Sans'],
        ['C:\\Windows\\Fonts\\segoeuii.ttf', 'PB Sans'],
        ['C:\\Windows\\Fonts\\segoeuiz.ttf', 'PB Sans'],
        ['C:\\Windows\\Fonts\\consola.ttf', 'PB Mono'],
        ['C:\\Windows\\Fonts\\consolab.ttf', 'PB Mono'],
        ['C:\\Windows\\Fonts\\seguisym.ttf', 'PB Symbols'],
        ['C:\\Windows\\Fonts\\seguiemj.ttf', 'PB Emoji'],
    ];

    for (const [filePath, family] of candidates) {
        try {
            if (fs.existsSync(filePath)) {
                GlobalFonts.registerFromPath(filePath, family);
            }
        } catch {
            // Ignore font registration errors and rely on OS fallback
        }
    }
}

export const FONT_SANS = '"PB Sans", "Segoe UI", "Noto Sans", Roboto, "PB Symbols", "PB Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
export const FONT_MONO = '"PB Mono", Consolas, "Noto Mono", monospace';

export function fontSpec(
    sizePx: number,
    weight: number = 600,
    style: 'normal' | 'italic' = 'normal',
    mono: boolean = false
): string {
    return `${style} ${weight} ${sizePx}px ${mono ? FONT_MONO : FONT_SANS}`;
}

export function getMeasureContext(): SKRSContext2D {
    initFonts();
    if (!measureCanvas) {
        measureCanvas = createCanvas(16, 16);
    }
    return measureCanvas.getContext('2d');
}

// Bounded SSRF-safe LRU cache for Discord custom emojis
const ALLOWED_IMAGE_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net',
]);

interface CachedImageEntry {
    image: Image;
    expires: number;
}

const imageCache = new Map<string, CachedImageEntry>();
const inflightFetches = new Map<string, Promise<Image | null>>();
const IMAGE_CACHE_MAX = 200;
const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;

export function isAllowedDiscordUrl(rawUrl: string): boolean {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

export async function fetchImageCached(url: string): Promise<Image | null> {
    if (!isAllowedDiscordUrl(url)) return null;

    const now = Date.now();
    const cached = imageCache.get(url);
    if (cached && now < cached.expires) {
        imageCache.delete(url);
        imageCache.set(url, cached);
        return cached.image;
    }

    const inflight = inflightFetches.get(url);
    if (inflight) {
        return inflight;
    }

    const promise = (async (): Promise<Image | null> => {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(2500),
                headers: { 'User-Agent': 'PollBot/2.0 (+canvas)' },
            });
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return null;
            const img = await loadImage(buf);

            if (imageCache.size >= IMAGE_CACHE_MAX) {
                const oldestKey = imageCache.keys().next().value;
                if (oldestKey) imageCache.delete(oldestKey);
            }
            imageCache.set(url, { image: img, expires: Date.now() + IMAGE_CACHE_TTL_MS });
            return img;
        } catch (err: any) {
            logger.debug(`[Renderer] Emoji fetch skipped (${url}): ${err?.message || err}`);
            return null;
        } finally {
            inflightFetches.delete(url);
        }
    })();

    inflightFetches.set(url, promise);
    return promise;
}

export type RichToken =
    | { type: 'text'; value: string }
    | { type: 'emoji'; name: string; id: string; url: string };

const CUSTOM_EMOJI_REGEX = /<(a)?:(\w+):(\d+)>/g;

export function parseRichTokens(text: string | null | undefined): RichToken[] {
    const str = String(text ?? '');
    if (!str) return [];

    const tokens: RichToken[] = [];
    let lastIndex = 0;
    CUSTOM_EMOJI_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = CUSTOM_EMOJI_REGEX.exec(str)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ type: 'text', value: str.slice(lastIndex, match.index) });
        }
        const name = match[2] || 'emoji';
        const id = match[3] || '';
        tokens.push({
            type: 'emoji',
            name,
            id,
            url: `https://cdn.discordapp.com/emojis/${id}.png?size=64`,
        });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < str.length) {
        tokens.push({ type: 'text', value: str.slice(lastIndex) });
    }

    return tokens;
}

export function collectEmojiUrls(texts: Array<string | null | undefined>): string[] {
    const urls = new Set<string>();
    for (const t of texts) {
        for (const tok of parseRichTokens(t)) {
            if (tok.type === 'emoji') {
                urls.add(tok.url);
            }
        }
    }
    return Array.from(urls);
}

export async function prefetchImages(urls: string[]): Promise<Map<string, Image | null>> {
    const unique = Array.from(new Set(urls.filter(Boolean)));
    if (unique.length === 0) return new Map();
    const entries = await Promise.all(unique.map(async (u): Promise<[string, Image | null]> => [u, await fetchImageCached(u)]));
    return new Map(entries);
}

export function createHiDpiCanvas(
    width: number,
    height: number,
    scale: number = 2,
    radius: number = 12
): { canvas: Canvas; ctx: SKRSContext2D } {
    initFonts();
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const canvas = createCanvas(Math.round(safeWidth * scale), Math.round(safeHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    if (radius > 0) {
        roundRectPath(ctx, 0, 0, safeWidth, safeHeight, radius);
        ctx.clip();
    }

    return { canvas, ctx };
}

export function roundRectPath(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void {
    const safeW = Math.max(0, w);
    const safeH = Math.max(0, h);
    const radius = Math.max(0, Math.min(r, safeW / 2, safeH / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + safeW, y, x + safeW, y + safeH, radius);
    ctx.arcTo(x + safeW, y + safeH, x, y + safeH, radius);
    ctx.arcTo(x, y + safeH, x, y, radius);
    ctx.arcTo(x, y, x + safeW, y, radius);
    ctx.closePath();
}

export function fillRoundRect(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fillStyle: string
): void {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
}

export function strokeRoundRect(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    strokeStyle: string,
    lineWidth: number = 1
): void {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
}

export function truncatePlainText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
    const str = String(text ?? '');
    if (maxWidth <= 0) return '';
    if (ctx.measureText(str).width <= maxWidth) return str;

    const ellipsis = '…';
    const ellipsisW = ctx.measureText(ellipsis).width;
    if (ellipsisW >= maxWidth) return '';

    const chars = Array.from(str);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = chars.slice(0, mid).join('');
        if (ctx.measureText(candidate).width + ellipsisW <= maxWidth) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return chars.slice(0, lo).join('') + ellipsis;
}

/**
 * Splits a long unbroken word into chunks that each fit within `maxWidth`.
 */
function splitLongWord(ctx: SKRSContext2D, word: string, maxWidth: number): string[] {
    const chars = Array.from(word);
    const chunks: string[] = [];
    let current = '';

    for (const ch of chars) {
        const candidate = current + ch;
        if (current.length > 0 && ctx.measureText(candidate).width > maxWidth) {
            chunks.push(current);
            current = ch;
        } else {
            current = candidate;
        }
    }
    if (current) {
        chunks.push(current);
    }
    return chunks;
}

/**
 * Wraps multi-paragraph plain text (preserving explicit `\n` newlines) within
 * `maxWidth`, capping at `maxLines` with an ellipsis on the final line.
 * Inline custom emoji syntax `<:name:id>` is left intact so `drawRichLine` can
 * render custom emojis on each wrapped line.
 */
export function wrapTextParagraphs(
    ctx: SKRSContext2D,
    text: string | null | undefined,
    maxWidth: number,
    maxLines: number = 12
): string[] {
    const raw = String(text ?? '').replace(/\r\n/g, '\n');
    if (!raw.trim()) return [];
    if (maxWidth <= 0 || maxLines <= 0) return [];

    // For width measurement, treat `<a?:name:id>` as roughly a 2-em glyph so wrapping stays accurate
    const measureDisplayWidth = (s: string): number => {
        const approx = s.replace(/<a?:\w+:\d+>/g, 'MM');
        return ctx.measureText(approx).width;
    };

    const paragraphs = raw.split('\n');
    const lines: string[] = [];

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const para = paragraphs[pIdx] ?? '';
        if (para.trim().length === 0) {
            if (lines.length + 1 >= maxLines && pIdx < paragraphs.length - 1) {
                lines.push('…');
                return lines;
            }
            lines.push('');
            continue;
        }

        const words = para.split(/\s+/).filter(Boolean);
        let current = '';

        for (let wIdx = 0; wIdx < words.length; wIdx++) {
            const word = words[wIdx]!;
            const candidate = current ? `${current} ${word}` : word;

            if (measureDisplayWidth(candidate) <= maxWidth) {
                current = candidate;
                continue;
            }

            // Need to wrap before placing `word`
            if (lines.length + 1 >= maxLines) {
                const remaining = [current, ...words.slice(wIdx)].filter(Boolean).join(' ');
                lines.push(truncatePlainText(ctx, remaining.replace(/<a?:(\w+):\d+>/g, ':$1:'), maxWidth));
                return lines;
            }

            if (current) {
                lines.push(current);
                current = '';
            }

            // Check if `word` itself is wider than `maxWidth`
            if (measureDisplayWidth(word) > maxWidth && !/<a?:\w+:\d+>/.test(word)) {
                const chunks = splitLongWord(ctx, word, maxWidth);
                for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
                    const chunk = chunks[cIdx]!;
                    const isLastChunk = cIdx === chunks.length - 1;
                    if (!isLastChunk) {
                        if (lines.length + 1 >= maxLines) {
                            const rest = chunks.slice(cIdx).join('') + (wIdx + 1 < words.length ? ' ' + words.slice(wIdx + 1).join(' ') : '');
                            lines.push(truncatePlainText(ctx, rest, maxWidth));
                            return lines;
                        }
                        lines.push(chunk);
                    } else {
                        current = chunk;
                    }
                }
            } else {
                current = word;
            }
        }

        if (current) {
            if (lines.length + 1 >= maxLines && pIdx < paragraphs.length - 1) {
                lines.push(truncatePlainText(ctx, `${current} …`, maxWidth));
                return lines;
            }
            lines.push(current);
        }
    }

    return lines;
}

type DrawSegment =
    | { type: 'text'; value: string; width: number }
    | { type: 'emoji'; img: Image; width: number };

/**
 * Draw single-line text supporting inline Discord custom emojis (`<:name:id>`),
 * truncation with ellipsis, and `'left' | 'center' | 'right'` alignment.
 * `y` is the vertical center of the line.
 */
export function drawRichLine(
    ctx: SKRSContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    imageMap: Map<string, Image | null> | null,
    options: { align?: 'left' | 'center' | 'right'; fontSize?: number } = {}
): void {
    const { align = 'left', fontSize = 16 } = options;
    if (!text || maxWidth <= 0) return;

    const tokens = parseRichTokens(text);
    if (tokens.length === 0) return;

    const emojiSize = Math.round(fontSize * 1.18);
    const emojiPad = 2;
    const ellipsis = '…';
    const ellipsisW = ctx.measureText(ellipsis).width;

    const segments: DrawSegment[] = [];
    let usedWidth = 0;
    let truncated = false;

    for (const tok of tokens) {
        if (tok.type === 'emoji') {
            const img = imageMap ? imageMap.get(tok.url) ?? null : null;
            if (img) {
                const segW = emojiSize + emojiPad * 2;
                if (usedWidth + segW <= maxWidth) {
                    segments.push({ type: 'emoji', img, width: segW });
                    usedWidth += segW;
                } else {
                    truncated = true;
                    break;
                }
            } else {
                const fallback = `:${tok.name}:`;
                const w = ctx.measureText(fallback).width;
                if (usedWidth + w <= maxWidth) {
                    segments.push({ type: 'text', value: fallback, width: w });
                    usedWidth += w;
                } else {
                    const fit = truncatePlainText(ctx, fallback, maxWidth - usedWidth);
                    if (fit) {
                        const fw = ctx.measureText(fit).width;
                        segments.push({ type: 'text', value: fit, width: fw });
                        usedWidth += fw;
                    }
                    truncated = false;
                    break;
                }
            }
        } else {
            const w = ctx.measureText(tok.value).width;
            if (usedWidth + w <= maxWidth) {
                segments.push({ type: 'text', value: tok.value, width: w });
                usedWidth += w;
            } else {
                const fit = truncatePlainText(ctx, tok.value, maxWidth - usedWidth);
                if (fit) {
                    const fw = ctx.measureText(fit).width;
                    segments.push({ type: 'text', value: fit, width: fw });
                    usedWidth += fw;
                }
                truncated = false;
                break;
            }
        }
    }

    if (truncated) {
        while (segments.length > 0 && usedWidth + ellipsisW > maxWidth) {
            const popped = segments.pop()!;
            usedWidth -= popped.width;
        }
        if (usedWidth + ellipsisW <= maxWidth) {
            segments.push({ type: 'text', value: ellipsis, width: ellipsisW });
            usedWidth += ellipsisW;
        }
    }

    let cursorX = x;
    if (align === 'center') cursorX = x - usedWidth / 2;
    else if (align === 'right') cursorX = x - usedWidth;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const seg of segments) {
        if (seg.type === 'text') {
            ctx.fillText(seg.value, cursorX, y);
            cursorX += seg.width;
        } else {
            ctx.drawImage(seg.img, cursorX + emojiPad, y - emojiSize / 2, emojiSize, emojiSize);
            cursorX += seg.width;
        }
    }

    ctx.restore();
}

/**
 * Draws a crisp vector crown icon (avoids platform-dependent emoji glyphs).
 */
export function drawCrownIcon(
    ctx: SKRSContext2D,
    x: number,
    cy: number,
    size: number = 15,
    color: string = '#FEE75C'
): void {
    const w = size;
    const h = size * 0.78;
    const top = cy - h / 2;
    const bottom = cy + h / 2;

    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.08, bottom - h * 0.18);
    ctx.lineTo(x + w * 0.02, top + h * 0.15);
    ctx.lineTo(x + w * 0.30, top + h * 0.50);
    ctx.lineTo(x + w * 0.50, top);
    ctx.lineTo(x + w * 0.70, top + h * 0.50);
    ctx.lineTo(x + w * 0.98, top + h * 0.15);
    ctx.lineTo(x + w * 0.92, bottom - h * 0.18);
    ctx.closePath();
    ctx.fill();

    // Crown base band
    fillRoundRect(ctx, x + w * 0.08, bottom - h * 0.12, w * 0.84, Math.max(2, h * 0.15), 1, color);
    ctx.restore();
}
