import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '../components/common';
import { TextArea } from '../components/common/Input';
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Welcome to yurucommu</h1>
          <p className="mt-2 text-gray-600">Let's set up your profile</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-600 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <Input
              label="Username"
              placeholder="johndoe"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              fullWidth
              disabled={loading}
            />

            <Input
              label="Display Name"
              placeholder="John Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              fullWidth
              disabled={loading}
            />

            <TextArea
              label="Bio (optional)"
              placeholder="Tell us about yourself..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              fullWidth
              rows={3}
              disabled={loading}
            />

            <Button type="submit" fullWidth loading={loading}>
              Complete Setup
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
