import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const App = () => {
  const [user, setUser] = useState(null);

  const handleLogin = () => {
    const clientId = 'Ynp5SmFtTWhCb05pTW1HV2VfUVM6MTpjaQ';
    const redirectUri = process.env.REACT_APP_API_URL + '/auth/callback';
    const scope = 'tweet.read users.read like.read offline.access';
    const state = Math.random().toString(36).substring(2);
    const codeChallenge = 'challenge';
    const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=plain`;
    window.location.href = authUrl;
  };

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
      localStorage.setItem('x_access_token', token);
      window.history.replaceState({}, document.title, '/');
      fetchUser(token);
    } else {
      const savedToken = localStorage.getItem('x_access_token');
      if (savedToken) fetchUser(savedToken);
    }
  }, []);

  const fetchUser = async (token) => {
    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL}/user`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data.data);
    } catch (e) {
      console.error('Error fetching user:', e);
      alert('Login failed. Please try again.');
    }
  };

  return (
    <div className="neon-container">
      <h1 className="neon-text">XashMarkets 🌌</h1>
      {!user ? (
        <>
          <p>Connect your X account!</p>
          <button onClick={handleLogin}>Connect X</button>
        </>
      ) : (
        <p>Welcome, @{user.username}!</p>
      )}
    </div>
  );
};

export default App;