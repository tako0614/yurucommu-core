import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, Route, BrowserRouter, Routes, useLocation, useNavigate } from "react-router-dom";
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
import { useAsyncResource, type AsyncResource } from "./lib/useAsyncResource";

registerCustomComponents();

const Login = resolveComponent("Login", DefaultLogin);
const AuthCallback = resolveComponent("AuthCallback", DefaultAuthCallback);

export default function App() {
  const [manifest] = useAsyncResource<AppManifest | undefined>(loadAppManifest);

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
  const [composerOpen, setComposerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

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
          open={composerOpen}
          onClose={closeComposer}
          onCreated={() => {
            closeComposer();
          }}
        />
        <NotificationPanel open={notificationsOpen} onClose={closeNotifications} />
      </div>
    </ShellContextProvider>
  );
}

function MainLayout(props: { children?: any }) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mainRef.current) return;
    mainRef.current.scrollTop = 0;
    mainRef.current.scrollLeft = 0;
  }, [location.pathname, location.search, location.hash]);

  return (
    <div className="min-h-dvh flex flex-col flex-1 min-w-0">
      <main
        ref={(el) => {
          mainRef.current = el;
        }}
        className="flex-1 overflow-y-auto"
      >
        {props.children}
      </main>
    </div>
  );
}

function ManifestScreen(props: { manifest: AsyncResource<AppManifest | undefined> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const me = useMe();
  const shell = useShellContext();
  const authState = useAuthStatus();

  const legacyRedirect = useMemo(() => {
    const path = location.pathname;
    if (path === "/friends") return "/connections";
    if (path === "/friend-requests") return "/follow-requests";
    if (path === "/dm") return "/chat";
    const dmMatch = path.match(/^\/dm\/(.+)$/);
    if (dmMatch) return `/chat/dm/${dmMatch[1]}`;
    const communityChat = path.match(/^\/c\/([^/]+)\/chat$/);
    if (communityChat) return `/chat/community/${communityChat[1]}`;
    return null;
  }, [location.pathname]);

  const matchedScreen = useMemo<AppManifestScreen | undefined>(() => {
    if (legacyRedirect) return undefined;
    const manifest = props.manifest.data;
    if (!manifest) return undefined;
    return getScreenByRoute(manifest, location.pathname);
  }, [legacyRedirect, location.pathname, props.manifest.data]);

  const routeParams = useMemo(() => {
    if (!matchedScreen) return {};
    return extractRouteParams(matchedScreen.route, location.pathname);
  }, [matchedScreen, location.pathname]);

  const actions = useMemo(
    () => ({
      ...(shell?.onOpenComposer ? { openComposer: shell.onOpenComposer } : {}),
      ...(shell?.onOpenNotifications ? { openNotifications: shell.onOpenNotifications } : {}),
    }),
    [shell],
  );

  const authContext = useMemo(
    () => ({
      loggedIn: authState === "authenticated",
      user: me(),
    }),
    [authState, me],
  );

  if (legacyRedirect) {
    return <Navigate to={legacyRedirect} />;
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

  if (!matchedScreen) {
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
      screen={matchedScreen!}
      context={{
        routeParams,
        location: location.pathname,
        actions,
        auth: authContext,
        $auth: authContext,
      }}
    />
  );

  const requiresAuth = matchedScreen?.auth !== "optional" && matchedScreen?.auth !== "public";
  const allowIncompleteProfile = matchedScreen?.id === "screen.onboarding" || matchedScreen?.id === "screen.home";

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
  const [profileReady, setProfileReady] = useState(allowIncomplete);
  const [profileChecked, setProfileChecked] = useState(false);

  const checkProfile = async () => {
    if (allowIncomplete || profileChecked) return;
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

  useEffect(() => {
    if (status === "authenticated" || status === "unknown") {
      refreshAuth().then(() => {
        if (status === "authenticated") {
          checkProfile();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      const target = `${location.pathname}${location.search}${location.hash}`;
      if (target === "/" || target.startsWith("/login")) {
        navigate("/login", { replace: true });
      } else {
        navigate(`/login?redirect=${encodeURIComponent(target)}`, {
          replace: true,
        });
      }
    } else if (status === "authenticated" && !profileChecked) {
      checkProfile();
    }
  }, [status, location.pathname, location.search, location.hash]);

  return (
    status === "authenticated" && (allowIncomplete || profileReady) ? (
      props.children
    ) : (
      <div className="p-6 text-center">読み込み中…</div>
    )
  );
}

function DefaultAuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const redirectParam = params.get("redirect");
  const redirectTo = redirectParam && redirectParam.startsWith("/") ? redirectParam : "/";

  useEffect(() => {
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
  }, [navigate, redirectTo]);
  return <div className="p-6 text-center">サインイン中…</div>;
}
