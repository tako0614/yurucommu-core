import { createMemo, createSignal, Show } from "solid-js";
import { useI18n } from "../lib/i18n.tsx";

interface SetupScreenProps {
  /** Claims the handle and provisions the instance. Returns success. */
  onComplete: (username: string) => Promise<boolean>;
}

const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

/**
 * First-run handle-claim screen for hosted deployments. Lets the user pick an
 * @handle, previews their fediverse address, and triggers instance setup via
 * {@link SetupScreenProps.onComplete} (wired to the auth strategy's
 * `completeSetup`).
 */
export function SetupScreen(props: SetupScreenProps) {
  const { t } = useI18n();
  const [handle, setHandle] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const normalized = createMemo(() => handle().trim().toLowerCase());
  const valid = createMemo(() => HANDLE_PATTERN.test(normalized()));
  const previewDomain = () =>
    typeof location === "undefined" ? "" : location.hostname;

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    const value = normalized();
    if (!HANDLE_PATTERN.test(value)) {
      setError(t("setup.usernameFormatError"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const ok = await props.onComplete(value);
      // `false` specifically means the handle was taken; a thrown error means
      // provisioning failed (network/500) — distinguish them so the user isn't
      // wrongly told "username taken" on an infra error (and no unhandled
      // rejection leaks when completeSetup rejects).
      if (!ok) setError(t("setup.usernameTakenError"));
    } catch (err) {
      console.error("Setup failed:", err);
      setError(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div class="w-full max-w-sm space-y-6">
        <div class="space-y-2 text-center">
          <h1 class="text-2xl font-bold">{t("setup.instanceTitle")}</h1>
          <p class="text-sm text-neutral-400">
            {t("setup.instanceDescription")}
          </p>
        </div>

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label
              for="setup-handle"
              class="mb-1 block text-sm font-medium text-neutral-300"
            >
              {t("setup.handleLabel")}
            </label>
            <div class="flex items-center rounded-md border border-neutral-700 bg-neutral-800 focus-within:ring-2 focus-within:ring-accent">
              <span class="pl-3 text-neutral-500">@</span>
              <input
                id="setup-handle"
                type="text"
                value={handle()}
                onInput={(e) => {
                  setHandle(e.currentTarget.value);
                  if (error()) setError(null);
                }}
                class="w-full bg-transparent px-2 py-2 text-neutral-100 focus:outline-none"
                placeholder={t("setup.handlePlaceholder")}
                autocomplete="off"
                autocapitalize="none"
                spellcheck={false}
                disabled={submitting()}
                autofocus
              />
            </div>
          </div>

          <Show when={normalized().length > 0}>
            <p class="text-sm text-neutral-500">
              {t("setup.handlePreview")}:{" "}
              <span class="font-mono text-neutral-300">
                @{normalized()}@{previewDomain()}
              </span>
            </p>
          </Show>

          <Show when={error()}>
            <div class="rounded-md border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-400">
              {error()}
            </div>
          </Show>

          <button
            type="submit"
            disabled={submitting() || !valid()}
            class="w-full rounded-md bg-accent px-6 py-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting() ? t("setup.creating") : t("setup.createInstance")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SetupScreen;
