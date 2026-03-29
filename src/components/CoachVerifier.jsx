import { useState, useMemo, useRef } from 'react';
import allData from '../data/coaches.json';
import ArtistFixer, { getMergedOverrides } from './ArtistFixer';
import { searchArtist } from '../spotify/api';

const jsonOverrides = allData.spotifyOverrides || {};
const countryCodes = Object.keys(allData).filter(k => k !== 'spotifyOverrides' && k !== 'coachMeta');

const RESULTS_KEY = 'voiceExplorer_verifyResults';

function loadSavedResults() {
  try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}'); }
  catch { return {}; }
}

function saveResults(results) {
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
}

function getStatus(result) {
  if (!result) return 'pending';
  if (result.noMatch) return 'missing';
  if (result.nameMismatch || result.noImages || result.lowFollowers) return 'warning';
  return 'ok';
}

function statusIcon(status) {
  return { ok: '✅', warning: '⚠️', missing: '❌', pending: '⏳' }[status] || '⏳';
}

function CoachVerifier({ token, onClose }) {
  const [results, setResults] = useState(loadSavedResults);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [fixCoach, setFixCoach] = useState(null);
  const [filter, setFilter] = useState('all'); // all, warning, missing, ok
  const [countryFilter, setCountryFilter] = useState('all');
  const cancelRef = useRef(false);

  const overrides = useMemo(() => getMergedOverrides(jsonOverrides), [fixCoach]);

  // Build flat list of all unique coaches with their countries
  const allCoaches = useMemo(() => {
    const map = new Map();
    countryCodes.forEach(code => {
      const country = allData[code];
      country.seasons.forEach(s => {
        s.coaches.forEach(name => {
          if (!map.has(name)) {
            map.set(name, { name, countries: new Set(), lastYear: 0 });
          }
          const entry = map.get(name);
          entry.countries.add(code);
          entry.lastYear = Math.max(entry.lastYear, s.year);
        });
      });
    });
    return Array.from(map.values()).map(c => ({
      ...c,
      countries: Array.from(c.countries),
    }));
  }, []);

  // Country stats
  const countryStats = useMemo(() => {
    return countryCodes.map(code => {
      const c = allData[code];
      const coaches = new Set();
      c.seasons.forEach(s => s.coaches.forEach(n => coaches.add(n)));
      const lastYear = Math.max(...c.seasons.map(s => s.year));
      return {
        code,
        name: c.name,
        flag: c.flag,
        showName: c.showName,
        seasonCount: c.seasons.length,
        coachCount: coaches.size,
        lastYear,
        stale: lastYear < 2024,
      };
    }).sort((a, b) => b.lastYear - a.lastYear);
  }, []);

  const runVerification = async () => {
    setRunning(true);
    cancelRef.current = false;
    const newResults = { ...results };
    const toVerify = allCoaches.filter(c => !results[c.name]);

    for (let i = 0; i < toVerify.length; i++) {
      if (cancelRef.current) break;
      const coach = toVerify[i];
      setProgress(`(${i + 1}/${toVerify.length}) ${coach.name}`);

      try {
        const artists = await searchArtist(token, coach.name, overrides);
        if (!artists || artists.length === 0) {
          newResults[coach.name] = { noMatch: true, checkedAt: Date.now() };
        } else {
          const a = artists[0];
          const exactMatch = a.name.toLowerCase() === coach.name.toLowerCase();
          const hasImages = a.images?.length > 0;
          const followers = a.followers?.total || 0;
          newResults[coach.name] = {
            spotifyName: a.name,
            spotifyId: a.id,
            followers,
            genres: a.genres?.slice(0, 3) || [],
            imageUrl: a.images?.[1]?.url || a.images?.[0]?.url || null,
            nameMismatch: !exactMatch,
            noImages: !hasImages,
            lowFollowers: followers < 1000,
            hasOverride: !!overrides[coach.name],
            checkedAt: Date.now(),
          };
        }
      } catch {
        newResults[coach.name] = { noMatch: true, error: true, checkedAt: Date.now() };
      }

      // Save every 10 coaches
      if (i % 10 === 0) {
        setResults({ ...newResults });
        saveResults(newResults);
      }

      // Rate limit: small delay between calls
      await new Promise(r => setTimeout(r, 200));
    }

    setResults({ ...newResults });
    saveResults(newResults);
    setRunning(false);
    setProgress('');
  };

  const clearResults = () => {
    setResults({});
    localStorage.removeItem(RESULTS_KEY);
  };

  // Filtered coaches
  const filteredCoaches = useMemo(() => {
    return allCoaches.filter(c => {
      const status = getStatus(results[c.name]);
      if (filter !== 'all' && status !== filter) return false;
      if (countryFilter !== 'all' && !c.countries.includes(countryFilter)) return false;
      return true;
    });
  }, [allCoaches, results, filter, countryFilter]);

  // Stats
  const stats = useMemo(() => {
    let ok = 0, warning = 0, missing = 0, pending = 0;
    allCoaches.forEach(c => {
      const s = getStatus(results[c.name]);
      if (s === 'ok') ok++;
      else if (s === 'warning') warning++;
      else if (s === 'missing') missing++;
      else pending++;
    });
    return { ok, warning, missing, pending, total: allCoaches.length };
  }, [allCoaches, results]);

  return (
    <div className="verifier-page">
      <div className="verifier-header">
        <h2>🔍 Coach Verifier</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      {/* Stats bar */}
      <div className="verifier-stats">
        <span className="stat-pill" onClick={() => setFilter('all')}>
          📊 {stats.total} total
        </span>
        <span className="stat-pill ok" onClick={() => setFilter('ok')}>
          ✅ {stats.ok}
        </span>
        <span className="stat-pill warn" onClick={() => setFilter('warning')}>
          ⚠️ {stats.warning}
        </span>
        <span className="stat-pill miss" onClick={() => setFilter('missing')}>
          ❌ {stats.missing}
        </span>
        <span className="stat-pill pend" onClick={() => setFilter('pending')}>
          ⏳ {stats.pending}
        </span>
      </div>

      {/* Controls */}
      <div className="verifier-controls">
        {!running ? (
          <>
            <button className="verify-run-btn" onClick={runVerification}>
              ▶️ {stats.pending > 0 && stats.pending < stats.total ? `Resume (${stats.pending} left)` : 'Verify All'}
            </button>
            {stats.pending < stats.total && (
              <button className="verify-clear-btn" onClick={clearResults}>🗑️ Reset</button>
            )}
          </>
        ) : (
          <>
            <span className="verify-progress">{progress}</span>
            <button className="verify-stop-btn" onClick={() => cancelRef.current = true}>⏹ Stop</button>
          </>
        )}
        <select
          className="verify-country-filter"
          value={countryFilter}
          onChange={e => setCountryFilter(e.target.value)}
        >
          <option value="all">All Countries</option>
          {countryStats.map(cs => (
            <option key={cs.code} value={cs.code}>
              {cs.flag} {cs.code} — {cs.coachCount} coaches
            </option>
          ))}
        </select>
      </div>

      {/* Country overview */}
      <details className="verifier-countries-section">
        <summary>📋 Country Overview ({countryCodes.length} countries)</summary>
        <div className="verifier-country-grid">
          {countryStats.map(cs => (
            <div
              key={cs.code}
              className={`verifier-country-card ${cs.stale ? 'stale' : ''}`}
              onClick={() => setCountryFilter(cs.code === countryFilter ? 'all' : cs.code)}
            >
              <span className="vc-flag">{cs.flag}</span>
              <div className="vc-info">
                <span className="vc-name">{cs.name}</span>
                <span className="vc-meta">
                  {cs.seasonCount} seasons · {cs.coachCount} coaches · Last: {cs.lastYear}
                </span>
              </div>
              {cs.stale && <span className="vc-stale" title="Last season before 2024">📅</span>}
            </div>
          ))}
        </div>
      </details>

      {/* Results table */}
      <div className="verifier-table-wrap">
        <table className="verifier-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Coach</th>
              <th>Spotify Match</th>
              <th>Followers</th>
              <th>Countries</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            {filteredCoaches.map(coach => {
              const r = results[coach.name];
              const status = getStatus(r);
              return (
                <tr key={coach.name} className={`vr-${status}`}>
                  <td className="vr-status">{statusIcon(status)}</td>
                  <td className="vr-coach">
                    {r?.imageUrl && <img src={r.imageUrl} alt="" className="vr-photo" />}
                    <span>{coach.name}</span>
                  </td>
                  <td className="vr-match">
                    {r?.spotifyName ? (
                      <span className={r.nameMismatch ? 'vr-mismatch' : ''}>
                        {r.spotifyName}
                        {r.hasOverride && ' 🔒'}
                      </span>
                    ) : r?.noMatch ? (
                      <span className="vr-nomatch">No match</span>
                    ) : '—'}
                  </td>
                  <td className="vr-followers">
                    {r?.followers != null ? (
                      <span className={r.lowFollowers ? 'vr-low' : ''}>
                        {r.followers.toLocaleString()}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="vr-countries">
                    {coach.countries.map(c => allData[c].flag).join('')}
                  </td>
                  <td>
                    <button className="vr-fix-btn" onClick={() => setFixCoach(coach.name)}>🔧</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {fixCoach && (
        <ArtistFixer
          token={token}
          coachName={fixCoach}
          onClose={() => {
            setFixCoach(null);
            // Re-check this coach's result after fix
            const updated = { ...results };
            delete updated[fixCoach];
            setResults(updated);
            saveResults(updated);
          }}
        />
      )}
    </div>
  );
}

export default CoachVerifier;
