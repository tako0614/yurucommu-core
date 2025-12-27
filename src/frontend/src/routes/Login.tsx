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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">yurucommu</h1>
          <p className="mt-2 text-gray-600">
            {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
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
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-gray-500">
                    Or continue with
                  </span>
                </div>
              </div>

              <OAuthButton />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
