// Copyright (c) 2026 Simple Solutions.
// Licensed under the PolyForm Shield License 1.0.0. See dashboard/LICENSE and dashboard/NOTICE for details.

import React, { useEffect, useState, createContext, useContext, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { AuthCallback } from './pages/AuthCallback';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/Toast';
import { GuildsProvider } from './components/shell/GuildsProvider';
import { apiFetch } from './utils/api';

// Heavy, auth-gated pages (charts, framer-motion, large views) are code-split so
// the public Landing/Login entry points don't download them on first load.
const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const ServerView = lazy(() => import('./pages/ServerView').then(m => ({ default: m.ServerView })));
const PollsView = lazy(() => import('./pages/PollsView').then(m => ({ default: m.PollsView })));
const VotersView = lazy(() => import('./pages/VotersView').then(m => ({ default: m.VotersView })));
const UserServerView = lazy(() => import('./pages/UserServerView').then(m => ({ default: m.UserServerView })));
const GuildAnalyticsView = lazy(() => import('./pages/GuildAnalyticsView').then(m => ({ default: m.GuildAnalyticsView })));
const MyVotesView = lazy(() => import('./pages/MyVotesView').then(m => ({ default: m.MyVotesView })));
const AdminOverview = lazy(() => import('./pages/AdminOverview').then(m => ({ default: m.AdminOverview })));
const AdminServers = lazy(() => import('./pages/AdminServers').then(m => ({ default: m.AdminServers })));

// User context for sharing auth state
interface User {
  id: string;
  username: string;
  discriminator: string;
  avatar_url: string;
  is_admin: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => { },
});

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      try {
        // With httpOnly cookies, we just need to call /me and the cookie is sent automatically
        const res = await fetch('/api/auth/me', {
          credentials: 'include', // Send cookies
        });

        if (res.ok && !cancelled) {
          const userData = await res.json();
          if (!cancelled) {
            setUser(userData);
          }
        }
        // If not ok, user is simply not logged in (no need to clear anything)
      } catch (error) {
        console.error('Auth check failed:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', {
        method: 'POST',
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      <GuildsProvider key={user?.id ?? 'signed-out'} userId={user?.id}>
        {children}
      </GuildsProvider>
    </AuthContext.Provider>
  );
};

/** Neutral full-screen wait state on the shell's ground colour. */
const FullScreenSpinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-ground" role="status" aria-label="Loading">
    <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly = false }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // Show loading spinner while checking auth
    return <FullScreenSpinner />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (adminOnly && !user.is_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

const RouteFallback = () => <FullScreenSpinner />;

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/dashboard" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/my-votes" element={<ProtectedRoute><MyVotesView /></ProtectedRoute>} />
        <Route path="/manage/:guildId" element={<ProtectedRoute><UserServerView /></ProtectedRoute>} />
        <Route path="/manage/:guildId/analytics" element={<ProtectedRoute><GuildAnalyticsView /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminOverview /></ProtectedRoute>} />
        <Route path="/admin/servers" element={<ProtectedRoute adminOnly><AdminServers /></ProtectedRoute>} />
        <Route path="/polls" element={<ProtectedRoute adminOnly><PollsView /></ProtectedRoute>} />
        <Route path="/voters" element={<ProtectedRoute adminOnly><VotersView /></ProtectedRoute>} />
        <Route path="/server/:id" element={<ProtectedRoute adminOnly><ServerView /></ProtectedRoute>} />
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

export default App;
