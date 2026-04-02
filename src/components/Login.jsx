import { redirectToGoogle } from '../youtube/auth';
import { redirectToSpotify } from '../spotify/auth';

function Login({ googleClientId, spotifyClientId }) {
  return (
    <div className="login">
      <h1>🎤 Coach Playlist Generator</h1>
      <p className="subtitle">
        Explore the music of singing competition coaches across 36 countries
        and create playlists from your favorites
      </p>
      <button className="login-btn login-btn-google" onClick={() => redirectToGoogle(googleClientId)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.35 11.1h-9.18v2.73h5.51c-.5 2.52-2.63 3.87-5.51 3.87-3.37 0-6.11-2.74-6.11-6.11s2.74-6.11 6.11-6.11c1.55 0 2.95.57 4.03 1.51l2.06-2.06C16.42 3.27 14.35 2.39 12.17 2.39 7 2.39 2.78 6.61 2.78 11.78s4.22 9.39 9.39 9.39c5.42 0 9-3.82 9-9.2 0-.62-.07-1.22-.18-1.8l-.64-.07z"/>
        </svg>
        Sign in with Google
      </button>
      <p className="login-hint">Creates playlists in YouTube & YouTube Music</p>
      {spotifyClientId && (
        <a href="#admin" className="login-admin-link">Admin access →</a>
      )}
    </div>
  );
}

export default Login;
