import React, { useEffect } from 'react';
import axios from 'axios';
import './App.css';

const AuthCallback = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      axios.post(`${process.env.REACT_APP_API_URL}/auth/token`, { code })
        .then(response => {
          const token = response.data.access_token;
          window.location.href = `/?token=${encodeURIComponent(token)}`;
        })
        .catch(e => alert(`Login failed: ${e.response?.data?.error || e.message}`));
    }
  }, []);

  return <div className="neon-container">Logging in...</div>;
};

export default AuthCallback;