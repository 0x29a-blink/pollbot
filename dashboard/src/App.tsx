import React, { useEffect, useState, createContext, useContext, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { AuthCallback } from './pages/AuthCallback';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/Toast';

// Heavy, auth-gated pages (charts, framer-motion, large views) are code-split so
// the public Landing/Login entry points don't download them on first load.
const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const ServerView = lazy(() => import('./pages/ServerView').then(m => ({ default: m.ServerView })));
const PollsView = lazy(() => import('./pages/PollsView').then(m => ({ default: m.PollsView })));
const VotersView = lazy(() => import('./pages/VotersView').then(m => ({ default: m.VotersView })));
const UserServerView = lazy(() => import('./pages/UserServerView').then(m => ({ default: m.UserServerView })));
const MyVotesView = lazy(() => import('./pages/MyVotesView').then(m => ({ default: m.MyVotesView })));

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

export const useAuth = () => useContext(AuthContext);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // With httpOnly cookies, we just need to call /me and the cookie is sent automatically
      const res = await fetch('/api/auth/me', {
        credentials: 'include', // Send cookies
      });

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      }
      // If not ok, user is simply not logged in (no need to clear anything)
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include', // Send cookies
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly = false }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // Show loading spinner while checking auth
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (adminOnly && !user.is_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-950">
    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/polls"
        element={
          <ProtectedRoute adminOnly>
            <PollsView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/voters"
        element={
          <ProtectedRoute adminOnly>
            <VotersView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/server/:id"
        element={
          <ProtectedRoute adminOnly>
            <ServerView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/manage/:guildId"
        element={
          <ProtectedRoute>
            <UserServerView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-votes"
        element={
          <ProtectedRoute>
            <MyVotesView />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Landing />} />
    </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
