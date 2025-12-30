import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';

export function Setup() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !displayName.trim()) {
      setError('Username and display name are required');
      return;
    }

    if (!/^[a-zA-Z0-9_]{1,30}$/.test(username)) {
      setError('Username must be 1-30 characters, alphanumeric and underscores only');
      return;
    }

    setLoading(true);

    try {
      const user = await api.setup({
        username: username.trim(),
        display_name: displayName.trim(),
        summary: summary.trim() || undefined,
      });
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container">
      <div className="setup-card">
        <div className="setup-header">
          <h1>Create <span style={{ background: 'var(--accent)', padding: '0 8px', borderRadius: '4px' }}>your account</span></h1>
          <p>Set up your profile to get started</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <div className="input-group">
            <label>Username</label>
            <input
              type="text"
              className="input"
              placeholder="alice"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
            <span className="input-hint">Letters, numbers, and underscores only</span>
          </div>

          <div className="input-group">
            <label>Display Name</label>
            <input
              type="text"
              className="input"
              placeholder="Alice"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="input-group">
            <label>Bio</label>
            <textarea
              className="textarea"
              placeholder="Tell us about yourself..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Setting up...' : 'Next'}
          </button>
        </form>
      </div>
    </div>
  );
}
