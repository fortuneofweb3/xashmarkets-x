const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const HttpsProxyAgent = require('https-proxy-agent');

dotenv.config();
const app = express();
app.use(cors({ origin: ['https://xashmarkets-x-client.onrender.com', 'https://dev.live'] }));
app.use(express.json());

const { X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI, PORT, X_BEARER_TOKEN, PROXY_URL } = process.env;

let proxyAgent;
try {
  proxyAgent = new HttpsProxyAgent(PROXY_URL);
  console.log('ProxyAgent initialized');
} catch (error) {
  console.error('ProxyAgent error:', error.message);
  process.exit(1);
}

const dbPath = process.env.DB_PATH || './xashmarkets.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }
  console.log(`Connected to ${dbPath}`);
});

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
    option_text TEXT,
    timestamp DATETIME NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS poll_options (
    tweet_id TEXT PRIMARY KEY,
    option_text TEXT NOT NULL
  )`);
  console.log('Database tables initialized');
});

app.post('/add-poll-options', async (req, res) => {
  const { options } = req.body; // [{ tweetId: "123456789", optionText: "Yes" }, ...]
  try {
    if (!Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty options array' });
    }
    const stmt = db.prepare(`INSERT OR IGNORE INTO poll_options (tweet_id, option_text) VALUES (?, ?)`);
    options.forEach(({ tweetId, optionText }) => stmt.run(tweetId, optionText));
    stmt.finalize();
    res.json({ status: 'Poll options added' });
    console.log(`Added poll options: ${options.map(o => o.tweetId).join(', ')}`);
  } catch (error) {
    console.error('Error adding poll options:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
      `INSERT INTO events (id, identifier, x_user_id, event_type, tweet_id, option_text, timestamp) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), identifier, xUserId, 'account_connected', null, null],
      (err) => { if (err) console.error('Event error:', err.message); }
    );
    res.json({ status: 'Account linked' });
    console.log(`Linked account for ${identifier}`);
  } catch (error) {
    console.error('Link account error:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

app.post('/auth/token', async (req, res) => {
  try {
    const { code } = req.body;
    const redirectUri = req.headers.origin === 'https://dev.live' ? 'https://dev.live/p/6ff87d1cb6c36286929c' : X_REDIRECT_URI;
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
    console.log('OAuth token exchanged');
  } catch (error) {
    console.error('OAuth token error:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

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
        console.log(`Fetched user data for ${identifier}`);
      }
    );
  } catch (error) {
    console.error('Get user data error:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

app.get('/events/:identifier', async (req, res) => {
  const { identifier } = req.params;
  try {
    db.all(
      `SELECT event_type, tweet_id, option_text, timestamp FROM events WHERE identifier = ? ORDER BY timestamp DESC`,
      [identifier],
      (err, rows) => {
        if (err) throw err;
        res.json(rows);
        console.log(`Fetched events for ${identifier}`);
      }
    );
  } catch (error) {
    console.error('Get events error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/check-likes', async (req, res) => {
  try {
    db.all(
      `SELECT tweet_id, option_text FROM poll_options`,
      async (err, optionRows) => {
        if (err) throw err;
        for (const { tweet_id, option_text } of optionRows) {
          try {
            const response = await axios.get(`https://api.x.com/2/tweets/${tweet_id}/liking_users`, {
              headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
              httpsAgent: proxyAgent
            });
            const likers = response.data.data || [];
            for (const liker of likers) {
              db.get(
                `SELECT identifier FROM users WHERE x_user_id = ?`,
                [liker.id],
                (err, userRow) => {
                  if (err) throw err;
                  if (userRow) {
                    const identifier = userRow.identifier;
                    db.get(
                      `SELECT id FROM events WHERE identifier = ? AND tweet_id = ? AND event_type = 'vote_registered'`,
                      [identifier, tweet_id],
                      (err, voteRow) => {
                        if (err) throw err;
                        if (!voteRow) {
                          db.run(
                            `INSERT INTO events (id, identifier, x_user_id, event_type, tweet_id, option_text, timestamp) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                            [uuidv4(), identifier, liker.id, 'vote_registered', tweet_id, option_text],
                            (err) => { if (err) console.error('Vote event error:', err.message); }
                          );
                          console.log(`Registered vote for ${identifier} on ${tweet_id} (${option_text})`);
                        }
                      }
                    );
                  }
                }
              );
            }
          } catch (error) {
            console.error(`Error checking likes for ${tweet_id}:`, error.message);
          }
        }
        res.json({ status: 'Likes checked' });
        console.log('Checked likes for all poll options');
      }
    );
  } catch (error) {
    console.error('Check likes error:', error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

app.get('/auth', (req, res) => {
  try {
    const clientId = X_CLIENT_ID;
    const redirectUri = req.headers.referer?.includes('dev.live') ? 'https://dev.live/p/6ff87d1cb6c36286929c' : X_REDIRECT_URI;
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
