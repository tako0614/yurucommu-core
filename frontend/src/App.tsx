import { Navigate, Outlet, Route, BrowserRouter, Routes, useLocation, useNavigate } from "react-router-dom";
import { Show, createEffect, createMemo, createResource, createSignal, onMount, type Resource } from "./lib/solid-compat";
import "./App.css";
import SideNav from "./components/Navigation/SideNav";
import AppTab from "./components/Navigation/AppTab";
import PostComposer from "./components/PostComposer";
import NotificationPanel from "./components/NotificationPanel";
import DefaultLogin from "./pages/Login";
import { fetchMe, refreshAuth, useAuthStatus, useMe } from "./lib/api";
import { resolveComponent } from "./lib/plugins";
import { ToastProvider } from "./components/Toast";
import { ShellContextProvider, useShellContext } from "./lib/shell-context";
import { registerCustomComponents } from "./lib/ui-components";
import { RenderScreen } from "./lib/ui-runtime";
import { extractRouteParams, getScreenByRoute, loadAppManifest, type AppManifest, type AppManifestScreen } from "./lib/app-manifest";

registerCustomComponents();

const Login = resolveComponent("Login", DefaultLogin);
const AuthCallback = resolveComponent("AuthCallback", DefaultAuthCallback);

export default function App() {
  const [manifest] = createResource<AppManifest | undefined>(loadAppManifest);

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shell />}>
            <Route path="auth/callback" element={<AuthCallback />} />
            <Route path="login" element={<Login />} />
            <Route path="*" element={<ManifestScreen manifest={manifest} />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

function Shell() {
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
      <div className="min-h-dvh bg-white dark:bg-black flex md:grid md:grid-cols-[72px_1fr] xl:grid-cols-[220px_1fr] overflow-x-hidden">
        <SideNav onOpenComposer={openComposer} onOpenNotifications={openNotifications} />
        <MainLayout>
          <Outlet />
        </MainLayout>
        <AppTab onOpenComposer={openComposer} />
        <PostComposer
          open={composerOpen()}
          onClose={closeComposer}
          onCreated={() => {
            closeComposer();
          }}
        />
        <NotificationPanel open={notificationsOpen()} onClose={closeNotifications} />
      </div>
    </ShellContextProvider>
  );
}

function MainLayout(props: { children?: any }) {
  const location = useLocation();
  let mainRef: HTMLElement | null = null;

  createEffect(() => {
    location.pathname;
    location.search;
    location.hash;
    if (!mainRef) return;
    mainRef.scrollTop = 0;
    mainRef.scrollLeft = 0;
  }, [location.pathname, location.search, location.hash]);

  return (
    <div className="min-h-dvh flex flex-col flex-1 min-w-0">
      <main
        ref={(el) => {
          mainRef = el;
        }}
        className="flex-1 overflow-y-auto"
      >
        {props.children}
      </main>
    </div>
  );
}

function ManifestScreen(props: { manifest: Resource<AppManifest | undefined> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const me = useMe();
  const shell = useShellContext();
  const authState = useAuthStatus();

  const legacyRedirect = createMemo(() => {
    const path = location.pathname;
    if (path === "/friends") return "/connections";
    if (path === "/friend-requests") return "/follow-requests";
    if (path === "/dm") return "/chat";
    const dmMatch = path.match(/^\/dm\/(.+)$/);
    if (dmMatch) return `/chat/dm/${dmMatch[1]}`;
    const communityChat = path.match(/^\/c\/([^/]+)\/chat$/);
    if (communityChat) return `/c/${communityChat[1]}`;
    return null;
  });

  const matchedScreen = createMemo<AppManifestScreen | undefined>(() => {
    const redirect = legacyRedirect();
    if (redirect) return undefined;
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

  const authContext = createMemo(() => ({
    loggedIn: authState === "authenticated",
    user: me(),
  }), [authState, me()]);

  if (legacyRedirect()) {
    return <Navigate to={legacyRedirect()!} />;
  }

  if (props.manifest.loading) {
    return <div className="p-6 text-center text-muted">読み込み中...</div>;
  }

  if (props.manifest.error) {
    console.error("[ManifestScreen] Manifest load failed:", props.manifest.error);
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-bold text-red-600">エラー</h1>
        <p className="mt-2 text-muted">App Manifest の読み込みに失敗しました。</p>
      </div>
    );
  }

  if (!matchedScreen()) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold">404 Not Found</h1>
        <p className="mt-2 text-muted">画面が見つかりませんでした: {location.pathname}</p>
        <button type="button" className="mt-4 inline-block text-blue-600 hover:underline" onClick={() => navigate("/")}>
          ホームに戻る
        </button>
      </div>
    );
  }

  const screenContent = (
    <RenderScreen
      screen={matchedScreen()!}
      context={{
        routeParams: routeParams(),
        location: location.pathname,
        actions: actions(),
        auth: authContext(),
        $auth: authContext(),
      }}
    />
  );

  const requiresAuth = matchedScreen()?.auth !== "public";
  const allowIncompleteProfile = matchedScreen()?.id === "screen.onboarding" || matchedScreen()?.id === "screen.home";

  if (!requiresAuth) {
    return screenContent;
  }

  return (
    <RequireAuth allowIncompleteProfile={allowIncompleteProfile}>
      {screenContent}
    </RequireAuth>
  );
}

function RequireAuth(props: { children: any; allowIncompleteProfile?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStatus();
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
    if (status === "authenticated" || status === "unknown") {
      refreshAuth().then(() => {
        if (status === "authenticated") {
          checkProfile();
        }
      });
    }
  });

  createEffect(() => {
    if (status === "unauthenticated") {
      const target = `${location.pathname}${location.search}${location.hash}`;
      if (target === "/" || target.startsWith("/login")) {
        navigate("/login", { replace: true });
      } else {
        navigate(`/login?redirect=${encodeURIComponent(target)}`, {
          replace: true,
        });
      }
    } else if (status === "authenticated" && !profileChecked()) {
      checkProfile();
    }
  }, [status, location.pathname, location.search, location.hash]);

  return (
    <Show
      when={status === "authenticated" && (allowIncomplete || profileReady())}
      fallback={<div className="p-6 text-center">読み込み中…</div>}
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
  const redirectTo = redirectParam && redirectParam.startsWith("/") ? redirectParam : "/";

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
  return <div className="p-6 text-center">サインイン中…</div>;
}
