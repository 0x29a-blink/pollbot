import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/api';

export interface UserGuild {
    id: string;
    name: string;
    icon_url: string | null;
    /** Null when the bot's guild cache has no member count yet. */
    member_count?: number | null;
    poll_count?: number;
    has_bot: boolean;
}

interface GuildsState {
    withBot: UserGuild[];
    withoutBot: UserGuild[];
    loading: boolean;
    /** True once the first response (or error) has arrived. */
    loaded: boolean;
    error: string | null;
    lastRefreshed: Date | null;
    /** Seconds until a manual refresh from Discord is allowed again. */
    cooldown: number;
    refreshing: boolean;
    reload: () => Promise<void>;
    refreshFromDiscord: () => Promise<void>;
    findGuild: (id: string | undefined) => UserGuild | undefined;
}

const GuildsContext = createContext<GuildsState | null>(null);

/**
 * The signed-in user's manageable servers, fetched once and shared by the
 * server rail, the Servers screen and each server's sidebar, so moving between
 * screens never refetches or flashes an empty rail.
 */
export const GuildsProvider: React.FC<{ userId: string | null | undefined; children: React.ReactNode }> = ({ userId, children }) => {
    const [withBot, setWithBot] = useState<UserGuild[]>([]);
    const [withoutBot, setWithoutBot] = useState<UserGuild[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const [cooldown, setCooldown] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    const apply = (data: { withBot?: UserGuild[]; withoutBot?: UserGuild[]; lastRefreshed?: string }) => {
        setWithBot(data.withBot || []);
        setWithoutBot(data.withoutBot || []);
        setLastRefreshed(data.lastRefreshed ? new Date(data.lastRefreshed) : new Date());
    };

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/user/guilds', { credentials: 'include' });
            if (res.ok) {
                apply(await res.json());
            } else if (res.status === 401) {
                setError('Your Discord session expired. Sign out and back in to see your servers.');
            } else {
                setError("Couldn't load your servers from Discord.");
            }
        } catch (err) {
            console.error('Error fetching user guilds:', err);
            setError("Couldn't load your servers from Discord.");
        } finally {
            setLoading(false);
            setLoaded(true);
        }
    }, []);

    const refreshFromDiscord = useCallback(async () => {
        if (refreshing || cooldown > 0) return;
        setRefreshing(true);
        setError(null);
        try {
            const res = await apiFetch('/api/user/guilds/refresh', { method: 'POST' });
            if (res.ok) {
                apply(await res.json());
                setCooldown(300);
            } else if (res.status === 429) {
                const data = await res.json().catch(() => ({}));
                setCooldown(data.retryAfter || 300);
            } else if (res.status === 401) {
                setError('Your Discord session expired. Sign out and back in.');
            } else {
                setError("Couldn't refresh your servers from Discord.");
            }
        } catch (err) {
            console.error('Error refreshing guilds:', err);
            setError("Couldn't refresh your servers from Discord.");
        } finally {
            setRefreshing(false);
        }
    }, [refreshing, cooldown]);

    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
        return () => clearInterval(t);
    }, [cooldown]);

    useEffect(() => {
        // The provider is keyed by user id (App.tsx), so a new sign-in remounts it.
        if (!userId) return;
        void (async () => { await reload(); })();
    }, [userId, reload]);

    const findGuild = useCallback((id: string | undefined) => withBot.find(g => g.id === id), [withBot]);

    const value = useMemo<GuildsState>(() => ({
        withBot, withoutBot, loading, loaded, error, lastRefreshed, cooldown, refreshing, reload, refreshFromDiscord, findGuild,
    }), [withBot, withoutBot, loading, loaded, error, lastRefreshed, cooldown, refreshing, reload, refreshFromDiscord, findGuild]);

    return <GuildsContext.Provider value={value}>{children}</GuildsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useGuilds(): GuildsState {
    const ctx = useContext(GuildsContext);
    if (!ctx) throw new Error('useGuilds must be used inside <GuildsProvider>');
    return ctx;
}

/** Bot invite URL, optionally pre-selecting a server. */
// eslint-disable-next-line react-refresh/only-export-components
export function botInviteUrl(guildId?: string): string {
    const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID || '';
    const base = `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=534992383040`;
    return guildId ? `${base}&guild_id=${guildId}&disable_guild_select=true` : base;
}
