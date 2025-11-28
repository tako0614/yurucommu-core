import { Navigate, Route, Router, useLocation, useNavigate } from "@solidjs/router";
import type { RouteSectionProps } from "@solidjs/router";
import { Show, createEffect, createSignal, onMount } from "solid-js";
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

const Login = resolveComponent("Login", DefaultLogin);
const Profile = resolveComponent("Profile", DefaultProfile);
const AuthCallback = resolveComponent("AuthCallback", DefaultAuthCallback);

export default function App() {
  console.log("[App] Component mounted");
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [notificationsOpen, setNotificationsOpen] = createSignal(false);

  const openComposer = () => setComposerOpen(true);
  const closeComposer = () => setComposerOpen(false);
  const openNotifications = () => setNotificationsOpen(true);
  const closeNotifications = () => setNotificationsOpen(false);

  return (
    <ToastProvider>
      <Router>
        <div class="min-h-dvh bg-white dark:bg-black flex md:grid md:grid-cols-[72px_1fr] xl:grid-cols-[220px_1fr] overflow-x-hidden">
          {/* PC: 左サイドナビ（md以上） */}
          <SideNav
            onOpenComposer={openComposer}
            onOpenNotifications={openNotifications}
          />

          {/* メインコンテンツ */}
          <Route path="/" component={MainLayout}>
            <Route path="/auth/callback" component={AuthCallback} />
            <Route
              path="/"
              component={() => (
                <RequireAuth allowIncompleteProfile>
                  <Home onOpenComposer={openComposer} onOpenNotifications={openNotifications} />
                </RequireAuth>
              )}
            />
            <Route path="/login" component={Login} />
            <Route
              path="/onboarding"
              component={() => (
                <RequireAuth allowIncompleteProfile>
                  <Onboarding />
                </RequireAuth>
              )}
            />
            <Route
              path="/connections"
              component={() => (
                <RequireAuth>
                  <Connections />
                </RequireAuth>
              )}
            />
            {/* Legacy routes redirect to connections */}
            <Route path="/friends" component={() => <Navigate href="/connections" />} />
            <Route path="/communities" component={() => <Navigate href="/connections" />} />
            <Route
              path="/users"
              component={() => (
                <RequireAuth>
                  <UserSearch />
                </RequireAuth>
              )}
            />
            <Route
              path="/invitations"
              component={() => (
                <RequireAuth>
                  <Invitations />
                </RequireAuth>
              )}
            />
            <Route
              path="/follow-requests"
              component={() => (
                <RequireAuth>
                  <FriendRequests />
                </RequireAuth>
              )}
            />
            <Route path="/friend-requests" component={() => <Navigate href="/follow-requests" />} />
            <Route
              path="/c/:id"
              component={() => (
                <RequireAuth>
                  <CommunityHub />
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
                  <Chat />
                </RequireAuth>
              )}
            />
            {/* Legacy DM paths -> unified chat */}
            <Route path="/dm" component={() => <Navigate href="/chat" />} />
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
                  <Compose />
                </RequireAuth>
              )}
            />
            <Route
              path="/stories"
              component={() => (
                <RequireAuth>
                  <Stories />
                </RequireAuth>
              )}
            />
            <Route
              path="/settings"
              component={() => (
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              )}
            />
            <Route
              path="/posts/:id"
              component={() => (
                <RequireAuth>
                  <PostDetail />
                </RequireAuth>
              )}
            />
            <Route
              path="/profile"
              component={() => (
                <RequireAuth>
                  <Profile />
                </RequireAuth>
              )}
            />
            <Route
              path="/profile/edit"
              component={() => (
                <RequireAuth>
                  <EditProfile />
                </RequireAuth>
              )}
            />
            <Route path="*" component={CatchAllRoute} />
          </Route>

          {/* モバイル下部タブ（md未満） */}
          <AppTab onOpenComposer={openComposer} />

          {/* 投稿作成ダイアログ */}
          <PostComposer
            open={composerOpen()}
            onClose={closeComposer}
            onCreated={() => {
              // 投稿が作成されたら、必要に応じてページを更新
              closeComposer();
            }}
          />
          <NotificationPanel
            open={notificationsOpen()}
            onClose={closeNotifications}
          />
        </div>
      </Router>
    </ToastProvider>
  );
}

function MainLayout(props: RouteSectionProps) {
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

function CatchAllRoute() {
  const location = useLocation();
  console.log("[CatchAllRoute] pathname:", location.pathname);

  // Check if this is a user profile route (starts with /@)
  if (location.pathname.startsWith("/@")) {
    console.log("[CatchAllRoute] Rendering UserProfile");
    return <UserProfile />;
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
