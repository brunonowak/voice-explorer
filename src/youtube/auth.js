const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
// Use base URL directly (not /callback) to avoid GitHub Pages 404.html hop
const REDIRECT_URI = window.location.origin + BASE_PATH + '/';
const SCOPES = 'https://www.googleapis.com/auth/youtube';

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

export async function redirectToGoogle(clientId) {
  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlEncode(hashed);

  sessionStorage.setItem('google_code_verifier', codeVerifier);
  // Mark that this is a Google OAuth flow (not Spotify)
  sessionStorage.setItem('oauth_provider', 'google');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
    access_type: 'offline',
    prompt: 'consent',
  });

  window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function handleGoogleCallback(clientId, clientSecret) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) throw new Error(`Google auth error: ${error}`);
  if (!code) return null;

  const codeVerifier = sessionStorage.getItem('google_code_verifier');
  if (!codeVerifier) return null; // Not a Google callback

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error_description || 'Failed to exchange Google code for token');
  }

  const data = await response.json();
  const tokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  localStorage.setItem('google_token', JSON.stringify(tokenData));
  sessionStorage.removeItem('google_code_verifier');
  sessionStorage.removeItem('oauth_provider');
  window.history.replaceState({}, document.title, window.location.origin + BASE_PATH + '/');

  return tokenData;
}

export async function refreshGoogleToken(clientId, clientSecret) {
  const stored = JSON.parse(localStorage.getItem('google_token') || 'null');
  if (!stored?.refresh_token) return null;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
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

  localStorage.setItem('google_token', JSON.stringify(tokenData));
  return tokenData;
}

export function getStoredGoogleToken() {
  const stored = JSON.parse(localStorage.getItem('google_token') || 'null');
  if (!stored) return null;
  if (Date.now() > stored.expires_at - 60000) return null;
  return stored;
}

export function logoutGoogle() {
  localStorage.removeItem('google_token');
  sessionStorage.removeItem('google_code_verifier');
  sessionStorage.removeItem('oauth_provider');
}
