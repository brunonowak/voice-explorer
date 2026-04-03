const BASE_URL = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
const CACHE_PREFIX = 'yt_cache_';

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
    return data;
  } catch { return null; }
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, expires: Date.now() + CACHE_TTL }));
  } catch { /* storage full — ignore */ }
}

async function fetchYouTube(token, endpoint, options = {}) {
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${endpoint}${separator}access_token=${token}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error?.message || `YouTube API error: ${response.status}`
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

// Get the authenticated user's channel info
export async function getMyChannel(token) {
  const data = await fetchYouTube(token, '/channels?part=snippet&mine=true');
  return data.items?.[0] || null;
}

// Get a channel by ID
export async function getChannel(token, channelId) {
  const data = await fetchYouTube(
    token,
    `/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}`
  );
  return data.items?.[0] || null;
}

// Search for an artist's channel, with optional override support
export async function searchArtist(token, name, overrides = null) {
  // Check for a YouTube channel ID override
  if (overrides && overrides[name]) {
    const channelId = overrides[name];
    const cacheKey = `artist_override_${channelId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    try {
      const channel = await getChannel(token, channelId);
      if (channel) {
        const result = [{
          id: channel.id,
          name: channel.snippet.title,
          image: channel.snippet.thumbnails?.medium?.url
            || channel.snippet.thumbnails?.default?.url || null,
          subscribers: parseInt(channel.statistics?.subscriberCount || '0'),
          platform: 'youtube',
        }];
        cacheSet(cacheKey, result);
        return result;
      }
    } catch (error) {
      console.warn(`Failed to fetch override channel ${channelId} for "${name}":`, error);
    }
  }

  // Check cache for name search (saves 100 units)
  const cacheKey = `artist_search_${name.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Search for channels matching the artist name
  const params = new URLSearchParams({
    part: 'snippet',
    q: name,
    type: 'channel',
    maxResults: '5',
  });
  const data = await fetchYouTube(token, `/search?${params}`);

  const result = (data.items || []).map(item => ({
    id: item.snippet.channelId,
    name: item.snippet.title,
    image: item.snippet.thumbnails?.medium?.url
      || item.snippet.thumbnails?.default?.url || null,
    subscribers: null,
    platform: 'youtube',
  }));
  cacheSet(cacheKey, result);
  return result;
}

// Search for top videos from an artist's channel (100 units - cached)
export async function getArtistTopVideos(token, channelId, maxResults = 10, mode = 'music') {
  const cacheKey = `top_videos_${channelId}_${mode}_${maxResults}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'viewCount',
    maxResults: String(maxResults),
  });
  if (mode === 'music') {
    params.set('videoCategoryId', '10');
  }
  const data = await fetchYouTube(token, `/search?${params}`);
  const videoIds = (data.items || []).map(item => item.id.videoId).filter(Boolean);

  if (videoIds.length === 0) return [];

  const result = await getVideoDetails(token, videoIds);
  cacheSet(cacheKey, result);
  return result;
}

// Search for music videos by artist name (100 units - cached)
export async function searchArtistVideos(token, artistName, maxResults = 10, mode = 'music') {
  const cacheKey = `search_videos_${artistName.toLowerCase()}_${mode}_${maxResults}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const suffix = mode === 'video' ? 'official music video' : 'official audio';
  const params = new URLSearchParams({
    part: 'snippet',
    q: `${artistName} ${suffix}`,
    type: 'video',
    order: 'viewCount',
    maxResults: String(maxResults),
  });
  if (mode === 'music') {
    params.set('videoCategoryId', '10');
  }
  const data = await fetchYouTube(token, `/search?${params}`);
  const videoIds = (data.items || []).map(item => item.id.videoId).filter(Boolean);

  if (videoIds.length === 0) return [];

  const result = await getVideoDetails(token, videoIds);
  cacheSet(cacheKey, result);
  return result;
}

// Get full details for videos (view count, duration, channel info)
export async function getVideoDetails(token, videoIds) {
  const all = [];
  // YouTube allows up to 50 IDs per request
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({
      part: 'snippet,statistics,contentDetails',
      id: chunk.join(','),
    });
    const data = await fetchYouTube(token, `/videos?${params}`);
    all.push(...(data.items || []));
  }

  return all.map(video => ({
    id: video.id,
    title: video.snippet.title,
    channelId: video.snippet.channelId,
    channelTitle: video.snippet.channelTitle,
    thumbnail: video.snippet.thumbnails?.medium?.url
      || video.snippet.thumbnails?.default?.url || null,
    viewCount: parseInt(video.statistics?.viewCount || '0'),
    duration: video.contentDetails?.duration || null,
    publishedAt: video.snippet.publishedAt,
    platform: 'youtube',
  }));
}

// Get expanded video pool for an artist (top videos + deeper search)
// Skips secondary search if primary returns enough results (saves 100 units)
export async function getArtistExpandedVideos(token, channelId, artistName, mode = 'music') {
  let topVideos, searchVideos;

  if (mode === 'video') {
    // Video mode: name-based search is primary (finds VEVO / official MVs)
    searchVideos = await searchArtistVideos(token, artistName, 20, mode);
    // Only do channel search if name search found fewer than 8 usable results
    topVideos = searchVideos.length >= 8 ? [] : await getArtistTopVideos(token, channelId, 15, mode);
  } else {
    // Music mode: channel-based search is primary (gets topic audio tracks)
    topVideos = await getArtistTopVideos(token, channelId, 15, mode);
    // Only do name search if channel search found fewer than 8 results
    searchVideos = topVideos.length >= 8 ? [] : await searchArtistVideos(token, artistName, 15, mode);
  }

  const seen = new Set();
  const all = [];
  for (const video of [...topVideos, ...searchVideos]) {
    if (video && !seen.has(video.id)) {
      seen.add(video.id);
      all.push(video);
    }
  }
  return all;
}

// Create a new playlist
export async function createPlaylist(token, title, description = '', isPublic = true) {
  const data = await fetchYouTube(token, '/playlists?part=snippet,status', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title, description },
      status: { privacyStatus: isPublic ? 'public' : 'private' },
    }),
  });

  return {
    id: data.id,
    url: `https://www.youtube.com/playlist?list=${data.id}`,
    musicUrl: `https://music.youtube.com/playlist?list=${data.id}`,
    title: data.snippet.title,
  };
}

// Add videos to a playlist (one at a time — YouTube API requirement)
export async function addVideosToPlaylist(token, playlistId, videoIds) {
  for (const videoId of videoIds) {
    await fetchYouTube(token, '/playlistItems?part=snippet', {
      method: 'POST',
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId,
          },
        },
      }),
    });
  }
}
