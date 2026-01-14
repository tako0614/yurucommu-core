import { useState, FormEvent } from 'react';

interface LoginFormProps {
  onLogin: (password: string, username?: string) => Promise<boolean>;
  error: string | null;
}

export function LoginForm({ onLogin, error }: LoginFormProps) {
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setSubmitting(true);
    await onLogin(password, username || undefined);
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-neutral-300 mb-1">
          パスワード
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="インスタンスパスワードを入力"
          disabled={submitting}
          autoComplete="current-password"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="username" className="block text-sm font-medium text-neutral-300 mb-1">
          ユーザー名 (新規作成時のみ)
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="ユーザー名 (空欄で既存ユーザー)"
          disabled={submitting}
          autoComplete="username"
        />
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !password}
        className="w-full bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'ログイン中...' : 'ログイン'}
      </button>
    </form>
  );
}
