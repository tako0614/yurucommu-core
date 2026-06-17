import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useSetAtom } from "solid-jotai";
import { useI18n } from "../../lib/i18n.tsx";
import { useDialog } from "../../lib/useDialog.ts";
import { createCommunity } from "../../lib/api/communities.ts";
import { enterCommunityScopeAtom } from "../../atoms/scope.ts";
import { pushToast, toastsAtom } from "../../atoms/toast.ts";

interface CreateScopeModalProps {
  open: boolean;
  onClose: () => void;
}

// Mirrors the backend validateCommunityName contract (routes.ts): 2–32 chars,
// [a-zA-Z0-9_]. We mirror it client-side only to gate the submit button and
// give inline feedback; the backend stays the authority and its error surfaces
// as a toast.
const NAME_PATTERN = /^[a-zA-Z0-9_]+$/;
const isNameValid = (name: string) => {
  const trimmed = name.trim();
  return (
    trimmed.length >= 2 &&
    trimmed.length <= 32 &&
    NAME_PATTERN.test(trimmed) &&
    !trimmed.startsWith("_") &&
    !trimmed.endsWith("_") &&
    !/^\d+$/.test(trimmed)
  );
};

/**
 * First-run-friendly community composer and the first UI caller of
 * {@link createCommunity}. On success it refreshes the scope picker source and
 * sets the inhabited scope to the new community — the owner "stands in the room
 * they made" rather than being dropped back to a list.
 *
 * Rendered as a bottom sheet on mobile / centered card on desktop, matching the
 * shared overlay shell used by ConfirmSheet and ScopeSwitcherSheet.
 */
export function CreateScopeModal(props: CreateScopeModalProps) {
  const { t } = useI18n();
  const setToasts = useSetAtom(toastsAtom);
  const enterCommunityScope = useSetAtom(enterCommunityScopeAtom);

  const [name, setName] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [summary, setSummary] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  const reset = () => {
    setName("");
    setDisplayName("");
    setSummary("");
  };

  let dialogRef: HTMLFormElement | undefined;

  const close = () => {
    if (submitting()) return;
    reset();
    props.onClose();
  };

  useDialog({
    isOpen: () => props.open,
    onClose: close,
    container: () => dialogRef,
  });

  const canSubmit = () => isNameValid(name()) && !submitting();

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!canSubmit()) return;
    setSubmitting(true);
    try {
      const community = await createCommunity({
        name: name().trim(),
        display_name: displayName().trim() || undefined,
        summary: summary().trim() || undefined,
      });
      // Stand in the room you made: surface the new pill and select it.
      await enterCommunityScope(community);
      pushToast(
        setToasts,
        t("scope.created").replace(
          "{name}",
          community.display_name || community.name,
        ),
        { kind: "success" },
      );
      reset();
      props.onClose();
    } catch (err) {
      console.error("Failed to create community:", err);
      const message =
        err instanceof Error && err.message ? err.message : t("scope.createFailed");
      pushToast(setToasts, message, { kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <form
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("scope.createTitle")}
            onSubmit={handleSubmit}
            class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl sm:rounded-2xl"
          >
            <h2 class="text-base font-bold text-white">
              {t("scope.createTitle")}
            </h2>
            <p class="mt-1 text-sm text-neutral-400">{t("scope.createDesc")}</p>

            <div class="mt-4 space-y-4">
              <div>
                <label
                  for="create-scope-name"
                  class="mb-1 block text-sm font-medium text-neutral-300"
                >
                  {t("scope.createName")}
                </label>
                <input
                  id="create-scope-name"
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder={t("scope.createNamePlaceholder")}
                  maxlength={32}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  disabled={submitting()}
                  class="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none placeholder-neutral-600 focus:border-[var(--accent)] disabled:opacity-50"
                />
                <p class="mt-1 text-xs text-neutral-500">
                  {t("scope.createNameHint")}
                </p>
              </div>

              <div>
                <label
                  for="create-scope-display-name"
                  class="mb-1 block text-sm font-medium text-neutral-300"
                >
                  {t("scope.createDisplayName")}
                </label>
                <input
                  id="create-scope-display-name"
                  type="text"
                  value={displayName()}
                  onInput={(e) => setDisplayName(e.currentTarget.value)}
                  placeholder={t("scope.createDisplayNamePlaceholder")}
                  maxlength={64}
                  disabled={submitting()}
                  class="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none placeholder-neutral-600 focus:border-[var(--accent)] disabled:opacity-50"
                />
              </div>

              <div>
                <label
                  for="create-scope-summary"
                  class="mb-1 block text-sm font-medium text-neutral-300"
                >
                  {t("scope.createSummary")}
                </label>
                <textarea
                  id="create-scope-summary"
                  value={summary()}
                  onInput={(e) => setSummary(e.currentTarget.value)}
                  placeholder={t("scope.createSummaryPlaceholder")}
                  rows={3}
                  maxlength={500}
                  disabled={submitting()}
                  class="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none placeholder-neutral-600 focus:border-[var(--accent)] disabled:opacity-50"
                />
              </div>
            </div>

            <div class="mt-5 flex gap-2">
              <button
                type="button"
                onClick={close}
                disabled={submitting()}
                class="flex-1 rounded-full bg-neutral-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={!canSubmit()}
                class="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:brightness-110 disabled:opacity-50"
              >
                {submitting() ? t("scope.creating") : t("scope.createSubmit")}
              </button>
            </div>
          </form>
        </div>
      </Portal>
    </Show>
  );
}
