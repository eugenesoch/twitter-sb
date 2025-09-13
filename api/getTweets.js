// Vercel Serverless Function: /api/getTweets
// Usage:
//   GET /api/getTweets?username=SonicBoomFest&next_token=XYZ

export default async function handler(req, res) {
    // --- CORS ---
    // While testing, "*" is fine. For production, set CORS_ORIGIN to your Webflow domain.
    const allowOrigin = process.env.CORS_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-api-key');
  
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
  
    const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
    const { username = 'SonicBoomFest', next_token } = req.query || {};
  
    if (!BEARER_TOKEN) {
      res.status(500).json({ error: 'Bearer token missing from environment.' });
      return;
    }
  
    try {
      // 1) Lookup user by handle
      const userRes = await fetch(
        `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}`,
        {
          headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
          cache: 'no-store',
        }
      );
  
      if (!userRes.ok) {
        const detail = await userRes.text();
        res.status(userRes.status).json({ error: 'User lookup failed', detail });
        return;
      }
  
      const userJson = await userRes.json();
      const userId = userJson?.data?.id;
      if (!userId) {
        res.status(404).json({ error: 'Twitter user not found', details: userJson });
        return;
      }
  
      // 2) Fetch tweets (add fields/expansions if you want media/profile later)
      const params = new URLSearchParams({
        max_results: '5',
        'tweet.fields': 'created_at,text',
      });
      if (next_token) params.set('pagination_token', String(next_token));
  
      const tweetsRes = await fetch(
        `https://api.twitter.com/2/users/${userId}/tweets?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
          cache: 'no-store',
        }
      );
  
      if (!tweetsRes.ok) {
        const detail = await tweetsRes.text();
        res.status(tweetsRes.status).json({ error: 'Tweets fetch failed', detail });
        return;
      }
  
      // 3) Edge/browser cache to cut rate usage
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120, max-age=30');
  
      const tweetsData = await tweetsRes.json();
      if (!tweetsData?.data) {
        res.status(404).json({ error: 'No tweets found or invalid response', details: tweetsData });
        return;
      }
  
      res.status(200).json(tweetsData);
    } catch (err) {
      console.error('Error in /api/getTweets:', err);
      res.status(500).json({ error: 'Server error', message: String(err) });
    }
  }
  