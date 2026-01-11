import SimpleSolutionsLogo from '../assets/simplesolutions.webp';
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, Eye, Settings2, Zap, Shield, Users, ArrowRight, Plus, Clock } from 'lucide-react';

// Discord brand colors
const DISCORD_BLURPLE = '#5865F2';

export const Landing: React.FC = () => {
    const navigate = useNavigate();

    // Check if already logged in
    useEffect(() => {
        const session = localStorage.getItem('dashboard_session');
        if (session) {
            fetch('/api/auth/me', {
                headers: { Authorization: `Bearer ${session}` }
            }).then(res => {
                if (res.ok) {
                    navigate('/dashboard', { replace: true });
                } else {
                    localStorage.removeItem('dashboard_session');
                }
            }).catch(() => { });
        }
    }, [navigate]);

    const handleDiscordLogin = () => {
        window.location.href = '/api/auth/discord';
    };

    const features = [
        {
            icon: <BarChart3 className="w-6 h-6" />,
            title: 'View Your Polls',
            description: 'See all polls you\'ve created across your servers with live vote counts and real-time updates.',
            color: 'indigo'
        },
        {
            icon: <Plus className="w-6 h-6" />,
            title: 'Create Polls',
            description: 'Create new polls directly from the dashboard with advanced options like vote limits and role restrictions.',
            color: 'emerald'
        },
        {
            icon: <Eye className="w-6 h-6" />,
            title: 'Live Updates',
            description: 'Watch votes come in real-time without refreshing. See exactly how your community is voting.',
            color: 'violet'
        },
        {
            icon: <Settings2 className="w-6 h-6" />,
            title: 'Manage Settings',
            description: 'Edit poll visibility, vote requirements, role restrictions, and more from one central place.',
            color: 'amber'
        },
        {
            icon: <Zap className="w-6 h-6" />,
            title: 'Quick Actions',
            description: 'Close, reopen, or delete polls instantly. Full control over your polls at your fingertips.',
            color: 'rose'
        },
        {
            icon: <Clock className="w-6 h-6" />,
            title: 'Poll History',
            description: 'Access your complete poll history with detailed vote breakdowns and results.',
            color: 'cyan'
        }
    ];

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/30 via-slate-900/80 to-slate-950 -z-10" />
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMyMDIwMzAiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRjMC0yIDItNCAyLTRzLTItMi00LTJoLTRjLTIgMC00IDItNCAyczIgNCAyIDRzMiAyIDQgMmg0YzIgMCA0LTIgNC0yeiIvPjwvZz48L2c+PC9zdmc+')] opacity-30 -z-10" />

            {/* Header */}
            <header className="container mx-auto px-6 py-6">
                <nav className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center ring-1 ring-indigo-500/30 overflow-hidden">
                            <img src={SimpleSolutionsLogo} alt="Logo" className="w-8 h-8 object-contain" />
                        </div>
                        <span className="text-xl font-bold title-gradient">Simple Poll Bot</span>
                    </div>
                    <button
                        onClick={handleDiscordLogin}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors border border-slate-700"
                    >
                        <Shield className="w-4 h-4" />
                        Sign In
                    </button>
                </nav>
            </header>

            {/* Hero Section */}
            <main className="container mx-auto px-6 pt-12 pb-20">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-center max-w-3xl mx-auto mb-20"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm font-medium mb-6">
                        <Zap className="w-4 h-4" />
                        Dashboard for Simple Poll Bot
                    </div>
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
                        Manage Your Polls
                        <br />
                        <span className="title-gradient">From One Place</span>
                    </h1>
                    <p className="text-lg text-slate-400 mb-10 max-w-xl mx-auto">
                        Create, monitor, and manage all your Discord polls from a beautiful web dashboard.
                        Real-time updates, advanced controls, and complete visibility.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            onClick={handleDiscordLogin}
                            style={{ backgroundColor: DISCORD_BLURPLE }}
                            className="flex items-center gap-3 px-6 py-3 rounded-xl text-white font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/20"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1099 30.1693C30.1099 34.1136 27.2792 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7680 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.7018 30.1693C53.7018 34.1136 50.9 37.3253 47.3178 37.3253Z" />
                            </svg>
                            Continue with Discord
                            <ArrowRight className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-2 text-slate-500 text-sm">
                            <Users className="w-4 h-4" />
                            <span>Requires Manage Server permission</span>
                        </div>
                    </div>
                </motion.div>

                {/* Features Grid */}
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                >
                    <h2 className="text-2xl font-bold text-white text-center mb-10">
                        Everything You Need to Manage Your Polls
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
                        {features.map((feature, index) => (
                            <motion.div
                                key={feature.title}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
                                className="glass-panel p-6 group hover:border-indigo-500/30 transition-colors"
                            >
                                <div className={`w-12 h-12 rounded-xl bg-${feature.color}-500/10 flex items-center justify-center text-${feature.color}-400 mb-4 ring-1 ring-${feature.color}-500/20 group-hover:ring-${feature.color}-500/40 transition-all`}>
                                    {feature.icon}
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                                <p className="text-slate-400 text-sm leading-relaxed">{feature.description}</p>
                            </motion.div>
                        ))}
                    </div>
                </motion.div>

                {/* CTA Section */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6, delay: 0.8 }}
                    className="text-center mt-20"
                >
                    <div className="glass-panel p-8 max-w-2xl mx-auto bg-gradient-to-br from-indigo-500/5 to-violet-500/5">
                        <h3 className="text-2xl font-bold text-white mb-3">Ready to Get Started?</h3>
                        <p className="text-slate-400 mb-6">
                            Sign in with your Discord account to start managing your polls.
                        </p>
                        <button
                            onClick={handleDiscordLogin}
                            style={{ backgroundColor: DISCORD_BLURPLE }}
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-semibold hover:opacity-90 transition-opacity"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1099 30.1693C30.1099 34.1136 27.2792 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7680 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.7018 30.1693C53.7018 34.1136 50.9 37.3253 47.3178 37.3253Z" />
                            </svg>
                            Sign In with Discord
                        </button>
                    </div>
                </motion.div>
            </main>

            {/* Footer */}
            <footer className="container mx-auto px-6 py-8 border-t border-slate-800">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
                    <div className="flex items-center gap-2">
                        <img src={SimpleSolutionsLogo} alt="Logo" className="w-5 h-5 object-contain opacity-50" />
                        <span>Simple Poll Bot Dashboard</span>
                    </div>
                    <p>© {new Date().getFullYear()} Simple Solutions. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
};
