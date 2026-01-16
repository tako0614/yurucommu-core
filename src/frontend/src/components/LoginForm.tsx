import { useState, useEffect, FormEvent } from 'react';

interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
}

interface AuthConfig {
  providers: OAuthProvider[];
  password_enabled: boolean;
}

interface LoginFormProps {
  onLogin: (password: string) => Promise<boolean>;
  error: string | null;
}

// Provider icons (inline SVG)
const ProviderIcons: Record<string, JSX.Element> = {
  google: (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  ),
  takos: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <circle cx="12" cy="12" r="10" fill="#10B981"/>
      <text x="12" y="16" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">T</text>
    </svg>
  ),
};

export function LoginForm({ onLogin, error }: LoginFormProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/providers')
      .then(res => res.json())
      .then((data: AuthConfig) => {
        setAuthConfig(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load auth providers:', err);
        // Fallback to password only
        setAuthConfig({ providers: [], password_enabled: true });
        setLoading(false);
      });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setSubmitting(true);
    await onLogin(password);
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="w-full max-w-sm flex justify-center py-8">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasOAuth = authConfig && authConfig.providers.length > 0;
  const hasPassword = authConfig?.password_enabled;

  // 認証方法が設定されていない場合
  if (!hasOAuth && !hasPassword) {
    return (
      <div className="w-full max-w-sm text-center text-neutral-400">
        <p>認証方法が設定されていません。</p>
        <p className="text-sm mt-2">管理者に連絡してください。</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      {/* OAuth Providers */}
      {hasOAuth && (
        <div className="space-y-3">
          {authConfig.providers.map(provider => (
            <a
              key={provider.id}
              href={`/api/auth/login/${provider.id}`}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 hover:bg-neutral-700 transition-colors"
            >
              {ProviderIcons[provider.id] || (
                <span className="w-5 h-5 bg-neutral-600 rounded-full" />
              )}
              <span>{provider.name}でログイン</span>
            </a>
          ))}
        </div>
      )}

      {/* Divider */}
      {hasOAuth && hasPassword && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-neutral-900 text-neutral-500">または</span>
          </div>
        </div>
      )}

      {/* Password Form */}
      {hasPassword && (
        <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="パスワードを入力"
              disabled={submitting}
              autoComplete="current-password"
              autoFocus={!hasOAuth}
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
      )}
    </div>
  );
}
