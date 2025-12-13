/**
 * Client-side entry point for the app.
 *
 * This file implements the React app using react-router-dom and
 * the App SDK client hooks.
 */

import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { useAuth, useFetch, useAppInfo } from "@takos/app-sdk/client";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

function Home() {
  const { user, isLoggedIn } = useAuth();
  const fetch = useFetch();

  if (!isLoggedIn) {
    return (
      <div>
        <h1>Welcome</h1>
        <p>Please log in to continue.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome, {user?.displayName}</h1>
      <p>You are logged in as @{user?.handle}</p>
      <nav>
        <Link to="/settings">Settings</Link>
      </nav>
    </div>
  );
}

function Settings() {
  const { appId, version } = useAppInfo();

  return (
    <div>
      <h1>Settings</h1>
      <p>App ID: {appId}</p>
      <p>Version: {version}</p>
      <nav>
        <Link to="/">Back to Home</Link>
      </nav>
    </div>
  );
}

export default App;
