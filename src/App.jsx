import { useState, useEffect } from 'react';
import { getStoredToken, handleCallback, refreshAccessToken, logout } from './spotify/auth';
import { getCurrentUser } from './spotify/api';
import Login from './components/Login';
import Header from './components/Header';
import CoachExplorer from './components/CoachExplorer';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function init() {
      if (!CLIENT_ID) {
        setError('Missing VITE_SPOTIFY_CLIENT_ID. Create a .env file — see .env.example');
        setLoading(false);
        return;
      }

      try {
        // Handle GitHub Pages SPA redirect from 404.html
        const params = new URLSearchParams(window.location.search);
        if (params.has('__redirect')) {
          const redirected = new URL(decodeURIComponent(params.get('__redirect')), window.location.origin);
          const redirectParams = new URLSearchParams(redirected.search);
          // Replace URL cleanly, preserving the OAuth params
          const cleanUrl = window.location.origin + window.location.pathname +
            (redirectParams.toString() ? '?' + redirectParams.toString() : '');
          window.history.replaceState({}, '', cleanUrl);
          // Re-read params after redirect
          const newParams = new URLSearchParams(window.location.search);
          if (newParams.has('code')) {
            const tokenData = await handleCallback(CLIENT_ID);
            if (tokenData) {
              setToken(tokenData.access_token);
              const userData = await getCurrentUser(tokenData.access_token);
              setUser(userData);
              setLoading(false);
              return;
            }
          }
        }

        // Handle direct OAuth callback
        if (params.has('code')) {
          const tokenData = await handleCallback(CLIENT_ID);
          if (tokenData) {
            setToken(tokenData.access_token);
            const userData = await getCurrentUser(tokenData.access_token);
            setUser(userData);
            setLoading(false);
            return;
          }
        }

        // Try stored / refreshed token
        let stored = getStoredToken();
        if (!stored) {
          stored = await refreshAccessToken(CLIENT_ID);
        }
        if (stored) {
          setToken(stored.access_token);
          const userData = await getCurrentUser(stored.access_token);
          setUser(userData);
        }
      } catch (err) {
        console.error('Auth error:', err);
        logout();
      }
      setLoading(false);
    }
    init();
  }, []);

  const handleLogout = () => {
    logout();
    setToken(null);
    setUser(null);
  };

  if (error) {
    return (
      <div className="loading">
        <div className="error-box">
          <h2>⚠️ Configuration Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  if (!token) {
    return <Login clientId={CLIENT_ID} />;
  }

  return (
    <div className="app">
      <Header user={user} onLogout={handleLogout} />
      <CoachExplorer token={token} userId={user?.id} />
    </div>
  );
}

export default App;
