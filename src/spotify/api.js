const BASE_URL = 'https://api.spotify.com/v1';

async function fetchSpotify(token, endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Spotify API error: ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function getCurrentUser(token) {
  return fetchSpotify(token, '/me');
}

export async function searchArtist(token, name) {
  const params = new URLSearchParams({ q: name, type: 'artist', limit: '5' });
  const data = await fetchSpotify(token, `/search?${params}`);
  return data.artists.items;
}

export async function getArtistTopTracks(token, artistId, market = 'US') {
  const params = new URLSearchParams({ market });
  const data = await fetchSpotify(token, `/artists/${artistId}/top-tracks?${params}`);
  return data.tracks;
}

export async function createPlaylist(token, userId, name, description = '', isPublic = false) {
  return fetchSpotify(token, `/users/${userId}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name, description, public: isPublic }),
  });
}

export async function getArtistAlbums(token, artistId, market = 'US') {
  const params = new URLSearchParams({
    include_groups: 'album,single',
    market,
    limit: '20',
  });
  const data = await fetchSpotify(token, `/artists/${artistId}/albums?${params}`);
  return data.items;
}

export async function getAlbumTracks(token, albumId, market = 'US') {
  const params = new URLSearchParams({ market, limit: '50' });
  const data = await fetchSpotify(token, `/albums/${albumId}/tracks?${params}`);
  return data.items;
}

export async function getTracksDetails(token, trackIds) {
  const all = [];
  for (let i = 0; i < trackIds.length; i += 50) {
    const chunk = trackIds.slice(i, i + 50);
    const params = new URLSearchParams({ ids: chunk.join(',') });
    const data = await fetchSpotify(token, `/tracks?${params}`);
    all.push(...data.tracks.filter(Boolean));
  }
  return all;
}

// Fetches top tracks + album tracks for a richer pool (needed for deep cuts / balanced mix)
export async function getArtistExpandedTracks(token, artistId, market = 'US') {
  const topTracks = await getArtistTopTracks(token, artistId, market);
  const albums = await getArtistAlbums(token, artistId, market);

  // Pull tracks from up to 5 albums
  const albumTrackIds = [];
  for (const album of albums.slice(0, 5)) {
    const tracks = await getAlbumTracks(token, album.id, market);
    albumTrackIds.push(...tracks.map(t => t.id));
  }

  // Fetch full details (includes popularity) for album tracks
  const fullAlbumTracks = albumTrackIds.length > 0
    ? await getTracksDetails(token, albumTrackIds)
    : [];

  // Deduplicate
  const seen = new Set();
  const all = [];
  for (const track of [...topTracks, ...fullAlbumTracks]) {
    if (track && !seen.has(track.id)) {
      seen.add(track.id);
      all.push(track);
    }
  }
  return all;
}

export async function addTracksToPlaylist(token, playlistId, trackUris) {
  // Spotify allows max 100 tracks per request
  for (let i = 0; i < trackUris.length; i += 100) {
    const chunk = trackUris.slice(i, i + 100);
    await fetchSpotify(token, `/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk }),
    });
  }
}
