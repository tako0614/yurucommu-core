import { useState, useRef, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFetch } from "@takos/app-sdk";
import { createCoreApi } from "../lib/core-api.js";
import { toast } from "../lib/ui.js";

export function OnboardingScreen() {
  const fetch = useFetch();
  const core = createCoreApi(fetch);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const redirectTo = searchParams.get("redirect") || "/";

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleNext = () => {
    if (step === 1 && !displayName.trim()) {
      toast("Please enter a display name", "error");
      return;
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleComplete = async () => {
    if (!displayName.trim()) {
      toast("Please enter a display name", "error");
      return;
    }

    setSaving(true);
    try {
      let avatarUrl: string | undefined;

      if (avatarFile) {
        const result = await core.uploadFile(avatarFile);
        avatarUrl = result.url;
      }

      await core.updateProfile({
        display_name: displayName.trim(),
        bio: bio.trim() || undefined,
        avatar_url: avatarUrl || undefined,
      });

      toast("Profile setup complete!", "success");
      navigate(redirectTo);
    } catch (error) {
      console.error("Failed to complete profile:", error);
      toast("Failed to complete profile setup", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Progress indicator */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 h-1 rounded-full transition-colors ${
                s <= step ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* Step 1: Display Name */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Welcome to takos!</h1>
              <p className="text-gray-500 dark:text-gray-400">
                Let's set up your profile. What should we call you?
              </p>
            </div>

            <div>
              <label htmlFor="displayName" className="block text-sm font-medium mb-2">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                maxLength={50}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent focus:outline-none focus:border-blue-500 text-lg"
                autoFocus
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                This is how you'll appear to others
              </p>
            </div>

            <button
              type="button"
              onClick={handleNext}
              disabled={!displayName.trim()}
              className="w-full py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Avatar */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Add a profile photo</h1>
              <p className="text-gray-500 dark:text-gray-400">
                Help people recognize you with a photo
              </p>
            </div>

            <div className="flex flex-col items-center">
              <div
                className="w-32 h-32 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center cursor-pointer overflow-hidden relative group"
                onClick={() => avatarInputRef.current?.click()}
              >
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-4xl font-bold text-gray-400">
                    {displayName.charAt(0).toUpperCase() || "?"}
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CameraIcon />
                </div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="mt-4 text-blue-600 hover:underline"
              >
                {avatarPreview ? "Change photo" : "Upload photo"}
              </button>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 border border-gray-300 dark:border-gray-600 rounded-full font-semibold hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-colors"
              >
                {avatarPreview ? "Continue" : "Skip"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Bio */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Tell us about yourself</h1>
              <p className="text-gray-500 dark:text-gray-400">
                Add a short bio to let people know who you are
              </p>
            </div>

            <div>
              <label htmlFor="bio" className="block text-sm font-medium mb-2">
                Bio
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A few words about yourself..."
                maxLength={160}
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent focus:outline-none focus:border-blue-500 resize-none"
              />
              <p className="text-right text-sm text-gray-500 dark:text-gray-400 mt-1">
                {bio.length}/160
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 border border-gray-300 dark:border-gray-600 rounded-full font-semibold hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={saving}
                className="flex-1 py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Complete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
