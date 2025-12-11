import { defineApp } from "@takos/app-sdk";

// Screens
import { HomeScreen } from "./screens/Home";
import { ProfileScreen } from "./screens/Profile";
import { ProfileEditScreen } from "./screens/ProfileEdit";
import { NotificationsScreen } from "./screens/Notifications";
import { SettingsScreen } from "./screens/Settings";
import { OnboardingScreen } from "./screens/Onboarding";

// Components
export { PostCard, type Post } from "./components/PostCard";

/**
 * Default App for takos
 *
 * This is the built-in default application that provides core social
 * networking features: timeline, profiles, notifications, and settings.
 *
 * The app is built using @takos/app-sdk and React, providing a reference
 * implementation for custom apps built on the takos platform.
 */
export default defineApp({
  id: "takos.default",
  name: "takos",
  version: "0.1.0",
  description: "Default takos application with timeline, profiles, and social features",
  screens: [
    HomeScreen,
    ProfileScreen,
    ProfileEditScreen,
    NotificationsScreen,
    SettingsScreen,
    OnboardingScreen
  ],
  permissions: [
    "core:posts.read",
    "core:posts.write",
    "core:posts.delete",
    "core:users.read",
    "core:users.follow",
    "core:timeline.read",
    "core:notifications.read",
    "core:notifications.write",
    "core:storage.upload"
  ]
});

// Re-export screens for external use
export {
  HomeScreen,
  ProfileScreen,
  ProfileEditScreen,
  NotificationsScreen,
  SettingsScreen,
  OnboardingScreen
};
