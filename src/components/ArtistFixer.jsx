import { useState } from 'react';
import { searchArtist } from '../spotify/api';

const STORAGE_KEY = 'voiceExplorer_artistOverrides';
const GH_PAT_KEY = 'voiceExplorer_githubPat';
const REPO_OWNER = 'brunonowak';
const REPO_NAME = 'voice-explorer';
const FILE_PATH = 'src/data/coaches.json';

// Load overrides from localStorage
export function getLocalOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { return {}; }
}

// Merge JSON overrides + localStorage overrides (local wins)
export function getMergedOverrides(jsonOverrides) {
  return { ...jsonOverrides, ...getLocalOverrides() };
}

function getGithubPat() {
  return localStorage.getItem(GH_PAT_KEY) || '';
}

// Fetch file from GitHub, update spotifyOverrides, commit back
async function commitOverrideToGitHub(coachName, spotifyId) {
  const pat = getGithubPat();
  if (!pat) throw new Error('No GitHub PAT configured');

  const headers = {
    Authorization: `token ${pat}`,
    Accept: 'application/vnd.github.v3+json',
  };
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;

  // Get current file
  const fileRes = await fetch(apiUrl, { headers });
  if (!fileRes.ok) throw new Error(`GitHub GET failed: ${fileRes.status}`);
  const fileData = await fileRes.json();

  // Decode base64 → UTF-8 (atob can't handle multi-byte chars like emoji flags)
  const raw = atob(fileData.content);
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const content = JSON.parse(new TextDecoder().decode(bytes));

  // Update spotifyOverrides
  if (!content.spotifyOverrides) content.spotifyOverrides = {};
  content.spotifyOverrides[coachName] = spotifyId;

  // Sort overrides alphabetically for tidiness
  const sorted = {};
  Object.keys(content.spotifyOverrides).sort().forEach(k => {
    sorted[k] = content.spotifyOverrides[k];
  });
  content.spotifyOverrides = sorted;

  // Encode as UTF-8 base64 (btoa can't handle multi-byte chars like emoji flags)
  const jsonStr = JSON.stringify(content, null, 2) + '\n';
  const encBytes = new TextEncoder().encode(jsonStr);
  const binStr = Array.from(encBytes, b => String.fromCharCode(b)).join('');
  const base64Content = btoa(binStr);

  // Commit
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Fix Spotify match: ${coachName} → ${spotifyId}`,
      content: base64Content,
      sha: fileData.sha,
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `GitHub PUT failed: ${putRes.status}`);
  }

  return putRes.json();
}

function ArtistFixer({ token, coachName, onClose }) {
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState(coachName);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [pat, setPat] = useState(getGithubPat());
  const [showPatInput, setShowPatInput] = useState(!getGithubPat());

  const doSearch = async (q) => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const artists = await searchArtist(token, q, null);
      setResults(artists.slice(0, 8));
    } catch { setResults([]); }
    setSearching(false);
  };

  const savePat = () => {
    localStorage.setItem(GH_PAT_KEY, pat.trim());
    setShowPatInput(false);
  };

  const pickArtist = async (artist) => {
    setError(null);

    // Always save to localStorage immediately (works without GitHub)
    const overrides = getLocalOverrides();
    overrides[coachName] = artist.id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));

    // Try to commit to GitHub
    const ghPat = getGithubPat();
    if (ghPat) {
      setSaving(true);
      try {
        await commitOverrideToGitHub(coachName, artist.id);
        setSaved({ ...artist, committed: true });
      } catch (err) {
        setSaved({ ...artist, committed: false });
        setError(`GitHub commit failed: ${err.message}. Saved locally only.`);
      }
      setSaving(false);
    } else {
      setSaved({ ...artist, committed: false });
    }
  };

  const currentOverride = getLocalOverrides()[coachName];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fixer-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>🔧 Fix: {coachName}</h2>

        {/* GitHub PAT setup */}
        {showPatInput ? (
          <div className="fixer-pat-section">
            <p className="fixer-hint">Enter your GitHub PAT to auto-commit fixes to the repo:</p>
            <div className="fixer-search">
              <input
                type="password"
                value={pat}
                onChange={e => setPat(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && savePat()}
                placeholder="ghp_xxxxxxxxxxxx"
              />
              <button onClick={savePat}>💾</button>
            </div>
          </div>
        ) : (
          <div className="fixer-pat-connected">
            🔗 GitHub connected
            <button className="fixer-clear-btn" onClick={() => setShowPatInput(true)}>Change PAT</button>
          </div>
        )}

        {saving && (
          <div className="fixer-saving">⏳ Committing to GitHub...</div>
        )}

        {saved && (
          <div className="fixer-saved">
            {saved.committed
              ? <>✅ Committed! <strong>{saved.name}</strong> — auto-deploying now.</>
              : <>💾 Saved locally! <strong>{saved.name}</strong></>
            }
            <p className="fixer-hint">
              {saved.committed
                ? 'GitHub Actions will deploy in ~2 min. Reload to see updated photo.'
                : 'Reload to see updated photo. Add a GitHub PAT to auto-commit.'
              }
            </p>
          </div>
        )}

        {error && <div className="fixer-error">{error}</div>}

        <div className="fixer-search">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch(query)}
            placeholder="Search Spotify artists..."
          />
          <button onClick={() => doSearch(query)} disabled={searching}>
            {searching ? '...' : '🔍'}
          </button>
        </div>

        {results.length === 0 && !searching && (
          <p className="fixer-hint">Search for the correct artist, then click to select.</p>
        )}

        <div className="fixer-results">
          {results.map(artist => (
            <div
              key={artist.id}
              className={`fixer-artist ${currentOverride === artist.id ? 'active' : ''}`}
              onClick={() => !saving && pickArtist(artist)}
            >
              {artist.images?.[2]?.url || artist.images?.[0]?.url ? (
                <img src={artist.images[2]?.url || artist.images[0]?.url} alt="" className="fixer-photo" />
              ) : (
                <div className="fixer-photo-placeholder">🎤</div>
              )}
              <div className="fixer-info">
                <span className="fixer-name">{artist.name}</span>
                <span className="fixer-meta">
                  {artist.followers?.total?.toLocaleString()} followers
                  {artist.genres?.length > 0 && ` · ${artist.genres.slice(0, 2).join(', ')}`}
                </span>
              </div>
              <span className="fixer-id">{artist.id.slice(0, 8)}…</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ArtistFixer;
