import { useState } from 'react';
import {
  searchArtist,
  getArtistTopTracks,
  getArtistExpandedTracks,
  createPlaylist,
  addTracksToPlaylist,
} from '../spotify/api';

function selectTracks(tracks, artistId, { tracksPerCoach, soloOnly, mixType }) {
  let pool = [...tracks];

  // Filter out collabs: keep only tracks where the coach is the sole artist
  if (soloOnly) {
    pool = pool.filter(t => t.artists.length === 1 || t.artists.every(a => a.id === artistId));
  }

  if (pool.length === 0) return [];

  if (mixType === 'top-hits') {
    pool.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return pool.slice(0, tracksPerCoach);
  }

  if (mixType === 'deep-cuts') {
    pool.sort((a, b) => (a.popularity ?? 0) - (b.popularity ?? 0));
    return pool.slice(0, tracksPerCoach);
  }

  // Balanced: ~1/3 popular, ~1/3 mid-range, ~1/3 deep
  const popular = pool.filter(t => (t.popularity ?? 0) >= 65).sort((a, b) => b.popularity - a.popularity);
  const mid = pool.filter(t => (t.popularity ?? 0) >= 35 && (t.popularity ?? 0) < 65);
  const deep = pool.filter(t => (t.popularity ?? 0) < 35).sort((a, b) => a.popularity - b.popularity);

  const third = Math.max(1, Math.ceil(tracksPerCoach / 3));
  const result = [
    ...popular.slice(0, third),
    ...mid.slice(0, third),
    ...deep.slice(0, tracksPerCoach - Math.min(popular.length, third) - Math.min(mid.length, third)),
  ];

  // Fill any remaining slots from the full pool
  if (result.length < tracksPerCoach) {
    const usedIds = new Set(result.map(t => t.id));
    const remaining = pool.filter(t => !usedIds.has(t.id));
    result.push(...remaining.slice(0, tracksPerCoach - result.length));
  }

  return result.slice(0, tracksPerCoach);
}

const MIX_OPTIONS = [
  { value: 'top-hits',  emoji: '🔥', label: 'Top Hits',  desc: 'Most popular tracks' },
  { value: 'balanced',  emoji: '🎵', label: 'Balanced',  desc: 'Mix of hits + deep cuts' },
  { value: 'deep-cuts', emoji: '💎', label: 'Deep Cuts', desc: 'Lesser-known gems' },
];

const FOLDER_PREFIX = 'The Voice Coaches Exploration';

function buildDefaultName(coaches, countryName) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const coachLabel = coaches.length <= 3
    ? coaches.join(', ')
    : `${coaches.slice(0, 2).join(', ')} & ${coaches.length - 2} more`;
  return `${today} — ${FOLDER_PREFIX} — ${countryName} — ${coachLabel}`;
}

function PlaylistBuilder({ token, userId, coaches, countryName, onClose }) {
  const [playlistName, setPlaylistName] = useState(() => buildDefaultName(coaches, countryName));
  const [trackMode, setTrackMode] = useState('per-coach'); // 'per-coach' or 'total'
  const [tracksPerCoach, setTracksPerCoach] = useState(5);
  const [totalTracks, setTotalTracks] = useState(30);
  const [isPublic, setIsPublic] = useState(false);
  const [soloOnly, setSoloOnly] = useState(true);
  const [mixType, setMixType] = useState('balanced');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const effectivePerCoach = trackMode === 'total'
    ? Math.max(1, Math.ceil(totalTracks / coaches.length))
    : tracksPerCoach;
  const effectiveTotal = trackMode === 'total' ? totalTracks : null;

  const needsExpanded = mixType !== 'top-hits';

  const buildPlaylist = async () => {
    setStatus('searching');
    setError(null);

    try {
      const allTracks = [];
      const skipped = [];

      for (const coachName of coaches) {
        setProgress(`Searching for ${coachName}...`);
        const artists = await searchArtist(token, coachName);

        if (artists.length === 0) {
          skipped.push(coachName);
          continue;
        }

        const artist = artists[0];

        setProgress(
          needsExpanded
            ? `Loading discography for ${coachName}...`
            : `Getting top tracks for ${coachName}...`
        );

        const tracks = needsExpanded
          ? await getArtistExpandedTracks(token, artist.id)
          : await getArtistTopTracks(token, artist.id);

        const selected = selectTracks(tracks, artist.id, {
          tracksPerCoach: effectivePerCoach,
          soloOnly,
          mixType,
        });

        allTracks.push(
          ...selected.map(t => ({
            uri: t.uri,
            name: t.name,
            artist: artist.name,
            album: t.album?.name ?? '',
            popularity: t.popularity ?? 0,
          }))
        );
      }

      if (allTracks.length === 0) {
        throw new Error('No tracks found for any selected coach');
      }

      // Trim to total if using total mode
      if (effectiveTotal && allTracks.length > effectiveTotal) {
        allTracks.splice(effectiveTotal);
      }

      setStatus('creating');
      setProgress(`Creating playlist with ${allTracks.length} tracks...`);

      const mixLabel = MIX_OPTIONS.find(m => m.value === mixType)?.label ?? '';
      const playlist = await createPlaylist(
        token,
        userId,
        playlistName,
        `${mixLabel} mix — ${coaches.join(', ')} · Generated by Voice Explorer`,
        isPublic
      );

      await addTracksToPlaylist(token, playlist.id, allTracks.map(t => t.uri));

      setResult({
        playlist,
        tracks: allTracks,
        skipped,
        url: playlist.external_urls.spotify,
      });
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>Build Playlist</h2>

        {status === 'idle' && (
          <div className="playlist-form">
            <label>
              Playlist Name
              <input
                type="text"
                value={playlistName}
                onChange={e => setPlaylistName(e.target.value)}
              />
            </label>

            <div className="form-group">
              <span className="form-label">Playlist Size</span>
              <div className="track-mode-toggle">
                <button
                  className={`toggle-btn ${trackMode === 'per-coach' ? 'active' : ''}`}
                  onClick={() => setTrackMode('per-coach')}
                >Per Coach</button>
                <button
                  className={`toggle-btn ${trackMode === 'total' ? 'active' : ''}`}
                  onClick={() => setTrackMode('total')}
                >Total Tracks</button>
              </div>
            </div>

            {trackMode === 'per-coach' ? (
              <label>
                Tracks per Coach: {tracksPerCoach}
                <input
                  type="range" min={1} max={10}
                  value={tracksPerCoach}
                  onChange={e => setTracksPerCoach(+e.target.value)}
                />
              </label>
            ) : (
              <label>
                Total Tracks: {totalTracks}
                <input
                  type="range" min={5} max={100} step={5}
                  value={totalTracks}
                  onChange={e => setTotalTracks(+e.target.value)}
                />
                <span className="note">~{effectivePerCoach} per coach</span>
              </label>
            )}

            <div className="form-group">
              <span className="form-label">Mix Type</span>
              <div className="mix-options">
                {MIX_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`mix-option ${mixType === opt.value ? 'active' : ''}`}
                    onClick={() => setMixType(opt.value)}
                  >
                    <span className="mix-emoji">{opt.emoji}</span>
                    <span className="mix-label">{opt.label}</span>
                    <span className="mix-desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={soloOnly}
                onChange={e => setSoloOnly(e.target.checked)}
              />
              Solo tracks only (no features / collabs)
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={e => setIsPublic(e.target.checked)}
              />
              Make playlist public
            </label>

            <p className="track-estimate">
              {trackMode === 'total'
                ? `${totalTracks} tracks from ${coaches.length} coach${coaches.length > 1 ? 'es' : ''}`
                : `~${coaches.length * tracksPerCoach} tracks from ${coaches.length} coach${coaches.length > 1 ? 'es' : ''}`
              }
              {needsExpanded && <span className="note"> · Will scan discographies — may take a moment</span>}
            </p>

            <div className="coach-list">
              {coaches.map(c => <span key={c} className="coach-tag">{c}</span>)}
            </div>

            <button className="create-btn" onClick={buildPlaylist}>
              Create Playlist
            </button>
          </div>
        )}

        {(status === 'searching' || status === 'creating') && (
          <div className="playlist-progress">
            <div className="spinner" />
            <p>{progress}</p>
          </div>
        )}

        {status === 'done' && result && (
          <div className="playlist-done">
            <h3>✅ Playlist Created!</h3>
            <p><strong>{result.playlist.name}</strong></p>
            <p>{result.tracks.length} tracks added</p>
            {result.skipped.length > 0 && (
              <p className="skipped-note">
                ⚠️ Could not find: {result.skipped.join(', ')}
              </p>
            )}
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="spotify-link"
            >
              Open in Spotify →
            </a>
          </div>
        )}

        {status === 'error' && (
          <div className="playlist-error">
            <h3>❌ Error</h3>
            <p>{error}</p>
            <button onClick={() => setStatus('idle')}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default PlaylistBuilder;
