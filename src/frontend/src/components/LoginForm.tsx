import { useState, FormEvent } from 'react';

interface LoginFormProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
  error: string | null;
}

export function LoginForm({ onLogin, error }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setSubmitting(true);
    await onLogin(username.trim(), password);
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label htmlFor="username" className="block text-sm font-medium text-neutral-300 mb-1">
          Username
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter your username"
          disabled={submitting}
          autoComplete="username"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-neutral-300 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter password"
          disabled={submitting}
          autoComplete="current-password"
        />
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !username.trim() || !password}
        className="w-full bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
