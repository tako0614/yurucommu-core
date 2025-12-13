import * as React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import {
  HomeScreen,
  ProfileScreen,
  ProfileEditScreen,
  NotificationsScreen,
  SettingsScreen,
  OnboardingScreen,
} from "./screens/index.js";

function AppRouter(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/@:handle" element={<ProfileScreen />} />
        <Route path="/settings/profile" element={<ProfileEditScreen />} />
        <Route path="/notifications" element={<NotificationsScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/onboarding" element={<OnboardingScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRouter;

