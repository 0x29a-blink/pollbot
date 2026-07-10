import React from 'react';
import { motion } from 'framer-motion';

// Complete class strings per accent color — Tailwind only generates classes it
// sees as literals, so these must never be built by string interpolation.
const accentClasses: Record<string, { tile: string; value: string }> = {
    yellow: { tile: 'bg-yellow-500/10 text-yellow-400', value: 'text-yellow-400' },
    amber: { tile: 'bg-amber-500/10 text-amber-400', value: 'text-amber-400' },
    indigo: { tile: 'bg-indigo-500/10 text-indigo-400', value: 'text-indigo-400' },
    emerald: { tile: 'bg-emerald-500/10 text-emerald-400', value: 'text-emerald-400' },
};
const fallbackAccent = { tile: 'bg-slate-500/10 text-slate-400', value: 'text-slate-400' };

interface LeaderboardProps {
    title: string;
    icon: React.ReactNode;
    color: string;
    items: {
        id: string;
        label: string;
        subLabel?: string;
        value: string | number;
        rank?: number;
        onClick?: () => void;
    }[];
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ title, icon, color, items }) => {
    const accent = accentClasses[color] ?? fallbackAccent;
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-6"
        >
            <div className="flex items-center gap-2 mb-6">
                <div className={`p-2 rounded-lg ${accent.tile}`}>
                    {icon}
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">{title}</h3>
                    <p className="text-slate-400 text-xs">Top Performers</p>
                </div>
            </div>

            <div className="space-y-4">
                {items.length === 0 ? (
                    <div className="text-center text-slate-500 py-4 text-sm">No data available</div>
                ) : (
                    items.map((item, index) => (
                        <div
                            key={item.id}
                            onClick={item.onClick}
                            className={`flex items-center gap-4 group ${item.onClick ? 'cursor-pointer' : ''}`}
                        >
                            <div className={`w-8 h-8 flex items-center justify-center rounded-full font-bold text-sm
                                ${index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                                    index === 1 ? 'bg-slate-400/20 text-slate-300' :
                                        index === 2 ? 'bg-amber-700/20 text-amber-600' :
                                            'bg-slate-800 text-slate-500'}
                            `}>
                                {index + 1}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className={`text-white text-sm font-medium truncate transition-colors ${item.onClick ? 'group-hover:text-indigo-400' : 'group-hover:text-indigo-300'}`}>
                                    {item.label}
                                </div>
                                {item.subLabel && <div className="text-xs text-slate-500 truncate">{item.subLabel}</div>}
                            </div>

                            <div className="text-right">
                                <span className={`font-mono font-bold text-sm ${accent.value}`}>{item.value}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </motion.div>
    );
};
