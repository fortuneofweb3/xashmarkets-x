const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const { X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI, PORT } = process.env;

// OAuth token exchange
app.post('/auth/token', async (req, res) => {
  try {
    const { code } = req.body;
    const response = await axios.post('https://api.x.com/2/oauth2/token', {
      code,
      grant_type: 'authorization_code',
      client_id: X_CLIENT_ID,
      redirect_uri: X_REDIRECT_URI,
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

// Get user data
app.get('/user', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    const response = await axios.get('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.error || e.message });
  }
});

// OAuth redirect
app.get('/auth', (req, res) => {
  const clientId = X_CLIENT_ID;
  const redirectUri = X_REDIRECT_URI;
  const scope = 'tweet.read users.read like.read offline.access';
  const state = Math.random().toString(36).substring(2);
  const codeChallenge = 'challenge';
  const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=plain`;
  res.redirect(authUrl);
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));