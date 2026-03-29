import { useState } from 'react';
import { searchArtist } from '../spotify/api';

const STORAGE_KEY = 'voiceExplorer_artistOverrides';

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

function ArtistFixer({ token, coachName, onClose }) {
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState(coachName);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState(null);

  const doSearch = async (q) => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      // Always do a raw search (no overrides) so we see what Spotify returns
      const artists = await searchArtist(token, q, null);
      setResults(artists.slice(0, 8));
    } catch { setResults([]); }
    setSearching(false);
  };

  const pickArtist = (artist) => {
    const overrides = getLocalOverrides();
    overrides[coachName] = artist.id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    setSaved(artist);
  };

  const clearOverride = () => {
    const overrides = getLocalOverrides();
    delete overrides[coachName];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    setSaved(null);
  };

  const currentOverride = getLocalOverrides()[coachName];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fixer-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>🔧 Fix: {coachName}</h2>

        {currentOverride && !saved && (
          <div className="fixer-current">
            ✅ Override active: <code>{currentOverride}</code>
            <button className="fixer-clear-btn" onClick={clearOverride}>Remove override</button>
          </div>
        )}

        {saved && (
          <div className="fixer-saved">
            ✅ Saved! <strong>{saved.name}</strong> (ID: {saved.id})
            <p className="fixer-hint">Reload the page to see the updated photo & tracks.</p>
          </div>
        )}

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
              onClick={() => pickArtist(artist)}
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

        <div className="fixer-export-section">
          <ExportButton />
        </div>
      </div>
    </div>
  );
}

function ExportButton() {
  const [copied, setCopied] = useState(false);
  const overrides = getLocalOverrides();
  const count = Object.keys(overrides).length;

  if (count === 0) return null;

  const doExport = () => {
    const json = JSON.stringify(overrides, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button className="fixer-export-btn" onClick={doExport}>
      {copied ? '✅ Copied!' : `📋 Export ${count} override${count > 1 ? 's' : ''} (JSON)`}
    </button>
  );
}

export default ArtistFixer;
