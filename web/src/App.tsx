import {
  createEffect,
  ErrorBoundary,
  lazy,
  Match,
  Show,
  Suspense,
  Switch,
} from "solid-js";
import { Route, Router } from "@solidjs/router";
import { Provider } from "solid-jotai";
import { useAtomValue } from "solid-jotai";
import { useAuth } from "./hooks/useAuth.ts";
import { languageAtom, tAtom } from "./atoms/i18n.ts";
import { LoginForm } from "./components/LoginForm.tsx";
import { SetupScreen } from "./components/SetupScreen.tsx";
import { InstancePendingScreen } from "./components/InstancePendingScreen.tsx";
import { InstanceProblemScreen } from "./components/InstanceProblemScreen.tsx";
import { AppLayout } from "./components/layout/index.ts";
import { LoadingSpinner } from "./components/LoadingSpinner.tsx";
import { OfflineBanner } from "./components/OfflineBanner.tsx";
import { yurucommuDeployDocsUrl } from "./lib/deploy-docs.ts";

// Lazy load page components for code splitting
const TimelinePage = lazy(() => import("./pages/TimelinePage.tsx"));
const CommunityChatPage = lazy(() => import("./pages/CommunityChatPage.tsx"));
const DMPage = lazy(() => import("./pages/DMPage.tsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.tsx"));
const NotificationPage = lazy(() => import("./pages/NotificationPage.tsx"));
const PostDetailPage = lazy(() => import("./pages/PostDetailPage.tsx"));
const BookmarksPage = lazy(() => import("./pages/BookmarksPage.tsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx"));
const FriendsListPage = lazy(() => import("./pages/FriendsListPage.tsx"));
const CommunityProfilePage = lazy(
  () => import("./pages/CommunityProfilePage.tsx"),
);
const SearchPage = lazy(() => import("./pages/SearchPage.tsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.tsx"));

function AppShell() {
  return (
    <Router>
      <Route path="/" component={AppLayout}>
        <Route path="/" component={TimelinePage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/friends" component={FriendsListPage} />
        <Route path="/friends/list" component={FriendsListPage} />
        <Route path="/groups/:name" component={CommunityProfilePage} />
        <Route path="/groups/:name/chat" component={CommunityChatPage} />
        <Route path="/dm" component={DMPage} />
        <Route path="/dm/:contactId" component={DMPage} />
        <Route path="/profile" component={ProfilePage} />
        {/* Splat (*) so a refreshed/shared link whose %2F was decoded on the
            server round-trip still matches (the AP id is a full URL). */}
        <Route path="/profile/*actorId" component={ProfilePage} />
        {/* Clean, federation-facing local profile URL: the actor `url` field and
            the WebFinger profile-page link both point here (/users/<username>),
            so a remote viewer clicking through to a local profile must land on a
            real route, not a blank SPA page. */}
        <Route path="/users/:username" component={ProfilePage} />
        <Route path="/notifications" component={NotificationPage} />
        <Route path="/post/*postId" component={PostDetailPage} />
        <Route path="/bookmarks" component={BookmarksPage} />
        <Route path="/settings" component={SettingsPage} />
        {/* Catch-all: an unknown in-app path otherwise renders a blank
            dead-end. Keep it INSIDE AppLayout so the not-found state shows
            within the normal chrome with a link home. */}
        <Route path="*" component={NotFoundPage} />
      </Route>
    </Router>
  );
}

function LoginScreen(props: {
  onLogin: (password: string) => Promise<boolean>;
  error: string | null;
}) {
  const t = useAtomValue(tAtom);
  const deployDocsUrl = yurucommuDeployDocsUrl();
  return (
    <div class="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-8 text-neutral-100">
      <h1 class="mb-2 text-4xl font-bold">Yurucommu</h1>
      <p class="mb-1 text-neutral-300">{t()("app.tagline")}</p>
      <p class="mb-8 max-w-xs text-center text-sm text-neutral-500">
        {t()("app.taglineHint")}
      </p>
      <LoginForm onLogin={props.onLogin} error={props.error} />
      <a
        href={deployDocsUrl}
        class="mt-6 inline-flex items-center justify-center rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-[var(--accent)]/10"
        rel="noopener"
      >
        {t()("instance.deployDocs")}
      </a>
    </div>
  );
}

function AuthErrorScreen(props: { onRetry: () => void }) {
  const t = useAtomValue(tAtom);
  return (
    <div class="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div class="w-full max-w-sm space-y-6 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/30 text-red-400">
          <svg
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
            />
          </svg>
        </div>
        <p class="text-sm text-neutral-400">{t()("auth.checkFailed")}</p>
        <button
          type="button"
          onClick={() => props.onRetry()}
          class="w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-white transition-colors"
        >
          {t()("common.retry")}
        </button>
      </div>
    </div>
  );
}

// Top-level crash fallback. Rendered by the ErrorBoundary, which sits *outside*
// the jotai <Provider>; solid-jotai's useAtomValue falls back to the default
// store here, so the language preference (atomWithStorage "language") still
// resolves and we can localize instead of hardcoding English.
function AppErrorFallback() {
  const t = useAtomValue(tAtom);
  return (
    <div class="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-neutral-900 rounded-xl p-6 text-center">
        <h1 class="text-xl font-bold text-white mb-2">
          {t()("app.errorTitle")}
        </h1>
        <p class="text-neutral-400 mb-6">{t()("app.errorBody")}</p>
        <button
          onClick={() => window.location.reload()}
          class="px-4 py-2 bg-accent text-white rounded-lg transition-colors"
        >
          {t()("app.reloadButton")}
        </button>
      </div>
    </div>
  );
}

function AppContent() {
  const {
    actor,
    loading,
    authError,
    loginError,
    login,
    needsSetup,
    instancePending,
    instanceMissing,
    instanceBlocked,
    instanceHealth,
    selectedInstanceId,
    completeSetup,
    rebuildInstance,
    refreshAuth,
  } = useAuth();
  const t = useAtomValue(tAtom);

  // Keep <html lang> in sync with the active locale (a11y + SEO) so it tracks
  // the in-app language switch, not just the mount-time default.
  const language = useAtomValue(languageAtom);
  createEffect(() => {
    document.documentElement.lang = language();
  });

  // Health reports `provisioning`/`updating` while the instance is still coming
  // up; treat those as pending alongside the explicit instancePending flag.
  const healthPending = () => {
    const state = instanceHealth()?.effective_state;
    return state === "provisioning" || state === "updating";
  };

  return (
    <Switch
      fallback={
        // Authenticated and healthy → the app shell/router.
        <Show
          when={actor()}
          fallback={<LoginScreen onLogin={login} error={loginError()} />}
        >
          <AppShell />
        </Show>
      }
    >
      <Match when={loading()}>
        <div class="flex h-screen items-center justify-center bg-neutral-950 text-neutral-500">
          {t()("common.loading")}
        </div>
      </Match>

      <Match when={authError() && !actor()}>
        <AuthErrorScreen onRetry={refreshAuth} />
      </Match>

      <Match when={needsSetup()}>
        <SetupScreen onComplete={completeSetup} />
      </Match>

      <Match when={instancePending() || healthPending()}>
        <InstancePendingScreen
          health={instanceHealth()}
          instanceId={selectedInstanceId()}
          onRefresh={refreshAuth}
          onRebuild={rebuildInstance}
        />
      </Match>

      <Match when={instanceMissing() || instanceBlocked()}>
        <InstanceProblemScreen
          variant={instanceBlocked() ? "blocked" : "missing"}
          health={instanceHealth()}
          instanceId={selectedInstanceId()}
          onRebuild={rebuildInstance}
        />
      </Match>
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallback={() => <AppErrorFallback />}>
      <Provider>
        <Suspense fallback={<LoadingSpinner />}>
          <AppContent />
        </Suspense>
        <OfflineBanner />
      </Provider>
    </ErrorBoundary>
  );
}
