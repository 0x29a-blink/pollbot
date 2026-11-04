import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { adminSupabase } from '../lib/supabase';
import { AppShell } from '../components/shell/AppShell';
import { AdminSidebar } from '../components/shell/Sidebars';
import { Dash, EmptyBlock, GuildIcon, InlineError, PageHeader, SearchField } from '../components/ui/primitives';
import { Segmented } from '../components/admin/adminUi';
import { fmtCount, fmtDate, fmtRelative, plural, toNum } from '../lib/format';

type SortKey = 'members_desc' | 'members_asc' | 'recent' | 'polls_desc' | 'votes_desc' | 'engagement_desc' | 'activity_desc';

const SORTS: { value: SortKey; label: string; needsRpc: boolean }[] = [
    { value: 'members_desc', label: 'Most members', needsRpc: false },
    { value: 'members_asc', label: 'Fewest members', needsRpc: false },
    { value: 'recent', label: 'Recently joined', needsRpc: false },
    { value: 'polls_desc', label: 'Most polls', needsRpc: true },
    { value: 'votes_desc', label: 'Most votes', needsRpc: true },
    { value: 'engagement_desc', label: 'Highest engagement', needsRpc: true },
    { value: 'activity_desc', label: 'Latest activity', needsRpc: true },
];

const PAGE_SIZE = 24;

interface BrowserRow {
    id: string;
    name: string;
    icon_url: string | null;
    member_count: number | null;
    joined_at: string | null;
    locale: string | null;
    /** null = unknown (fallback query without poll stats) */
    poll_count: number | null;
    active_poll_count: number | null;
    vote_count: number | null;
    last_poll_at: string | null;
}

/**
 * Every server PollBot is in, as a paged table. Sorting, search, the
 * "with polls" filter and the poll stats are computed in Postgres by the
 * get_guild_browser RPC; without it (migration 31 not applied) the screen
 * falls back to the plain guilds table with member/joined sorts only.
 */
export const AdminServers: React.FC = () => {
    const navigate = useNavigate();
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [curated, setCurated] = useState(false);
    const [sort, setSort] = useState<SortKey>('members_desc');
    const [page, setPage] = useState(0);
    const [rows, setRows] = useState<BrowserRow[] | null>(null);
    const [total, setTotal] = useState<number | null>(null);
    const [fallback, setFallback] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const requestRef = useRef(0);

    // Debounce the search box (250ms) and go back to the first page.
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(0);
        }, 250);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        const reqId = ++requestRef.current;
        (async () => {
            setLoading(true);
            const offset = page * PAGE_SIZE;
            try {
                const rpc = await adminSupabase.rpc('get_guild_browser', {
                    p_search: search || null,
                    p_sort: sort,
                    p_curated: curated,
                    p_offset: offset,
                    p_limit: PAGE_SIZE,
                });
                if (reqId !== requestRef.current) return;
                if (!rpc.error && Array.isArray(rpc.data)) {
                    const data = rpc.data as Record<string, unknown>[];
                    setFallback(false);
                    setRows(data.map(r => ({
                        id: String(r.id),
                        name: String(r.name ?? 'Unknown server'),
                        icon_url: (r.icon_url as string | null) ?? null,
                        member_count: toNum(r.member_count),
                        joined_at: (r.joined_at as string | null) ?? null,
                        locale: (r.locale as string | null) ?? null,
                        poll_count: toNum(r.poll_count) ?? 0,
                        active_poll_count: toNum(r.active_poll_count) ?? 0,
                        vote_count: toNum(r.vote_count ?? r.weighted_votes) ?? 0,
                        last_poll_at: (r.last_poll_at as string | null) ?? null,
                    })));
                    // total_count rides on every row; an empty page past the end keeps the old total.
                    if (data.length) setTotal(toNum(data[0].total_count));
                    else if (offset === 0) setTotal(0);
                    setError(null);
                    return;
                }

                // Fallback: plain guilds query. Only member/joined sorts are
                // real here; poll columns show a dash rather than a wrong number.
                setFallback(true);
                const fbSort: SortKey = SORTS.find(s => s.value === sort)?.needsRpc ? 'members_desc' : sort;
                let query = adminSupabase
                    .from('guilds')
                    .select('id, name, icon_url, member_count, joined_at, locale', { count: 'exact' })
                    .is('left_at', null);
                if (search) query = query.ilike('name', `%${search.replace(/[\\%_]/g, m => `\\${m}`)}%`);
                if (fbSort === 'members_desc') query = query.order('member_count', { ascending: false, nullsFirst: false });
                if (fbSort === 'members_asc') query = query.order('member_count', { ascending: true, nullsFirst: false });
                if (fbSort === 'recent') query = query.order('joined_at', { ascending: false });
                const { data, count, error: qError } = await query.range(offset, offset + PAGE_SIZE - 1);
                if (reqId !== requestRef.current) return;
                if (qError || !data) throw qError ?? new Error('No data');
                setRows((data as { id: string; name: string; icon_url: string | null; member_count: number | null; joined_at: string | null; locale: string | null }[]).map(g => ({
                    ...g,
                    member_count: toNum(g.member_count),
                    poll_count: null,
                    active_poll_count: null,
                    vote_count: null,
                    last_poll_at: null,
                })));
                setTotal(count ?? null);
                setError(null);
            } catch (err) {
                console.error('Error fetching servers:', err);
                if (reqId === requestRef.current) setError("Couldn't load servers.");
            } finally {
                if (reqId === requestRef.current) setLoading(false);
            }
        })();
    }, [search, sort, curated, page, retry]);

    // In fallback the RPC-only sorts and the curated filter can't be honoured;
    // the controls show what the fallback query actually did.
    const shownSort: SortKey = fallback && SORTS.find(s => s.value === sort)?.needsRpc ? 'members_desc' : sort;
    const shownCurated = fallback ? false : curated;

    const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
    const to = Math.min((page + 1) * PAGE_SIZE, total ?? (page + 1) * PAGE_SIZE);
    const lastPage = total != null ? Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) : page;
    const firstLoad = rows === null && !error;

    const subtitle = total == null
        ? 'Every server PollBot is in'
        : search
            ? `${fmtCount(total)} ${total === 1 ? 'server matches' : 'servers match'} “${search}”`
            : shownCurated ? `${fmtCount(total)} ${total === 1 ? 'server has' : 'servers have'} polls` : `${fmtCount(total)} servers`;

    const pager = (
        <div className="flex items-center justify-between gap-3 px-5 h-14 border-t border-rule">
            <span className="num text-[13px] text-faint">
                {total == null ? '\u00a0' : `${fmtCount(from)}–${fmtCount(to)} of ${fmtCount(total)}`}
            </span>
            <div className="flex items-center gap-2">
                <button type="button" className="btn btn-outline btn-sm" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous
                </button>
                <button type="button" className="btn btn-outline btn-sm" disabled={page >= lastPage || loading} onClick={() => setPage(p => p + 1)}>
                    Next <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
            </div>
        </div>
    );

    return (
        <AppShell sidebar={<AdminSidebar serverCount={!search && !shownCurated ? total : null} />} mobileTitle="Servers">
            <PageHeader title="Servers" subtitle={subtitle} />

            {/* Toolbar: scope on the left, sort on the right */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search servers" label="Search servers by name" className="w-full sm:w-72" />
                <Segmented
                    label="Filter"
                    value={shownCurated ? 'polls' : 'all'}
                    onChange={v => { setCurated(v === 'polls'); setPage(0); }}
                    options={[
                        { value: 'all', label: 'All' },
                        { value: 'polls', label: 'With polls', disabled: fallback, title: fallback ? 'Needs migration 31' : undefined },
                    ]}
                />
                <label className="flex items-center gap-2 sm:ml-auto text-[13px] text-faint">
                    Sort
                    <select
                        className="field w-48"
                        value={shownSort}
                        onChange={e => { setSort(e.target.value as SortKey); setPage(0); }}
                    >
                        {SORTS.map(s => (
                            <option key={s.value} value={s.value} disabled={fallback && s.needsRpc}>{s.label}</option>
                        ))}
                    </select>
                </label>
            </div>
            {fallback && (
                <p className="-mt-2 mb-3 flex items-center gap-1.5 text-xs text-faint">
                    <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    Poll stats, the “With polls” filter and activity sorts need migration 31.
                </p>
            )}

            <div className="panel">
                {error ? (
                    <InlineError message={error} onRetry={() => setRetry(n => n + 1)} />
                ) : !firstLoad && rows && rows.length === 0 ? (
                    <EmptyBlock title={search ? 'No servers match that name' : shownCurated ? 'No servers have polls yet' : 'No servers yet'}>
                        {search ? 'Try a shorter part of the name.' : 'Servers appear here when PollBot joins them.'}
                    </EmptyBlock>
                ) : (
                    <>
                        {/* Desktop / tablet: the table */}
                        <table className={`data-table hidden sm:table ${loading && !firstLoad ? 'opacity-60' : ''}`}>
                            <thead>
                                <tr>
                                    <th className="sticky top-0 bg-surface rounded-tl-lg pl-5 w-[34%]">Server</th>
                                    <th className="sticky top-0 bg-surface num">Members</th>
                                    <th className="sticky top-0 bg-surface num">Polls</th>
                                    <th className="sticky top-0 bg-surface num">Open</th>
                                    <th className="sticky top-0 bg-surface num">Votes</th>
                                    <th className="sticky top-0 bg-surface num hidden lg:table-cell">Last poll</th>
                                    <th className="sticky top-0 bg-surface num rounded-tr-lg pr-5">Joined</th>
                                </tr>
                            </thead>
                            <tbody>
                                {firstLoad
                                    ? Array.from({ length: 8 }, (_, i) => (
                                        <tr key={i}>
                                            <td className="pl-5"><div className="flex items-center gap-3"><div className="skeleton w-7 h-7 rounded-lg" /><div className="skeleton h-3.5 w-40" /></div></td>
                                            {Array.from({ length: 5 }, (__, j) => <td key={j} className={`num ${j === 4 ? 'hidden lg:table-cell' : ''}`}><div className="skeleton h-3.5 w-12 ml-auto" /></td>)}
                                            <td className="num pr-5"><div className="skeleton h-3.5 w-20 ml-auto" /></td>
                                        </tr>
                                    ))
                                    : rows!.map(g => (
                                        <tr key={g.id} className="row-interactive" onClick={() => navigate(`/server/${g.id}`)}>
                                            <td className="pl-5 max-w-0">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <GuildIcon name={g.name} iconUrl={g.icon_url} size={28} radius="8px" />
                                                    <div className="min-w-0">
                                                        <Link to={`/server/${g.id}`} onClick={e => e.stopPropagation()} className="block text-ink truncate hover:underline">{g.name}</Link>
                                                        {g.locale && <div className="text-xs text-faint truncate">{g.locale}</div>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="num text-ink">{g.member_count == null ? <Dash title="Not synced" /> : fmtCount(g.member_count)}</td>
                                            <td className="num">{g.poll_count == null ? <Dash /> : fmtCount(g.poll_count)}</td>
                                            <td className={`num ${g.active_poll_count ? 'text-positive' : ''}`}>{g.active_poll_count == null ? <Dash /> : fmtCount(g.active_poll_count)}</td>
                                            <td className="num">{g.vote_count == null ? <Dash /> : fmtCount(g.vote_count)}</td>
                                            <td className="num hidden lg:table-cell whitespace-nowrap">{g.last_poll_at ? fmtRelative(g.last_poll_at) : <Dash title="No polls" />}</td>
                                            <td className="num pr-5 whitespace-nowrap">{g.joined_at ? fmtDate(g.joined_at) : <Dash />}</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>

                        {/* Phone: two-line rows, nothing dropped */}
                        <ul className={`sm:hidden ${loading && !firstLoad ? 'opacity-60' : ''}`}>
                            {firstLoad
                                ? Array.from({ length: 6 }, (_, i) => (
                                    <li key={i} className="h-[68px] px-4 flex items-center gap-3 border-t border-rule first:border-t-0">
                                        <div className="skeleton w-9 h-9 rounded-lg" />
                                        <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-2/3" /><div className="skeleton h-3 w-1/2" /></div>
                                    </li>
                                ))
                                : rows!.map(g => (
                                    <li key={g.id} className="border-t border-rule first:border-t-0">
                                        <Link to={`/server/${g.id}`} className="row-interactive min-h-[68px] px-4 py-3 flex items-center gap-3">
                                            <GuildIcon name={g.name} iconUrl={g.icon_url} size={36} radius="10px" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-sm text-ink truncate flex-1">{g.name}</span>
                                                    <span className="num text-sm text-ink shrink-0">{g.member_count == null ? <Dash /> : fmtCount(g.member_count)}</span>
                                                </div>
                                                <div className="num text-[13px] text-faint truncate">
                                                    {g.poll_count == null
                                                        ? `Joined ${fmtDate(g.joined_at)}`
                                                        : `${plural(g.poll_count, 'poll')} · ${fmtCount(g.active_poll_count)} open · ${plural(g.vote_count ?? 0, 'vote')} · ${g.last_poll_at ? `last poll ${fmtRelative(g.last_poll_at)}` : `joined ${fmtDate(g.joined_at)}`}`}
                                                </div>
                                            </div>
                                        </Link>
                                    </li>
                                ))}
                        </ul>
                        {pager}
                    </>
                )}
            </div>
        </AppShell>
    );
};
