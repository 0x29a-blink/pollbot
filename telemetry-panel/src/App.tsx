import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { ServerView } from './pages/ServerView';
import { PollsView } from './pages/PollsView';
import { VotersView } from './pages/VotersView';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const key = localStorage.getItem('telemetry_key');
  const location = useLocation();

  if (!key) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
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
            <ProtectedRoute>
              <PollsView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/voters"
          element={
            <ProtectedRoute>
              <VotersView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/server/:id"
          element={
            <ProtectedRoute>
              <ServerView />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
