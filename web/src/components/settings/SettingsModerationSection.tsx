import { createSignal, For, onMount, Show } from "solid-js";
import { SettingsSectionHeader } from "./SettingsSectionHeader.tsx";
import {
  blockActor,
  blockDomain,
  type BlockedActor,
  type BlockedDomain,
  fetchBlockedActors,
  fetchBlockedDomains,
  fetchReports,
  type ModerationReport,
  resolveReport,
  unblockActor,
  unblockDomain,
} from "../../lib/api/moderation.ts";
import { ApiError } from "../../lib/api/fetch.ts";
import type { Translate } from "../../lib/i18n.tsx";

interface SettingsModerationSectionProps {
  onBack: () => void;
  t: Translate;
}

export function SettingsModerationSection(
  props: SettingsModerationSectionProps,
) {
  const [domains, setDomains] = createSignal<BlockedDomain[]>([]);
  const [actors, setActors] = createSignal<BlockedActor[]>([]);
  const [reports, setReports] = createSignal<ModerationReport[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [forbidden, setForbidden] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [domainInput, setDomainInput] = createSignal("");
  const [actorInput, setActorInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  // Per-item in-flight guard. Without it the unblock/resolve buttons stay live
  // during their request and a double-tap fires duplicate DELETE/resolve calls.
  // Keys are namespaced so a domain/apId/report-id can't collide.
  const [pending, setPending] = createSignal<Set<string>>(new Set());
  const isPending = (key: string) => pending().has(key);
  const withPending = async (key: string, fn: () => Promise<void>) => {
    if (isPending(key)) return;
    setPending((prev) => new Set(prev).add(key));
    try {
      await fn();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, a, r] = await Promise.all([
        fetchBlockedDomains(),
        fetchBlockedActors(),
        fetchReports(),
      ]);
      setDomains(d);
      setActors(a);
      setReports(r);
    } catch (e) {
      // The backend returns 403 for non-owners; surface the owner-only notice
      // rather than a generic failure so the gate is explained.
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
      } else {
        console.error("Failed to load moderation data:", e);
        setError(props.t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  onMount(loadAll);

  const handleAddDomain = async () => {
    const value = domainInput().trim();
    if (!value || busy()) return;
    setBusy(true);
    try {
      await blockDomain(value);
      setDomainInput("");
      setDomains(await fetchBlockedDomains());
    } catch (e) {
      console.error("Failed to block domain:", e);
      setError(props.t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const handleUnblockDomain = (domain: string) =>
    withPending(`domain:${domain}`, async () => {
      try {
        await unblockDomain(domain);
        setDomains((prev) => prev.filter((d) => d.domain !== domain));
      } catch (e) {
        console.error("Failed to unblock domain:", e);
        setError(props.t("common.error"));
      }
    });

  const handleAddActor = async () => {
    const value = actorInput().trim();
    if (!value || busy()) return;
    setBusy(true);
    try {
      await blockActor(value);
      setActorInput("");
      setActors(await fetchBlockedActors());
    } catch (e) {
      console.error("Failed to block actor:", e);
      setError(props.t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const handleUnblockActor = (apId: string) =>
    withPending(`actor:${apId}`, async () => {
      try {
        await unblockActor(apId);
        setActors((prev) => prev.filter((a) => a.actor_ap_id !== apId));
      } catch (e) {
        console.error("Failed to unblock actor:", e);
        setError(props.t("common.error"));
      }
    });

  const handleResolve = (id: string) =>
    withPending(`report:${id}`, async () => {
      try {
        await resolveReport(id);
        setReports((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, resolved_at: new Date().toISOString() } : r,
          ),
        );
      } catch (e) {
        console.error("Failed to resolve report:", e);
        setError(props.t("common.error"));
      }
    });

  const inputClass =
    "flex-1 min-w-0 bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent";

  return (
    <div class="flex flex-col h-full">
      <SettingsSectionHeader
        title={props.t("settings.moderation")}
        onBack={props.onBack}
      />
      <div class="flex-1 overflow-y-auto">
        <Show when={error()}>
          <div class="mx-4 mt-4 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error()}
          </div>
        </Show>

        <Show when={forbidden()}>
          <div class="p-8 text-center text-neutral-500">
            {props.t("settings.moderationOwnerOnly")}
          </div>
        </Show>

        <Show when={loading() && !forbidden()}>
          <div class="p-8 text-center text-neutral-500">
            {props.t("common.loading")}
          </div>
        </Show>

        <Show when={!loading() && !forbidden()}>
          {/* Blocked domains */}
          <div class="border-b border-neutral-900 py-4">
            <div class="px-4 pb-3 text-sm text-neutral-500 uppercase">
              {props.t("settings.blockedDomains")}
            </div>
            <div class="px-4 flex gap-2 mb-3">
              <input
                type="text"
                value={domainInput()}
                onInput={(e) => setDomainInput(e.currentTarget.value)}
                placeholder={props.t("settings.domainPlaceholder")}
                aria-label={props.t("settings.blockedDomains")}
                class={inputClass}
              />
              <button
                type="button"
                onClick={handleAddDomain}
                disabled={busy() || domainInput().trim().length === 0}
                class="px-4 py-2 bg-accent rounded-lg font-bold disabled:opacity-50"
              >
                {props.t("settings.addBlockedDomain")}
              </button>
            </div>
            <For each={domains()}>
              {(d) => (
                <div class="flex items-center justify-between px-4 py-2">
                  <span class="truncate text-white">{d.domain}</span>
                  <button
                    type="button"
                    onClick={() => handleUnblockDomain(d.domain)}
                    disabled={isPending(`domain:${d.domain}`)}
                    class="text-sm text-accent hover:underline ml-3 shrink-0 disabled:opacity-50"
                  >
                    {props.t("settings.unblock")}
                  </button>
                </div>
              )}
            </For>
          </div>

          {/* Blocked actors */}
          <div class="border-b border-neutral-900 py-4">
            <div class="px-4 pb-3 text-sm text-neutral-500 uppercase">
              {props.t("settings.blockedActors")}
            </div>
            <div class="px-4 flex gap-2 mb-3">
              <input
                type="text"
                value={actorInput()}
                onInput={(e) => setActorInput(e.currentTarget.value)}
                placeholder={props.t("settings.actorPlaceholder")}
                aria-label={props.t("settings.blockedActors")}
                class={inputClass}
              />
              <button
                type="button"
                onClick={handleAddActor}
                disabled={busy() || actorInput().trim().length === 0}
                class="px-4 py-2 bg-accent rounded-lg font-bold disabled:opacity-50"
              >
                {props.t("settings.addBlockedActor")}
              </button>
            </div>
            <For each={actors()}>
              {(a) => (
                <div class="flex items-center justify-between px-4 py-2">
                  <span class="truncate text-white">{a.actor_ap_id}</span>
                  <button
                    type="button"
                    onClick={() => handleUnblockActor(a.actor_ap_id)}
                    disabled={isPending(`actor:${a.actor_ap_id}`)}
                    class="text-sm text-accent hover:underline ml-3 shrink-0 disabled:opacity-50"
                  >
                    {props.t("settings.unblock")}
                  </button>
                </div>
              )}
            </For>
          </div>

          {/* Reports */}
          <div class="py-4">
            <div class="px-4 pb-3 text-sm text-neutral-500 uppercase">
              {props.t("settings.reports")}
            </div>
            <Show
              when={reports().length > 0}
              fallback={
                <div class="px-4 py-2 text-neutral-500">
                  {props.t("settings.noReports")}
                </div>
              }
            >
              <For each={reports()}>
                {(r) => (
                  <div class="px-4 py-3 border-t border-neutral-900">
                    <div class="flex items-center justify-between gap-3">
                      <span
                        class={
                          r.resolved_at
                            ? "text-xs text-neutral-500"
                            : "text-xs text-accent"
                        }
                      >
                        {r.resolved_at
                          ? props.t("settings.reportsResolved")
                          : props.t("settings.reportsOpen")}
                      </span>
                      <Show when={!r.resolved_at}>
                        <button
                          type="button"
                          onClick={() => handleResolve(r.id)}
                          disabled={isPending(`report:${r.id}`)}
                          class="text-sm text-accent hover:underline shrink-0 disabled:opacity-50"
                        >
                          {props.t("settings.resolveReport")}
                        </button>
                      </Show>
                    </div>
                    <Show when={r.target_ap_id}>
                      <div class="text-sm text-white truncate mt-1">
                        {r.target_ap_id}
                      </div>
                    </Show>
                    <Show when={r.content}>
                      <div class="text-sm text-neutral-400 mt-1 break-words">
                        {r.content}
                      </div>
                    </Show>
                    <Show when={r.reporter_ap_id}>
                      <div class="text-xs text-neutral-500 mt-1 truncate">
                        {r.reporter_ap_id}
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
