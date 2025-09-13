export default async function handler(req, res) {
    const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
    const username = 'SonicBoomFest'; // Change this to your target
  
    const userRes = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`
      }
    });
  
    const userData = await userRes.json();
    const userId = userData.data.id;
  
    const tweetsRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=5&tweet.fields=created_at,text`, {
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`
      }
    });
  
    const tweetsData = await tweetsRes.json();
  
    res.setHeader('Access-Control-Allow-Origin', '*'); // allow frontend fetch
    res.status(200).json(tweetsData);
  }
  