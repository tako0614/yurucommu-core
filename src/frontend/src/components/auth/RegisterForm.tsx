import React, { useState } from 'react';
import { Button, Input } from '../common';
import { useAuthStore } from '../../stores/authStore';

interface RegisterFormProps {
  onSuccess?: () => void;
  onLoginClick?: () => void;
}

export function RegisterForm({ onSuccess, onLoginClick }: RegisterFormProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const { register, isLoading } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !email || !password) {
      setError('Please fill in all required fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (!/^[a-zA-Z0-9_]{1,30}$/.test(username)) {
      setError('Username must be 1-30 characters, alphanumeric and underscores only');
      return;
    }

    try {
      await register({
        username,
        email,
        password,
        display_name: displayName || username,
      });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="p-3 bg-red-100 text-red-600 rounded-lg text-sm">
          {error}
        </div>
      )}

      <Input
        type="text"
        label="Username"
        placeholder="johndoe"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        fullWidth
        autoComplete="username"
        disabled={isLoading}
      />

      <Input
        type="text"
        label="Display Name (optional)"
        placeholder="John Doe"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        fullWidth
        disabled={isLoading}
      />

      <Input
        type="email"
        label="Email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        fullWidth
        autoComplete="email"
        disabled={isLoading}
      />

      <Input
        type="password"
        label="Password"
        placeholder="At least 8 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        fullWidth
        autoComplete="new-password"
        disabled={isLoading}
      />

      <Input
        type="password"
        label="Confirm Password"
        placeholder="Confirm your password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        fullWidth
        autoComplete="new-password"
        disabled={isLoading}
      />

      <Button
        type="submit"
        variant="primary"
        fullWidth
        loading={isLoading}
      >
        Create Account
      </Button>

      {onLoginClick && (
        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <button
            type="button"
            onClick={onLoginClick}
            className="text-blue-600 hover:underline"
          >
            Sign In
          </button>
        </p>
      )}
    </form>
  );
}
