const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const REDIRECT_URI = window.location.origin + BASE_PATH + '/callback';
const SCOPES = [
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-private',
  'user-read-email',
].join(' ');

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (x) => possible[x % possible.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function redirectToSpotify(clientId) {
  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlEncode(hashed);

  sessionStorage.setItem('code_verifier', codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
  });

  window.location.href = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

export async function handleCallback(clientId) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) throw new Error(`Spotify auth error: ${error}`);
  if (!code) return null;

  const codeVerifier = sessionStorage.getItem('code_verifier');
  if (!codeVerifier) throw new Error('Missing code verifier');

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) throw new Error('Failed to exchange code for token');

  const data = await response.json();
  const tokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  localStorage.setItem('spotify_token', JSON.stringify(tokenData));
  sessionStorage.removeItem('code_verifier');
  window.history.replaceState({}, document.title, window.location.origin + BASE_PATH + '/');

  return tokenData;
}

export async function refreshAccessToken(clientId) {
  const stored = JSON.parse(localStorage.getItem('spotify_token') || 'null');
  if (!stored?.refresh_token) return null;

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const tokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || stored.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  localStorage.setItem('spotify_token', JSON.stringify(tokenData));
  return tokenData;
}

export function getStoredToken() {
  const stored = JSON.parse(localStorage.getItem('spotify_token') || 'null');
  if (!stored) return null;
  if (Date.now() > stored.expires_at - 60000) return null;
  return stored;
}

export function logout() {
  localStorage.removeItem('spotify_token');
  sessionStorage.removeItem('code_verifier');
}
