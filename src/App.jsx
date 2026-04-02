import { useState, useEffect } from 'react';
import { getStoredToken, handleCallback, refreshAccessToken, logout } from './spotify/auth';
import { getCurrentUser } from './spotify/api';
import { getStoredGoogleToken, handleGoogleCallback, refreshGoogleToken, logoutGoogle } from './youtube/auth';
import { getMyChannel } from './youtube/api';
import Login from './components/Login';
import Header from './components/Header';
import CoachExplorer from './components/CoachExplorer';
import CoachVerifier from './components/CoachVerifier';

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '444afa8729db4132bc8323cbc80b3535';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '903410397056-vahckgaijopf0hpt4ti9forb5b86v2dh.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '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';
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
  const [platform, setPlatform] = useState(null); // 'youtube' | 'spotify'
  const [spotifyToken, setSpotifyToken] = useState(null); // admin-only Spotify token
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const hash = useHashRoute();
  const isAdmin = hash === '#admin';

  useEffect(() => {
    async function init() {
      if (!GOOGLE_CLIENT_ID) {
        setError('Missing VITE_GOOGLE_CLIENT_ID. Create a .env file with your Google Client ID.');
        setLoading(false);
        return;
      }

      try {
        // Handle GitHub Pages SPA redirect from 404.html
        const params = new URLSearchParams(window.location.search);
        if (params.has('__redirect')) {
          const redirected = new URL(decodeURIComponent(params.get('__redirect')), window.location.origin);
          const redirectParams = new URLSearchParams(redirected.search);
          const cleanUrl = window.location.origin + window.location.pathname +
            (redirectParams.toString() ? '?' + redirectParams.toString() : '');
          window.history.replaceState({}, '', cleanUrl);
          const newParams = new URLSearchParams(window.location.search);
          if (newParams.has('code')) {
            const rdScope = newParams.get('scope') || '';
            const provider = sessionStorage.getItem('oauth_provider')
              || (rdScope.includes('googleapis.com') || rdScope.includes('youtube') ? 'google' : 'spotify');
            if (provider === 'google') {
              const tokenData = await handleGoogleCallback(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
              if (tokenData) {
                setToken(tokenData.access_token);
                setPlatform('youtube');
                const channel = await getMyChannel(tokenData.access_token);
                setUser(channel ? { display_name: channel.snippet.title, id: channel.id, image: channel.snippet.thumbnails?.default?.url } : null);
                setLoading(false);
                return;
              }
            } else {
              // Spotify callback (admin flow)
              if (SPOTIFY_CLIENT_ID) {
                const tokenData = await handleCallback(SPOTIFY_CLIENT_ID);
                if (tokenData) {
                  setSpotifyToken(tokenData.access_token);
                  setToken(tokenData.access_token);
                  setPlatform('spotify');
                  const userData = await getCurrentUser(tokenData.access_token);
                  setUser(userData);
                  setLoading(false);
                  return;
                }
              }
            }
          }
        }

        // Handle direct OAuth callback
        if (params.has('code')) {
          // Detect provider: Google includes scope with googleapis.com
          const scope = params.get('scope') || '';
          const provider = sessionStorage.getItem('oauth_provider')
            || (scope.includes('googleapis.com') || scope.includes('youtube') ? 'google' : 'spotify');

          if (provider === 'google') {
            try {
              const tokenData = await handleGoogleCallback(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
              if (tokenData) {
                setToken(tokenData.access_token);
                setPlatform('youtube');
                const channel = await getMyChannel(tokenData.access_token);
                setUser(channel ? { display_name: channel.snippet.title, id: channel.id, image: channel.snippet.thumbnails?.default?.url } : null);
                setLoading(false);
                return;
              }
            } catch (err) {
              console.error('Google token exchange failed:', err);
              setError(`Google login failed: ${err.message}`);
              setLoading(false);
              return;
            }
          } else if (SPOTIFY_CLIENT_ID) {
            const tokenData = await handleCallback(SPOTIFY_CLIENT_ID);
            if (tokenData) {
              setSpotifyToken(tokenData.access_token);
              setToken(tokenData.access_token);
              setPlatform('spotify');
              const userData = await getCurrentUser(tokenData.access_token);
              setUser(userData);
              setLoading(false);
              return;
            }
          }
        }

        // Try stored Google token first (public flow)
        let googleStored = getStoredGoogleToken();
        if (!googleStored) {
          googleStored = await refreshGoogleToken(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
        }
        if (googleStored) {
          setToken(googleStored.access_token);
          setPlatform('youtube');
          const channel = await getMyChannel(googleStored.access_token);
          setUser(channel ? { display_name: channel.snippet.title, id: channel.id, image: channel.snippet.thumbnails?.default?.url } : null);
          setLoading(false);
          return;
        }

        // Try stored Spotify token (admin flow)
        if (SPOTIFY_CLIENT_ID) {
          let spotifyStored = getStoredToken();
          if (!spotifyStored) {
            spotifyStored = await refreshAccessToken(SPOTIFY_CLIENT_ID);
          }
          if (spotifyStored) {
            setSpotifyToken(spotifyStored.access_token);
            setToken(spotifyStored.access_token);
            setPlatform('spotify');
            const userData = await getCurrentUser(spotifyStored.access_token);
            setUser(userData);
          }
        }
      } catch (err) {
        console.error('Auth error:', err);
        // Only clear the failing provider's token, not both
        if (sessionStorage.getItem('oauth_provider') === 'google') {
          logoutGoogle();
        } else {
          logout();
        }
      }
      setLoading(false);
    }
    init();
  }, []);

  const handleLogout = () => {
    if (platform === 'youtube') {
      logoutGoogle();
    } else {
      logout();
    }
    setToken(null);
    setSpotifyToken(null);
    setUser(null);
    setPlatform(null);
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
    return <Login googleClientId={GOOGLE_CLIENT_ID} spotifyClientId={SPOTIFY_CLIENT_ID} />;
  }

  return (
    <div className="app">
      <Header user={user} onLogout={handleLogout} isAdmin={isAdmin} platform={platform} />
      {isAdmin ? (
        <AdminGate>
          <CoachVerifier token={spotifyToken || token} onClose={() => { window.location.hash = ''; }} />
        </AdminGate>
      ) : (
        <CoachExplorer token={token} userId={user?.id} platform={platform} />
      )}
    </div>
  );
}

export default App;
