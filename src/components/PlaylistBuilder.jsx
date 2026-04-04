import { useState, useEffect } from 'react';
import allData from '../data/coaches.json';
import { getMergedOverrides } from './ArtistFixer';
import {
  searchArtist as spotifySearchArtist,
  getArtist as spotifyGetArtist,
  getArtistTopTracks,
  getArtistExpandedTracks,
  createPlaylist as spotifyCreatePlaylist,
  addTracksToPlaylist,
} from '../spotify/api';
import {
  searchArtist as ytSearchArtist,
  getArtistTopVideos,
  searchArtistVideos,
  getArtistExpandedVideos,
  createPlaylist as ytCreatePlaylist,
  addVideosToPlaylist,
} from '../youtube/api';

const spotifyOverrides = getMergedOverrides(allData.spotifyOverrides || {});
const youtubeOverrides = allData.youtubeOverrides || {};
const coachMeta = allData.coachMeta || {};

// For band_member coaches, figure out the solo vs band situation
async function resolveCoachArtists(token, coachName, platform) {
  const meta = coachMeta[coachName];

  if (platform === 'youtube') {
    // YouTube: search by name, get channel info
    if (meta?.type === 'band_member') {
      const bandResults = meta.bandName
        ? await ytSearchArtist(token, meta.bandName, youtubeOverrides).catch(() => [])
        : [];
      const band = bandResults?.[0] || null;
      const soloResults = await ytSearchArtist(token, coachName, null).catch(() => []);
      const solo = soloResults?.[0] && soloResults[0].id !== band?.id ? soloResults[0] : null;
      return {
        type: 'band_member', coachName, band, solo,
        bandName: meta.bandName || band?.name || coachName,
        bandFollowers: band?.subscribers || 0,
        soloFollowers: solo?.subscribers || 0,
        autoBlend: band ? 75 : 0,
        blend: band ? 75 : 0,
      };
    }
    const artists = await ytSearchArtist(token, coachName, youtubeOverrides);
    return { type: 'solo', coachName, artist: artists?.[0] || null, band: null, solo: null };
  }

  // Spotify path (unchanged)
  const override = spotifyOverrides[coachName];

  if (meta?.type === 'band_member') {
    let band = null;
    if (override) {
      band = await spotifyGetArtist(token, override).catch(() => null);
    }
    if (!band && meta.bandName) {
      const bandResults = await spotifySearchArtist(token, meta.bandName, spotifyOverrides).catch(() => []);
      band = bandResults?.[0] || null;
    }

    const soloResults = await spotifySearchArtist(token, coachName, null).catch(() => []);
    const solo = soloResults?.[0] && soloResults[0].id !== band?.id ? soloResults[0] : null;

    const bandFollowers = band?.followers?.total || 0;
    const soloFollowers = solo?.followers?.total || 0;

    let autoBlend = band ? 75 : 0;
    if (solo && band && soloFollowers > 0) {
      const ratio = bandFollowers / Math.max(soloFollowers, 1);
      if (ratio > 20) autoBlend = 90;
      else if (ratio > 5) autoBlend = 75;
      else if (ratio > 2) autoBlend = 60;
      else if (ratio > 0.5) autoBlend = 50;
      else autoBlend = 25;
    }

    return {
      type: 'band_member', coachName, band, solo,
      bandName: meta.bandName || band?.name || coachName,
      bandFollowers, soloFollowers, autoBlend, blend: autoBlend,
    };
  }

  const artists = await spotifySearchArtist(token, coachName, spotifyOverrides);
  return { type: 'solo', coachName, artist: artists?.[0] || null, band: null, solo: null };
}

function selectTracks(tracks, artistId, { tracksPerCoach, soloOnly, mixType }) {
  let pool = [...tracks];

  // Always filter out tracks where the primary artist doesn't match
  pool = pool.filter(t => t.artists?.[0]?.id === artistId);

  // Filter out collabs: keep only tracks where the coach is the sole artist
  if (soloOnly) {
    pool = pool.filter(t => t.artists.length === 1);
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

// YouTube equivalent: select videos by view count with artist relevance filtering
function selectVideos(videos, channelId, { tracksPerCoach, mixType, artistName }) {
  let pool = [...videos];

  if (pool.length === 0) return [];

  // Score each video by relevance to the target artist
  const nameLC = (artistName || '').toLowerCase();
  pool = pool.map(v => {
    let score = 0;
    if (channelId && v.channelId === channelId) score += 10;
    if (nameLC && v.channelTitle?.toLowerCase().includes(nameLC)) score += 5;
    if (nameLC && v.title?.toLowerCase().includes(nameLC)) score += 3;
    return { ...v, _relevance: score };
  });

  // Separate into relevant (score > 0) and other videos
  const relevant = pool.filter(v => v._relevance > 0).sort((a, b) => b._relevance - a._relevance);
  const other = pool.filter(v => v._relevance === 0);

  // Prefer relevant videos; only fill from others if needed
  pool = relevant.length >= tracksPerCoach ? relevant : [...relevant, ...other];

  if (mixType === 'top-hits') {
    pool.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    return pool.slice(0, tracksPerCoach);
  }

  if (mixType === 'deep-cuts') {
    pool.sort((a, b) => (a.viewCount ?? 0) - (b.viewCount ?? 0));
    return pool.slice(0, tracksPerCoach);
  }

  // Balanced: mix of high/mid/low view counts
  pool.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  const third = Math.max(1, Math.ceil(tracksPerCoach / 3));
  const top = pool.slice(0, third);
  const mid = pool.slice(Math.floor(pool.length * 0.3), Math.floor(pool.length * 0.3) + third);
  const deep = pool.slice(-third);

  const seen = new Set();
  const result = [];
  for (const v of [...top, ...mid, ...deep]) {
    if (!seen.has(v.id)) { seen.add(v.id); result.push(v); }
  }

  if (result.length < tracksPerCoach) {
    for (const v of pool) {
      if (!seen.has(v.id)) { seen.add(v.id); result.push(v); }
      if (result.length >= tracksPerCoach) break;
    }
  }

  return result.slice(0, tracksPerCoach);
}

const MIX_OPTIONS = [
  { value: 'top-hits',  emoji: '🔥', label: 'Top Hits',  desc: 'Most popular tracks' },
  { value: 'balanced',  emoji: '🎵', label: 'Balanced',  desc: 'Mix of hits + deep cuts' },
  { value: 'deep-cuts', emoji: '💎', label: 'Deep Cuts', desc: 'Lesser-known gems' },
];

const FOLDER_PREFIX = 'Coach Playlist';

function buildDefaultName(coaches, countryName) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const coachLabel = coaches.length <= 3
    ? coaches.join(', ')
    : `${coaches.slice(0, 2).join(', ')} & ${coaches.length - 2} more`;
  return `${today} — ${FOLDER_PREFIX} — ${countryName} — ${coachLabel}`;
}

function PlaylistBuilder({ token, userId, coaches, countryName, onClose, platform }) {
  const [playlistName, setPlaylistName] = useState(() => buildDefaultName(coaches, countryName));
  const [trackMode, setTrackMode] = useState('per-coach');
  const [tracksPerCoach, setTracksPerCoach] = useState(5);
  const [totalTracks, setTotalTracks] = useState(30);
  const [isPublic, setIsPublic] = useState(false);
  const [soloOnly, setSoloOnly] = useState(true);
  const [mixType, setMixType] = useState('balanced');
  const [trackOrder, setTrackOrder] = useState('grouped');
  const [ytMode, setYtMode] = useState('music'); // 'music' or 'video' — YouTube only
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [coachArtists, setCoachArtists] = useState(null);
  const [resolving, setResolving] = useState(false);

  const isYouTube = platform === 'youtube';

  const effectivePerCoach = trackMode === 'total'
    ? Math.max(1, Math.ceil(totalTracks / coaches.length))
    : tracksPerCoach;
  const effectiveTotal = trackMode === 'total' ? totalTracks : null;

  const needsExpanded = mixType !== 'top-hits';

  // Check if any coach is a band_member type
  const hasBandMembers = coaches.some(c => coachMeta[c]?.type === 'band_member');

  // Resolve artists for band members (one-time on mount or when coaches change)
  useEffect(() => {
    if (!hasBandMembers) return;
    let cancelled = false;
    setResolving(true);
    (async () => {
      const resolved = {};
      for (const name of coaches) {
        if (coachMeta[name]?.type === 'band_member') {
          resolved[name] = await resolveCoachArtists(token, name, platform);
        }
      }
      if (!cancelled) {
        setCoachArtists(resolved);
        setResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, coaches, hasBandMembers, platform]);

  const updateBlend = (coachName, blend) => {
    setCoachArtists(prev => ({
      ...prev,
      [coachName]: { ...prev[coachName], blend },
    }));
  };

  const buildPlaylist = async () => {
    setStatus('searching');
    setError(null);

    try {
      const trackBuckets = [];
      const skipped = [];

      if (isYouTube) {
        // ── YouTube flow ──
        for (const coachName of coaches) {
          const resolved = coachArtists?.[coachName];

          if (resolved?.type === 'band_member' && resolved.band) {
            const blend = resolved.blend;
            const bandCount = Math.round(effectivePerCoach * (blend / 100));
            const soloCount = effectivePerCoach - bandCount;

            let bandVideos = [];
            if (bandCount > 0 && resolved.band.id) {
              setProgress(`Loading ${resolved.bandName} videos...`);
              bandVideos = needsExpanded
                ? await getArtistExpandedVideos(token, resolved.band.id, resolved.bandName, ytMode)
                : ytMode === 'video'
                  ? await searchArtistVideos(token, resolved.bandName, bandCount + 5, ytMode)
                  : await getArtistTopVideos(token, resolved.band.id, bandCount + 5, ytMode);
              bandVideos = selectVideos(bandVideos, resolved.band.id, { tracksPerCoach: bandCount, mixType, artistName: resolved.bandName });
            }

            let soloVideos = [];
            if (soloCount > 0 && resolved.solo?.id) {
              setProgress(`Loading ${coachName} solo videos...`);
              soloVideos = needsExpanded
                ? await getArtistExpandedVideos(token, resolved.solo.id, coachName, ytMode)
                : ytMode === 'video'
                  ? await searchArtistVideos(token, coachName, soloCount + 5, ytMode)
                  : await getArtistTopVideos(token, resolved.solo.id, soloCount + 5, ytMode);
              soloVideos = selectVideos(soloVideos, resolved.solo.id, { tracksPerCoach: soloCount, mixType, artistName: coachName });
            }

            const combined = [...bandVideos, ...soloVideos];
            if (combined.length === 0) { skipped.push(coachName); continue; }

            trackBuckets.push({
              artist: coachName,
              tracks: combined.map(v => ({
                id: v.id,
                name: v.title,
                artist: v.channelTitle || resolved.bandName,
                viewCount: v.viewCount || 0,
                thumbnail: v.thumbnail,
              })),
            });
          } else {
            setProgress(`Searching for ${coachName}...`);
            const channels = await ytSearchArtist(token, coachName, youtubeOverrides);
            if (!channels.length) { skipped.push(coachName); continue; }

            const channel = channels[0];
            setProgress(needsExpanded
              ? `Loading discography for ${coachName}...`
              : `Getting top videos for ${coachName}...`);

            const videos = needsExpanded
              ? await getArtistExpandedVideos(token, channel.id, coachName, ytMode)
              : ytMode === 'video'
                ? await searchArtistVideos(token, coachName, effectivePerCoach + 5, ytMode)
                : await getArtistTopVideos(token, channel.id, effectivePerCoach + 5, ytMode);

            const selected = selectVideos(videos, channel.id, { tracksPerCoach: effectivePerCoach, mixType, artistName: coachName });

            trackBuckets.push({
              artist: channel.name || coachName,
              tracks: selected.map(v => ({
                id: v.id,
                name: v.title,
                artist: v.channelTitle || channel.name,
                viewCount: v.viewCount || 0,
                thumbnail: v.thumbnail,
              })),
            });
          }
        }
      } else {
        // ── Spotify flow (unchanged) ──
        for (const coachName of coaches) {
          const resolved = coachArtists?.[coachName];

          if (resolved?.type === 'band_member' && resolved.band) {
            const blend = resolved.blend;
            const bandCount = Math.round(effectivePerCoach * (blend / 100));
            const soloCount = effectivePerCoach - bandCount;

            setProgress(`Loading ${resolved.bandName} tracks...`);

            let bandTracks = [];
            if (bandCount > 0) {
              bandTracks = needsExpanded
                ? await getArtistExpandedTracks(token, resolved.band.id)
                : await getArtistTopTracks(token, resolved.band.id);
              bandTracks = selectTracks(bandTracks, resolved.band.id, {
                tracksPerCoach: bandCount, soloOnly, mixType,
              });
            }

            let soloTracks = [];
            if (soloCount > 0 && resolved.solo) {
              setProgress(`Loading ${coachName} solo tracks...`);
              soloTracks = needsExpanded
                ? await getArtistExpandedTracks(token, resolved.solo.id)
                : await getArtistTopTracks(token, resolved.solo.id);
              soloTracks = selectTracks(soloTracks, resolved.solo.id, {
                tracksPerCoach: soloCount, soloOnly, mixType,
              });
            }

            const combined = [...bandTracks, ...soloTracks];
            if (combined.length === 0) { skipped.push(coachName); continue; }

            trackBuckets.push({
              artist: coachName,
              tracks: combined.map(t => ({
                id: t.id, uri: t.uri, name: t.name,
                artist: t.artists?.[0]?.name || resolved.bandName,
                album: t.album?.name ?? '',
                popularity: t.popularity ?? 0,
              })),
            });
          } else {
            setProgress(`Searching for ${coachName}...`);
            const artists = await spotifySearchArtist(token, coachName, spotifyOverrides);
            if (artists.length === 0) { skipped.push(coachName); continue; }

            const artist = artists[0];
            setProgress(needsExpanded
              ? `Loading discography for ${coachName}...`
              : `Getting top tracks for ${coachName}...`);

            const tracks = needsExpanded
              ? await getArtistExpandedTracks(token, artist.id)
              : await getArtistTopTracks(token, artist.id);

            const selected = selectTracks(tracks, artist.id, {
              tracksPerCoach: effectivePerCoach, soloOnly, mixType,
            });

            trackBuckets.push({
              artist: artist.name,
              tracks: selected.map(t => ({
                id: t.id, uri: t.uri, name: t.name,
                artist: artist.name,
                album: t.album?.name ?? '',
                popularity: t.popularity ?? 0,
              })),
            });
          }
        }
      }

      // Flatten buckets into final track list
      let allTracks;
      if (trackOrder === 'interleaved') {
        allTracks = [];
        const iters = trackBuckets.map(b => b.tracks[Symbol.iterator]());
        let done = false;
        while (!done) {
          done = true;
          for (const it of iters) {
            const next = it.next();
            if (!next.done) { allTracks.push(next.value); done = false; }
          }
        }
      } else {
        allTracks = trackBuckets.flatMap(b => b.tracks);
      }

      if (allTracks.length === 0) {
        throw new Error(`No ${isYouTube ? 'videos' : 'tracks'} found for any selected artist`);
      }

      if (effectiveTotal && allTracks.length > effectiveTotal) {
        allTracks.splice(effectiveTotal);
      }

      setStatus('creating');
      setProgress(`Creating playlist with ${allTracks.length} ${isYouTube ? 'songs' : 'tracks'}...`);

      const mixLabel = MIX_OPTIONS.find(m => m.value === mixType)?.label ?? '';
      const desc = `${mixLabel} mix — ${coaches.join(', ')} · Generated by Coach Playlist Generator`;

      if (isYouTube) {
        const playlist = await ytCreatePlaylist(token, playlistName, desc, isPublic);
        await addVideosToPlaylist(token, playlist.id, allTracks.map(t => t.id));
        setResult({
          playlist,
          tracks: allTracks,
          skipped,
          url: ytMode === 'music' ? playlist.musicUrl : playlist.url,
          altUrl: ytMode === 'music' ? playlist.url : playlist.musicUrl,
          primaryLabel: ytMode === 'music' ? 'Open in YouTube Music' : 'Open in YouTube',
          altLabel: ytMode === 'music' ? 'Also on YouTube' : 'Also on YouTube Music',
        });
      } else {
        const playlist = await spotifyCreatePlaylist(token, userId, playlistName, desc, isPublic);
        await addTracksToPlaylist(token, playlist.id, allTracks.map(t => t.uri));
        setResult({
          playlist,
          tracks: allTracks,
          skipped,
          url: playlist.external_urls.spotify,
          primaryLabel: 'Open in Spotify',
        });
      }
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

            {/* YouTube mode selector */}
            {isYouTube && (
              <div className="form-group">
                <span className="form-label">Playlist Type</span>
                <div className="yt-mode-toggle">
                  <button
                    className={`yt-mode-btn ${ytMode === 'music' ? 'active' : ''}`}
                    onClick={() => setYtMode('music')}
                  >🎵 Music Playlist</button>
                  <button
                    className={`yt-mode-btn ${ytMode === 'video' ? 'active' : ''}`}
                    onClick={() => setYtMode('video')}
                  >🎬 Video Playlist</button>
                </div>
                <span className="note">
                  {ytMode === 'music'
                    ? 'Audio tracks — best for YouTube Music'
                    : 'Music videos — best for YouTube'}
                </span>
              </div>
            )}

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

            {!isYouTube && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={soloOnly}
                  onChange={e => setSoloOnly(e.target.checked)}
                />
                Solo tracks only (no features / collabs)
              </label>
            )}

            <div className="order-toggle">
              <span className="order-label">Track order</span>
              <div className="order-options">
                <button
                  className={`order-btn ${trackOrder === 'grouped' ? 'active' : ''}`}
                  onClick={() => setTrackOrder('grouped')}
                >📦 Grouped</button>
                <button
                  className={`order-btn ${trackOrder === 'interleaved' ? 'active' : ''}`}
                  onClick={() => setTrackOrder('interleaved')}
                >🔀 Alternating</button>
              </div>
            </div>

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

            {/* Band blend controls */}
            {hasBandMembers && coachArtists && (
              <div className="blend-section">
                <span className="form-label">🎸 Solo vs Band Blend</span>
                {coaches.filter(c => coachArtists[c]?.type === 'band_member').map(c => {
                  const r = coachArtists[c];
                  if (!r) return null;
                  const bandPct = r.blend;
                  const soloPct = 100 - bandPct;
                  return (
                    <div key={c} className="blend-row">
                      <div className="blend-header">
                        <span className="blend-coach">{c}</span>
                        <span className="blend-label">
                          {bandPct === 100 ? `100% ${r.bandName}` :
                           bandPct === 0 ? '100% Solo' :
                           `${soloPct}% Solo · ${bandPct}% ${r.bandName}`}
                        </span>
                      </div>
                      <div className="blend-control">
                        <span className="blend-end">Solo{r.solo ? ` (${(r.soloFollowers/1000).toFixed(0)}K)` : ''}</span>
                        <input
                          type="range" min={0} max={100} step={10}
                          value={bandPct}
                          onChange={e => updateBlend(c, +e.target.value)}
                        />
                        <span className="blend-end">{r.bandName} ({(r.bandFollowers/1000).toFixed(0)}K)</span>
                      </div>
                      <div className="blend-hint">
                        Auto: {r.autoBlend}% band ({r.bandFollowers > r.soloFollowers * 10 ? 'band much bigger' :
                          r.bandFollowers > r.soloFollowers * 2 ? 'band bigger' : 'comparable'})
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {resolving && <p className="note">Loading band info...</p>}

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
            <p><strong>{result.playlist.name || result.playlist.title}</strong></p>
            <p>{result.tracks.length} {isYouTube ? 'songs' : 'tracks'} added</p>
            {result.skipped.length > 0 && (
              <p className="skipped-note">
                ⚠️ Could not find: {result.skipped.join(', ')}
              </p>
            )}
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className={isYouTube ? 'yt-link' : 'spotify-link'}
            >
              {result.primaryLabel} →
            </a>
            {result.altUrl && (
              <a
                href={result.altUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="alt-link"
              >
                {result.altLabel} →
              </a>
            )}
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
