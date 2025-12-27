import React from 'react';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/common';

export function Settings() {
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-gray-200 px-4 py-3 z-10">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
      </header>

      <div className="p-4 space-y-6">
        {/* Account Section */}
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>

          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Username</span>
              <span className="font-medium text-gray-900">@{user?.username}</span>
            </div>

            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Email</span>
              <span className="font-medium text-gray-900">{user?.email ?? 'Not set'}</span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className="text-gray-600">Auth Provider</span>
              <span className="font-medium text-gray-900 capitalize">
                {user?.auth_provider === 'oauth2' ? 'takos' : 'Password'}
              </span>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-white rounded-lg border border-red-200 p-4">
          <h2 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Sign Out</p>
                <p className="text-sm text-gray-500">Sign out of your account</p>
              </div>
              <Button variant="danger" onClick={handleLogout}>
                Sign Out
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
