import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Settings, Info, PieChart, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Poll } from '../types';

interface PollCardProps {
    poll: Poll;
    votes?: Record<number, number>;
    guild?: { name: string; icon_url: string | null; id: string }; // Optional guild info
}

export const PollCard: React.FC<PollCardProps> = ({ poll, votes = {}, guild }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const navigate = useNavigate();
    const options = Array.isArray(poll.options) ? poll.options : [];
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="glass-panel border-l-4 border-l-indigo-500 overflow-hidden"
        >
            {/* Compact / Header View */}
            <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-800/30 transition-colors" onClick={() => setIsExpanded(!isExpanded)}>
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
                                    <SettingItem icon={<Settings className="w-4 h-4" />} label="Private" value={poll.settings?.private ? 'Yes' : 'No'} />
                                    <SettingItem icon={<Info className="w-4 h-4" />} label="Multi-Vote" value={poll.settings?.allow_multivote ? 'Yes' : 'No'} />
                                    <SettingItem icon={<PieChart className="w-4 h-4" />} label="Results" value={poll.settings?.hide_results ? 'Hidden' : 'Public'} />

                                    <SettingItem icon={<Settings className="w-4 h-4" />} label="Min Votes" value={poll.settings?.min_votes || 'None'} />
                                    <SettingItem icon={<Settings className="w-4 h-4" />} label="Max Votes" value={poll.settings?.max_votes || 'None'} />

                                    <div className="col-span-2 mt-2 pt-2 border-t border-slate-700/50">
                                        <div className="text-[10px] uppercase opacity-70 mb-1">Allowed Roles</div>
                                        <div className="text-xs text-white break-words">{poll.settings?.allowed_roles?.length ? poll.settings.allowed_roles.join(', ') : 'All Users'}</div>
                                    </div>

                                    {poll.settings?.weights && Object.keys(poll.settings.weights).length > 0 && (
                                        <div className="col-span-2 mt-2 pt-2 border-t border-slate-700/50">
                                            <div className="text-[10px] uppercase opacity-70 mb-1">Vote Weights</div>
                                            <div className="flex flex-wrap gap-2">
                                                {Object.entries(poll.settings.weights).map(([role, weight]: any) => (
                                                    <span key={role} className="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-xs">
                                                        {role}: {weight}x
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const SettingItem = ({ icon, label, value }: any) => (
    <div className="flex items-center gap-2 text-slate-400">
        <div className="text-indigo-400">{icon}</div>
        <div className="flex flex-col">
            <span className="text-[10px] uppercase opacity-70">{label}</span>
            <span className="text-white font-medium">{value}</span>
        </div>
    </div>
);
