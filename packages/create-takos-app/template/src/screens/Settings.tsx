import { Link, defineScreen } from "@takos/app-sdk";

export const SettingsScreen = defineScreen({
  id: "screen.settings",
  path: "/settings",
  auth: "required",
  component: Settings
});

function Settings() {
  return (
    <div>
      <h1>Settings</h1>
      <Link to="/">Back to Home</Link>
    </div>
  );
}
