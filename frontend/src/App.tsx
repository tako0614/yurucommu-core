import { Navigate, Route, Router, useLocation, useNavigate } from "@solidjs/router";
import type { RouteSectionProps } from "@solidjs/router";
import { Show, createEffect, createMemo, createResource, createSignal, onMount, type Resource } from "solid-js";
import "./App.css";
import SideNav from "./components/Navigation/SideNav";
import AppTab from "./components/Navigation/AppTab";
import PostComposer from "./components/PostComposer";
import NotificationPanel from "./components/NotificationPanel";
import DefaultLogin from "./pages/Login";
import { authStatus, refreshAuth, fetchMe } from "./lib/api";
import { resolveComponent } from "./lib/plugins";
import { ToastProvider } from "./components/Toast";
import { ShellContextProvider, useShellContext } from "./lib/shell-context";
import { registerCustomComponents } from "./lib/ui-components";
import { RenderScreen } from "./lib/ui-runtime";
import { extractRouteParams, getScreenByRoute, loadAppManifest, type AppManifest, type AppManifestScreen } from "./lib/app-manifest";

// Register custom UiNode components on module load
registerCustomComponents();

const Login = resolveComponent("Login", DefaultLogin);
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
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route path="/login" component={Login} />
          <Route
            path="/onboarding"
            component={() => (
              <RequireAuth allowIncompleteProfile>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/connections"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          {/* Legacy routes redirect to connections */}
          <Route path="/friends" component={() => <Navigate href="/connections" />} />
          <Route
            path="/communities"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/users"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/invitations"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/follow-requests"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route path="/friend-requests" component={() => <Navigate href="/follow-requests" />} />
          <Route
            path="/c/:id"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          {/* Legacy community chat path -> unified chat */}
          <Route
            path="/c/:id/chat"
            component={LegacyCommunityChatRedirect}
          />
          {/* Unified Chat routes */}
          <Route
            path="/chat/*"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          {/* Legacy DM paths -> unified chat */}
          <Route
            path="/dm"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
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
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/stories"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/settings"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/notifications"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/posts/:id"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/profile"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          <Route
            path="/profile/edit"
            component={() => (
              <RequireAuth>
                <ManifestScreen manifest={manifest} />
              </RequireAuth>
            )}
          />
          {/* User profile route - public, no auth required */}
          <Route
            path="/@:handle"
            component={() => <ManifestScreen manifest={manifest} />}
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

/**
 * ManifestScreen - App Manifest 駆動の画面レンダリング
 *
 * screens-core.json から画面定義を取得し、UiNode としてレンダリングする。
 * 画面が見つからない場合は404を表示。
 */
function ManifestScreen(props: { manifest: Resource<AppManifest | undefined> }) {
  const location = useLocation();
  const shell = useShellContext();

  const matchedScreen = createMemo<AppManifestScreen | undefined>(() => {
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

  // Loading state
  if (props.manifest.loading) {
    return <div class="p-6 text-center text-muted">読み込み中...</div>;
  }

  // Error state
  if (props.manifest.error) {
    console.error("[ManifestScreen] Manifest load failed:", props.manifest.error);
    return (
      <div class="p-6 text-center">
        <h1 class="text-xl font-bold text-red-600">エラー</h1>
        <p class="mt-2 text-muted">App Manifest の読み込みに失敗しました。</p>
      </div>
    );
  }

  // No screen found
  if (!matchedScreen()) {
    return (
      <div class="p-6 text-center">
        <h1 class="text-2xl font-bold">404 Not Found</h1>
        <p class="mt-2 text-muted">画面が見つかりませんでした: {location.pathname}</p>
        <a href="/" class="mt-4 inline-block text-blue-600 hover:underline">
          ホームに戻る
        </a>
      </div>
    );
  }

  return (
    <RenderScreen
      screen={matchedScreen()!}
      context={{
        routeParams: routeParams(),
        location: location.pathname,
        actions: actions(),
      }}
    />
  );
}

function CatchAllRoute() {
  return (
    <div class="p-6 text-center">
      <h1 class="text-2xl font-bold">404 Not Found</h1>
      <p class="mt-2 text-muted">ページが見つかりませんでした。</p>
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
