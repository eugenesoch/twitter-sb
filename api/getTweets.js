// Vercel Serverless Function: /api/getTweets?next_token=...
// ENV VARS (set in Vercel):
// - TWITTER_BEARER_TOKEN (required)
// - CORS_ORIGIN (optional, e.g. https://your-site.webflow.io)
// - USER_ID (optional: overrides the hardcoded fallback)

let inMemoryCache = {
    key: null,   // cache key (page token)
    json: null,  // last successful JSON payload
    ts: 0        // timestamp (ms)
  };
  
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
  
    // Use your found rest_id; env var wins if provided
    const USER_ID = process.env.USER_ID || '1802749491268771841';
  
    // Accept pagination token; username no longer needed
    const { next_token } = req.query || {};
  
    // CDN/browser cache (reduce hits from many visitors)
    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300, max-age=60');
  
    // Small server-side memory cache to serve if Twitter 429s
    const cacheTTLms = 5 * 60 * 1000; // 5 minutes
    const cacheKey = `${next_token || ''}`;
  
    try {
      // 1) Fetch tweets WITH media + author (for images + avatar)
      const params = new URLSearchParams({
        max_results: '25',
        expansions: 'attachments.media_keys,author_id',
        'tweet.fields': 'created_at,text,attachments,author_id',
        'user.fields': 'name,username,profile_image_url',
        'media.fields': 'url,preview_image_url,alt_text,width,height,type'
      });
      if (next_token) params.set('pagination_token', String(next_token));
  
      const tweetsRes = await fetch(
        `https://api.twitter.com/2/users/${USER_ID}/tweets?${params.toString()}`,
        { headers: { Authorization: `Bearer ${BEARER_TOKEN}` }, cache: 'no-store' }
      );
  
      if (!tweetsRes.ok) {
        const detail = await tweetsRes.text();
        // Serve stale cache on 429 (rate limit) to keep your site working
        if (tweetsRes.status === 429 && inMemoryCache.json && (Date.now() - inMemoryCache.ts) < 24 * 60 * 60 * 1000) {
          return res.status(200).json(inMemoryCache.json);
        }
        return res.status(tweetsRes.status).json({ error: 'Tweets fetch failed', detail });
      }
  
      const json = await tweetsRes.json();
      if (!json?.data) {
        return res.status(404).json({ error: 'No tweets found or invalid response', details: json });
      }
  
      // 2) Update small in-memory cache (best-effort; not guaranteed across cold starts)
      if (!next_token) { // only cache first page
        inMemoryCache = { key: cacheKey, json, ts: Date.now() };
      }
  
      return res.status(200).json(json);
    } catch (err) {
      // serve stale on unexpected errors if available
      if (inMemoryCache.json && (Date.now() - inMemoryCache.ts) < cacheTTLms) {
        return res.status(200).json(inMemoryCache.json);
      }
      console.error('Error in /api/getTweets:', err);
      return res.status(500).json({ error: 'Server error', message: String(err) });
    }
  }
  