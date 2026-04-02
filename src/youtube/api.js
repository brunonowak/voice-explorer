const BASE_URL = 'https://www.googleapis.com/youtube/v3';

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
    try {
      const channel = await getChannel(token, channelId);
      if (channel) {
        return [{
          id: channel.id,
          name: channel.snippet.title,
          image: channel.snippet.thumbnails?.medium?.url
            || channel.snippet.thumbnails?.default?.url || null,
          subscribers: parseInt(channel.statistics?.subscriberCount || '0'),
          platform: 'youtube',
        }];
      }
    } catch (error) {
      console.warn(`Failed to fetch override channel ${channelId} for "${name}":`, error);
    }
  }

  // Search for channels matching the artist name
  const params = new URLSearchParams({
    part: 'snippet',
    q: name,
    type: 'channel',
    maxResults: '5',
  });
  const data = await fetchYouTube(token, `/search?${params}`);

  return (data.items || []).map(item => ({
    id: item.snippet.channelId,
    name: item.snippet.title,
    image: item.snippet.thumbnails?.medium?.url
      || item.snippet.thumbnails?.default?.url || null,
    subscribers: null, // Search results don't include subscriber count
    platform: 'youtube',
  }));
}

// Search for top videos from an artist's channel
// mode: 'video' searches for music videos, 'music' gets any music content
export async function getArtistTopVideos(token, channelId, maxResults = 10, mode = 'music') {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'viewCount',
    maxResults: String(maxResults),
  });
  // Music mode: filter to music category (gets audio/topic content)
  // Video mode: don't filter category (gets actual music videos)
  if (mode === 'music') {
    params.set('videoCategoryId', '10');
  }
  const data = await fetchYouTube(token, `/search?${params}`);
  const videoIds = (data.items || []).map(item => item.id.videoId).filter(Boolean);

  if (videoIds.length === 0) return [];

  return getVideoDetails(token, videoIds);
}

// Search for music videos by artist name (text search)
export async function searchArtistVideos(token, artistName, maxResults = 10, mode = 'music') {
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

  return getVideoDetails(token, videoIds);
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
export async function getArtistExpandedVideos(token, channelId, artistName, mode = 'music') {
  let topVideos, searchVideos;

  if (mode === 'video') {
    // Video mode: name-based search is primary (finds VEVO / official MVs)
    // Channel-based search secondary (may return audio-only topic tracks)
    searchVideos = await searchArtistVideos(token, artistName, 20, mode);
    topVideos = searchVideos.length >= 10 ? [] : await getArtistTopVideos(token, channelId, 15, mode);
  } else {
    // Music mode: channel-based search is primary (gets topic audio tracks)
    topVideos = await getArtistTopVideos(token, channelId, 15, mode);
    searchVideos = await searchArtistVideos(token, artistName, 15, mode);
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
