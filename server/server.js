import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_BASE_URL = 'https://xashmarkets-x-server.onrender.com';

const XashMarketsIntegration = ({ walletAddress }) => {
  const [accessToken, setAccessToken] = useState(null);
  const [userData, setUserData] = useState(null);
  const [events, setEvents] = useState([]);
  const [pollOptions, setPollOptions] = useState([{ tweetId: '', optionText: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const isMounted = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      exchangeCodeForToken(code);
    }
  }, []);

  // Exchange OAuth code for access token
  const exchangeCodeForToken = async (code) => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.post(`${API_BASE_URL}/auth/token`, { code }, {
        headers: { Origin: 'https://dev.fun' }
      });
      if (isMounted.current) {
        const token = response.data.access_token;
        setAccessToken(token);
        await linkAccount(walletAddress, token);
        window.history.replaceState({}, document.title, '/p/6ff87d1cb6c36286929c');
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to authenticate with X');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  // Initiate X OAuth
  const initiateXAuth = () => {
    const clientId = 'Ynp5SmFtTWhCb05pTW1HV2VfUVM6MTpjaQ';
    const redirectUri = 'https://dev.fun/p/6ff87d1cb6c36286929c';
    const scope = 'tweet.read users.read like.read offline.access';
    const state = Math.random().toString(36).substring(2);
    const codeChallenge = 'challenge'; // Static for simplicity; use PKCE in production
    const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=plain`;
    window.location.href = authUrl;
  };

  // Link Solana wallet to X account
  const linkAccount = async (identifier, token) => {
    try {
      setLoading(true);
      setError(null);
      await axios.post(`${API_BASE_URL}/link-account`, {
        identifier,
        accessToken: token
      });
      if (isMounted.current) {
        await fetchUserData(identifier);
        startPolling(identifier);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to link account');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  // Fetch X user data
  const fetchUserData = async (identifier) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/user/${identifier}`);
      if (isMounted.current) {
        setUserData(response.data.data);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to fetch user data');
      }
    }
  };

  // Submit poll options
  const handleAddPollOptions = async () => {
    try {
      setLoading(true);
      setError(null);
      const validOptions = pollOptions.filter(o => o.tweetId.trim() && o.optionText.trim());
      if (validOptions.length === 0) {
        setError('Please enter at least one valid tweet ID and option text');
        return;
      }
      await axios.post(`${API_BASE_URL}/add-poll-options`, { options: validOptions });
      if (isMounted.current) {
        setPollOptions([{ tweetId: '', optionText: '' }]);
        alert('Poll options submitted successfully');
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to add poll options');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  // Poll for events every 30 seconds
  const checkEvents = async (identifier) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/events/${identifier}`);
      if (isMounted.current) {
        setEvents(response.data);
      }
    } catch (err) {
      console.error('Error checking events:', err.message);
    }
  };

  const startPolling = (identifier) => {
    checkEvents(identifier);
    const interval = setInterval(() => checkEvents(identifier), 30000); // 30 seconds
    return () => clearInterval(interval);
  };

  // Handle poll option input changes
  const handleOptionChange = (index, field, value) => {
    const newPollOptions = [...pollOptions];
    newPollOptions[index][field] = value;
    setPollOptions(newPollOptions);
  };

  // Add new poll option input field
  const addPollOptionField = () => {
    setPollOptions([...pollOptions, { tweetId: '', optionText: '' }]);
  };

  return (
    <div style={{
      color: '#00FF87',
      background: '#050A24',
      fontFamily: 'Inter, monospace',
      padding: '20px',
      textAlign: 'center',
      minHeight: '100vh'
    }}>
      <h1 style={{ textShadow: '0 0 10px #00FF87', fontSize: '2.5em' }}>XashMarkets Integration</h1>
      {!walletAddress ? (
        <p style={{ fontSize: '1.2em' }}>Connect your Solana wallet to proceed.</p>
      ) : !accessToken ? (
        <>
          <p>Wallet: {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}</p>
          <button
            onClick={initiateXAuth}
            style={{
              background: '#050A24',
              color: '#00FF87',
              border: '2px solid #FF5547',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '18px',
              boxShadow: '0 0 10px #FF5547',
              transition: 'all 0.3s',
              borderRadius: '5px'
            }}
            onMouseOver={e => e.target.style.boxShadow = '0 0 15px #FF5547'}
            onMouseOut={e => e.target.style.boxShadow = '0 0 10px #FF5547'}
          >
            Connect X Account
          </button>
        </>
      ) : (
        <>
          <p>Connected as @{userData?.username || '...'}</p>
          <h2 style={{ marginTop: '20px' }}>Submit @XashMarkets Poll Options</h2>
          {pollOptions.map((option, index) => (
            <div key={index} style={{ margin: '10px 0' }}>
              <input
                type="text"
                value={option.tweetId}
                onChange={(e) => handleOptionChange(index, 'tweetId', e.target.value)}
                placeholder="Tweet ID (e.g., 123456789)"
                style={{
                  margin: '5px',
                  padding: '8px',
                  background: '#050A24',
                  color: '#00FF87',
                  border: '1px solid #FF5547',
                  borderRadius: '3px',
                  width: '200px'
                }}
              />
              <input
                type="text"
                value={option.optionText}
                onChange={(e) => handleOptionChange(index, 'optionText', e.target.value)}
                placeholder="Option (e.g., Yes)"
                style={{
                  margin: '5px',
                  padding: '8px',
                  background: '#050A24',
                  color: '#00FF87',
                  border: '1px solid #FF5547',
                  borderRadius: '3px',
                  width: '100px'
                }}
              />
            </div>
          ))}
          <button
            onClick={addPollOptionField}
            style={{
              margin: '5px',
              padding: '8px 15px',
              background: '#050A24',
              color: '#00FF87',
              border: '1px solid #FF5547',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            Add Poll Option
          </button>
          <button
            onClick={handleAddPollOptions}
            style={{
              margin: '5px',
              padding: '8px 15px',
              background: '#050A24',
              color: '#00FF87',
              border: '1px solid #FF5547',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            Submit Poll Options
          </button>
          <h2 style={{ marginTop: '20px' }}>Your Votes</h2>
          {loading ? (
            <p>Loading...</p>
          ) : error ? (
            <p style={{ color: '#FF5547' }}>{error}</p>
          ) : events.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, maxWidth: '600px', margin: '0 auto' }}>
              {events.map((event, index) => (
                <li key={index} style={{
                  margin: '10px 0',
                  padding: '10px',
                  background: '#0A1F44',
                  borderRadius: '5px',
                  boxShadow: '0 0 5px #00FF87'
                }}>
                  {event.event_type === 'account_connected'
                    ? `Connected X account at ${new Date(event.timestamp).toLocaleString()}`
                    : `Voted ${event.option_text} (Tweet ID: ${event.tweet_id}) at ${new Date(event.timestamp).toLocaleString()}`}
                </li>
              ))}
            </ul>
          ) : (
            <p>No votes yet. Like an @XashMarkets poll tweet to vote!</p>
          )}
        </>
      )}
    </div>
  );
};

export default XashMarketsIntegration;
