import { useState, useMemo, useEffect, useCallback } from 'react';
import allData from '../data/coaches.json';
import PlaylistBuilder from './PlaylistBuilder';
import CoachTimeline from './CoachTimeline';
import CoachDetail from './CoachDetail';
import ArtistFixer, { getMergedOverrides } from './ArtistFixer';
import { searchArtist } from '../spotify/api';

const jsonOverrides = allData.spotifyOverrides || {};
const jsonCoachMeta = allData.coachMeta || {};
const countryCodes = Object.keys(allData).filter(k => !['spotifyOverrides', 'coachMeta', 'seasonStatus'].includes(k));

// Merge JSON coachMeta with localStorage overrides
function getMergedCoachMeta() {
  let localMeta = {};
  try { localMeta = JSON.parse(localStorage.getItem('voiceExplorer_coachMeta') || '{}'); } catch {}
  const merged = { ...jsonCoachMeta };
  for (const [name, meta] of Object.entries(localMeta)) {
    merged[name] = { ...(merged[name] || {}), ...meta };
  }
  return merged;
}
const coachMeta = getMergedCoachMeta();

// Global cache so we don't re-fetch across country switches
const artistCache = new Map();

const isDevMode = new URLSearchParams(window.location.search).has('dev');

function CoachExplorer({ token, userId }) {
  const [mode, setMode] = useState('single'); // 'single' or 'clash'
  const [countryCode, setCountryCode] = useState('US');
  const [clashCountries, setClashCountries] = useState(new Set());
  const [selectedCoaches, setSelectedCoaches] = useState(new Set());
  const [seasonRange, setSeasonRange] = useState([1, 1]);
  const [showPlaylistBuilder, setShowPlaylistBuilder] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [detailCoach, setDetailCoach] = useState(null);
  const [fixCoach, setFixCoach] = useState(null);
  const [artistPhotos, setArtistPhotos] = useState({});

  const spotifyOverrides = useMemo(() => getMergedOverrides(jsonOverrides), [fixCoach]);

  // Single mode data
  const country = allData[countryCode];
  const seasons = country.seasons;

  useEffect(() => {
    if (mode === 'single') {
      setSeasonRange([1, seasons.length]);
      setSelectedCoaches(new Set());
    }
  }, [countryCode, seasons.length, mode]);

  // Reset when switching modes
  useEffect(() => {
    setSelectedCoaches(new Set());
    if (mode === 'single') {
      setClashCountries(new Set());
    }
  }, [mode]);

  const filteredSeasons = useMemo(() => {
    if (mode === 'single') {
      return seasons.filter((_, i) => (i + 1) >= seasonRange[0] && (i + 1) <= seasonRange[1]);
    }
    return [];
  }, [mode, seasons, seasonRange]);

  // Build coach list depending on mode
  const allCoaches = useMemo(() => {
    const coachMap = new Map();

    if (mode === 'single') {
      filteredSeasons.forEach(s => {
        s.coaches.forEach(name => {
          if (!coachMap.has(name)) {
            coachMap.set(name, { name, seasons: [], years: new Set(), countries: new Set() });
          }
          const entry = coachMap.get(name);
          entry.seasons.push(s.season);
          entry.years.add(s.year);
          entry.countries.add(countryCode);
        });
      });
    } else {
      // Clash mode: merge all coaches from selected countries
      clashCountries.forEach(code => {
        const c = allData[code];
        c.seasons.forEach(s => {
          s.coaches.forEach(name => {
            if (!coachMap.has(name)) {
              coachMap.set(name, { name, seasons: [], years: new Set(), countries: new Set() });
            }
            const entry = coachMap.get(name);
            entry.seasons.push(s.season);
            entry.years.add(s.year);
            entry.countries.add(code);
          });
        });
      });
    }

    return Array.from(coachMap.values())
      .map(c => ({
        ...c,
        years: Array.from(c.years).sort(),
        countries: Array.from(c.countries),
      }))
      .sort((a, b) => {
        // In clash mode, sort by number of countries first (globetrotters first)
        if (mode === 'clash' && b.countries.length !== a.countries.length) {
          return b.countries.length - a.countries.length;
        }
        return b.seasons.length - a.seasons.length;
      });
  }, [mode, filteredSeasons, clashCountries, countryCode]);

  // Fetch artist photos for visible coaches (parallel, batched, with retry)
  const fetchPhotos = useCallback(async () => {
    if (!token) return;

    // Always apply cached photos first (instant render on country switch)
    const cached = {};
    allCoaches.forEach(c => {
      if (artistCache.has(c.name) && artistCache.get(c.name)) {
        cached[c.name] = artistCache.get(c.name);
      }
    });
    setArtistPhotos(cached);

    // Then fetch any uncached ones (or retry nulls)
    const uncached = allCoaches.map(c => c.name).filter(n => !artistCache.has(n) || artistCache.get(n) === null);
    if (uncached.length === 0) return;

    const fetchOne = async (name, attempt = 0) => {
      try {
        const artists = await searchArtist(token, name, spotifyOverrides);
        const withImg = artists.find(a => a.images?.length > 0);
        const img = withImg?.images?.[1]?.url || withImg?.images?.[0]?.url || null;
        artistCache.set(name, img);
      } catch (err) {
        if (attempt < 1) {
          await new Promise(r => setTimeout(r, 1500));
          return fetchOne(name, attempt + 1);
        }
        artistCache.set(name, null);
      }
    };

    for (let i = 0; i < uncached.length; i += 5) {
      const batch = uncached.slice(i, i + 5);
      await Promise.all(batch.map(name => fetchOne(name)));
      const photos = {};
      allCoaches.forEach(c => {
        if (artistCache.has(c.name) && artistCache.get(c.name)) {
          photos[c.name] = artistCache.get(c.name);
        }
      });
      setArtistPhotos(photos);
    }
  }, [token, allCoaches, spotifyOverrides]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);

  const toggleCoach = (name) => {
    setSelectedCoaches(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleClashCountry = (code) => {
    setClashCountries(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setSelectedCoaches(new Set());
  };

  const selectAll = () => setSelectedCoaches(new Set(allCoaches.map(c => c.name)));
  const clearAll = () => setSelectedCoaches(new Set());

  const playlistCountryName = mode === 'clash'
    ? Array.from(clashCountries).map(c => allData[c].name).join(' vs ')
    : country.name;

  return (
    <main className="explorer">
      {/* Mode toggle */}
      <div className="mode-toggle-section">
        <button
          className={`mode-btn ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
        >🌍 Single Country</button>
        <button
          className={`mode-btn ${mode === 'clash' ? 'active' : ''}`}
          onClick={() => setMode('clash')}
        >⚔️ Country Clash</button>
      </div>

      {/* Country selection */}
      <section className="country-section">
        <h2>{mode === 'clash' ? 'Pick Countries to Clash' : 'Country'}</h2>
        <div className="country-grid">
          {countryCodes.map(code => {
            const c = allData[code];
            const isActive = mode === 'single'
              ? countryCode === code
              : clashCountries.has(code);
            return (
              <button
                key={code}
                className={`country-btn ${isActive ? 'active' : ''}`}
                onClick={() => mode === 'single' ? setCountryCode(code) : toggleClashCountry(code)}
                title={`${c.showName} — ${c.seasons.length} seasons`}
              >
                <span className="country-flag">{c.flag}</span>
                <span className="country-code">{code}</span>
              </button>
            );
          })}
        </div>
        {mode === 'single' && (
          <p className="country-subtitle">{country.showName} — {seasons.length} seasons</p>
        )}
        {mode === 'clash' && clashCountries.size > 0 && (
          <p className="country-subtitle">
            {Array.from(clashCountries).map(c => `${allData[c].flag} ${allData[c].name}`).join('  vs  ')}
            {' — '}{allCoaches.length} coaches
          </p>
        )}
        {mode === 'clash' && clashCountries.size === 0 && (
          <p className="country-subtitle">Select 2 or more countries to clash their coaches</p>
        )}
      </section>

      {/* Season filter (single mode only) */}
      {mode === 'single' && (
        <section className="filters">
          <h2>Filter by Seasons</h2>
          <div className="range-controls">
            <label>
              From Season {seasons[seasonRange[0] - 1]?.season} ({seasons[seasonRange[0] - 1]?.year})
              <input
                type="range" min={1} max={seasons.length}
                value={seasonRange[0]}
                onChange={e => setSeasonRange([+e.target.value, Math.max(+e.target.value, seasonRange[1])])}
              />
            </label>
            <label>
              To Season {seasons[seasonRange[1] - 1]?.season} ({seasons[seasonRange[1] - 1]?.year})
              <input
                type="range" min={1} max={seasons.length}
                value={seasonRange[1]}
                onChange={e => setSeasonRange([Math.min(seasonRange[0], +e.target.value), +e.target.value])}
              />
            </label>
          </div>
        </section>
      )}

      {mode === 'single' && showTimeline && <CoachTimeline seasons={filteredSeasons} />}

      {/* Coaches grid */}
      {(mode === 'single' || clashCountries.size > 0) && (
        <section className="coaches">
          <div className="coaches-header">
            <h2>Coaches ({allCoaches.length})</h2>
            <div className="coach-actions">
              <button onClick={selectAll}>Select All</button>
              <button onClick={clearAll}>Clear</button>
              {mode === 'single' && (
                <button
                  className={`timeline-toggle ${showTimeline ? 'active' : ''}`}
                  onClick={() => setShowTimeline(t => !t)}
                >📊 Timeline</button>
              )}
            </div>
          </div>
          <div className="coach-grid">
            {allCoaches.map(coach => (
              <div
                key={coach.name}
                className={`coach-card ${selectedCoaches.has(coach.name) ? 'selected' : ''}`}
              >
                <div className="coach-card-main" onClick={() => toggleCoach(coach.name)}>
                  {artistPhotos[coach.name] ? (
                    <img src={artistPhotos[coach.name]} alt="" className="coach-photo" />
                  ) : (
                    <div className="coach-photo-placeholder">🎤</div>
                  )}
                  <div className="coach-text">
                    <span className="coach-name">
                      {coachMeta[coach.name]?.type === 'group'
                        ? <>{coachMeta[coach.name]?.displayName || coach.name} 👥</>
                        : coach.name}
                    </span>
                    {coachMeta[coach.name]?.type === 'band_member' && (
                      <span className="coach-band-badge">🎸 {coachMeta[coach.name].bandName}</span>
                    )}
                    <span className="coach-seasons">
                      {mode === 'clash' && coach.countries.length > 1
                        ? `${coach.countries.map(c => allData[c].flag).join('')} · `
                        : ''
                      }
                      {coach.seasons.length} season{coach.seasons.length > 1 ? 's' : ''}
                      {mode === 'single' && (
                        <>
                          {' · '}
                          {coach.years[0] === coach.years[coach.years.length - 1]
                            ? coach.years[0]
                            : `${coach.years[0]}–${coach.years[coach.years.length - 1]}`
                          }
                        </>
                      )}
                    </span>
                  </div>
                </div>
                <button
                  className="who-btn"
                  onClick={(e) => { e.stopPropagation(); setDetailCoach(coach.name); }}
                  title="Who's this?"
                >ℹ️</button>
                {isDevMode && (
                  <button
                    className="who-btn fix-btn"
                    onClick={(e) => { e.stopPropagation(); setFixCoach(coach.name); }}
                    title="Fix Spotify match"
                  >🔧</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {selectedCoaches.size > 0 && (
        <section className="playlist-section">
          <button className="build-btn" onClick={() => setShowPlaylistBuilder(true)}>
            🎵 Build Playlist ({selectedCoaches.size} coach{selectedCoaches.size > 1 ? 'es' : ''})
          </button>
        </section>
      )}

      {showPlaylistBuilder && (
        <PlaylistBuilder
          token={token}
          userId={userId}
          coaches={Array.from(selectedCoaches)}
          countryName={playlistCountryName}
          onClose={() => setShowPlaylistBuilder(false)}
        />
      )}

      {detailCoach && (
        <CoachDetail
          token={token}
          coachName={detailCoach}
          onClose={() => setDetailCoach(null)}
        />
      )}

      {fixCoach && (
        <ArtistFixer
          token={token}
          coachName={fixCoach}
          onClose={() => setFixCoach(null)}
        />
      )}
    </main>
  );
}

export default CoachExplorer;
