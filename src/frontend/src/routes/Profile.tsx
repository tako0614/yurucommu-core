import React, { useState } from 'react';
import { Avatar, Button, Input } from '../components/common';
import { TextArea } from '../components/common/Input';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api/client';

export function Profile() {
  const { user, setUser } = useAuthStore();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [summary, setSummary] = useState(user?.summary ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      const updated = await api.updateMe({
        display_name: displayName,
        summary,
      });
      setUser(updated);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDisplayName(user?.display_name ?? '');
    setSummary(user?.summary ?? '');
    setIsEditing(false);
  };

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-gray-200 px-4 py-3 z-10">
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
      </header>

      {/* Header Image */}
      <div className="h-32 bg-gradient-to-r from-blue-500 to-purple-600" />

      {/* Profile Info */}
      <div className="px-4 pb-4">
        <div className="flex justify-between items-end -mt-12 mb-4">
          <Avatar
            src={user.avatar_url}
            alt={user.display_name}
            size="xl"
            className="border-4 border-white"
          />
          {!isEditing && (
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              Edit Profile
            </Button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-600 rounded-lg text-sm">
            {error}
          </div>
        )}

        {isEditing ? (
          <div className="space-y-4">
            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              fullWidth
            />
            <TextArea
              label="Bio"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              fullWidth
              rows={3}
            />
            <div className="flex gap-2">
              <Button onClick={handleSave} loading={saving}>
                Save
              </Button>
              <Button variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-gray-900">{user.display_name}</h2>
            <p className="text-gray-500">@{user.username}</p>
            {user.summary && (
              <p className="mt-3 text-gray-700 whitespace-pre-wrap">{user.summary}</p>
            )}
            {user.email && (
              <p className="mt-2 text-sm text-gray-500">{user.email}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
