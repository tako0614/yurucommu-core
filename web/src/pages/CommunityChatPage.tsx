import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { fetchCommunity } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";

/**
 * Community chat has been folded into the unified DM hybrid surface (DMPage).
 * This route is kept as a stable deep-link: `/groups/:name/chat` resolves the
 * community's ActivityPub id and redirects to `/dm?c=<apId>`, where the same
 * community conversation is rendered by DMChatPanel. The conversation id rides
 * in a query param (not a path segment) so it survives a server round-trip:
 * `%2F` in a path is decoded on reload and would break the route. Members and the "leave"
 * affordance now live on the community profile (`/groups/:name`).
 */
export function CommunityChatPage() {
  const params = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const name = params.name;
    if (!name) return;
    let cancelled = false;
    // Invalidate the in-flight redirect when params.name changes (the route is
    // reused across communities without an unmount) or on unmount, so a stale
    // fetch can't navigate to the wrong community after a newer one started.
    onCleanup(() => {
      cancelled = true;
    });
    setError(null);

    (async () => {
      try {
        const community = await fetchCommunity(name);
        if (cancelled) return;
        navigate(`/dm?c=${encodeURIComponent(community.ap_id)}`, {
          replace: true,
        });
      } catch (e) {
        if (cancelled) return;
        console.error("Failed to resolve community for chat redirect:", e);
        // Fall back to the community profile so the deep-link is never a dead end.
        navigate(`/groups/${encodeURIComponent(name)}`, { replace: true });
        setError(t("communityChat.notFound"));
      }
    })();
  });

  return (
    <div class="flex flex-col items-center justify-center h-full bg-neutral-900">
      <Show
        when={!error()}
        fallback={<div class="text-neutral-500">{error()}</div>}
      >
        <div class="text-neutral-500">{t("communityChat.openingInDm")}</div>
      </Show>
    </div>
  );
}

export default CommunityChatPage;
