import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginForm, RegisterForm, OAuthButton } from '../components/auth';
import { useAuthStore } from '../stores/authStore';

type AuthMode = 'login' | 'register';

export function Login() {
  const [mode, setMode] = useState<AuthMode>('login');
  const navigate = useNavigate();
  const { isAuthenticated, authMethods, checkAuth, isLoading } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSuccess = () => {
    navigate('/', { replace: true });
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src="/yurucommu.png" alt="yurucommu" className="login-logo" />
          <h1>yurucommu</h1>
          <p className="login-description">
            {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        <div className="login-body">
          {mode === 'login' ? (
            <LoginForm
              onSuccess={handleSuccess}
              onRegisterClick={() => setMode('register')}
            />
          ) : (
            <RegisterForm
              onSuccess={handleSuccess}
              onLoginClick={() => setMode('login')}
            />
          )}

          {authMethods.oauth && (
            <>
              <div style={{ margin: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
                Or continue with
              </div>
              <OAuthButton />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
