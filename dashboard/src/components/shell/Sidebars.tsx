import React from 'react';
import { Activity, BarChart3, Compass, Hash, LayoutGrid, ListChecks, Server, Users, Vote } from 'lucide-react';
import { useGuilds } from './GuildsProvider';
import { NavGroup, NavItem, PollBotMark, SidebarHeader } from './AppShell';
import { useAuth } from '../../App';
import { GuildIcon } from '../ui/primitives';
import { fmtCount, plural } from '../../lib/format';

const ICON = 'w-[18px] h-[18px]';
const STROKE = 1.75;

/** Sidebar for the signed-in user's home screens. */
export const HomeSidebar: React.FC = () => {
    const { withBot, loaded } = useGuilds();
    const { user } = useAuth();
    const polls = withBot.reduce((sum, g) => sum + (g.poll_count || 0), 0);
    return (
        <>
            <SidebarHeader
                to="/"
                leading={<span className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center shrink-0"><PollBotMark size={20} /></span>}
                title="PollBot"
                subtitle={loaded ? `${plural(withBot.length, 'server')} · ${plural(polls, 'poll')}` : 'Loading servers…'}
            />
            <nav className="px-2 pb-4" aria-label="Home">
                <NavGroup>
                    <NavItem to="/dashboard" icon={<LayoutGrid className={ICON} strokeWidth={STROKE} />} label="Servers" count={loaded ? withBot.length : null} />
                    <NavItem to="/my-votes" icon={<Vote className={ICON} strokeWidth={STROKE} />} label="My votes" />
                </NavGroup>
                {user?.is_admin && (
                    <NavGroup label="Bot admin">
                        <NavItem to="/admin" icon={<Activity className={ICON} strokeWidth={STROKE} />} label="Overview" />
                        <NavItem to="/admin/servers" icon={<Server className={ICON} strokeWidth={STROKE} />} label="All servers" />
                    </NavGroup>
                )}
                <NavGroup label="Site">
                    <NavItem to="/" icon={<Compass className={ICON} strokeWidth={STROKE} />} label="Landing page" />
                </NavGroup>
            </nav>
        </>
    );
};

/** Sidebar for the bot-owner screens. */
export const AdminSidebar: React.FC<{ serverCount?: number | null }> = ({ serverCount }) => (
    <>
        <SidebarHeader
            leading={<span className="w-8 h-8 rounded-lg bg-cyan-soft text-cyan flex items-center justify-center shrink-0"><PollBotMark size={20} /></span>}
            title="Bot admin"
            subtitle={serverCount != null ? `${fmtCount(serverCount)} servers` : 'Every server PollBot is in'}
        />
        <nav className="px-2 pb-4" aria-label="Bot admin">
            <NavGroup>
                <NavItem to="/admin" icon={<Activity className={ICON} strokeWidth={STROKE} />} label="Overview" />
                <NavItem to="/admin/servers" icon={<Server className={ICON} strokeWidth={STROKE} />} label="Servers" end={false} />
                <NavItem to="/polls" icon={<ListChecks className={ICON} strokeWidth={STROKE} />} label="Polls" />
                <NavItem to="/voters" icon={<Users className={ICON} strokeWidth={STROKE} />} label="Voters" />
            </NavGroup>
            <NavGroup label="You">
                <NavItem to="/dashboard" icon={<LayoutGrid className={ICON} strokeWidth={STROKE} />} label="Your servers" />
                <NavItem to="/my-votes" icon={<Vote className={ICON} strokeWidth={STROKE} />} label="My votes" />
                <NavItem to="/" icon={<Compass className={ICON} strokeWidth={STROKE} />} label="Landing page" />
            </NavGroup>
        </nav>
    </>
);

export interface ChannelPollCount {
    id: string;
    name: string | null;
    count: number;
    open: number;
}

/**
 * Sidebar for one server: the server header, its screens, and - like
 * Discord's channel list - every channel that has polls, which filters the
 * poll list to that channel.
 */
export const GuildSidebar: React.FC<{
    guildId: string;
    name?: string;
    iconUrl?: string | null;
    memberCount?: number | null;
    totalPolls?: number | null;
    channels?: ChannelPollCount[];
    activeChannel?: string | null;
    section: 'polls' | 'analytics';
}> = ({ guildId, name, iconUrl, memberCount, totalPolls, channels = [], activeChannel, section }) => {
    const { findGuild } = useGuilds();
    const cached = findGuild(guildId);
    const title = name || cached?.name || 'Server';
    const icon = iconUrl !== undefined ? iconUrl : cached?.icon_url;
    const members = memberCount ?? cached?.member_count ?? null;

    return (
        <>
            <SidebarHeader
                leading={<GuildIcon name={title} iconUrl={icon} size={32} radius="10px" />}
                title={title}
                subtitle={members != null ? `${fmtCount(members)} members` : 'Members not synced yet'}
            />
            <nav className="px-2 pb-4" aria-label={title}>
                <NavGroup>
                    <NavItem
                        to={`/manage/${guildId}`}
                        icon={<ListChecks className={ICON} strokeWidth={STROKE} />}
                        label="Polls"
                        count={totalPolls ?? cached?.poll_count ?? null}
                        active={section === 'polls' && !activeChannel}
                    />
                    <NavItem
                        to={`/manage/${guildId}/analytics`}
                        icon={<BarChart3 className={ICON} strokeWidth={STROKE} />}
                        label="Analytics"
                        trailing={<span className="chip chip-warning h-5 px-1.5 text-[11px]">Premium</span>}
                    />
                </NavGroup>
                {channels.length > 0 && (
                    <NavGroup label="Channels with polls">
                        {channels.map(c => (
                            <NavItem
                                key={c.id}
                                to={`/manage/${guildId}?channel=${c.id}`}
                                icon={<Hash className={ICON} strokeWidth={STROKE} />}
                                label={c.name || 'unknown-channel'}
                                count={c.count}
                                active={section === 'polls' && activeChannel === c.id}
                            />
                        ))}
                    </NavGroup>
                )}
            </nav>
        </>
    );
};
