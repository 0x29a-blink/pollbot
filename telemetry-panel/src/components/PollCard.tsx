import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Settings, Info, PieChart } from 'lucide-react';
import type { Poll } from '../types';

interface PollCardProps {
    poll: Poll;
    votes?: Record<number, number>;
}

export const PollCard: React.FC<PollCardProps> = ({ poll, votes = {} }) => {
    const options = Array.isArray(poll.options) ? poll.options : [];
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="glass-panel p-6 border-l-4 border-l-indigo-500"
        >
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="text-xl font-bold text-white mb-1">{poll.title}</h3>
                    <p className="text-slate-400 text-sm line-clamp-2">{poll.description}</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold ${poll.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                    {poll.active ? 'ACTIVE' : 'CLOSED'}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Options / Values */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Current Standings</h4>
                        <span className="text-xs text-slate-400">{totalVotes} Total Votes</span>
                    </div>

                    {options.slice(0, 5).map((opt: any, i: number) => {
                        const count = votes[i] || 0;
                        const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;

                        return (
                            <div key={i} className="relative">
                                <div className="flex justify-between text-sm text-slate-300 mb-1 z-10 relative">
                                    <span>{opt.text || opt.label}</span>
                                    <span className="font-mono text-indigo-300">{count} Votes</span>
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
                    {options.length > 5 && <div className="text-xs text-slate-500 italic">...and {options.length - 5} more</div>}
                </div>

                {/* Meta / Settings */}
                <div className="bg-slate-900/30 rounded-xl p-4 text-sm">
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
