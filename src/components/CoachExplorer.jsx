import { useState, useMemo, useEffect } from 'react';
import allData from '../data/coaches.json';
import PlaylistBuilder from './PlaylistBuilder';

const countryCodes = Object.keys(allData);

function CoachExplorer({ token, userId }) {
  const [countryCode, setCountryCode] = useState('US');
  const [selectedCoaches, setSelectedCoaches] = useState(new Set());
  const [seasonRange, setSeasonRange] = useState([1, 1]);
  const [showPlaylistBuilder, setShowPlaylistBuilder] = useState(false);

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

      <section className="coaches">
        <div className="coaches-header">
          <h2>Coaches ({allCoaches.length})</h2>
          <div className="coach-actions">
            <button onClick={selectAll}>Select All</button>
            <button onClick={clearAll}>Clear</button>
          </div>
        </div>
        <div className="coach-grid">
          {allCoaches.map(coach => (
            <button
              key={coach.name}
              className={`coach-card ${selectedCoaches.has(coach.name) ? 'selected' : ''}`}
              onClick={() => toggleCoach(coach.name)}
            >
              <span className="coach-name">{coach.name}</span>
              <span className="coach-seasons">
                {coach.seasons.length} season{coach.seasons.length > 1 ? 's' : ''}
                {' · '}
                {coach.years[0] === coach.years[coach.years.length - 1]
                  ? coach.years[0]
                  : `${coach.years[0]}–${coach.years[coach.years.length - 1]}`
                }
              </span>
            </button>
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
    </main>
  );
}

export default CoachExplorer;
