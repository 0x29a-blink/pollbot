import SimpleSolutionsLogo from '../assets/simplesolutions.webp';
import React from 'react';
import { Link } from 'react-router-dom';
import {
    Activity, BarChart3, Check, ChevronDown, FileSpreadsheet, Hash, ListChecks, Lock, PlusCircle, SlidersHorizontal, Zap,
} from 'lucide-react';
import { useAuth } from '../App';
import { botInviteUrl } from '../components/shell/GuildsProvider';

/** Bot invite link: the configured client id, or PollBot's public one (as in the README). */
const INVITE_URL = import.meta.env.VITE_DISCORD_CLIENT_ID
    ? botInviteUrl()
    : 'https://discord.com/api/oauth2/authorize?client_id=911731627498041374&permissions=534992383040&scope=applications.commands%20bot';

const DiscordMark: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg className={className} viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1099 30.1693C30.1099 34.1136 27.2792 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7680 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.7018 30.1693C53.7018 34.1136 50.9 37.3253 47.3178 37.3253Z" />
    </svg>
);

/* --------------------------------------------------------------------------
   Hero picture: a PollBot poll as it appears in a Discord channel, drawn in
   HTML/CSS with the same layout and colours as the bot's rendered image
   (src/lib/renderBackend.ts) and its select menu + buttons.
   -------------------------------------------------------------------------- */

const SAMPLE = {
    title: 'Which night works for the raid?',
    description: 'Pick the night you can make it. Closes Friday at noon.',
    creator: 'mira.wav',
    options: [
        { label: 'Friday', votes: 15 },
        { label: 'Saturday', votes: 9 },
        { label: 'Sunday', votes: 4 },
        { label: 'Next week', votes: 2 },
    ],
};

const DiscordPollPicture: React.FC = () => {
    const total = SAMPLE.options.reduce((s, o) => s + o.votes, 0);
    return (
        <figure className="rounded-card overflow-hidden border border-[#2c303c] bg-[#26282f] text-left" style={{ boxShadow: 'var(--shadow-float)' }}>
            {/* Channel header */}
            <div className="h-12 px-4 flex items-center gap-2 border-b border-[#1d1f26] bg-[#22242b]">
                <Hash className="w-5 h-5 text-cyan" aria-hidden="true" />
                <span className="text-[15px] font-semibold text-[#f2f3f5]">polls</span>
                <span className="hidden sm:block w-px h-4 bg-[#383c48] mx-1.5" aria-hidden="true" />
                <span className="hidden sm:block text-[13px] text-[#9ca3b4] truncate">Weekly raid scheduling</span>
                <span className="ml-auto chip chip-positive chip-dot h-5 px-2 text-[11px]">Open</span>
            </div>

            {/* Message */}
            <div className="flex gap-3 sm:gap-4 px-3 sm:px-4 pt-4 pb-5">
                <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center shrink-0 overflow-hidden" aria-hidden="true">
                    <img src={SimpleSolutionsLogo} alt="" className="w-7 h-7 object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 leading-[22px]">
                        <span className="text-[15px] font-medium text-[#f2f3f5]">Simple Poll Bot</span>
                        <span className="inline-flex items-center gap-0.5 h-[15px] px-1 rounded-[3px] bg-brand text-[10px] font-semibold text-white leading-none">
                            <Check className="w-2.5 h-2.5" strokeWidth={3} aria-hidden="true" />
                            APP
                        </span>
                        <span className="text-xs text-[#9ca3b4] ml-0.5">Today at 9:14 PM</span>
                    </div>

                    {/* Poll image card */}
                    <div className="mt-2 max-w-[460px] rounded-[10px] bg-[#1e2026] border border-[#323643] border-l-[5px] border-l-brand p-4 sm:p-5">
                        <p className="text-[17px] sm:text-[19px] leading-tight font-bold text-white">{SAMPLE.title}</p>
                        <p className="text-[13px] sm:text-sm leading-snug text-[#d4d8e2] mt-1.5">{SAMPLE.description}</p>
                        <div className="h-px bg-[#323643] my-3.5" />
                        <ul className="space-y-2">
                            {SAMPLE.options.map((o, i) => {
                                const pct = Math.round((o.votes / total) * 100);
                                const leader = i === 0;
                                return (
                                    <li
                                        key={o.label}
                                        className={`relative overflow-hidden rounded-md bg-[#282b34] border ${leader ? 'border-[#4b56c8]' : 'border-[#333744]'}`}
                                    >
                                        <div
                                            className={`absolute inset-y-0 left-0 ${leader ? 'bg-[rgba(88,101,242,0.40)]' : 'bg-[rgba(88,101,242,0.18)]'}`}
                                            style={{ width: `${pct}%` }}
                                            aria-hidden="true"
                                        />
                                        <div className="relative flex items-center justify-between gap-3 px-3 py-2">
                                            <span className="flex items-center gap-2.5 min-w-0 text-[13px] sm:text-sm font-medium text-white">
                                                <span className={`num shrink-0 rounded text-[11px] leading-4 px-1.5 font-semibold ${leader ? 'bg-brand text-white' : 'bg-[#373b47] text-[#c4c9d6]'}`}>
                                                    #{i + 1}
                                                </span>
                                                <span className="truncate">{o.label}</span>
                                            </span>
                                            <span className={`num shrink-0 text-xs font-semibold ${leader ? 'text-[#dee2ff]' : 'text-[#b5bccb]'}`}>
                                                {o.votes} votes ({pct}%)
                                            </span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="flex items-center gap-1.5 mt-4 text-[11px] sm:text-xs text-[#9ca3b4]">
                            <span className="w-2.5 h-2.5 rounded-full bg-positive shrink-0" aria-hidden="true" />
                            <span className="truncate">Created by {SAMPLE.creator} • <span className="num text-[#d4d8e2]">{total}</span> total votes</span>
                        </div>
                    </div>

                    {/* Components: select menu + buttons */}
                    <div className="mt-2 max-w-[460px] h-10 px-3 rounded-[4px] bg-[#191b20] border border-[#323643] flex items-center justify-between text-sm text-[#9ca3b4]">
                        <span className="truncate">Select an option to vote</span>
                        <ChevronDown className="w-4 h-4 shrink-0 text-cyan" aria-hidden="true" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 h-8 px-4 rounded-[4px] bg-[#da373c] text-sm font-medium text-white">
                            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                            Close Poll
                        </span>
                        <span className="inline-flex items-center gap-1.5 h-8 px-4 rounded-[4px] bg-[#383c47] text-sm font-medium text-white">
                            <BarChart3 className="w-3.5 h-3.5 text-cyan" aria-hidden="true" />
                            View Details
                        </span>
                    </div>
                </div>
            </div>
            <figcaption className="sr-only">
                A Simple Poll Bot poll in a Discord channel: the question, four options with vote bars and percentages, a select menu to vote, and Close Poll and View Details buttons.
            </figcaption>
        </figure>
    );
};

/* -------------------------------------------------------------------------- */

const steps = [
    {
        chip: 'chip-brand',
        step: 'Step 01',
        title: 'Add Simple Poll Bot to your server',
        body: 'One click from Discord. It needs permission to post and attach images in the channels you poll in.',
    },
    {
        chip: 'chip-cyan',
        step: 'Step 02',
        title: 'Ask with /poll or the dashboard',
        body: 'Up to 25 options, single or multiple choice, role limits and weights, an optional close time.',
    },
    {
        chip: 'chip-positive',
        step: 'Step 03',
        title: 'Watch the results card update',
        body: 'Votes come in through a select menu; the image in the channel redraws with the new counts.',
    },
];

const features = [
    {
        icon: ListChecks,
        tone: 'text-brand-text',
        title: 'View your polls',
        description: 'Every poll you\u2019ve created across your servers, with live vote counts.',
    },
    {
        icon: PlusCircle,
        tone: 'text-cyan',
        title: 'Create polls',
        description: 'Create polls from the dashboard with vote limits, role restrictions and weights.',
    },
    {
        icon: Activity,
        tone: 'text-positive',
        title: 'Live updates',
        description: 'Votes arrive without a refresh, so you see how your community is voting as it happens.',
    },
    {
        icon: SlidersHorizontal,
        tone: 'text-brand-text',
        title: 'Manage settings',
        description: 'Change result visibility, vote requirements and role restrictions from one place.',
    },
    {
        icon: Zap,
        tone: 'text-warning',
        title: 'Quick actions',
        description: 'Close, reopen or delete a poll in one click.',
    },
    {
        icon: FileSpreadsheet,
        tone: 'text-cyan',
        title: 'Poll history & exports',
        description: 'Your complete poll history with per-option breakdowns, analytics and CSV exports.',
    },
];

export const Landing: React.FC = () => {
    const { user } = useAuth();

    const handleDiscordLogin = () => {
        window.location.href = '/api/auth/discord';
    };

    return (
        <div className="min-h-screen bg-ground text-ink">
            {/* Header */}
            <header className="border-b border-[#2c303b] bg-[#1a1c22]">
                <nav className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between" aria-label="Main">
                    <Link to="/" className="flex items-center gap-2.5 rounded-control">
                        <img src={SimpleSolutionsLogo} alt="" className="w-7 h-7 object-contain" />
                        <span className="text-[15px] font-semibold text-ink">Simple Poll Bot</span>
                    </Link>
                    <div className="flex items-center gap-1 sm:gap-2">
                        <a href={INVITE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost hidden sm:inline-flex">
                            Add to Discord
                        </a>
                        {user ? (
                            <Link to="/dashboard" className="btn btn-tonal">
                                Open dashboard
                            </Link>
                        ) : (
                            <Link to="/login" className="btn btn-outline">
                                Sign in
                            </Link>
                        )}
                    </div>
                </nav>
            </header>

            <main>
                {/* Hero */}
                <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-16 sm:pb-24 grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-12 lg:gap-14 items-center">
                    <div>
                        <span className="chip chip-brand chip-dot mb-4">Live image polls for Discord</span>
                        <h1 className="font-[family-name:var(--font-display)] text-[36px] leading-[42px] sm:text-[52px] sm:leading-[58px] font-semibold tracking-[-0.02em] text-ink">
                            Discord polls,<br />
                            <span className="text-brand-text">run from one place.</span>
                        </h1>
                        <p className="text-base sm:text-lg leading-7 text-muted mt-5 max-w-[46ch]">
                            Simple Poll Bot posts each poll as a live results card in Discord, and this dashboard lets you create, watch and close them without typing a command.
                        </p>
                        <div className="flex flex-wrap items-center gap-3 mt-8">
                            <a href={INVITE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
                                <DiscordMark className="w-5 h-5" />
                                Add to Discord
                            </a>
                            {user ? (
                                <Link to="/dashboard" className="btn btn-tonal btn-lg">
                                    Open dashboard
                                </Link>
                            ) : (
                                <button type="button" onClick={handleDiscordLogin} className="btn btn-tonal btn-lg">
                                    Open dashboard
                                </button>
                            )}
                        </div>
                        <p className="text-[13px] text-faint mt-4">The dashboard requires the Manage Server permission.</p>
                    </div>

                    <DiscordPollPicture />
                </section>

                {/* What it does */}
                <section className="border-t border-b border-[#2c303b] bg-sheet" aria-labelledby="how-heading">
                    <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
                        <h2 id="how-heading" className="font-[family-name:var(--font-display)] text-[28px] leading-9 font-semibold text-ink">How it works</h2>
                        <p className="text-base text-muted mt-2 max-w-[56ch]">Three steps from invite to results.</p>
                        <ol className="grid md:grid-cols-3 mt-10 border-t border-line">
                            {steps.map((s, i) => (
                                <li key={s.title} className={`pt-6 pb-2 md:pr-8 ${i > 0 ? 'md:pl-8 md:border-l border-line' : ''} ${i > 0 ? 'border-t md:border-t-0 mt-6 md:mt-0' : ''}`}>
                                    <span className={`chip ${s.chip} num`}>{s.step}</span>
                                    <h3 className="text-[17px] leading-6 font-semibold text-ink mt-3">{s.title}</h3>
                                    <p className="text-sm text-muted mt-1.5">{s.body}</p>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* Features */}
                <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-10 lg:gap-16" aria-labelledby="features-heading">
                    <div>
                        <h2 id="features-heading" className="font-[family-name:var(--font-display)] text-[28px] leading-9 font-semibold text-ink lg:sticky lg:top-8">
                            Everything you need to manage your polls
                        </h2>
                    </div>
                    <dl className="grid sm:grid-cols-2 gap-x-10">
                        {features.map(f => {
                            const Icon = f.icon;
                            return (
                                <div key={f.title} className="py-5 border-t border-line">
                                    <dt className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                                        <Icon className={`w-4 h-4 shrink-0 ${f.tone}`} strokeWidth={2} aria-hidden="true" />
                                        {f.title}
                                    </dt>
                                    <dd className="text-sm text-muted mt-1.5">{f.description}</dd>
                                </div>
                            );
                        })}
                    </dl>
                </section>

                {/* CTA */}
                <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
                    <div className="rounded-card bg-[#23284a] border border-[#3d4684] px-6 sm:px-10 py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                        <div>
                            <h2 className="font-[family-name:var(--font-display)] text-2xl leading-8 font-semibold text-ink">Ready to get started?</h2>
                            <p className="text-sm text-[#c7cdf0] mt-1.5">Add Simple Poll Bot to a server, then sign in with Discord to manage its polls.</p>
                        </div>
                        <div className="flex flex-wrap gap-3 shrink-0">
                            <a href={INVITE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
                                Add to Discord
                            </a>
                            {user ? (
                                <Link to="/dashboard" className="btn btn-outline btn-lg border-[#525da6] hover:bg-white/10">
                                    Open dashboard
                                </Link>
                            ) : (
                                <button type="button" onClick={handleDiscordLogin} className="btn btn-outline btn-lg border-[#525da6] hover:bg-white/10">
                                    <DiscordMark className="w-[18px] h-[18px]" />
                                    Sign in with Discord
                                </button>
                            )}
                        </div>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="border-t border-[#2c303b] bg-[#1a1c22]">
                <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[13px] text-faint">
                    <div className="flex items-center gap-2">
                        <img src={SimpleSolutionsLogo} alt="" className="w-5 h-5 object-contain" />
                        <span>Simple Poll Bot · © {new Date().getFullYear()} Simple Solutions™</span>
                    </div>
                    <nav aria-label="Legal and project links" className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <a
                            href="https://github.com/0x29a-blink/pollbot/wiki/Terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-ink rounded-control"
                        >
                            Terms of service
                        </a>
                        <a
                            href="https://github.com/0x29a-blink/pollbot/wiki/Privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-ink rounded-control"
                        >
                            Privacy policy
                        </a>
                        <a
                            href="https://github.com/0x29a-blink/pollbot#legal-and-licensing"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-ink rounded-control"
                        >
                            GitHub &amp; licensing
                        </a>
                    </nav>
                </div>
            </footer>
        </div>
    );
};
