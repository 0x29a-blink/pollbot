import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Settings, Info, PieChart, ChevronDown, ChevronUp, ExternalLink, Heart, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import type { Poll } from '../types';

interface PollSupporters {
    total_voters: number;
    premium_now: number;
    supporters: number;
    supporters_30d: number;
    topgg: number;
    discordforge: number;
    top_supporters: {
        user_id: string;
        username: string | null;
        avatar_url: string | null;
        botlist_votes: number;
        sources: string[];
        last_botlist_vote_at: string;
    }[];
}

interface PollCardProps {
    poll: Poll;
    votes?: Record<number, number>;
    guild?: { name: string; icon_url: string | null; id: string }; // Optional guild info
    /** Admin-only: show the bot-list supporter breakdown card on expand. */
    showSupporterCard?: boolean;
}

export const PollCard: React.FC<PollCardProps> = ({ poll, votes = {}, guild, showSupporterCard = false }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [supporters, setSupporters] = useState<PollSupporters | null>(null);
    const [supportersFailed, setSupportersFailed] = useState(false);
    const navigate = useNavigate();
    const options = Array.isArray(poll.options) ? poll.options : [];
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);

    // Lazy-load the supporter breakdown the first time the card is expanded.
    useEffect(() => {
        if (!showSupporterCard || !isExpanded || supporters || supportersFailed) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch(`/api/admin/polls/${poll.message_id}/supporters`);
                if (cancelled) return;
                if (!res.ok) { setSupportersFailed(true); return; }
                setSupporters(await res.json());
            } catch {
                if (!cancelled) setSupportersFailed(true);
            }
        })();
        return () => { cancelled = true; };
    }, [showSupporterCard, isExpanded, supporters, supportersFailed, poll.message_id]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="glass-panel border-l-4 border-l-indigo-500 overflow-hidden"
        >
            {/* Compact / Header View */}
            <div
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-800/30 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
                onClick={() => setIsExpanded(!isExpanded)}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-label={`Toggle details for poll ${poll.title}`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); } }}
            >
                <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-white mb-1 truncate">{poll.title}</h3>
                    <div className="flex items-center gap-4 text-sm text-slate-400">
                        <span className="font-medium text-emerald-400">{totalVotes} Votes</span>
                        <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${poll.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                            {poll.active ? 'Active' : 'Closed'}
                        </div>
                        {guild && (
                            <>
                                <span className="w-1 h-1 bg-slate-600 rounded-full hidden md:block"></span>
                                <div
                                    className="flex items-center gap-2 hover:text-indigo-400 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/server/${guild.id}`);
                                    }}
                                >
                                    {guild.icon_url ? (
                                        <img src={guild.icon_url} alt={guild.name} className="w-5 h-5 rounded-md" />
                                    ) : (
                                        <div className="w-5 h-5 rounded-md bg-slate-700 flex items-center justify-center text-[10px]">{guild.name.charAt(0)}</div>
                                    )}
                                    <span className="hidden md:inline truncate max-w-[150px]">{guild.name}</span>
                                    <ExternalLink className="w-3 h-3" />
                                </div>
                            </>
                        )}
                    </div>
                </div>
                <div className="text-slate-500">
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-slate-700/50 bg-slate-900/20"
                    >
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Options / Values */}
                            <div className="space-y-3">
                                <p className="text-slate-400 text-sm mb-4">{poll.description}</p>
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Results</h4>
                                </div>

                                {options.map((opt: any, i: number) => {
                                    const count = votes[i] || 0;
                                    const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;

                                    return (
                                        <div key={i} className="relative">
                                            <div className="flex justify-between text-sm text-slate-300 mb-1 z-10 relative">
                                                <span>{typeof opt === 'string' ? opt : (opt.text || opt.label)}</span>
                                                <span className="font-mono text-indigo-300">{count}</span>
                                            </div>
                                            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-indigo-500/50 transition-all duration-500"
                                                    style={{ width: `${percentage}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Meta / Settings */}
                            <div className="bg-slate-900/30 rounded-xl p-4 text-sm h-fit">
                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Configuration</h4>
                                <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                                    <SettingItem icon={<Calendar className="w-4 h-4" />} label="Created" value={new Date(poll.created_at).toLocaleString()} />
                                    {/* public/allow_close/allow_exports default to true when absent — use !== false */}
                                    <SettingItem icon={<PieChart className="w-4 h-4" />} label="Live Results" value={poll.settings?.public !== false ? 'Visible' : 'Hidden until close'} />
                                    <SettingItem icon={<Info className="w-4 h-4" />} label="Selections" value={`${poll.settings?.min_votes ?? 1}–${poll.settings?.max_votes ?? 1}`} />
                                    <SettingItem icon={<Settings className="w-4 h-4" />} label="Thread" value={poll.settings?.allow_thread ? 'Yes' : 'No'} />

                                    <SettingItem icon={<Settings className="w-4 h-4" />} label="Close Button" value={poll.settings?.allow_close !== false ? 'Yes' : 'No'} />
                                    <SettingItem icon={<Settings className="w-4 h-4" />} label="Exports" value={poll.settings?.allow_exports !== false ? 'Allowed' : 'Disabled'} />

                                    <div className="col-span-2 mt-2 pt-2 border-t border-slate-700/50">
                                        <div className="text-[10px] uppercase opacity-70 mb-1">Allowed Roles</div>
                                        <div className="text-xs text-white break-words">{poll.settings?.allowed_roles?.length ? poll.settings.allowed_roles.map(roleName(poll)).join(', ') : 'All Users'}</div>
                                    </div>

                                    {poll.settings?.vote_weights && Object.keys(poll.settings.vote_weights).length > 0 && (
                                        <div className="col-span-2 mt-2 pt-2 border-t border-slate-700/50">
                                            <div className="text-[10px] uppercase opacity-70 mb-1">Vote Weights</div>
                                            <div className="flex flex-wrap gap-2">
                                                {Object.entries(poll.settings.vote_weights).map(([role, weight]) => (
                                                    <span key={role} className="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-xs">
                                                        {roleName(poll)(role)}: {weight}x
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Bot-list supporter breakdown (admin polls view only) */}
                        {showSupporterCard && (
                            <div className="px-6 pb-6">
                                <div className="bg-slate-900/30 rounded-xl p-4 text-sm">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="p-1.5 bg-rose-500/10 rounded-lg text-rose-400">
                                            <Heart className="w-4 h-4" />
                                        </div>
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Bot-List Supporters Among Voters</h4>
                                    </div>

                                    {supportersFailed ? (
                                        <p className="text-xs text-slate-500">Couldn't load supporter data.</p>
                                    ) : !supporters ? (
                                        <div className="h-10 rounded-lg animate-pulse bg-slate-800/40" />
                                    ) : (
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                <SupporterStat label="Poll voters" value={supporters.total_voters} />
                                                <SupporterStat
                                                    label="Premium now"
                                                    value={supporters.premium_now}
                                                    accent="text-emerald-400"
                                                    icon={<CheckCircle className="w-3 h-3" />}
                                                />
                                                <SupporterStat label="Top.gg voters" value={supporters.topgg} accent="text-rose-400" />
                                                <SupporterStat label="DiscordForge" value={supporters.discordforge} accent="text-indigo-400" />
                                                <div className="col-span-2 sm:col-span-4 text-[11px] text-slate-500">
                                                    {supporters.total_voters > 0
                                                        ? `${Math.round((supporters.supporters / supporters.total_voters) * 100)}% of this poll's voters have ever voted for the bot (${supporters.supporters_30d} in the last 30 days).`
                                                        : 'No votes on this poll yet.'}
                                                </div>
                                            </div>

                                            <div>
                                                <div className="text-[10px] uppercase text-slate-500 font-bold mb-2">Top supporters in this poll</div>
                                                {supporters.top_supporters.length === 0 ? (
                                                    <p className="text-xs text-slate-500">None of this poll's voters have voted on a bot list.</p>
                                                ) : (
                                                    <ul className="space-y-1.5">
                                                        {supporters.top_supporters.map(s => (
                                                            <li key={s.user_id} className="flex items-center gap-2 bg-slate-900/40 border border-slate-800 rounded-lg px-2.5 py-1.5">
                                                                {s.avatar_url
                                                                    ? <img src={s.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                                                                    : <div className="w-5 h-5 rounded-full bg-slate-700" />}
                                                                <span className="text-xs text-slate-200 truncate flex-1">{s.username || s.user_id}</span>
                                                                <span className="text-[10px] text-slate-500">{s.sources.join(' · ')}</span>
                                                                <span className="text-xs font-bold text-white">{s.botlist_votes}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const SupporterStat = ({ label, value, accent = 'text-white', icon }: { label: string; value: number; accent?: string; icon?: React.ReactNode }) => (
    <div className="bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
        <div className="text-[10px] uppercase text-slate-500 font-bold">{label}</div>
        <div className={`text-lg font-bold ${accent} inline-flex items-center gap-1.5`}>{icon}{value.toLocaleString()}</div>
    </div>
);

/** Resolve a role ID to its display name via role_metadata, falling back to the ID. */
const roleName = (poll: Poll) => (id: string) => poll.settings?.role_metadata?.[id]?.name ?? id;

const SettingItem = ({ icon, label, value }: any) => (
    <div className="flex items-center gap-2 text-slate-400">
        <div className="text-indigo-400">{icon}</div>
        <div className="flex flex-col">
            <span className="text-[10px] uppercase opacity-70">{label}</span>
            <span className="text-white font-medium">{value}</span>
        </div>
    </div>
);
