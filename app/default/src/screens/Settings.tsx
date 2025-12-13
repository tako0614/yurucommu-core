import { Link, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@takos/app-sdk";
import { toast, confirm } from "../lib/ui.js";

export function SettingsScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    const ok = await confirm("Are you sure you want to log out?");
    if (!ok) return;

    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
      navigate("/login");
    } catch (error) {
      console.error("Failed to logout:", error);
      toast("Failed to log out", "error");
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-4 py-3 z-10">
        <h1 className="text-xl font-bold">Settings</h1>
      </header>

      <div className="divide-y divide-gray-200 dark:divide-gray-800">
        {/* Account Section */}
        <section className="py-4">
          <h2 className="px-4 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Account
          </h2>
          <SettingsLink
            to="/settings/profile"
            icon={<UserIcon />}
            title="Edit profile"
            description="Change your display name, bio, and avatar"
          />
          <SettingsLink
            to="/settings/account"
            icon={<KeyIcon />}
            title="Account settings"
            description="Update your email and password"
          />
          <SettingsLink
            to="/settings/privacy"
            icon={<ShieldIcon />}
            title="Privacy and safety"
            description="Manage who can see your content"
          />
        </section>

        {/* Preferences Section */}
        <section className="py-4">
          <h2 className="px-4 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Preferences
          </h2>
          <SettingsLink
            to="/settings/notifications"
            icon={<BellIcon />}
            title="Notifications"
            description="Configure push and email notifications"
          />
          <SettingsLink
            to="/settings/display"
            icon={<PaletteIcon />}
            title="Display"
            description="Theme, font size, and accessibility"
          />
        </section>

        {/* Data Section */}
        <section className="py-4">
          <h2 className="px-4 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Data
          </h2>
          <SettingsLink
            to="/settings/export"
            icon={<DownloadIcon />}
            title="Export your data"
            description="Download a copy of your posts and data"
          />
          <SettingsLink
            to="/settings/blocked"
            icon={<BanIcon />}
            title="Blocked accounts"
            description="Manage accounts you've blocked"
          />
          <SettingsLink
            to="/settings/muted"
            icon={<VolumeOffIcon />}
            title="Muted accounts"
            description="Manage accounts you've muted"
          />
        </section>

        {/* About Section */}
        <section className="py-4">
          <h2 className="px-4 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            About
          </h2>
          <SettingsLink
            to="/about"
            icon={<InfoIcon />}
            title="About takos"
            description="Version, licenses, and acknowledgments"
          />
          <SettingsLink
            to="/help"
            icon={<HelpIcon />}
            title="Help center"
            description="Get help and report issues"
          />
        </section>

        {/* Logout */}
        <section className="py-4">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full px-4 py-3 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600">
              <LogoutIcon />
            </div>
            <div>
              <div className="font-semibold text-red-600">Log out</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                @{user?.handle}
              </div>
            </div>
          </button>
        </section>
      </div>
    </div>
  );
}

interface SettingsLinkProps {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
}

function SettingsLink({ to, icon, title, description }: SettingsLinkProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-400">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{description}</div>
      </div>
      <ChevronRightIcon />
    </Link>
  );
}

function UserIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function BanIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}

function VolumeOffIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}
