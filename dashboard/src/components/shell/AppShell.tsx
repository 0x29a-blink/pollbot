import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Plus, Shield, X } from 'lucide-react';
import { useAuth } from '../../App';
import { useGuilds, botInviteUrl } from './GuildsProvider';
import { GuildIcon, Avatar } from '../ui/primitives';

/* ==========================================================================
   App shell
   rail (Discord server list) | sidebar (scope header, nav, user panel) |
   content sheet (Fluent layer: one tone up, rounded top-left corner).

   Desktop arithmetic at 1440: 72 rail + 240 sidebar + 1128 sheet. The sheet's
   column is max 1180 with 32px gutters, so at 1440 the content is
   1128 - 2*32 = 1064 wide and every grid inside lands on those two edges.
   ========================================================================== */

export const PollBotMark: React.FC<{ size?: number; className?: string }> = ({ size = 24, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        {/* The PollBot pie: three quarters, and the quarter pulled out */}
        <path d="M11 4.06A8.5 8.5 0 1 0 19.94 13H11V4.06Z" fill="currentColor" />
        <path d="M13 2.05V11h8.95A9 9 0 0 0 13 2.05Z" fill="currentColor" opacity="0.55" />
    </svg>
);

/* ---------------------------------------------------------------- tooltip */

const RailTooltip: React.FC<{ pos: { top: number; left: number } | null; label: string }> = ({ pos, label }) => {
    if (!pos) return null;
    return createPortal(
        <div
            role="tooltip"
            className="fixed z-[200] -translate-y-1/2 pointer-events-none px-3 py-2 rounded-md bg-[#121317] border border-[#2c303a] text-ink text-sm font-semibold whitespace-nowrap max-w-[260px] truncate"
            style={{ top: pos.top, left: pos.left, boxShadow: 'var(--shadow-float)' }}
        >
            {label}
        </div>,
        document.body,
    );
};

/* -------------------------------------------------------------- rail item */

const RailItem: React.FC<{
    label: string;
    active?: boolean;
    to?: string;
    href?: string;
    tone?: 'home' | 'guild' | 'add' | 'admin';
    children: React.ReactNode;
    onNavigate?: () => void;
}> = ({ label, active = false, to, href, tone = 'guild', children, onNavigate }) => {
    // Tooltip position is measured when the pointer or focus arrives (the rail scrolls).
    const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
    const hover = tip !== null;
    const show = (e: React.SyntheticEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ top: r.top + r.height / 2, left: r.right + 14 });
    };
    const hide = () => setTip(null);

    const shape = active
        ? 'rounded-[16px]'
        : 'rounded-[24px] group-hover:rounded-[16px] group-focus-visible:rounded-[16px]';
    const toneClass =
        tone === 'home'
            ? active ? 'bg-brand text-white' : 'bg-[#252830] text-ink group-hover:bg-brand group-hover:text-white'
            : tone === 'add'
                ? 'bg-[#252830] text-positive group-hover:bg-[#23a559] group-hover:text-white'
                : tone === 'admin'
                    ? active ? 'bg-cyan-soft text-cyan' : 'bg-[#252830] text-muted group-hover:bg-cyan-soft group-hover:text-cyan'
                    : '';

    const inner = (
        <>
            {/* Discord's edge pill: 20px white on hover, 40px Fluent sky-cyan when selected */}
            <span
                aria-hidden="true"
                className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 rounded-r-full transition-all duration-200 ease-[var(--ease-standard)] ${active ? 'h-10 bg-cyan' : hover ? 'h-5 bg-white' : 'h-0 bg-white'}`}
            />
            <span className={`w-12 h-12 overflow-hidden flex items-center justify-center transition-all duration-200 ease-[var(--ease-standard)] ${shape} ${toneClass}`}>
                {children}
            </span>
        </>
    );

    const common = {
        'aria-label': label,
        'aria-current': active ? ('page' as const) : undefined,
        className: 'group relative flex items-center justify-center rounded-[16px]',
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
    };

    return (
        <li className="relative flex justify-center w-full">
            {href ? (
                <a {...common} href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
            ) : (
                <Link {...common} to={to || '/dashboard'} onClick={() => { hide(); onNavigate?.(); }}>{inner}</Link>
            )}
            <RailTooltip pos={tip} label={label} />
        </li>
    );
};

/* -------------------------------------------------------------- the rail */

const ServerRail: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
    const { user } = useAuth();
    const { withBot, loaded } = useGuilds();
    const { pathname } = useLocation();
    const activeGuild = pathname.match(/^\/manage\/(\d+)/)?.[1];
    const isAdminPath = /^\/(admin|polls|voters|server)\b/.test(pathname);
    const isHome = !activeGuild && !isAdminPath;

    return (
        <nav aria-label="Servers" className="w-[72px] shrink-0 bg-rail h-full overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ul className="flex flex-col items-center gap-2 py-3">
                <RailItem label="Home" to="/dashboard" active={isHome} tone="home" onNavigate={onNavigate}>
                    <PollBotMark size={26} />
                </RailItem>
                <li aria-hidden="true" className="w-8 h-0.5 rounded-full bg-[#2c303a] my-0.5" />
                {!loaded && [0, 1, 2].map(i => (
                    <li key={i} aria-hidden="true" className="w-12 h-12 rounded-[24px] bg-[#23262e]" />
                ))}
                {withBot.map(g => (
                    <RailItem key={g.id} label={g.name} to={`/manage/${g.id}`} active={activeGuild === g.id} onNavigate={onNavigate}>
                        <GuildIcon name={g.name} iconUrl={g.icon_url} size={48} radius="0" />
                    </RailItem>
                ))}
                <RailItem label="Add PollBot to a server" href={botInviteUrl()} tone="add">
                    <Plus className="w-6 h-6" strokeWidth={2} />
                </RailItem>
                {user?.is_admin && (
                    <>
                        <li aria-hidden="true" className="w-8 h-0.5 rounded-full bg-[#2c303a] my-0.5" />
                        <RailItem label="Bot admin" to="/admin" active={isAdminPath} tone="admin" onNavigate={onNavigate}>
                            <Shield className="w-5 h-5" strokeWidth={1.75} />
                        </RailItem>
                    </>
                )}
            </ul>
        </nav>
    );
};

/* ---------------------------------------------------------- sidebar parts */

/** 56px scope header at the top of the sidebar (Discord's server header). */
export const SidebarHeader: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode; leading?: React.ReactNode; to?: string }> = ({ title, subtitle, leading, to }) => {
    const content = (
        <>
            {leading}
            <div className="min-w-0">
                <div className="text-[15px] leading-5 font-semibold text-ink truncate">{title}</div>
                {subtitle && <div className="text-xs text-faint truncate num">{subtitle}</div>}
            </div>
        </>
    );
    if (to) {
        return (
            <Link to={to} className="h-14 shrink-0 px-4 flex items-center gap-3 border-b border-[#18191e] hover:bg-[var(--state-hover)] transition-colors">
                {content}
            </Link>
        );
    }
    return (
        <div className="h-14 shrink-0 px-4 flex items-center gap-3 border-b border-[#18191e]">
            {content}
        </div>
    );
};

/** Sentence-case group label. */
export const NavGroup: React.FC<{ label?: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="pt-4 first:pt-2">
        {label && <div className="px-2 pb-1 text-xs font-semibold text-faint">{label}</div>}
        <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
);

/**
 * Fluent NavigationView item: a tonal selected fill plus the short sky-cyan
 * pill on its left edge.
 */
export const NavItem: React.FC<{
    to: string;
    icon?: React.ReactNode;
    label: string;
    count?: number | string | null;
    trailing?: React.ReactNode;
    end?: boolean;
    active?: boolean;
    onNavigate?: () => void;
}> = ({ to, icon, label, count, trailing, end = true, active, onNavigate }) => (
    <li>
        <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) => {
                const on = active ?? isActive;
                return `relative flex items-center gap-2.5 h-9 px-2 rounded-[4px] text-sm transition-colors duration-100 ${on ? 'bg-[var(--state-selected)] text-ink' : 'text-faint hover:bg-[var(--state-hover)] hover:text-muted'}`;
            }}
            aria-current={active ? 'page' : undefined}
        >
            {({ isActive }) => {
                const on = active ?? isActive;
                return (
                    <>
                        {on && <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-cyan" />}
                        {icon && <span className={`w-5 h-5 flex items-center justify-center shrink-0 ${on ? 'text-brand-text' : ''}`}>{icon}</span>}
                        <span className={`flex-1 truncate ${on ? 'font-medium' : ''}`}>{label}</span>
                        {trailing}
                        {count !== undefined && count !== null && <span className={`num text-xs ${on ? 'text-brand-text' : 'text-faint'}`}>{count}</span>}
                    </>
                );
            }}
        </NavLink>
    </li>
);

/** Discord user area at the foot of the sidebar. */
const UserPanel: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    if (!user) return null;
    return (
        <div className="h-[56px] shrink-0 px-2 flex items-center gap-2 bg-[#181a1f] border-t border-[#262932]">
            <div className="flex items-center gap-2.5 min-w-0 flex-1 px-1.5 py-1 rounded-[4px]">
                <Avatar name={user.username} url={user.avatar_url} size={32} id={user.id} />
                <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{user.username}</div>
                    <div className="text-xs text-faint truncate">{user.is_admin ? 'Bot admin' : 'Server manager'}</div>
                </div>
            </div>
            <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label="Sign out"
                title="Sign out"
                onClick={async () => {
                    await logout();
                    navigate('/');
                }}
            >
                <LogOut className="w-4 h-4" />
            </button>
        </div>
    );
};

/* ------------------------------------------------------------- the shell */

export const AppShell: React.FC<{
    /** Sidebar body: a SidebarHeader and nav groups. */
    sidebar: React.ReactNode;
    /** Short name of the screen for the phone top bar. */
    mobileTitle: string;
    children: React.ReactNode;
    /** Full-bleed content (no centred column). */
    wide?: boolean;
}> = ({ sidebar, mobileTitle, children, wide = false }) => {
    const { pathname, search } = useLocation();
    const here = pathname + search;
    // The phone drawer remembers the location it was opened on, so any
    // navigation closes it without an effect.
    const [drawerAt, setDrawerAt] = useState<string | null>(null);
    const drawerOpen = drawerAt === here;
    const setDrawerOpen = (open: boolean) => setDrawerAt(open ? here : null);
    const mainRef = useRef<HTMLElement>(null);

    // Reset the content scroll on every navigation
    useEffect(() => {
        mainRef.current?.scrollTo({ top: 0 });
    }, [here]);

    useEffect(() => {
        if (!drawerOpen) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerAt(null);
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [drawerOpen]);

    const close = () => setDrawerOpen(false);

    const nav = (
        <>
            <ServerRail onNavigate={close} />
            <aside className="w-60 shrink-0 bg-ground flex flex-col h-full min-h-0" aria-label="Sections">
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{sidebar}</div>
                <UserPanel />
            </aside>
        </>
    );

    return (
        <div className="h-screen flex bg-ground text-ink overflow-hidden">
            {/* Desktop navigation */}
            <div className="hidden lg:flex h-full">{nav}</div>

            {/* Phone / tablet drawer */}
            {drawerOpen && (
                <div className="lg:hidden fixed inset-0 z-[90] flex">
                    <div className="flex h-full shadow-[var(--shadow-float)]" role="dialog" aria-modal="true" aria-label="Navigation">{nav}</div>
                    <button type="button" aria-label="Close navigation" className="flex-1 bg-black/60" onClick={close} />
                </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col">
                {/* Phone top bar */}
                <div className="lg:hidden h-12 shrink-0 flex items-center gap-2 px-2 bg-ground border-b border-[#18191e]">
                    <button type="button" className="btn btn-ghost btn-icon" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
                        {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                    <span className="text-[15px] font-semibold truncate">{mobileTitle}</span>
                </div>

                {/* Fluent layer: inset 8px from the top, rounded top-left */}
                <div className="flex-1 min-h-0 lg:pt-2 flex">
                    <main
                        ref={mainRef}
                        className="flex-1 min-w-0 overflow-y-auto bg-sheet lg:rounded-tl-lg lg:border-l lg:border-t border-[#343844]"
                    >
                        <div className={wide ? 'px-5 sm:px-6 lg:px-8 py-6 lg:py-7' : 'max-w-[1180px] mx-auto px-5 sm:px-6 lg:px-8 py-6 lg:py-7'}>
                            {children}
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
};
