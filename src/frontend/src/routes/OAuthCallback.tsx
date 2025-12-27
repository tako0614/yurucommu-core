import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    const error = searchParams.get('error');

    if (error) {
      // OAuth error - redirect to login with error
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }

    // If we get here, the backend has already processed the callback
    // and set the session cookie. We just need to refresh auth state.
    checkAuth().then(() => {
      navigate('/', { replace: true });
    });
  }, [searchParams, navigate, checkAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  );
}
