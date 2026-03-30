import { useState, useEffect } from 'react';
import { getStoredToken, handleCallback, refreshAccessToken, logout } from './spotify/auth';
import { getCurrentUser } from './spotify/api';
import Login from './components/Login';
import Header from './components/Header';
import CoachExplorer from './components/CoachExplorer';
import CoachVerifier from './components/CoachVerifier';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const GH_PAT_KEY = 'voiceExplorer_githubPat';
const ADMIN_OWNER = 'brunonowak';

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}

async function verifyGitHubAdmin(pat) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${pat}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user.login?.toLowerCase() === ADMIN_OWNER.toLowerCase() ? user : null;
  } catch { return null; }
}

function AdminGate({ children }) {
  const [status, setStatus] = useState('checking'); // checking | prompt | authorized | denied
  const [patInput, setPatInput] = useState('');
  const [ghUser, setGhUser] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem(GH_PAT_KEY);
    if (stored) {
      verifyGitHubAdmin(stored).then(user => {
        if (user) { setGhUser(user); setStatus('authorized'); }
        else { localStorage.removeItem(GH_PAT_KEY); setStatus('prompt'); }
      });
    } else {
      setStatus('prompt');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('checking');
    const user = await verifyGitHubAdmin(patInput.trim());
    if (user) {
      localStorage.setItem(GH_PAT_KEY, patInput.trim());
      setGhUser(user);
      setStatus('authorized');
    } else {
      setStatus('denied');
    }
  };

  if (status === 'checking') return <div className="loading"><div className="spinner" /></div>;

  if (status === 'authorized') return children;

  return (
    <div className="admin-gate">
      <h2>🔐 Admin Access</h2>
      <p>Enter your GitHub Personal Access Token to access admin tools.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={patInput}
          onChange={e => setPatInput(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxx"
          className="admin-pat-input"
        />
        <button type="submit" className="admin-pat-btn">Verify</button>
      </form>
      {status === 'denied' && <p className="admin-error">Access denied. Token invalid or not authorized.</p>}
      <a href="#" className="admin-back">← Back to app</a>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const hash = useHashRoute();
  const isAdmin = hash === '#admin';

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
      <Header user={user} onLogout={handleLogout} isAdmin={isAdmin} />
      {isAdmin ? (
        <AdminGate>
          <CoachVerifier token={token} onClose={() => { window.location.hash = ''; }} />
        </AdminGate>
      ) : (
        <CoachExplorer token={token} userId={user?.id} />
      )}
    </div>
  );
}

export default App;
