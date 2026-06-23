import { createSignal, Index, onMount, Show } from "solid-js";
import { useAtomValue } from "solid-jotai";
import { SettingsSectionHeader } from "./SettingsSectionHeader.tsx";
import { ConfirmSheet } from "../ConfirmSheet.tsx";
import { CloseIcon, PlusIcon } from "./SettingsIcons.tsx";
import {
  downloadDataExport,
  fetchAlsoKnownAs,
  moveAccount,
  setAlsoKnownAs,
} from "../../lib/api/account.ts";
import { actorAtom } from "../../atoms/auth.ts";
import type { Translate } from "../../lib/i18n.tsx";

interface SettingsAccountSectionProps {
  onBack: () => void;
  t: Translate;
}

export function SettingsAccountSection(props: SettingsAccountSectionProps) {
  const [exporting, setExporting] = createSignal(false);
  const [aliases, setAliases] = createSignal<string[]>([""]);
  const [savingAliases, setSavingAliases] = createSignal(false);
  const [aliasesSaved, setAliasesSaved] = createSignal(false);
  const [moveTarget, setMoveTarget] = createSignal("");
  const [moving, setMoving] = createSignal(false);
  const [moveDone, setMoveDone] = createSignal(false);
  const [confirmingMove, setConfirmingMove] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const actor = useAtomValue(actorAtom);

  // Hydrate the editor with the account's EXISTING aliases. setAlsoKnownAs is a
  // full REPLACE, so without seeding the current values, a user returning to add
  // one alias to an empty field would silently overwrite (wipe) the others.
  onMount(async () => {
    const me = actor();
    if (!me) return;
    try {
      const existing = await fetchAlsoKnownAs(me.ap_id);
      if (existing.length > 0) setAliases(existing);
    } catch (e) {
      console.error("Failed to load existing aliases:", e);
    }
  });

  const handleExport = async () => {
    if (exporting()) return;
    setExporting(true);
    setError(null);
    try {
      await downloadDataExport();
    } catch (e) {
      console.error("Failed to export data:", e);
      setError(e instanceof Error ? e.message : props.t("common.error"));
    } finally {
      setExporting(false);
    }
  };

  const updateAlias = (index: number, value: string) => {
    setAliasesSaved(false);
    setAliases((prev) => prev.map((a, i) => (i === index ? value : a)));
  };
  const addAlias = () => {
    setAliasesSaved(false);
    setAliases((prev) => [...prev, ""]);
  };
  const removeAlias = (index: number) => {
    setAliasesSaved(false);
    setAliases((prev) =>
      prev.length === 1 ? [""] : prev.filter((_, i) => i !== index),
    );
  };

  const handleSaveAliases = async () => {
    if (savingAliases()) return;
    setSavingAliases(true);
    setError(null);
    setAliasesSaved(false);
    try {
      const cleaned = aliases()
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      await setAlsoKnownAs(cleaned);
      // Reflect the saved server state (a full replace) and confirm success.
      setAliases(cleaned.length > 0 ? cleaned : [""]);
      setAliasesSaved(true);
    } catch (e) {
      console.error("Failed to save aliases:", e);
      setError(e instanceof Error ? e.message : props.t("common.error"));
    } finally {
      setSavingAliases(false);
    }
  };

  const handleMove = async () => {
    const target = moveTarget().trim();
    if (!target || moving()) return;
    setMoving(true);
    setError(null);
    try {
      await moveAccount(target);
      setMoveDone(true);
    } catch (e) {
      console.error("Failed to move account:", e);
      setError(e instanceof Error ? e.message : props.t("common.error"));
    } finally {
      setMoving(false);
    }
  };

  const inputClass =
    "w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent";

  return (
    <div class="flex flex-col h-full">
      <SettingsSectionHeader
        title={props.t("settings.accountMigration")}
        onBack={props.onBack}
      />
      <div class="flex-1 overflow-y-auto">
        <Show when={error()}>
          <div class="mx-4 mt-4 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error()}
          </div>
        </Show>

        {/* Data export */}
        <div class="border-b border-neutral-900 p-4">
          <div class="text-sm text-neutral-500 uppercase mb-2">
            {props.t("settings.dataExport")}
          </div>
          <p class="text-sm text-neutral-400 mb-3">
            {props.t("settings.dataExportHint")}
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting()}
            class="w-full py-2 bg-accent rounded-lg font-bold disabled:opacity-50"
          >
            {exporting()
              ? props.t("settings.exporting")
              : props.t("settings.dataExport")}
          </button>
        </div>

        {/* Account migration */}
        <div class="p-4">
          <div class="text-sm text-neutral-500 uppercase mb-2">
            {props.t("settings.accountMigration")}
          </div>

          {/* alsoKnownAs aliases */}
          <label class="block text-sm text-neutral-400 mb-1">
            {props.t("settings.alsoKnownAs")}
          </label>
          <p class="text-xs text-neutral-500 mb-2">
            {props.t("settings.alsoKnownAsHint")}
          </p>
          <div class="space-y-2 mb-2">
            <Index each={aliases()}>
              {(alias, index) => (
                <div class="flex gap-2">
                  <input
                    type="text"
                    value={alias()}
                    onInput={(e) => updateAlias(index, e.currentTarget.value)}
                    placeholder="https://example.com/ap/users/me"
                    aria-label={props.t("settings.alsoKnownAs")}
                    class={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => removeAlias(index)}
                    aria-label={props.t("profile.removeField")}
                    class="p-2 hover:bg-neutral-800 rounded-full shrink-0"
                  >
                    <CloseIcon />
                  </button>
                </div>
              )}
            </Index>
          </div>
          <button
            type="button"
            onClick={addAlias}
            class="flex items-center gap-2 text-sm text-accent mb-3"
          >
            <PlusIcon />
            {props.t("profile.addField")}
          </button>
          <button
            type="button"
            onClick={handleSaveAliases}
            disabled={savingAliases()}
            class="w-full py-2 bg-neutral-800 rounded-lg font-bold disabled:opacity-50 mb-2"
          >
            {savingAliases()
              ? props.t("common.saving")
              : props.t("common.save")}
          </button>
          <Show when={aliasesSaved()}>
            <div
              role="status"
              class="mb-6 p-2 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm"
            >
              {props.t("settings.aliasesSaved")}
            </div>
          </Show>
          <Show when={!aliasesSaved()}>
            <div class="mb-6" />
          </Show>

          {/* Move target */}
          <Show
            when={!moveDone()}
            fallback={
              <div class="p-2 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                {props.t("settings.moveDone")}
              </div>
            }
          >
            <label
              for="settings-move-target"
              class="block text-sm text-neutral-400 mb-1"
            >
              {props.t("settings.moveAccount")}
            </label>
            <input
              id="settings-move-target"
              type="text"
              value={moveTarget()}
              onInput={(e) => setMoveTarget(e.currentTarget.value)}
              placeholder={props.t("settings.moveTargetPlaceholder")}
              class={`${inputClass} mb-3`}
            />
            <button
              type="button"
              onClick={() => setConfirmingMove(true)}
              disabled={moving() || moveTarget().trim().length === 0}
              class="w-full py-2 bg-red-500/90 rounded-lg font-bold disabled:opacity-50"
            >
              {props.t("settings.moveConfirm")}
            </button>
            {/* Account migration is irreversible (this account becomes "moved"
                and followers are handed off), so require a deliberate confirm
                rather than firing on the first click. */}
            <ConfirmSheet
              open={confirmingMove()}
              title={props.t("settings.moveAccount")}
              body={props.t("settings.moveConfirm")}
              destructive
              busy={moving()}
              onConfirm={() => {
                setConfirmingMove(false);
                void handleMove();
              }}
              onCancel={() => setConfirmingMove(false)}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
