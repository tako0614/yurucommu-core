import { Navigate, Route, Router, useLocation, useNavigate } from "@solidjs/router";
import type { RouteSectionProps } from "@solidjs/router";
import { Show, createEffect, createMemo, createResource, createSignal, onMount, type JSX, type Resource } from "solid-js";
import "./App.css";
import SideNav from "./components/Navigation/SideNav";
import AppTab from "./components/Navigation/AppTab";
import PostComposer from "./components/PostComposer";
import NotificationPanel from "./components/NotificationPanel";
import Connections from "./pages/Connections";
import CommunityHub from "./pages/CommunityHub";
import Chat from "./pages/Chat";
import DefaultLogin from "./pages/Login";
import Compose from "./pages/Compose";
import Settings from "./pages/Settings";
import { authStatus, refreshAuth, fetchMe } from "./lib/api";
import DefaultProfile from "./pages/Profile";
import { resolveComponent } from "./lib/plugins";
import EditProfile from "./pages/EditProfile";
import UserProfile from "./pages/UserProfile";
import Onboarding from "./pages/Onboarding";
import Home from "./pages/Home";
import Stories from "./pages/Stories";
import PostDetail from "./pages/PostDetail";
import UserSearch from "./pages/UserSearch";
import Invitations from "./pages/Invitations";
import FriendRequests from "./pages/FriendRequests";
import { ToastProvider } from "./components/Toast";
import { ShellContextProvider, useShellContext } from "./lib/shell-context";
import DynamicScreen from "./pages/DynamicScreen";
import { registerCustomComponents } from "./lib/ui-components";
import { RenderScreen } from "./lib/ui-runtime";
import { extractRouteParams, getScreenByRoute, loadAppManifest, type AppManifest, type AppManifestScreen } from "./lib/app-manifest";

// Register custom UiNode components on module load
registerCustomComponents();

/**
 * Feature flag for App Manifest driven UI
 * Set to true to enable dynamic screen rendering from App Manifest
 * (PLAN.md 5.4: App Manifest 駆動 UI)
 *
 * When enabled:
 * - CatchAllRoute will try to render screens from App Manifest
 * - Unknown routes will fall back to DynamicScreen instead of 404
 *
 * Migration strategy:
 * 1. Keep existing routes as-is for stability
 * 2. New screens can be defined in App Manifest
 * 3. Gradually replace existing screens with UiNode definitions
 */
const USE_DYNAMIC_SCREENS = true;

const Login = resolveComponent("Login", DefaultLogin);
const Profile = resolveComponent("Profile", DefaultProfile);
const AuthCallback = resolveComponent("AuthCallback", DefaultAuthCallback);

export default function App() {
  const [manifest] = createResource<AppManifest | undefined>(loadAppManifest);

  return (
    <ToastProvider>
      <Router>
        <Route path="/" component={Shell}>
          <Route path="/auth/callback" component={AuthCallback} />
          <Route
            path="/"
            component={() => (
              <RequireAuth allowIncompleteProfile>
                <ManifestScreenBoundary manifest={manifest} fallback={<Home />} />
              </RequireAuth>
            )}
          />
          <Route path="/login" component={Login} />
          <Route
            path="/onboarding"
            component={() => (
              <RequireAuth allowIncompleteProfile>
                <ManifestScreenBoundary manifest={manifest} fallback={<Onboarding />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/connections"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Connections />} />
              </RequireAuth>
            )}
          />
          {/* Legacy routes redirect to connections */}
          <Route path="/friends" component={() => <Navigate href="/connections" />} />
          <Route
            path="/communities"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Navigate href="/connections" />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/users"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<UserSearch />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/invitations"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Invitations />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/follow-requests"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<FriendRequests />} />
              </RequireAuth>
            )}
          />
          <Route path="/friend-requests" component={() => <Navigate href="/follow-requests" />} />
          <Route
            path="/c/:id"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<CommunityHub />} />
              </RequireAuth>
            )}
          />
          {/* Legacy community chat path -> unified chat */}
          <Route
            path="/c/:id/chat"
            component={LegacyCommunityChatRedirect}
          />
          {/* Unified Chat routes - single mount to prevent remount/reset */}
          <Route
            path="/chat/*"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Chat />} />
              </RequireAuth>
            )}
          />
          {/* Legacy DM paths -> unified chat */}
          <Route
            path="/dm"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Navigate href="/chat" />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/dm/:id"
            component={() => (
              <RequireAuth>
                <LegacyDMRedirect />
              </RequireAuth>
            )}
          />
          <Route
            path="/compose"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Compose />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/stories"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Stories />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/settings"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Settings />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/posts/:id"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<PostDetail />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/profile"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<Profile />} />
              </RequireAuth>
            )}
          />
          <Route
            path="/profile/edit"
            component={() => (
              <RequireAuth>
                <ManifestScreenBoundary manifest={manifest} fallback={<EditProfile />} />
              </RequireAuth>
            )}
          />
          <Route path="*" component={CatchAllRoute} />
        </Route>
      </Router>
    </ToastProvider>
  );
}

function Shell(props: RouteSectionProps) {
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [notificationsOpen, setNotificationsOpen] = createSignal(false);

  const openComposer = () => setComposerOpen(true);
  const closeComposer = () => setComposerOpen(false);
  const openNotifications = () => setNotificationsOpen(true);
  const closeNotifications = () => setNotificationsOpen(false);

  return (
    <ShellContextProvider
      value={{
        onOpenComposer: openComposer,
        onOpenNotifications: openNotifications,
      }}
    >
      <div class="min-h-dvh bg-white dark:bg-black flex md:grid md:grid-cols-[72px_1fr] xl:grid-cols-[220px_1fr] overflow-x-hidden">
        {/* PC: 左サイドナビ（md以上） */}
        <SideNav
          onOpenComposer={openComposer}
          onOpenNotifications={openNotifications}
        />

        {/* メインコンテンツ */}
        <MainLayout>
          {props.children}
        </MainLayout>

        {/* モバイル下部タブ（md未満） */}
        <AppTab onOpenComposer={openComposer} />

        {/* 投稿作成ダイアログ */}
        <PostComposer
          open={composerOpen()}
          onClose={closeComposer}
          onCreated={() => {
            closeComposer();
          }}
        />
        <NotificationPanel
          open={notificationsOpen()}
          onClose={closeNotifications}
        />
      </div>
    </ShellContextProvider>
  );
}

function MainLayout(props: { children?: any }) {
  const location = useLocation();
  let mainRef: HTMLElement | undefined;

  createEffect(() => {
    // Reset scroll position when navigating to a new route
    console.log("[MainLayout] location changed:", {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
    location.pathname;
    location.search;
    location.hash;
    if (!mainRef) return;
    mainRef.scrollTop = 0;
    mainRef.scrollLeft = 0;
  });

  return (
    <div class="min-h-dvh flex flex-col flex-1 min-w-0">
      <main
        ref={(el) => {
          mainRef = el ?? undefined;
        }}
        class="flex-1 overflow-y-auto"
      >
        {props.children}
      </main>
    </div>
  );
}

function ManifestScreenBoundary(props: { manifest: Resource<AppManifest | undefined>; fallback: JSX.Element }) {
  const location = useLocation();
  const shell = useShellContext();

  const matchedScreen = createMemo<AppManifestScreen | undefined>(() => {
    if (!USE_DYNAMIC_SCREENS) return undefined;
    const m = props.manifest();
    if (!m) return undefined;
    return getScreenByRoute(m, location.pathname);
  });

  const routeParams = createMemo(() => {
    const screen = matchedScreen();
    if (!screen) return {};
    return extractRouteParams(screen.route, location.pathname);
  });

  const actions = createMemo(() => ({
    ...(shell?.onOpenComposer ? { openComposer: shell.onOpenComposer } : {}),
    ...(shell?.onOpenNotifications ? { openNotifications: shell.onOpenNotifications } : {}),
  }));

  if (!USE_DYNAMIC_SCREENS) {
    return props.fallback;
  }

  if (props.manifest.loading && !matchedScreen()) {
    return <div class="p-6 text-center">App UI を読み込み中...</div>;
  }

  if (props.manifest.error && !matchedScreen()) {
    console.warn("[ManifestScreenBoundary] Manifest load failed:", props.manifest.error);
    return props.fallback;
  }

  return (
    <Show when={matchedScreen()} fallback={props.fallback}>
      {(screen) => (
        <RenderScreen
          screen={screen()}
          context={{
            routeParams: routeParams(),
            location: location.pathname,
            actions: actions(),
          }}
        />
      )}
    </Show>
  );
}

function CatchAllRoute() {
  const location = useLocation();
  console.log("[CatchAllRoute] pathname:", location.pathname);

  // Check if this is a user profile route (starts with /@)
  if (location.pathname.startsWith("/@")) {
    console.log("[CatchAllRoute] Rendering UserProfile");
    return <UserProfile />;
  }

  // When USE_DYNAMIC_SCREENS is enabled, try to render from App Manifest
  // This allows App Manifest defined screens to be rendered for unknown routes
  if (USE_DYNAMIC_SCREENS) {
    console.log("[CatchAllRoute] Trying DynamicScreen for:", location.pathname);
    return <DynamicScreen />;
  }

  // Otherwise show 404
  console.log("[CatchAllRoute] Showing 404");
  return (
    <div class="p-6 text-center">
      <h1 class="text-2xl font-bold">404 Not Found</h1>
      <p class="mt-2">ページが見つかりませんでした。</p>
      <a href="/" class="mt-4 inline-block text-blue-600 hover:underline">
        ホームに戻る
      </a>
    </div>
  );
}

function LegacyCommunityChatRedirect() {
  const location = useLocation();
  return <Navigate href={location.pathname.replace("/c/", "/chat/c/")} />;
}

function LegacyDMRedirect() {
  const location = useLocation();
  const id = encodeURIComponent(location.pathname.split("/").pop() || "");
  return <Navigate href={`/chat/dm/${id}`} />;
}

function RequireAuth(props: { children: any; allowIncompleteProfile?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const status = authStatus;
  const allowIncomplete = props.allowIncompleteProfile ?? false;
  const [profileReady, setProfileReady] = createSignal(allowIncomplete);
  const [profileChecked, setProfileChecked] = createSignal(false);

  const checkProfile = async () => {
    if (allowIncomplete || profileChecked()) return;
    setProfileChecked(true);
    try {
      const user = await fetchMe();
      if (!user?.profile_completed_at) {
        const target = `${location.pathname}${location.search}${location.hash}`;
        if (!location.pathname.startsWith("/onboarding")) {
          navigate(`/onboarding?redirect=${encodeURIComponent(target)}`, {
            replace: true,
          });
        }
        return;
      }
      setProfileReady(true);
    } catch (error) {
      console.error("failed to check profile", error);
      setProfileReady(true);
    }
  };

  onMount(() => {
    // Verify authentication status with server if needed
    const currentStatus = status();
    if (currentStatus === "authenticated" || currentStatus === "unknown") {
      refreshAuth().then(() => {
        if (status() === "authenticated") {
          checkProfile();
        }
      });
    }
  });

  createEffect(() => {
    if (status() === "unauthenticated") {
      const target = `${location.pathname}${location.search}${location.hash}`;
      // Only add redirect parameter if not on root or login page
      if (target === "/" || target.startsWith("/login")) {
        navigate("/login", { replace: true });
      } else {
        navigate(`/login?redirect=${encodeURIComponent(target)}`, {
          replace: true,
        });
      }
    } else if (status() === "authenticated" && !profileChecked()) {
      checkProfile();
    }
  });

  return (
    <Show
      when={status() === "authenticated" && (allowIncomplete || profileReady())}
      fallback={<div class="p-6 text-center">読み込み中…</div>}
    >
      {props.children}
    </Show>
  );
}

function DefaultAuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const redirectParam = params.get("redirect");
  const redirectTo = redirectParam && redirectParam.startsWith("/")
    ? redirectParam
    : "/";
  onMount(() => {
    (async () => {
      try {
        const ok = await refreshAuth();
        if (ok) {
          navigate(redirectTo, { replace: true });
          return;
        }
      } catch (error) {
        console.error("auth callback failed", error);
      }
      navigate(`/login?redirect=${encodeURIComponent(redirectTo)}`, { replace: true });
    })();
  });
  return <div class="p-6 text-center">サインイン中…</div>;
}
