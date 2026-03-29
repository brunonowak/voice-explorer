import { useState, useMemo, useRef } from 'react';
import allData from '../data/coaches.json';
import ArtistFixer, { getMergedOverrides, getLocalOverrides, commitOverrideToGitHub, getGithubPat } from './ArtistFixer';
import { searchArtist } from '../spotify/api';

const jsonOverrides = allData.spotifyOverrides || {};
const jsonCoachMeta = allData.coachMeta || {};
const seasonStatus = allData.seasonStatus || {};
const countryCodes = Object.keys(allData).filter(k => !['spotifyOverrides', 'coachMeta', 'seasonStatus'].includes(k));

function getMergedCoachMeta() {
  let localMeta = {};
  try { localMeta = JSON.parse(localStorage.getItem('voiceExplorer_coachMeta') || '{}'); } catch {}
  const merged = { ...jsonCoachMeta };
  for (const [name, meta] of Object.entries(localMeta)) {
    merged[name] = { ...(merged[name] || {}), ...meta };
  }
  return merged;
}

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
  if (result.approved) return 'ok';
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
  const [renameCoach, setRenameCoach] = useState(null);
  const [renameTo, setRenameTo] = useState('');
  const [filter, setFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const cancelRef = useRef(false);

  const coachMeta = useMemo(() => getMergedCoachMeta(), [renameCoach]);

  const approveCoach = async (name) => {
    const r = results[name];
    if (!r || !r.spotifyId) return;

    // Save to localStorage immediately
    const localOverrides = getLocalOverrides();
    localOverrides[name] = r.spotifyId;
    localStorage.setItem('voiceExplorer_artistOverrides', JSON.stringify(localOverrides));

    // Mark as approved in verifier results
    const updated = { ...results };
    updated[name] = { ...r, approved: true, hasOverride: true };
    setResults(updated);
    saveResults(updated);

    // Commit to GitHub if PAT available
    if (getGithubPat()) {
      try {
        await commitOverrideToGitHub(name, r.spotifyId);
      } catch (err) {
        console.warn('GitHub commit failed for approval:', err);
      }
    }
  };

  const unapproveCoach = (name) => {
    const updated = { ...results };
    if (updated[name]) {
      const { approved, ...rest } = updated[name];
      updated[name] = rest;
      setResults(updated);
      saveResults(updated);
    }
  };

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
      const ss = seasonStatus[code];
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
        showStatus: ss?.status || 'unknown',
        latestKnown: ss?.latestKnown || '',
        statusNote: ss?.note || '',
        needsUpdate: ss && ss.status === 'active' && lastYear < 2024,
      };
    }).sort((a, b) => {
      // Sort: needs update first, then by last year desc
      if (a.needsUpdate !== b.needsUpdate) return a.needsUpdate ? -1 : 1;
      return b.lastYear - a.lastYear;
    });
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
        <summary>📋 Country Overview ({countryCodes.length} countries — {countryStats.filter(c => c.needsUpdate).length} need data updates)</summary>
        <div className="verifier-country-grid">
          {countryStats.map(cs => (
            <div
              key={cs.code}
              className={`verifier-country-card ${cs.needsUpdate ? 'needs-update' : cs.stale ? 'stale' : ''}`}
              onClick={() => setCountryFilter(cs.code === countryFilter ? 'all' : cs.code)}
              title={cs.statusNote}
            >
              <span className="vc-flag">{cs.flag}</span>
              <div className="vc-info">
                <span className="vc-name">{cs.name}</span>
                <span className="vc-meta">
                  Our data: {cs.seasonCount} seasons (last {cs.lastYear})
                </span>
                {cs.latestKnown && (
                  <span className={`vc-latest ${cs.needsUpdate ? 'vc-outdated' : ''}`}>
                    Latest: {cs.latestKnown}
                    {cs.showStatus === 'hiatus' && ' · ⏸ Hiatus'}
                    {cs.needsUpdate && ' · 🔄 Needs update'}
                  </span>
                )}
              </div>
              {cs.needsUpdate ? (
                <span className="vc-badge update" title="Active show, our data is behind">🔄</span>
              ) : cs.showStatus === 'hiatus' ? (
                <span className="vc-badge hiatus" title="Show on hiatus/ended">⏸</span>
              ) : (
                <span className="vc-badge active" title="Active, data up to date">✅</span>
              )}
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCoaches.map(coach => {
              const r = results[coach.name];
              const status = getStatus(r);
              const meta = coachMeta[coach.name];
              return (
                <tr key={coach.name} className={`vr-${status}`}>
                  <td className="vr-status">{statusIcon(status)}</td>
                  <td className="vr-coach">
                    {r?.imageUrl && <img src={r.imageUrl} alt="" className="vr-photo" />}
                    <div className="vr-coach-names">
                      <span>{coach.name}</span>
                      {meta?.displayName && meta.displayName !== coach.name && (
                        <span className="vr-display-name">→ {meta.displayName}</span>
                      )}
                    </div>
                  </td>
                  <td className="vr-match">
                    {r?.spotifyName ? (
                      <span className={r.nameMismatch && !r.approved ? 'vr-mismatch' : ''}>
                        {r.spotifyName}
                        {r.hasOverride && ' 🔒'}
                      </span>
                    ) : r?.noMatch ? (
                      <span className="vr-nomatch">No match</span>
                    ) : '—'}
                  </td>
                  <td className="vr-followers">
                    {r?.followers != null ? (
                      <span className={r.lowFollowers && !r.approved ? 'vr-low' : ''}>
                        {r.followers.toLocaleString()}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="vr-countries">
                    {coach.countries.map(c => allData[c].flag).join('')}
                  </td>
                  <td className="vr-actions">
                    {status === 'warning' && (
                      <button className="vr-approve-btn" onClick={() => approveCoach(coach.name)} title="Mark as correct">✓</button>
                    )}
                    {r?.approved && (
                      <button className="vr-unapprove-btn" onClick={() => unapproveCoach(coach.name)} title="Remove approval">↩</button>
                    )}
                    <button className="vr-fix-btn" onClick={() => {
                      setRenameCoach(coach.name);
                      setRenameTo(meta?.displayName || r?.spotifyName || coach.name);
                    }} title="Set display name">✏️</button>
                    <button className="vr-fix-btn" onClick={() => setFixCoach(coach.name)} title="Fix Spotify match">🔧</button>
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

      {renameCoach && (
        <div className="modal-overlay" onClick={() => setRenameCoach(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <button className="modal-close" onClick={() => setRenameCoach(null)}>✕</button>
            <h2>✏️ Display Name</h2>
            <p className="fixer-hint">Coach in data: <strong>{renameCoach}</strong></p>
            <p className="fixer-hint">Set the name shown in the app:</p>
            <div className="fixer-search" style={{ marginTop: '0.75rem' }}>
              <input
                type="text"
                value={renameTo}
                onChange={e => setRenameTo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveDisplayName()}
                placeholder="Display name..."
              />
              <button onClick={saveDisplayName}>💾</button>
            </div>
            {renameTo && renameTo !== renameCoach && (
              <p className="fixer-hint" style={{ marginTop: '0.5rem' }}>
                Will show as: <strong>{renameTo}</strong>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  function saveDisplayName() {
    if (!renameCoach || !renameTo.trim()) return;
    // Save to localStorage coachMeta overrides
    const META_KEY = 'voiceExplorer_coachMeta';
    let localMeta = {};
    try { localMeta = JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch {}
    if (renameTo.trim() === renameCoach) {
      delete localMeta[renameCoach];
    } else {
      localMeta[renameCoach] = { ...localMeta[renameCoach], displayName: renameTo.trim() };
    }
    localStorage.setItem(META_KEY, JSON.stringify(localMeta));
    setRenameCoach(null);
  }
}

export default CoachVerifier;
