import { useState, useEffect, useRef } from "react";
import { defineScreen, useCore, useAuth, useTakos } from "@takos/app-sdk";

export const ProfileEditScreen = defineScreen({
  id: "screen.profile_edit",
  path: "/settings/profile",
  title: "Edit Profile",
  auth: "required",
  component: ProfileEdit
});

function ProfileEdit() {
  const core = useCore();
  const { user } = useAuth();
  const { ui, navigate, back } = useTakos();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      try {
        const profile = await core.users.get(user.handle) as any;
        setDisplayName(profile.displayName || "");
        setBio(profile.bio || "");
        setAvatarPreview(profile.avatar || null);
        setBannerPreview(profile.banner || null);
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, [core, user]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBannerFile(file);
      setBannerPreview(URL.createObjectURL(file));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let avatarUrl = avatarPreview;
      let bannerUrl = bannerPreview;

      if (avatarFile) {
        const result = await core.storage.upload(avatarFile, { type: "avatar" }) as any;
        avatarUrl = result.url;
      }

      if (bannerFile) {
        const result = await core.storage.upload(bannerFile, { type: "banner" }) as any;
        bannerUrl = result.url;
      }

      await core.fetch("/me", {
        method: "PATCH",
        body: JSON.stringify({
          displayName,
          bio,
          avatar: avatarUrl,
          banner: bannerUrl
        })
      });

      ui.toast("Profile updated", "success");
      navigate(`/@${user?.handle}`);
    } catch (error) {
      console.error("Failed to save profile:", error);
      ui.toast("Failed to save profile", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => back()}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-900 rounded-full transition-colors"
            aria-label="Back"
          >
            <BackIcon />
          </button>
          <h1 className="text-xl font-bold">Edit profile</h1>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-full font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </header>

      {/* Banner */}
      <div
        className="h-32 md:h-48 bg-gray-200 dark:bg-gray-800 relative cursor-pointer"
        onClick={() => bannerInputRef.current?.click()}
      >
        {bannerPreview && (
          <img
            src={bannerPreview}
            alt=""
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
          <CameraIcon />
        </div>
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          onChange={handleBannerChange}
          className="hidden"
        />
      </div>

      {/* Avatar */}
      <div className="px-4">
        <div
          className="w-24 h-24 md:w-28 md:h-28 -mt-12 md:-mt-14 rounded-full border-4 border-white dark:border-black overflow-hidden bg-gray-200 dark:bg-gray-700 relative cursor-pointer"
          onClick={() => avatarInputRef.current?.click()}
        >
          {avatarPreview ? (
            <img
              src={avatarPreview}
              alt={displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-gray-400">
              {displayName.charAt(0).toUpperCase() || "?"}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
            <CameraIcon />
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Form */}
      <div className="p-4 space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
            Name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={160}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent focus:outline-none focus:border-blue-500 resize-none"
          />
          <p className="text-right text-sm text-gray-500 dark:text-gray-400 mt-1">
            {bio.length}/160
          </p>
        </div>
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
