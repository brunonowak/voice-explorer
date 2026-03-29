import { useState, useMemo, useEffect, useCallback } from 'react';
import allData from '../data/coaches.json';
import PlaylistBuilder from './PlaylistBuilder';
import CoachTimeline from './CoachTimeline';
import CoachDetail from './CoachDetail';
import { searchArtist } from '../spotify/api';

const countryCodes = Object.keys(allData);

// Global cache so we don't re-fetch across country switches
const artistCache = new Map();

function CoachExplorer({ token, userId }) {
  const [countryCode, setCountryCode] = useState('US');
  const [selectedCoaches, setSelectedCoaches] = useState(new Set());
  const [seasonRange, setSeasonRange] = useState([1, 1]);
  const [showPlaylistBuilder, setShowPlaylistBuilder] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [detailCoach, setDetailCoach] = useState(null);
  const [artistPhotos, setArtistPhotos] = useState({});

  const country = allData[countryCode];
  const seasons = country.seasons;

  useEffect(() => {
    setSeasonRange([1, seasons.length]);
    setSelectedCoaches(new Set());
  }, [countryCode, seasons.length]);

  const filteredSeasons = useMemo(() => {
    return seasons.filter((_, i) => (i + 1) >= seasonRange[0] && (i + 1) <= seasonRange[1]);
  }, [seasons, seasonRange]);

  const allCoaches = useMemo(() => {
    const coachMap = new Map();
    filteredSeasons.forEach(s => {
      s.coaches.forEach(name => {
        if (!coachMap.has(name)) {
          coachMap.set(name, { name, seasons: [], years: new Set() });
        }
        const entry = coachMap.get(name);
        entry.seasons.push(s.season);
        entry.years.add(s.year);
      });
    });
    return Array.from(coachMap.values())
      .map(c => ({ ...c, years: Array.from(c.years).sort() }))
      .sort((a, b) => b.seasons.length - a.seasons.length);
  }, [filteredSeasons]);

  // Fetch artist photos for visible coaches (parallel, batched)
  const fetchPhotos = useCallback(async () => {
    if (!token) return;
    const uncached = allCoaches.map(c => c.name).filter(n => !artistCache.has(n));

    // Fetch in parallel batches of 5 to avoid rate limits
    for (let i = 0; i < uncached.length; i += 5) {
      const batch = uncached.slice(i, i + 5);
      await Promise.all(batch.map(async (name) => {
        try {
          const artists = await searchArtist(token, name);
          const img = artists[0]?.images?.[1]?.url || artists[0]?.images?.[0]?.url || null;
          artistCache.set(name, img);
        } catch {
          artistCache.set(name, null);
        }
      }));
      // Update photos progressively after each batch
      const photos = {};
      allCoaches.forEach(c => {
        if (artistCache.has(c.name)) photos[c.name] = artistCache.get(c.name);
      });
      setArtistPhotos({ ...photos });
    }
  }, [token, allCoaches]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);

  const toggleCoach = (name) => {
    setSelectedCoaches(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelectedCoaches(new Set(allCoaches.map(c => c.name)));
  const clearAll = () => setSelectedCoaches(new Set());

  return (
    <main className="explorer">
      <section className="country-section">
        <h2>Country</h2>
        <div className="country-grid">
          {countryCodes.map(code => {
            const c = allData[code];
            return (
              <button
                key={code}
                className={`country-btn ${countryCode === code ? 'active' : ''}`}
                onClick={() => setCountryCode(code)}
                title={`${c.showName} — ${c.seasons.length} seasons`}
              >
                <span className="country-flag">{c.flag}</span>
                <span className="country-code">{code}</span>
              </button>
            );
          })}
        </div>
        <p className="country-subtitle">{country.showName} — {seasons.length} seasons</p>
      </section>

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

      {showTimeline && <CoachTimeline seasons={filteredSeasons} />}

      <section className="coaches">
        <div className="coaches-header">
          <h2>Coaches ({allCoaches.length})</h2>
          <div className="coach-actions">
            <button onClick={selectAll}>Select All</button>
            <button onClick={clearAll}>Clear</button>
            <button
              className={`timeline-toggle ${showTimeline ? 'active' : ''}`}
              onClick={() => setShowTimeline(t => !t)}
            >📊 Timeline</button>
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
                  <span className="coach-name">{coach.name}</span>
                  <span className="coach-seasons">
                    {coach.seasons.length} season{coach.seasons.length > 1 ? 's' : ''}
                    {' · '}
                    {coach.years[0] === coach.years[coach.years.length - 1]
                      ? coach.years[0]
                      : `${coach.years[0]}–${coach.years[coach.years.length - 1]}`
                    }
                  </span>
                </div>
              </div>
              <button
                className="who-btn"
                onClick={(e) => { e.stopPropagation(); setDetailCoach(coach.name); }}
                title="Who's this?"
              >ℹ️</button>
            </div>
          ))}
        </div>
      </section>

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
          countryName={country.name}
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
    </main>
  );
}

export default CoachExplorer;
