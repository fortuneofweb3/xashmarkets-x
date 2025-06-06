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

const { X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI, PORT, X_BEARER_TOKEN, PROXY_URL, TWEET_IDS } = process.env;
const tweetIds = TWEET_IDS ? TWEET_IDS.split(',') : [];
const db = new sqlite3.Database('xashmarkets.db');
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

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
      (err) => { if (err) console.error(err); }
    );
    res.json({ status: 'Account linked' });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.error || e.message });
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
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.error || e.message });
  }
});

// Get user ID from token
async function getUserId(token) {
  const response = await axios.get('https://api.x.com/2/users/me', {
    headers: { Authorization: `Bearer ${token}` },
    httpsAgent: proxyAgent
  });
  return response.data.data.id;
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
      }
    );
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.error || e.message });
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
      }
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
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
        for (const tweetId of tweetIds) {
          const response = await axios.get(`https://api.x.com/2/tweets/${tweetId}/liking_users`, {
            headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
            httpsAgent: proxyAgent
          });
          const likers = response.data.data || [];
          if (likers.find(liker => liker.id === xUserId)) {
            db.run(
              `INSERT OR REPLACE INTO events (id, identifier, x_user_id, event_type, tweet_id, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
              [uuidv4(), identifier, xUserId, 'liked_tweet', tweetId],
              (err) => { if (err) console.error(err); }
            );
          }
        }
        res.json({ status: 'Likes checked' });
      }
    );
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.error || e.message });
  }
});

// OAuth redirect
app.get('/auth', (req, res) => {
  const clientId = X_CLIENT_ID;
  const redirectUri = req.headers.referer?.includes('dev.fun') ? 'https://dev.fun/p/6ff87d1cb6c36286929c/auth/callback' : X_REDIRECT_URI;
  const scope = 'tweet.read users.read like.read offline.access';
  const state = Math.random().toString(36).substring(2);
  const codeChallenge = 'challenge';
  const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=plain`;
  res.redirect(authUrl);
  });

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
