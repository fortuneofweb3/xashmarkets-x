const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const HttpsProxyAgent = require('https-proxy-agent');

dotenv.config();
const app = express();
app.use(cors({ origin: ['https://xashmarkets-x-client.onrender.com', 'https://dev.fun'] }));
app.use(express.json());

const { X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI, PORT, X_BEARER_TOKEN, PROXY_URL } = process.env;

// Initialize proxy with error handling
let proxyAgent;
try {
  proxyAgent = new HttpsProxyAgent(PROXY_URL);
  console.log('ProxyAgent initialized successfully');
} catch (error) {
  console.error('Failed to initialize proxy agent:', error.message);
}

const db = new sqlite3.Database('xashmarkets.db');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    identifier TEXT PRIMARY KEY,
    x_user_id TEXT NOT NULL,
    x_access_token TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    x_user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    tweet_id TEXT,
    timestamp DATETIME NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tweet_ids (
    tweet_id TEXT PRIMARY KEY
  )`);
});

// Add tweet IDs
app.post('/add-tweet-ids', async (req, res) => {
  const { tweetIds } = req.body;
  try {
    if (!Array.isArray(tweetIds) || tweetIds.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty tweetIds array' });
    }
    const stmt = db.prepare(`INSERT OR IGNORE INTO tweet_ids (tweet_id) VALUES (?)`);
    tweetIds.forEach(id => stmt.run(id));
    stmt.finalize();
    res.json({ status: 'Tweet IDs added' });
    console.log(`Added tweet IDs: ${tweetIds.join(', ')}`);
  } catch (error) {
    console.error('Error adding tweet IDs:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Link DevFun identifier to X account
app.post('/link-account', async (req, res) => {
  const { identifier, accessToken } = req.body;
  try {
    if (!identifier || !accessToken) {
      return res.status(400).json({ error: 'Missing identifier or accessToken' });
    }
    const xUserId = await getUserId(accessToken);
    db.run(
      `INSERT OR REPLACE INTO users (identifier, x_user_id, x_access_token) VALUES (?, ?, ?)`,
      [identifier, xUserId, accessToken],
      (err) => { if (err) throw err; }
    );
    db.run(
      `INSERT INTO events (id, identifier, x_user_id, event_type, tweet_id, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), identifier, xUserId, 'account_connected', null],
      (err) => { if (err) console.error('Event insertion error:', err.message); }
    );
    res.json({ status: 'Account linked' });
    console.log(`Linked account for identifier: ${identifier}`);
  } catch (error) {
    console.error('Error linking account:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// OAuth token exchange
app.post('/auth/token', async (req, res) => {
  try {
    const { code } = req.body;
    const redirectUri = req.headers.origin === 'https://dev.fun' ? 'https://dev.fun/p/6ff87d1cb6c36286929c/auth/callback' : X_REDIRECT_URI;
    const response = await axios.post('https://api.x.com/2/oauth2/token', {
      code,
      grant_type: 'authorization_code',
      client_id: X_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: 'challenge',
    }, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    res.json(response.data);
    console.log('OAuth token exchanged successfully');
  } catch (error) {
    console.error('OAuth token error:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Get user ID from token
async function getUserId(token) {
  try {
    const response = await axios.get('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent: proxyAgent
    });
    return response.data.data.id;
  } catch (error) {
    console.error('Get user ID error:', error.message);
    throw error;
  }
}

// Get user data
app.get('/user/:identifier', async (req, res) => {
  const { identifier } = req.params;
  try {
    db.get(
      `SELECT x_user_id, x_access_token FROM users WHERE identifier = ?`,
      [identifier],
      async (err, row) => {
        if (err) throw err;
        if (!row) return res.status(404).json({ error: 'User not found' });
        const response = await axios.get('https://api.x.com/2/users/me', {
          headers: { Authorization: `Bearer ${row.x_access_token}` },
          httpsAgent: proxyAgent
        });
        res.json(response.data);
        console.log(`Fetched user data for identifier: ${identifier}`);
      }
    );
  } catch (error) {
    console.error('Get user data error:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Get user events
app.get('/events/:identifier', async (req, res) => {
  const { identifier } = req.params;
  try {
    db.all(
      `SELECT event_type, tweet_id, timestamp FROM events WHERE identifier = ? ORDER BY timestamp DESC`,
      [identifier],
      (err, rows) => {
        if (err) throw err;
        res.json(rows);
        console.log(`Fetched events for identifier: ${identifier}`);
      }
    );
  } catch (error) {
    console.error('Get events error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Check likes
app.post('/check-likes', async (req, res) => {
  const { identifier } = req.body;
  try {
    db.get(
      `SELECT x_user_id FROM users WHERE identifier = ?`,
      [identifier],
      async (err, row) => {
        if (err) throw err;
        if (!row) return res.status(404).json({ error: 'User not found' });
        const xUserId = row.x_user_id;
        db.all(
          `SELECT tweet_id FROM tweet_ids`,
          async (err, tweetRows) => {
            if (err) throw err;
            const tweetIds = tweetRows.map(row => row.tweet_id);
            for (const tweetId of tweetIds) {
              try {
                const response = await axios.get(`https://api.x.com/2/tweets/${tweetId}/liking_users`, {
                  headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
                  httpsAgent: proxyAgent
                });
                const likers = response.data.data || [];
                if (likers.find(liker => liker.id === xUserId)) {
                  db.run(
                    `INSERT OR REPLACE INTO events (id, identifier, x_user_id, event_type, tweet_id, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
                    [uuidv4(), identifier, xUserId, 'liked_tweet', tweetId],
                    (err) => { if (err) console.error('Like event error:', err.message); }
                  );
                }
              } catch (error) {
                console.error(`Error checking likes for tweet ${tweetId}:`, error.message);
              }
            }
            res.json({ status: 'Likes checked' });
            console.log(`Checked likes for identifier: ${identifier}`);
          }
        );
      }
    );
  } catch (error) {
    console.error('Check likes error:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// OAuth redirect
app.get('/auth', (req, res) => {
  try {
    const clientId = X_CLIENT_ID;
    const redirectUri = req.headers.referer?.includes('dev.fun') ? 'https://dev.fun/p/6ff87d1cb6c36286929c/auth/callback' : X_REDIRECT_URI;
    const scope = 'tweet.read users.read like.read offline.access';
    const state = Math.random().toString(36).substring(2);
    const codeChallenge = 'challenge';
    const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=plain`;
    res.redirect(authUrl);
    console.log('Redirecting to OAuth URL');
  } catch (error) {
    console.error('OAuth redirect error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
