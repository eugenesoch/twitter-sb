export default async function handler(req, res) {
    const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
    const username = 'SonicBoomFest';
  
    if (!BEARER_TOKEN) {
      return res.status(500).json({ error: 'Bearer token missing from environment.' });
    }
  
    try {
      // Step 1: Get user ID by username
      const userRes = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
        headers: {
          'Authorization': `Bearer ${BEARER_TOKEN}`
        }
      });
  
      const userData = await userRes.json();
  
      if (!userData.data || !userData.data.id) {
        return res.status(404).json({ error: 'Twitter user not found.', details: userData });
      }
  
      const userId = userData.data.id;
  
      // Step 2: Get tweets by user ID
      const tweetsRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=5&tweet.fields=created_at,text`, {
        headers: {
          'Authorization': `Bearer ${BEARER_TOKEN}`
        }
      });
  
      const tweetsData = await tweetsRes.json();
  
      if (!tweetsData.data) {
        return res.status(404).json({ error: 'No tweets found or invalid response.', details: tweetsData });
      }
  
      // Step 3: Return tweets
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json(tweetsData);
  
    } catch (err) {
      console.error('Error in Twitter API function:', err);
      return res.status(500).json({ error: 'Server error', message: err.message });
    }
  }
  