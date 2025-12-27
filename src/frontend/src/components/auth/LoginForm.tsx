import React, { useState } from 'react';
import { Button, Input } from '../common';
import { useAuthStore } from '../../stores/authStore';

interface LoginFormProps {
  onSuccess?: () => void;
  onRegisterClick?: () => void;
}

export function LoginForm({ onSuccess, onRegisterClick }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const { login, isLoading } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
        placeholder="Enter your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        fullWidth
        autoComplete="current-password"
        disabled={isLoading}
      />

      <Button
        type="submit"
        variant="primary"
        fullWidth
        loading={isLoading}
      >
        Sign In
      </Button>

      {onRegisterClick && (
        <p className="text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={onRegisterClick}
            className="text-blue-600 hover:underline"
          >
            Register
          </button>
        </p>
      )}
    </form>
  );
}
