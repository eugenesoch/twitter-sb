// /api/getTweets
// Requires: TWITTER_BEARER_TOKEN
// Optional: CORS_ORIGIN, USER_ID (overrides hardcoded id)
// Optional: REFRESH_SECONDS (defaults to 900 = 15 minutes)

let inMemoryCache = {
    json: null,        // last successful JSON payload (first page only)
    ts: 0              // timestamp (ms) of last successful refresh
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
  
    const USER_ID = process.env.USER_ID || '1802749491268771841';
    const { next_token } = req.query || {};
  
    // How long we consider the cache "fresh" (defaults to 15 minutes)
    const REFRESH_MS = (parseInt(process.env.REFRESH_SECONDS || '900', 10) || 900) * 1000;
  
    // Cache headers for clients (the server still enforces the 15-min gate internally)
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800, max-age=120');
  
    const now = Date.now();
  
    // ---- 15-minute self-throttle for FIRST PAGE ONLY (no next_token) ----
    if (!next_token && inMemoryCache.json && (now - inMemoryCache.ts) < REFRESH_MS) {
      res.setHeader('X-Cache', 'MEMORY_FRESH');
      return res.status(200).json(inMemoryCache.json);
    }
  
    // If we're in backoff and have any cache, serve it immediately
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
          const backoffMs = (isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 300) * 1000; // default 5m
          backoffUntil = Date.now() + backoffMs;
  
          if (inMemoryCache.json) {
            res.setHeader('X-Cache', 'STALE_429');
            return res.status(200).json(inMemoryCache.json);
          }
  
          return res.status(503).json({
            error: 'Rate limited by X (no cached data)',
            detail: body
          });
        }
  
        // Other errors: if we have cache, serve stale; else bubble the error
        if (!next_token && inMemoryCache.json) {
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
        if (!next_token && inMemoryCache.json) {
          res.setHeader('X-Cache', 'STALE_EMPTY');
          return res.status(200).json(inMemoryCache.json);
        }
        return res.status(404).json({ error: 'No tweets found or invalid response', details: json });
      }
  
      // Only cache the first page and mark its timestamp, enforcing the 15-min window
      if (!next_token) {
        inMemoryCache = { json, ts: Date.now() };
        res.setHeader('X-Cache', 'MEMORY_REFRESHED');
      } else {
        res.setHeader('X-Cache', 'PAGED_NO_CACHE');
      }
  
      return res.status(200).json(json);
    } catch (e) {
      // On unexpected errors, prefer stale if present (first page only)
      if (!next_token && inMemoryCache.json) {
        res.setHeader('X-Cache', 'STALE_EXCEPTION');
        return res.status(200).json(inMemoryCache.json);
      }
      console.error('Error in /api/getTweets:', e);
      return res.status(500).json({ error: 'Server error', message: String(e) });
    }
  }
  