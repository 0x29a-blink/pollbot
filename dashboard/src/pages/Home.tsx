import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ExternalLink, Plus } from 'lucide-react';
import { AppShell } from '../components/shell/AppShell';
import { HomeSidebar } from '../components/shell/Sidebars';
import { useGuilds, botInviteUrl } from '../components/shell/GuildsProvider';
import {
    Dash, EmptyBlock, Freshness, GuildIcon, InlineError, Kpi, KpiStrip, PageHeader, Panel, SearchField, ShareBar,
} from '../components/ui/primitives';
import { fmtCount, fmtRelative, plural } from '../lib/format';
import type { MyVote } from '../types';

/**
 * Home for a signed-in server manager.
 * Question: "Which of my servers do I open, and is anything happening there?"
 * The server list is the biggest block; recent votes and servers without the
 * bot sit in the rail beside it.
 */
export const Home: React.FC = () => {
    const navigate = useNavigate();
    const {
        withBot, withoutBot, loading, loaded, error, lastRefreshed, cooldown, refreshing, reload, refreshFromDiscord,
    } = useGuilds();
    const [query, setQuery] = useState('');

    // Recent votes for the rail (own votes only)
    const [votes, setVotes] = useState<MyVote[] | null>(null);
    const [votesTotal, setVotesTotal] = useState<number | null>(null);
    const [votesError, setVotesError] = useState(false);
    const loadVotes = async () => {
        setVotesError(false);
        try {
            const res = await fetch('/api/user/votes?limit=4&offset=0', { credentials: 'include' });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setVotes(data.votes || []);
            setVotesTotal(typeof data.total === 'number' ? data.total : null);
        } catch {
            setVotesError(true);
        }
    };
    useEffect(() => {
        void (async () => { await loadVotes(); })();
    }, []);

    const totals = useMemo(() => {
        const polls = withBot.reduce((s, g) => s + (g.poll_count || 0), 0);
        const known = withBot.filter(g => g.member_count != null);
        const members = known.reduce((s, g) => s + (g.member_count || 0), 0);
        const maxPolls = withBot.reduce((m, g) => Math.max(m, g.poll_count || 0), 0);
        return { polls, members, unsynced: withBot.length - known.length, maxPolls };
    }, [withBot]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? withBot.filter(g => g.name.toLowerCase().includes(q)) : withBot;
    }, [withBot, query]);

    const cooldownLabel = cooldown > 0 ? `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, '0')}` : null;
    const firstLoad = !loaded && loading;
    const noServersAtAll = loaded && !error && withBot.length === 0 && withoutBot.length === 0;

    return (
        <AppShell sidebar={<HomeSidebar />} mobileTitle="Servers">
            <PageHeader
                title="Servers"
                subtitle={
                    firstLoad ? 'Loading your servers from Discord…'
                        : error ? 'Your server list could not be loaded.'
                            : `${plural(withBot.length, 'server')} with PollBot · ${plural(totals.polls, 'poll')} created`
                }
                actions={
                    <>
                        <Freshness
                            updatedAt={lastRefreshed}
                            label={cooldownLabel ? `Refresh again in ${cooldownLabel}` : lastRefreshed ? `Synced from Discord ${fmtRelative(lastRefreshed.toISOString())}` : undefined}
                            onRefresh={refreshFromDiscord}
                            refreshing={refreshing}
                            disabled={cooldown > 0}
                            title="Refresh your servers, channels and roles from Discord"
                        />
                        <a className="btn btn-primary" href={botInviteUrl()} target="_blank" rel="noopener noreferrer">
                            <Plus className="w-4 h-4" />
                            Add to a server
                        </a>
                    </>
                }
            />

            {noServersAtAll ? (
                <Panel>
                    <EmptyBlock
                        title="You don't manage any servers yet"
                        action={<a className="btn btn-primary" href={botInviteUrl()} target="_blank" rel="noopener noreferrer"><Plus className="w-4 h-4" />Add PollBot to a server</a>}
                    >
                        Servers appear here when you have the Manage Server permission in them. Add PollBot to one you own to start running polls.
                    </EmptyBlock>
                </Panel>
            ) : (
                <>
                    <KpiStrip className="mb-4">
                        <Kpi tone="brand" label="Servers with PollBot" value={fmtCount(withBot.length)} caption={withoutBot.length ? `${withoutBot.length} more you could add it to` : 'Every server you manage'} loading={firstLoad} />
                        <Kpi tone="cyan" label="Polls created" value={fmtCount(totals.polls)} caption="All time, across your servers" loading={firstLoad} />
                        <Kpi
                            tone="positive"
                            label="Members reached"
                            value={withBot.length && totals.unsynced === withBot.length ? <Dash /> : fmtCount(totals.members)}
                            caption={totals.unsynced ? `${totals.unsynced} not synced yet` : 'Sum of server members'}
                            loading={firstLoad}
                        />
                        <Kpi
                            tone="warning"
                            label="Polls you voted in"
                            value={votesError ? <Dash /> : fmtCount(votesTotal)}
                            caption={<Link to="/my-votes" className="text-brand-text hover:underline">See my votes</Link>}
                            loading={votes === null && !votesError}
                        />
                    </KpiStrip>

                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
                        {/* Servers - the screen's answer */}
                        <Panel
                            title="Your servers"
                            meta={loaded && !error ? `${rows.length} of ${withBot.length} · most polls first` : undefined}
                            actions={withBot.length > 6 ? <SearchField value={query} onChange={setQuery} placeholder="Find a server" className="w-56" /> : undefined}
                        >
                            {error ? (
                                <InlineError message={error} onRetry={reload} />
                            ) : firstLoad ? (
                                <ul aria-hidden="true">
                                    {[0, 1, 2, 3, 4].map(i => (
                                        <li key={i} className="h-16 px-5 flex items-center gap-3 border-t border-rule">
                                            <div className="skeleton w-10 h-10 rounded-xl" />
                                            <div className="skeleton h-4 w-48" />
                                        </li>
                                    ))}
                                </ul>
                            ) : withBot.length === 0 ? (
                                <EmptyBlock title="PollBot isn't in any of your servers yet">
                                    Add it to one of the servers listed on the right, then come back here to create and manage polls.
                                </EmptyBlock>
                            ) : rows.length === 0 ? (
                                <EmptyBlock title={`No server matches “${query}”`} />
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th className="pl-5">Server</th>
                                            <th className="num w-28">Members</th>
                                            <th className="w-48 hidden md:table-cell">Polls</th>
                                            <th className="w-12"><span className="sr-only">Open</span></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(g => (
                                            <tr
                                                key={g.id}
                                                className="row-interactive"
                                                onClick={() => navigate(`/manage/${g.id}`)}
                                            >
                                                <td className="pl-5 h-16">
                                                    <Link to={`/manage/${g.id}`} className="flex items-center gap-3 min-w-0 rounded" onClick={e => e.stopPropagation()}>
                                                        <GuildIcon name={g.name} iconUrl={g.icon_url} size={40} radius="14px" />
                                                        <span className="min-w-0">
                                                            <span className="block text-ink font-medium truncate">{g.name}</span>
                                                            <span className="block text-xs text-faint md:hidden num">{plural(g.poll_count || 0, 'poll')}</span>
                                                        </span>
                                                    </Link>
                                                </td>
                                                <td className="num">{g.member_count != null ? fmtCount(g.member_count) : <Dash title="Member count not synced yet" />}</td>
                                                <td className="hidden md:table-cell">
                                                    <div className="flex items-center gap-3">
                                                        <span className="num text-ink w-8 text-right shrink-0">{fmtCount(g.poll_count || 0)}</span>
                                                        <ShareBar value={g.poll_count || 0} max={totals.maxPolls} />
                                                    </div>
                                                </td>
                                                <td className="pr-3 text-right">
                                                    <ChevronRight className="w-4 h-4 text-faint inline" aria-hidden="true" />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </Panel>

                        <div className="flex flex-col gap-4">
                            {/* Recent votes */}
                            <Panel
                                title="Your recent votes"
                                actions={<Link to="/my-votes" className="btn btn-ghost btn-sm">View all</Link>}
                            >
                                {votesError ? (
                                    <InlineError message="Couldn't load your votes." onRetry={loadVotes} />
                                ) : votes === null ? (
                                    <ul aria-hidden="true">
                                        {[0, 1, 2].map(i => (
                                            <li key={i} className="px-5 py-3 border-t border-rule">
                                                <div className="skeleton h-4 w-44" />
                                                <div className="skeleton h-3 w-28 mt-2" />
                                            </li>
                                        ))}
                                    </ul>
                                ) : votes.length === 0 ? (
                                    <p className="px-5 pb-5 text-sm text-faint">You haven't voted on a PollBot poll yet.</p>
                                ) : (
                                    <ul>
                                        {votes.slice(0, 4).map(v => (
                                            <li key={v.poll_id} className="border-t border-rule">
                                                <a
                                                    href={`https://discord.com/channels/${v.guild_id}/${v.channel_id}/${v.poll_id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="row-interactive flex gap-3 px-5 py-3"
                                                >
                                                    <GuildIcon name={v.guild_name} iconUrl={v.guild_icon_url} size={28} radius="9px" className="mt-0.5" />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-sm text-ink truncate">{v.title}</span>
                                                        <span className="block text-xs text-faint truncate">
                                                            {v.chosen_options.join(', ')} · {fmtRelative(v.voted_at)}
                                                        </span>
                                                    </span>
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Panel>

                            {/* Servers without the bot */}
                            {withoutBot.length > 0 && (
                                <Panel title="Add PollBot" meta={plural(withoutBot.length, 'server')}>
                                    <ul>
                                        {withoutBot.slice(0, 5).map(g => (
                                            <li key={g.id} className="flex items-center gap-3 px-5 h-12 border-t border-rule">
                                                <GuildIcon name={g.name} iconUrl={g.icon_url} size={28} radius="9px" />
                                                <span className="flex-1 min-w-0 text-sm text-muted truncate">{g.name}</span>
                                                <a
                                                    className="btn btn-outline btn-sm"
                                                    href={botInviteUrl(g.id)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`Add PollBot to ${g.name}`}
                                                >
                                                    Add
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                    {withoutBot.length > 5 && (
                                        <p className="px-5 py-3 border-t border-rule text-xs text-faint">
                                            and {plural(withoutBot.length - 5, 'more server')} you manage
                                        </p>
                                    )}
                                </Panel>
                            )}
                        </div>
                    </div>
                </>
            )}
        </AppShell>
    );
};
