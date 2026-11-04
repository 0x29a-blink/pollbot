/**
 * DEV-ONLY mock of the PollBot API, so the dashboard can be previewed and
 * screenshotted without a backend, Discord OAuth or a database.
 *
 * Enabled only when `import.meta.env.DEV` and `VITE_MOCK_API=1` (see main.tsx),
 * e.g. `VITE_MOCK_API=1 npm run dev`. Never imported by production builds.
 *
 * The data is sample data. Totals are computed from the rows so every count
 * on screen agrees with the list it summarises.
 */

type Json = Record<string, unknown> | unknown[];

const now = Date.now();
const H = 3_600_000;
const D = 24 * H;
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

// --------------------------------------------------------------- servers

interface MockGuild { id: string; name: string; icon_url: string | null; member_count: number | null; joined_at: string; locale: string }

const guilds: MockGuild[] = [
    { id: '700000000000000001', name: 'Lofi Study Hall', icon_url: null, member_count: 18432, joined_at: iso(420 * D), locale: 'en-US' },
    { id: '700000000000000002', name: 'Valheim Vikings', icon_url: null, member_count: 2381, joined_at: iso(212 * D), locale: 'en-GB' },
    { id: '700000000000000003', name: 'HomeLab Garage', icon_url: null, member_count: 9604, joined_at: iso(160 * D), locale: 'en-US' },
    { id: '700000000000000004', name: 'Tabletop Tuesdays', icon_url: null, member_count: 214, joined_at: iso(41 * D), locale: 'en-US' },
    { id: '700000000000000005', name: 'Speedrun Dojo', icon_url: null, member_count: 5120, joined_at: iso(18 * D), locale: 'es-ES' },
    { id: '700000000000000006', name: 'Quiet Bookclub', icon_url: null, member_count: null, joined_at: iso(3 * D), locale: 'en-US' },
];

const withoutBot = [
    { id: '700000000000000101', name: 'Synthwave Lounge', icon_url: null, has_bot: false },
    { id: '700000000000000102', name: 'Pixel Art Atelier', icon_url: null, has_bot: false },
    { id: '700000000000000103', name: 'Rust Learners', icon_url: null, has_bot: false },
];

const channelsByGuild: Record<string, { id: string; name: string; type: number; position: number; parent_id: string | null; bot_can_post: boolean }[]> = {};
const channelNames = ['announcements', 'general', 'polls', 'events', 'feedback', 'off-topic'];
guilds.forEach((g, gi) => {
    channelsByGuild[g.id] = channelNames.map((name, i) => ({
        id: `8${String(gi).padStart(2, '0')}0000000000000${i}`,
        name,
        type: 0,
        position: i,
        parent_id: null,
        bot_can_post: name !== 'announcements',
    }));
});

const roles = [
    { id: '900000000000000001', name: 'Moderator', color: 0x3498db, position: 5, managed: false },
    { id: '900000000000000002', name: 'Patron', color: 0xe67e22, position: 4, managed: false },
    { id: '900000000000000003', name: 'Member', color: 0x2ecc71, position: 2, managed: false },
    { id: '900000000000000004', name: 'Newcomer', color: 0, position: 1, managed: false },
];

// ----------------------------------------------------------------- polls

interface MockPoll {
    message_id: string; guild_id: string; channel_id: string; creator_id: string;
    title: string; description: string; options: string[]; settings: Record<string, unknown>;
    created_at: string; active: boolean; discord_deleted: boolean | null; ends_at: string | null;
    vote_counts: Record<number, number>; total_votes: number; unique_voters: number;
}

const pollSeeds: [string, string[], string][] = [
    ['Which night works for the next game session?', ['Friday', 'Saturday', 'Sunday afternoon'], 'Pick every night you can make.'],
    ['Pick the soundtrack for this week’s focus stream', ['Rainy jazz', 'Synthwave', 'Piano only', 'Nature sounds'], ''],
    ['Should we add a #self-promo channel?', ['Yes', 'No', 'Only for members over 30 days'], 'Mods will follow the majority.'],
    ['Next server event', ['Movie night', 'Trivia', 'Build contest', 'Karaoke'], ''],
    ['Rate the new onboarding flow', ['Great', 'Fine', 'Confusing'], ''],
    ['Favourite boss so far', ['Eikthyr', 'The Elder', 'Bonemass', 'Moder', 'Yagluth'], ''],
    ['When should weekly reset happen?', ['Monday 00:00 UTC', 'Sunday 18:00 UTC'], ''],
    ['Book for December', ['Piranesi', 'The Remains of the Day', 'Klara and the Sun'], 'Voting closes Friday.'],
];

const polls: MockPoll[] = [];
let seq = 1;
guilds.forEach((g, gi) => {
    const count = [14, 9, 6, 3, 2, 0][gi];
    for (let i = 0; i < count; i++) {
        const [title, options, description] = pollSeeds[(gi * 3 + i) % pollSeeds.length];
        const channel = channelsByGuild[g.id][(i * 2 + gi) % channelNames.length];
        const counts: Record<number, number> = {};
        let total = 0;
        options.forEach((_, oi) => {
            const v = Math.max(0, Math.round(((gi + 3) * (oi + 2) * 7 + i * 13) % 61) - (i === 1 ? 61 : 0));
            counts[oi] = v;
            total += v;
        });
        const weighted = gi === 0 && i === 2;
        const active = i < 2 || (gi === 1 && i === 4);
        polls.push({
            message_id: `60000000000000${String(seq++).padStart(4, '0')}`,
            guild_id: g.id,
            channel_id: channel.id,
            creator_id: '100000000000000001',
            title,
            description,
            options,
            settings: {
                public: i % 4 !== 3,
                allow_thread: i % 3 === 0,
                allow_close: true,
                allow_exports: i % 5 !== 4,
                max_votes: i % 2 === 0 ? 1 : options.length,
                min_votes: 1,
                allowed_roles: i % 4 === 2 ? ['900000000000000003'] : [],
                vote_weights: weighted ? { '900000000000000002': 2 } : {},
                role_metadata: i % 4 === 2 || weighted ? {
                    '900000000000000003': { name: 'Member', color: 0x2ecc71 },
                    '900000000000000002': { name: 'Patron', color: 0xe67e22 },
                } : undefined,
            },
            created_at: iso((i * 2.7 + gi * 0.6) * D + (i + 1) * 2 * H),
            active,
            discord_deleted: gi === 0 && i === 6 ? true : null,
            ends_at: active && i === 0 ? new Date(now + (gi + 1) * 26 * H).toISOString() : null,
            vote_counts: counts,
            total_votes: total,
            unique_voters: Math.round(total * (weighted ? 0.8 : 1)),
        });
    }
});

// ----------------------------------------------------------------- votes

const myVotes = polls.filter((_, i) => i % 3 === 0).slice(0, 9).map((p, i) => {
    const g = guilds.find(x => x.id === p.guild_id)!;
    return {
        poll_id: p.message_id,
        title: p.title,
        guild_id: g.id,
        guild_name: g.name,
        guild_icon_url: g.icon_url,
        channel_id: p.channel_id,
        active: p.active,
        chosen_options: [p.options[i % p.options.length]],
        weight: i === 2 ? 2 : 1,
        voted_at: iso(i * 1.4 * D + 3 * H),
    };
});

// ------------------------------------------------------------- analytics

function dayKey(msAgo: number) {
    return new Date(now - msAgo).toISOString().slice(0, 10);
}

function guildAnalytics(guildId: string) {
    const gp = polls.filter(p => p.guild_id === guildId);
    const scale = Math.max(1, gp.length);
    const activity = Array.from({ length: 30 }, (_, i) => {
        const d = 29 - i;
        const base = (Math.sin(i / 3) + 1.4) * scale * 1.6;
        const spike = i === 22 ? scale * 9 : 0;
        const votes = Math.max(0, Math.round(base + spike + (i % 5)));
        return { day: dayKey(d * D), votes, unique_voters: Math.round(votes * 0.72) };
    });
    const peakHours = Array.from({ length: 24 }, (_, h) => ({ hour: h, votes: Math.round((Math.sin((h - 14) / 3.8) + 1.1) * scale * 4) }));
    const names = ['mira.wav', 'Thorgrim', 'packetloss', 'juniper', 'Oskar_K', 'byte-sized', 'Lune', 'ferrous'];
    const topVoters = names.slice(0, Math.min(names.length, scale + 2)).map((n, i) => ({
        user_id: `30000000000000000${i}`,
        username: n,
        avatar_url: null,
        votes: Math.max(1, 40 - i * 5 - (scale < 4 ? 20 : 0)),
    }));
    return { days: 30, activity, peakHours, topVoters };
}

// ----------------------------------------------------------------- admin
//
// The bot-admin screens see every server PollBot is in: the six sample
// servers above plus generated ones, so the server browser can page and sort.
// Stats for the six come from their polls; the generated servers carry their
// own counters. Every admin total is summed from these rows.

/** Small deterministic PRNG so the sample data is the same on every load. */
function seeded(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface AdminGuildRow extends MockGuild {
    poll_count: number;
    active_poll_count: number;
    weighted_votes: number;
    ballots: number;
    last_poll_at: string | null;
    left_at: string | null;
}

const extraGuildNames = [
    'Minecraft Builders Guild', 'Apex Squad Finder', 'Indie Dev Collective', 'Anime Watch Party', 'Crypto Chat (no shilling)',
    'Cozy Gamers Café', 'r/buildapc Discord', 'Chess Openings Club', 'Lo-Fi Producers', 'Destiny Raid Planning',
    'Photography Critique', 'Formula 1 Paddock', 'Python Help Desk', 'Pokémon Trading Post', 'Language Exchange Hub',
    'Fantasy Football League', 'Warframe Clan Dojo', 'Kpop Stan Room', 'Linux Users Group', 'Board Game Geeks',
    'Fitness Accountability', 'Genshin Co-op', 'Film Club Weekly', 'Mechanical Keyboards', 'Startup Founders',
    'Overwatch Scrims', 'Plant Parents', 'D&D Wednesday Group', 'Retro Console Repair', 'Music Theory Corner',
    'Cat Pictures Only', 'Rocket League Ranked', 'Study Together 24/7', 'Hiking & Trails', 'Valorant Customs',
    'Astro Imaging', 'Comic Book Club', 'Rust Survival PvP', 'Writers Workshop', 'Esports Bets (for fun)',
    'Homebrewing', 'Tech Support Night', 'Stardew Farmers', 'VRChat Hangout', 'Bakers Dozen',
    'Japanese Learners', 'Speedcubing', 'Open Source Contributors', 'League Clash Team', 'Minimalist Living',
    'Lofi Café Deutsch', 'Comunidad Gamer MX', 'Clube do Livro BR', 'Le Salon Français', 'Polska Strefa Gier',
];
const localeFor: Record<string, string> = { 'Lofi Café Deutsch': 'de', 'Comunidad Gamer MX': 'es-419', 'Clube do Livro BR': 'pt-BR', 'Le Salon Français': 'fr', 'Polska Strefa Gier': 'pl' };
const extraLocales = ['en-US', 'en-US', 'en-US', 'en-US', 'en-GB', 'de', 'es-ES', 'fr', 'pt-BR', 'ru', 'pl', 'tr', 'ja', 'ko', 'nl', 'it', 'sv-SE', 'uk', 'es-419', 'zh-CN'];

const adminGuilds: AdminGuildRow[] = (() => {
    const rnd = seeded(31);
    const own: AdminGuildRow[] = guilds.map(g => {
        const gp = polls.filter(p => p.guild_id === g.id);
        return {
            ...g,
            poll_count: gp.length,
            active_poll_count: gp.filter(p => p.active).length,
            weighted_votes: gp.reduce((s, p) => s + p.total_votes, 0),
            ballots: gp.reduce((s, p) => s + p.unique_voters, 0),
            last_poll_at: gp.reduce<string | null>((m, p) => (!m || p.created_at > m ? p.created_at : m), null),
            left_at: null,
        };
    });
    const extra: AdminGuildRow[] = extraGuildNames.map((name, i) => {
        // Long-tailed sizes: a few big communities, many small ones.
        const members = Math.round(30 + Math.pow(rnd(), 3.2) * 240_000);
        const hasPolls = rnd() > 0.38;
        const pollCount = hasPolls ? Math.max(1, Math.round(Math.pow(rnd(), 2) * 160)) : 0;
        const perPoll = 4 + rnd() * Math.min(400, members / 40);
        const votes = Math.round(pollCount * perPoll);
        const joinedDays = 2 + Math.round(rnd() * 900);
        return {
            id: `7100000000000${String(i + 1).padStart(5, '0')}`,
            name,
            icon_url: null,
            member_count: i === 17 ? null : members,
            joined_at: iso(joinedDays * D + i * H),
            locale: localeFor[name] ?? extraLocales[i % extraLocales.length],
            poll_count: pollCount,
            active_poll_count: hasPolls ? Math.round(rnd() * Math.min(6, pollCount)) : 0,
            weighted_votes: votes,
            ballots: Math.round(votes * 0.93),
            last_poll_at: hasPolls ? iso(Math.round(rnd() * Math.min(joinedDays, 60)) * D + Math.round(rnd() * 20) * H) : null,
            left_at: null,
        };
    });
    // Two servers the bot has left: excluded from every admin count.
    extra.push({ ...extra[3], id: '7199999999999990001', name: 'Old Test Server', left_at: iso(30 * D) });
    extra.push({ ...extra[5], id: '7199999999999990002', name: 'Abandoned Raid Group', left_at: iso(90 * D) });
    return [...own, ...extra];
})();

const liveGuilds = () => adminGuilds.filter(g => !g.left_at);

const handles = [
    'mira.wav', 'Thorgrim', 'packetloss', 'juniper', 'Oskar_K', 'byte-sized', 'Lune', 'ferrous', 'quietfox', 'nadia.k',
    'pixelpusher', 'Rook', 'tamsin', 'kestrel', 'Bram', 'sol.y', 'vex', 'Ilka', 'marlowe', 'zuzu', 'Cass', 'drift',
    'Hoshi', 'ember_', 'Teodor', 'wren', 'kip', 'Saoirse', 'gale', 'Ottilie', 'renzo', 'mochi', 'Aster', 'noor',
    'Felix_B', 'yuki', 'harbor', 'Pim', 'odette', 'snek', 'Quill', 'arlo', 'Maren', 'tidepool', 'Ines', 'beck',
];

interface MockVoter {
    user_id: string; username: string | null; avatar_url: null;
    sources: string[]; perMonth: number; weightedRatio: number; streak: number;
    df_weekly: number | null; df_total: number | null;
    first_vote_at: string; last_vote_at: string; premium_last_vote_at: string | null;
}

const voters: MockVoter[] = (() => {
    const rnd = seeded(77);
    return Array.from({ length: 138 }, (_, i) => {
        const r = rnd();
        const sources = r < 0.62 ? ['topgg'] : r < 0.84 ? ['discordforge'] : ['discordforge', 'topgg'];
        const perMonth = Math.max(1, Math.round(Math.pow(rnd(), 2.4) * 58));
        const lastHoursAgo = i < 30 ? rnd() * 11.5 : i === 30 ? 12.4 : 13 + rnd() * 24 * 25;
        const df = sources.includes('discordforge');
        return {
            user_id: `3000000000000${String(10000 + i)}`,
            username: i % 23 === 7 ? null : `${handles[i % handles.length]}${i >= handles.length ? Math.floor(i / handles.length) + 1 : ''}`,
            avatar_url: null,
            sources,
            perMonth,
            weightedRatio: sources.includes('topgg') ? 1 + rnd() * 0.3 : 1,
            // A streak only survives if the last vote was within about a day.
            streak: lastHoursAgo > 30 ? 0 : perMonth > 20 ? 2 + Math.round(rnd() * 22) : rnd() > 0.6 ? 2 : 0,
            df_weekly: df ? Math.round(rnd() * 7) : null,
            df_total: df ? 12 + Math.round(rnd() * 300) : null,
            first_vote_at: iso((40 + rnd() * 500) * D),
            last_vote_at: iso(lastHoursAgo * H),
            premium_last_vote_at: i % 19 === 11 ? null : iso(lastHoursAgo * H),
        };
    }).sort((a, b) => b.perMonth - a.perMonth);
})();

const votersIn = (days: number, source: string | null) => voters
    .filter(v => !source || v.sources.includes(source))
    .map(v => {
        const votes = Math.max(0, Math.round(v.perMonth * (days / 30) * (source && v.sources.length > 1 ? 0.5 : 1)));
        return { v, votes, weighted: Math.round(votes * v.weightedRatio) };
    })
    .filter(x => x.votes > 0);

function botlistDaily(days: number) {
    const out: { day: string; source: 'topgg' | 'discordforge'; votes: number; unique_voters: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const day = dayKey(i * D);
        const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
        const weekend = wd === 0 || wd === 6 ? 1.25 : 1;
        const t = Math.round((26 + Math.sin(i / 3) * 7 + (i === 9 ? 38 : 0)) * weekend);
        const f = Math.round(11 + Math.cos(i / 4) * 4);
        out.push({ day, source: 'discordforge', votes: f, unique_voters: Math.round(f * 0.92) });
        out.push({ day, source: 'topgg', votes: t, unique_voters: Math.round(t * 0.95) });
    }
    return out;
}

function voteAnalytics(days: number, source: string | null) {
    const history = botlistDaily(days).map(r => (source && r.source !== source ? { ...r, votes: 0, unique_voters: 0 } : r));
    const total = history.reduce((s, r) => s + r.votes, 0);
    const hourShape = Array.from({ length: 24 }, (_, h) => Math.max(0.15, Math.sin((h - 9) / 3.8) + 1.1));
    const hourSum = hourShape.reduce((a, b) => a + b, 0);
    const wdShape = [1, 0.95, 0.97, 1.02, 1.1, 1.35, 1.3];
    const wdSum = wdShape.reduce((a, b) => a + b, 0);
    const daysList = [...new Set(history.map(r => r.day))];
    const inWindow = votersIn(days, null);
    const both = inWindow.filter(x => x.v.sources.length > 1).length;
    const tOnly = inWindow.filter(x => x.v.sources.length === 1 && x.v.sources[0] === 'topgg').length;
    const fOnly = inWindow.length - both - tOnly;
    const weekendVotes = history.filter(r => [0, 6].includes(new Date(`${r.day}T00:00:00Z`).getUTCDay())).reduce((s, r) => s + r.votes, 0);
    return {
        history,
        hours: hourShape.map((w, h) => ({ hour: h, votes: Math.round((total * w) / hourSum) })),
        weekdays: wdShape.map((w, i) => ({ dow: i + 1, votes: Math.round((total * w) / wdSum) })),
        new_returning: daysList.map((day, i) => {
            const dayVotes = history.filter(r => r.day === day).reduce((s, r) => s + r.unique_voters, 0);
            const nv = Math.round(dayVotes * (0.08 + (i % 5) * 0.02));
            return { day, new_voters: nv, returning_voters: dayVotes - nv };
        }),
        overlap: { topgg_only: tOnly, discordforge_only: fOnly, both },
        weekend: { weekend_votes: weekendVotes, total_votes: total },
        campaigns: source === 'discordforge' ? [] : [
            { campaign: 'discord-announcement', votes: Math.round(total * 0.06) },
            { campaign: 'github-readme', votes: Math.round(total * 0.03) },
            { campaign: 'poll-footer', votes: Math.round(total * 0.02) },
        ],
    };
}

function adminVoteAnalytics(url: URL) {
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
    const rawSource = url.searchParams.get('source');
    const source = rawSource === 'topgg' || rawSource === 'discordforge' ? rawSource : null;
    const analytics = voteAnalytics(days, source);
    const top = votersIn(days, null).slice(0, 10);
    const month = botlistDaily(30);
    const totalsFor = (s: 'topgg' | 'discordforge') => {
        const v30 = month.filter(r => r.source === s).reduce((a, r) => a + r.votes, 0);
        return { source: s, votes_total: v30 * 14 + 311, voters_total: voters.filter(v => v.sources.includes(s)).length * 6, votes_30d: v30, voters_30d: votersIn(30, s).length };
    };
    const recent = voters.slice().sort((a, b) => b.last_vote_at.localeCompare(a.last_vote_at)).slice(0, 20).map((v, i) => ({
        id: 90000 - i,
        source: v.sources[i % v.sources.length],
        user_id: v.user_id,
        username: v.username,
        avatar_url: null,
        weight: v.sources.includes('topgg') && i % 4 === 1 ? 2 : 1,
        is_test: i === 5,
        is_weekend: i % 4 === 1,
        weekly_votes: v.df_weekly,
        total_votes: v.df_total,
        created_at: v.last_vote_at,
    }));
    return {
        days,
        source,
        analytics,
        topVoters: top.map(x => ({ user_id: x.v.user_id, username: x.v.username, avatar_url: null, votes: x.votes, sources: x.v.sources, last_vote_at: x.v.last_vote_at })),
        totals: [totalsFor('topgg'), totalsFor('discordforge')],
        recentVotes: recent,
    };
}

function adminVoterDirectory(url: URL) {
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
    const rawSource = url.searchParams.get('source');
    const source = rawSource === 'topgg' || rawSource === 'discordforge' ? rawSource : null;
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'votes';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
    const list = votersIn(days, source)
        .filter(x => !search || x.v.user_id.includes(search) || (x.v.username || '').toLowerCase().includes(search))
        .sort((a, b) => sort === 'streak' ? b.v.streak - a.v.streak
            : sort === 'weighted' ? b.weighted - a.weighted
                : sort === 'recent' ? b.v.last_vote_at.localeCompare(a.v.last_vote_at)
                    : b.votes - a.votes);
    return {
        days, source, sort, limit, offset,
        total: list.length,
        rows: list.slice(offset, offset + limit).map(x => ({
            user_id: x.v.user_id, username: x.v.username, avatar_url: null,
            votes: x.votes, weighted_votes: x.weighted, sources: x.v.sources,
            first_vote_at: x.v.first_vote_at, last_botlist_vote_at: x.v.last_vote_at,
            df_weekly_votes: x.v.df_weekly, df_total_votes: x.v.df_total,
            streak_days: x.v.streak, premium_last_vote_at: x.v.premium_last_vote_at,
            premium_active: !!x.v.premium_last_vote_at && now - new Date(x.v.premium_last_vote_at).getTime() < 12 * H,
        })),
    };
}

function adminPollSupporters(pollId: string) {
    const poll = polls.find(p => p.message_id === pollId);
    const n = poll?.unique_voters ?? 0;
    const supporters = Math.round(n * 0.36);
    const picks = voters.filter((_, i) => (i + Number(pollId.slice(-2))) % 9 === 0).slice(0, Math.min(5, supporters));
    return {
        total_voters: n,
        premium_now: Math.round(n * 0.18),
        supporters,
        supporters_30d: Math.round(supporters * 0.7),
        topgg: Math.round(supporters * 0.8),
        discordforge: Math.round(supporters * 0.35),
        top_supporters: picks.map(v => ({ user_id: v.user_id, username: v.username, avatar_url: null, botlist_votes: v.df_total ?? v.perMonth * 7, sources: v.sources, last_botlist_vote_at: v.last_vote_at })),
    };
}

/** Global votes per UTC day (get_vote_history), oldest first. */
function voteHistory(days: number) {
    return Array.from({ length: days }, (_, i) => {
        const d = days - 1 - i;
        const votes = Math.round((Math.sin(d / 4) + 1.6) * 820 + (d === 5 ? 2400 : 0) + (60 - d) * 9);
        return { day: dayKey(d * D), votes, unique_voters: Math.round(votes * 0.71), polls_created: Math.round(votes / 31) };
    });
}

/** Result of a mocked PostgREST call: the body and, for lists, the full count. */
interface RestResult { body: Json; total?: number }

/** PostgREST filter value for `col` (e.g. `eq.123` -> ['eq', '123']). */
function pgFilter(url: URL, col: string): [string, string] | null {
    const raw = url.searchParams.get(col);
    if (raw === null) return null;
    const i = raw.indexOf('.');
    return i < 0 ? [raw, ''] : [raw.slice(0, i), raw.slice(i + 1)];
}

const ilikeMatch = (value: string, pattern: string) => {
    const needle = pattern.replace(/^[%*]|[%*]$/g, '').replace(/\\([\\%_])/g, '$1').toLowerCase();
    return value.toLowerCase().includes(needle);
};

function paged<T>(rows: T[], url: URL): RestResult {
    const offset = Number(url.searchParams.get('offset') || 0);
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? rows.length : Number(limitRaw);
    return { body: rows.slice(offset, offset + limit) as unknown as Json, total: rows.length };
}

function adminRest(path: string, url: URL, rawBody?: string): RestResult {
    // /api/admin/db/rest/v1/<table or rpc/name>
    const rest = path.replace(/^\/api\/admin\/db\/rest\/v1\//, '');
    let args: Record<string, unknown> = {};
    try { args = rawBody ? JSON.parse(rawBody) : {}; } catch { /* not JSON */ }
    const live = liveGuilds();
    const sum = (f: (g: AdminGuildRow) => number) => live.reduce((s, g) => s + f(g), 0);

    if (rest.startsWith('global_stats')) {
        return { body: [{ id: 1, total_polls: sum(g => g.poll_count), total_votes: sum(g => g.weighted_votes), peak_active_servers: live.length, last_updated: iso(0) }] };
    }

    if (rest.startsWith('guilds')) {
        let rows = adminGuilds.slice();
        const id = pgFilter(url, 'id');
        if (id?.[0] === 'eq') rows = rows.filter(g => g.id === id[1]);
        if (pgFilter(url, 'left_at')?.join('.') === 'is.null') rows = rows.filter(g => !g.left_at);
        const name = pgFilter(url, 'name');
        if (name?.[0] === 'ilike') rows = rows.filter(g => ilikeMatch(g.name, name[1]));
        const order = url.searchParams.get('order') || '';
        if (order.startsWith('member_count')) {
            const asc = order.includes('.asc');
            rows.sort((a, b) => (a.member_count == null ? 1 : b.member_count == null ? -1 : asc ? a.member_count - b.member_count : b.member_count - a.member_count));
        } else if (order.startsWith('joined_at')) {
            rows.sort((a, b) => b.joined_at.localeCompare(a.joined_at));
        }
        return paged(rows.map(g => ({ id: g.id, name: g.name, icon_url: g.icon_url, member_count: g.member_count, joined_at: g.joined_at, locale: g.locale, left_at: g.left_at })), url);
    }

    if (rest.startsWith('polls')) {
        let rows = polls.slice();
        for (const col of ['guild_id', 'creator_id', 'active'] as const) {
            const f = pgFilter(url, col);
            if (f?.[0] === 'eq') rows = rows.filter(p => String(p[col]) === f[1]);
        }
        if (pgFilter(url, 'ends_at')?.join('.') === 'not.is.null') rows = rows.filter(p => p.ends_at);
        const created = pgFilter(url, 'created_at');
        if (created?.[0] === 'gte') rows = rows.filter(p => p.created_at >= created[1]);
        const title = pgFilter(url, 'title');
        if (title?.[0] === 'ilike') rows = rows.filter(p => ilikeMatch(p.title, title[1]));
        const asc = (url.searchParams.get('order') || '').includes('created_at.asc');
        rows.sort((a, b) => (asc ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
        const embed = (url.searchParams.get('select') || '').includes('guilds(');
        return paged(rows.map(p => {
            const g = adminGuilds.find(x => x.id === p.guild_id);
            return embed ? { ...p, guilds: g ? { id: g.id, name: g.name, icon_url: g.icon_url } : null } : p;
        }), url);
    }

    const rpc = rest.replace(/^rpc\//, '');
    switch (rpc) {
        case 'get_total_members': return { body: sum(g => g.member_count || 0) as unknown as Json };
        case 'get_active_voter_count': return { body: voters.filter(v => v.premium_last_vote_at && now - new Date(v.premium_last_vote_at).getTime() < 12 * H).length as unknown as Json };
        case 'get_global_totals':
            return {
                body: [{
                    total_polls: sum(g => g.poll_count),
                    active_polls: sum(g => g.active_poll_count),
                    vote_rows: sum(g => g.weighted_votes),
                    ballots: sum(g => g.ballots),
                    weighted_votes: sum(g => g.weighted_votes),
                    servers: live.length,
                    members: sum(g => g.member_count || 0),
                }],
            };
        case 'get_top_creators':
        case 'get_top_creators_v2': {
            const list = [
                { creator_id: '100000000000000001', polls: 41, username: 'mira.wav', avatar_url: null },
                { creator_id: '100000000000000002', polls: 33, username: 'Thorgrim', avatar_url: null },
                { creator_id: '100000000000000003', polls: 27, username: null, avatar_url: null },
                { creator_id: '100000000000000004', polls: 19, username: 'packetloss', avatar_url: null },
                { creator_id: '100000000000000005', polls: 12, username: 'juniper', avatar_url: null },
            ];
            return { body: list.slice(0, Number(args.p_limit) || 5) };
        }
        case 'get_top_guilds':
            return {
                body: live.filter(g => g.poll_count > 0).sort((a, b) => b.weighted_votes - a.weighted_votes).slice(0, Number(args.p_limit) || 5)
                    .map((g, i) => ({ guild_id: g.id, guild_name: g.name, votes: Math.round(g.weighted_votes * (0.18 - i * 0.02)), polls: Math.max(1, Math.round(g.poll_count * 0.25)) })),
            };
        case 'get_vote_history':
            return { body: voteHistory(Number(args.p_days) || 30) };
        case 'get_global_peak_hours': {
            // The same 30 days of votes as the history chart, spread over the hours.
            const total = voteHistory(30).reduce((s, r) => s + r.votes, 0);
            const shape = Array.from({ length: 24 }, (_, h) => Math.max(0.12, Math.sin((h - 13) / 3.8) + 1.15));
            const sumShape = shape.reduce((a, b) => a + b, 0);
            return { body: shape.map((w, h) => ({ hour: h, votes: Math.round((total * w) / sumShape) })) };
        }
        case 'get_guild_locale_counts': {
            const counts = new Map<string, number>();
            live.forEach(g => counts.set(g.locale, (counts.get(g.locale) ?? 0) + 1));
            return { body: [...counts.entries()].map(([locale, servers]) => ({ locale, servers })).sort((a, b) => b.servers - a.servers) };
        }
        case 'get_usage_summary': {
            const days = Number(args.p_days) || 30;
            const out: unknown[] = [];
            for (let i = days - 1; i >= 0; i--) {
                out.push({ day: dayKey(i * D), source: 'bot', events: Math.round(430 + Math.sin(i / 4) * 70 + (i % 7 === 1 ? 60 : 0) + (days - i) * 3), unique_users: 140 + (i % 5) * 9 });
                out.push({ day: dayKey(i * D), source: 'dashboard', events: 48 + (i % 4) * 11 + (days - i), unique_users: 19 + (i % 3) * 4 });
            }
            return { body: out };
        }
        case 'get_guild_vote_counts':
            return { body: live.map(g => ({ guild_id: g.id, vote_count: g.weighted_votes })) };
        case 'get_poll_vote_counts': {
            const ids = Array.isArray(args.p_poll_ids) ? (args.p_poll_ids as string[]) : polls.map(p => p.message_id);
            const o: Record<string, Record<number, number>> = {};
            polls.filter(p => ids.includes(p.message_id)).forEach(p => { o[p.message_id] = p.vote_counts; });
            return { body: o };
        }
        case 'get_guild_browser': {
            const search = typeof args.p_search === 'string' ? args.p_search.toLowerCase() : '';
            const sort = String(args.p_sort || 'members_desc');
            const offset = Number(args.p_offset) || 0;
            const limit = Number(args.p_limit) || 24;
            const engagement = (g: AdminGuildRow) => (g.poll_count ? g.weighted_votes / g.poll_count : 0);
            const rows = live
                .filter(g => !search || g.name.toLowerCase().includes(search))
                .filter(g => !args.p_curated || g.poll_count > 0)
                .sort((a, b) => {
                    switch (sort) {
                        case 'members_asc': return (a.member_count ?? Infinity) - (b.member_count ?? Infinity);
                        case 'recent': return b.joined_at.localeCompare(a.joined_at);
                        case 'polls_desc': return b.poll_count - a.poll_count;
                        case 'votes_desc': return b.weighted_votes - a.weighted_votes;
                        case 'engagement_desc': return engagement(b) - engagement(a);
                        case 'activity_desc': return (b.last_poll_at ?? '').localeCompare(a.last_poll_at ?? '');
                        default: return (b.member_count ?? -1) - (a.member_count ?? -1);
                    }
                });
            return {
                body: rows.slice(offset, offset + limit).map(g => ({
                    id: g.id, name: g.name, icon_url: g.icon_url, member_count: g.member_count, joined_at: g.joined_at, locale: g.locale,
                    poll_count: g.poll_count, active_poll_count: g.active_poll_count, vote_count: g.weighted_votes, weighted_votes: g.weighted_votes,
                    last_poll_at: g.last_poll_at, total_count: rows.length,
                })),
            };
        }
        case 'get_botlist_vote_history':
            return { body: botlistDaily(Number(args.p_days) || 30) };
        default:
            return { body: [] };
    }
}

// ---------------------------------------------------------------- router

const MOCK_LOGOUT_KEY = 'pollbot_mock_logged_out';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function handle(method: string, url: URL, rawBody?: string): Response | null {
    const p = url.pathname;

    if (p === '/api/auth/me') {
        if (sessionStorage.getItem(MOCK_LOGOUT_KEY) === '1') return json({ error: 'Unauthorized' }, 401);
        return json({ id: '100000000000000001', username: 'mira.wav', discriminator: '0', avatar_url: null, is_admin: true });
    }
    if (p === '/api/auth/csrf') return json({ csrfToken: 'mock' });
    if (p === '/api/auth/logout') {
        sessionStorage.setItem(MOCK_LOGOUT_KEY, '1');
        return json({ ok: true });
    }

    if (p === '/api/user/guilds' || p === '/api/user/guilds/refresh') {
        const withBot = guilds.map(g => ({
            id: g.id, name: g.name, icon_url: g.icon_url, member_count: g.member_count,
            poll_count: polls.filter(x => x.guild_id === g.id).length, has_bot: true,
        })).sort((a, b) => b.poll_count - a.poll_count || a.name.localeCompare(b.name));
        return json({ withBot, withoutBot, lastRefreshed: iso(14 * 60_000), cacheMaxAge: 1_800_000 });
    }

    let m = p.match(/^\/api\/user\/guilds\/(\d+)\/channels$/);
    if (m) return json({ channels: channelsByGuild[m[1]] || [], cached_at: iso(H) });
    m = p.match(/^\/api\/user\/guilds\/(\d+)\/roles$/);
    if (m) return json({ roles, cached_at: iso(H) });
    m = p.match(/^\/api\/user\/guilds\/(\d+)\/analytics$/);
    if (m) return json(guildAnalytics(m[1]));

    m = p.match(/^\/api\/user\/polls\/(\d{18})$/);
    if (m && method === 'GET' && guilds.some(g => g.id === m![1])) {
        const g = guilds.find(x => x.id === m![1])!;
        const status = url.searchParams.get('status');
        const channel = url.searchParams.get('channel');
        const search = (url.searchParams.get('search') || '').toLowerCase();
        const limit = Number(url.searchParams.get('limit') || 50);
        const offset = Number(url.searchParams.get('offset') || 0);
        const all = polls.filter(x => x.guild_id === g.id);
        const filtered = all
            .filter(x => (status === 'active' ? x.active : status === 'closed' ? !x.active : true))
            .filter(x => (channel ? x.channel_id === channel : true))
            .filter(x => (search ? x.title.toLowerCase().includes(search) : true));
        return json({
            guild: { id: g.id, name: g.name, icon_url: g.icon_url, member_count: g.member_count },
            polls: filtered.slice(offset, offset + limit),
            total: filtered.length,
            summary: {
                total: all.length,
                active: all.filter(x => x.active).length,
                closed: all.filter(x => !x.active).length,
                channels: Object.entries(all.reduce<Record<string, { count: number; open: number }>>((acc, x) => {
                    acc[x.channel_id] = acc[x.channel_id] || { count: 0, open: 0 };
                    acc[x.channel_id].count++;
                    if (x.active) acc[x.channel_id].open++;
                    return acc;
                }, {})).map(([channel_id, v]) => ({ channel_id, ...v })),
            },
            limit,
            offset,
        });
    }

    if (p === '/api/user/votes') {
        const limit = Number(url.searchParams.get('limit') || 25);
        const offset = Number(url.searchParams.get('offset') || 0);
        return json({ votes: myVotes.slice(offset, offset + limit), total: myVotes.length, limit, offset });
    }

    m = p.match(/^\/api\/user\/polls\/(\d+)\/voters$/);
    if (m) {
        const poll = polls.find(x => x.message_id === m![1]);
        const idx = Number(url.searchParams.get('option') || 0);
        const n = Math.min(12, poll?.vote_counts[idx] ?? 0);
        return json({
            option_index: idx,
            option_name: poll?.options[idx] ?? '',
            total_voters: poll?.vote_counts[idx] ?? 0,
            voters: Array.from({ length: n }, (_, i) => ({ user_id: `3000000000000001${String(i).padStart(2, '0')}`, username: `voter${i + 1}`, display_name: ['mira.wav', 'Thorgrim', 'juniper', 'Lune', 'ferrous', 'Oskar_K'][i % 6], nickname: null, avatar_url: null })),
        });
    }
    m = p.match(/^\/api\/user\/polls\/(\d+)\/export$/);
    if (m) {
        const poll = polls.find(x => x.message_id === m![1]);
        const rowsCount = Math.max(1, poll?.unique_voters ?? 1);
        return json({
            csv: 'User ID,Username,Option Index,Option Text,Weight,Voted At\n100000000000000001,mira.wav,0,Friday,2,2026-11-03T20:00:00Z\n',
            filename: 'poll-export.csv',
            total_votes: rowsCount,
            unique_voters: poll?.unique_voters ?? rowsCount,
            weighted_total: poll?.total_votes ?? rowsCount,
        });
    }

    if (p === '/api/user/premium/status' || p === '/api/user/premium/refresh') {
        return json({ isPremium: true, expiresAt: new Date(now + 9 * H).toISOString(), voteUrl: 'https://top.gg/bot/911731627498041374/vote' });
    }

    m = p.match(/^\/api\/user\/polls\/(\d+)\/status$/);
    if (m && method === 'PATCH') {
        const poll = polls.find(x => x.message_id === m![1]);
        if (poll) poll.active = !poll.active;
        return json({ ...poll, ends_at: null });
    }

    if (p.startsWith('/api/admin/db/rest/v1/')) {
        const { body, total } = adminRest(p, url, rawBody);
        // supabase-js reads `count` from Content-Range ("0-23/58"); HEAD gets no body.
        const offset = Number(url.searchParams.get('offset') || 0);
        const len = Array.isArray(body) ? body.length : 1;
        const res = method === 'HEAD'
            ? new Response(null, { status: 200, headers: { 'Content-Type': 'application/json' } })
            : json(body);
        res.headers.set('Content-Range', `${len ? `${offset}-${offset + len - 1}` : '*'}/${total ?? len}`);
        return res;
    }

    if (p === '/api/admin/vote-analytics') return json(adminVoteAnalytics(url));
    if (p === '/api/admin/voters') return json(adminVoterDirectory(url));
    m = p.match(/^\/api\/admin\/polls\/(\d+)\/supporters$/);
    if (m) return json(adminPollSupporters(m[1]));
    if (p === '/api/admin/sync-guilds' && method === 'POST') return json({ success: true, message: 'Guild sync initiated on all shards' });

    return null;
}

export function installMockApi(): void {
    if (window.location.pathname === '/api/auth/discord') {
        sessionStorage.removeItem(MOCK_LOGOUT_KEY);
        window.history.replaceState(null, '', '/dashboard');
    }
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.origin);
        if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
            const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
            await new Promise(r => setTimeout(r, 120));
            const res = handle(method, url, typeof init?.body === 'string' ? init.body : undefined);
            if (res) return res;
            console.warn('[mockApi] unhandled', method, url.pathname);
            return json({ error: 'Not mocked' }, 404);
        }
        return realFetch(input, init);
    };
    console.info('[mockApi] PollBot API is mocked (VITE_MOCK_API=1)');
}
