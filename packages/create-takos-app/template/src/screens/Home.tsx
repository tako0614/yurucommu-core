import { Link, defineScreen, useAuth } from "@takos/app-sdk";

export const HomeScreen = defineScreen({
  id: "screen.home",
  path: "/",
  auth: "required",
  component: Home
});

function Home() {
  const { user } = useAuth();
  return (
    <div>
      <h1>Welcome, {user?.displayName}</h1>
      <Link to="/settings">Settings</Link>
    </div>
  );
}
