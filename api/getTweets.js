// /api/getTweets
// Requires: TWITTER_BEARER_TOKEN
// Optional: CORS_ORIGIN, USER_ID (overrides hardcoded id)

let inMemoryCache = {
    json: null,        // last successful JSON payload
    ts: 0              // timestamp (ms)
  };
  let backoffUntil = 0; // epoch ms until which we won't hit X again after a 429
  
  export default async function handler(req, res) {
    // ---- CORS ----
    const allowOrigin = process.env.CORS_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
    const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
    if (!BEARER_TOKEN) return res.status(500).json({ error: 'Bearer token missing from environment.' });
  
    // Use your discovered rest_id; env var wins if provided
    const USER_ID = process.env.USER_ID || '1802749491268771841';
  
    const { next_token } = req.query || {};
  
    // Heavier CDN/browser cache to slash hits (tweak to taste)
    // s-maxage: edge cache (10 min), stale-while-revalidate: 30 min, browser: 2 min
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800, max-age=120');
  
    // If we're in backoff and have any cache, serve it immediately
    const now = Date.now();
    if (now < backoffUntil && inMemoryCache.json) {
      res.setHeader('X-Cache', 'STALE_BACKOFF');
      return res.status(200).json(inMemoryCache.json);
    }
  
    try {
      // Build fields so images/avatars render
      const params = new URLSearchParams({
        max_results: '5',
        expansions: 'attachments.media_keys,author_id',
        'tweet.fields': 'created_at,text,attachments,author_id',
        'user.fields': 'name,username,profile_image_url',
        'media.fields': 'url,preview_image_url,alt_text,width,height,type'
      });
      if (next_token) params.set('pagination_token', String(next_token));
  
      const r = await fetch(`https://api.twitter.com/2/users/${USER_ID}/tweets?${params.toString()}`, {
        headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
        cache: 'no-store'
      });
  
      if (!r.ok) {
        const body = await r.text();
  
        // If 429, set backoff and serve stale if we have any
        if (r.status === 429) {
          const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
          // Default to 5 minutes if no header
          const backoffMs = (isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 300) * 1000;
          backoffUntil = Date.now() + backoffMs;
  
          if (inMemoryCache.json) {
            res.setHeader('X-Cache', 'STALE_429');
            return res.status(200).json(inMemoryCache.json);
          }
  
          // No cache available: send a 503 so your UI can show a friendly message
          return res.status(503).json({
            error: 'Rate limited by X (no cached data)',
            detail: body
          });
        }
  
        // Other errors: if we have cache, serve stale; else bubble the error
        if (inMemoryCache.json) {
          res.setHeader('X-Cache', 'STALE_ERROR');
          return res.status(200).json(inMemoryCache.json);
        }
        return res.status(r.status).json({ error: 'Tweets fetch failed', detail: body });
      }
  
      // Success: clear backoff and cache the result
      backoffUntil = 0;
      const json = await r.json();
      if (!json?.data) {
        // If empty but we have cached data, serve stale instead of empty
        if (inMemoryCache.json) {
          res.setHeader('X-Cache', 'STALE_EMPTY');
          return res.status(200).json(inMemoryCache.json);
        }
        return res.status(404).json({ error: 'No tweets found or invalid response', details: json });
      }
  
      // Cache only the first page (most common)
      if (!next_token) {
        inMemoryCache = { json, ts: Date.now() };
      }
  
      return res.status(200).json(json);
    } catch (e) {
      // On unexpected errors, prefer stale if present
      if (inMemoryCache.json) {
        res.setHeader('X-Cache', 'STALE_EXCEPTION');
        return res.status(200).json(inMemoryCache.json);
      }
      console.error('Error in /api/getTweets:', e);
      return res.status(500).json({ error: 'Server error', message: String(e) });
    }
  }
  