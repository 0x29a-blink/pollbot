import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Search, CheckCircle, XCircle, Clock } from 'lucide-react';


interface UserData {
    id: string;
    last_vote_at: string | null;
}

export const VotersView: React.FC = () => {
    const navigate = useNavigate();
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const { data } = await supabase
                .from('users')
                .select('*')
                .order('last_vote_at', { ascending: false });

            if (data) setUsers(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const getPremiumStatus = (lastVote: string | null): 'active' | 'grace' | 'inactive' => {
        if (!lastVote) return 'inactive';
        const voteDate = new Date(lastVote);
        const now = new Date();
        const diffMs = now.getTime() - voteDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours < 12) return 'active';
        if (diffHours >= 12 && diffHours < 13) return 'grace';
        return 'inactive';
    };

    const filteredUsers = users.filter(user => {
        const matchesSearch = user.id.includes(search);
        const status = getPremiumStatus(user.last_vote_at);

        if (filter === 'active') return matchesSearch && (status === 'active' || status === 'grace');
        if (filter === 'inactive') return matchesSearch && status === 'inactive';
        return matchesSearch;
    });

    return (
        <div className="min-h-screen pb-20 p-8">
            <div className="container-wide animate-fade-in">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </button>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-2">Voter Registry</h1>
                        <p className="text-slate-400">Manage user premium status and voting history</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                        {/* Search */}
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Search User ID..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            />
                        </div>

                        {/* Filter */}
                        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterButton>
                            <FilterButton active={filter === 'active'} onClick={() => setFilter('active')}>Active</FilterButton>
                            <FilterButton active={filter === 'inactive'} onClick={() => setFilter('inactive')}>Inactive</FilterButton>
                        </div>
                    </div>
                </div>

                <div className="glass-panel overflow-hidden">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="bg-slate-900/50 text-xs uppercase font-bold text-slate-500">
                            <tr>
                                <th className="p-4">User ID</th>
                                <th className="p-4">Status</th>
                                <th className="p-4">Last Vote</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {loading ? (
                                <tr><td colSpan={4} className="p-8 text-center">Loading registry...</td></tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center">No users found.</td></tr>
                            ) : (
                                filteredUsers.map(user => {
                                    const status = getPremiumStatus(user.last_vote_at);
                                    let statusBadge;

                                    if (status === 'active') {
                                        statusBadge = (
                                            <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400">
                                                <CheckCircle className="w-3 h-3" /> PREMIUM
                                            </div>
                                        );
                                    } else if (status === 'grace') {
                                        statusBadge = (
                                            <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400">
                                                <Clock className="w-3 h-3" /> GRACE PERIOD
                                            </div>
                                        );
                                    } else {
                                        statusBadge = (
                                            <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400">
                                                <XCircle className="w-3 h-3" /> INACTIVE
                                            </div>
                                        );
                                    }

                                    return (
                                        <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                                            <td className="p-4 font-mono text-white">{user.id}</td>
                                            <td className="p-4">{statusBadge}</td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-3 h-3" />
                                                    {user.last_vote_at ? new Date(user.last_vote_at).toLocaleString() : 'Never'}
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                <button
                                                    onClick={() => navigate(`/polls?user_id=${user.id}`)}
                                                    className="text-indigo-400 hover:text-indigo-300 text-xs font-bold"
                                                >
                                                    VIEW POLLS
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const FilterButton = ({ active, children, onClick }: any) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
    >
        {children}
    </button>
);
