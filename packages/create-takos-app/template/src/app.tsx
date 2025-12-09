import { defineApp } from "@takos/app-sdk";
import { HomeScreen } from "./screens/Home";
import { SettingsScreen } from "./screens/Settings";

export default defineApp({
  screens: [HomeScreen, SettingsScreen]
});
