import { createEffect, createSignal, onMount, Show } from "solid-js";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import type { Actor } from "../types/index.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { pushToast, toastsAtom } from "../atoms/toast.ts";
import {
  accountsAtom,
  accountsLoadingAtom,
  createAccountAtom,
  currentApIdAtom,
  loadAccountsAtom,
  switchAccountAtom,
} from "../atoms/timeline.ts";
import { UserAvatar } from "../components/UserAvatar.tsx";
import { ConfirmSheet } from "../components/ConfirmSheet.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { SettingsAccountsSection } from "../components/settings/SettingsAccountsSection.tsx";
import { SettingsDeleteSection } from "../components/settings/SettingsDeleteSection.tsx";
import { SettingsUserList } from "../components/settings/SettingsUserList.tsx";
import { ChevronRightIcon } from "../components/settings/SettingsIcons.tsx";
import {
  deleteAccount,
  fetchBlockedUsers,
  fetchMutedUsers,
  logout as logoutRequest,
  unblockUser,
  unmuteUser,
} from "../lib/api.ts";

export function SettingsPage() {
  const actor = useRequiredActor();
  const { t, language, setLanguage } = useI18n();
  const setToasts = useSetAtom(toastsAtom);
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const [confirmingDeleteAccount, setConfirmingDeleteAccount] =
    createSignal(false);
  const [activeSection, setActiveSection] = createSignal<
    "main" | "blocked" | "muted" | "delete" | "accounts"
  >("main");
  const [blockedUsers, setBlockedUsers] = createSignal<Actor[]>([]);
  const [mutedUsers, setMutedUsers] = createSignal<Actor[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [deleteConfirm, setDeleteConfirm] = createSignal("");
  // True while the irreversible delete request is in flight, to show progress
  // and prevent a double-submit.
  const [deletingAccount, setDeletingAccount] = createSignal(false);

  // Account switching — share the same atoms as the AppMenu switcher so the
  // list and current selection never go stale across the two surfaces.
  const accounts = useAtomValue(accountsAtom);
  const accountsLoading = useAtomValue(accountsLoadingAtom);
  const currentApId = useAtomValue(currentApIdAtom);
  const doLoadAccounts = useSetAtom(loadAccountsAtom);
  const doSwitchAccount = useSetAtom(switchAccountAtom);
  const doCreateAccount = useSetAtom(createAccountAtom);
  const [showCreateAccount, setShowCreateAccount] = createSignal(false);
  const [newUsername, setNewUsername] = createSignal("");
  const [newDisplayName, setNewDisplayName] = createSignal("");
  const [createError, setCreateError] = createSignal<string | null>(null);
  const usernamePattern = /^[a-zA-Z0-9_]+$/;
  const normalizedUsername = () => newUsername().trim();
  const isUsernameValid = () =>
    normalizedUsername().length > 0 &&
    usernamePattern.test(normalizedUsername());
  const [switching, setSwitching] = createSignal(false);

  const handleLogout = async () => {
    try {
      await logoutRequest();
    } catch {
      // Ignore errors
    }
    // Redirect to home to trigger re-auth
    globalThis.location.href = "/";
  };

  const resetCreateAccount = () => {
    setShowCreateAccount(false);
    setNewUsername("");
    setNewDisplayName("");
    setCreateError(null);
  };

  const handleToggleCreate = (open: boolean) => {
    if (open) {
      setShowCreateAccount(true);
    } else {
      resetCreateAccount();
    }
  };

  onMount(() => {
    setActiveSection("main");
  });

  createEffect(() => {
    const section = activeSection();
    if (section === "blocked") {
      // Only show loading if no cached data
      if (blockedUsers().length === 0) setLoading(true);
      fetchBlockedUsers()
        .then(setBlockedUsers)
        .catch((err) => {
          console.error("Failed to load blocked users:", err);
          setError(t("common.error"));
        })
        .finally(() => setLoading(false));
    } else if (section === "muted") {
      // Only show loading if no cached data
      if (mutedUsers().length === 0) setLoading(true);
      fetchMutedUsers()
        .then(setMutedUsers)
        .catch((err) => {
          console.error("Failed to load muted users:", err);
          setError(t("common.error"));
        })
        .finally(() => setLoading(false));
    } else if (section === "accounts") {
      // Shared atom owns the fetch + loading/error state; this just triggers it.
      doLoadAccounts();
    }
  });

  const handleSwitchAccount = async (apId: string) => {
    if (apId === currentApId()) return;
    setSwitching(true);
    try {
      // switchAccountAtom reloads the page on success; only reached on error.
      await doSwitchAccount(apId);
    } catch (e) {
      console.error("Failed to switch account:", e);
      setError(t("common.error"));
    } finally {
      setSwitching(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!normalizedUsername()) {
      setCreateError(t("settings.usernameRequired"));
      return;
    }
    if (!usernamePattern.test(normalizedUsername())) {
      setCreateError(t("settings.usernamePatternError"));
      return;
    }
    setCreateError(null);
    try {
      await doCreateAccount({
        username: normalizedUsername(),
        name: newDisplayName().trim() || undefined,
      });
      resetCreateAccount();
    } catch (e: unknown) {
      setCreateError(
        e instanceof Error ? e.message : t("settings.createAccountFailed"),
      );
    }
  };

  const handleUnblock = async (userApId: string) => {
    try {
      await unblockUser(userApId);
      setBlockedUsers((prev) => prev.filter((u) => u.ap_id !== userApId));
    } catch (e) {
      console.error("Failed to unblock:", e);
      pushToast(setToasts, t("feedback.actionFailed"), { kind: "error" });
    }
  };

  const handleUnmute = async (userApId: string) => {
    try {
      await unmuteUser(userApId);
      setMutedUsers((prev) => prev.filter((u) => u.ap_id !== userApId));
    } catch (e) {
      console.error("Failed to unmute:", e);
      pushToast(setToasts, t("feedback.actionFailed"), { kind: "error" });
    }
  };

  const handleDeleteAccount = () => {
    if (deleteConfirm() !== actor.preferred_username) {
      setError(t("settings.usernameMismatch"));
      return;
    }
    // Username matched: gate the irreversible action behind a final confirm.
    setConfirmingDeleteAccount(true);
  };

  const confirmDeleteAccount = async () => {
    setConfirmingDeleteAccount(false);
    if (deletingAccount()) return;
    setDeletingAccount(true);
    try {
      await deleteAccount();
      // On success we navigate away; keep the in-flight state until then.
      globalThis.location.href = "/";
    } catch (e: unknown) {
      setDeletingAccount(false);
      pushToast(
        setToasts,
        e instanceof Error ? e.message : t("settings.deleteAccountFailed"),
        { kind: "error" },
      );
    }
  };

  const errorBanner = () =>
    error() ? (
      <InlineErrorBanner message={error()!} onClose={clearError} />
    ) : null;

  return (
    <div class="flex flex-col h-full">
      {errorBanner()}
      <Show when={activeSection() === "blocked"}>
        <SettingsUserList
          title={t("settings.blockedUsers")}
          emptyLabel={t("settings.noBlockedUsers")}
          actionLabel={t("settings.unblock")}
          loading={loading()}
          users={blockedUsers()}
          onBack={() => setActiveSection("main")}
          onAction={handleUnblock}
          t={t}
        />
      </Show>

      <Show when={activeSection() === "muted"}>
        <SettingsUserList
          title={t("settings.mutedUsers")}
          emptyLabel={t("settings.noMutedUsers")}
          actionLabel={t("settings.unmute")}
          loading={loading()}
          users={mutedUsers()}
          onBack={() => setActiveSection("main")}
          onAction={handleUnmute}
          t={t}
        />
      </Show>

      <Show when={activeSection() === "delete"}>
        <SettingsDeleteSection
          actor={actor}
          deleteConfirm={deleteConfirm()}
          deleting={deletingAccount()}
          onChangeConfirm={setDeleteConfirm}
          onDelete={handleDeleteAccount}
          onBack={() => setActiveSection("main")}
          t={t}
        />
      </Show>

      <Show when={activeSection() === "accounts"}>
        <SettingsAccountsSection
          accounts={accounts()}
          loading={accountsLoading()}
          switching={switching()}
          showCreateAccount={showCreateAccount()}
          newUsername={newUsername()}
          newDisplayName={newDisplayName()}
          createError={createError()}
          isUsernameValid={isUsernameValid()}
          onBack={() => setActiveSection("main")}
          onSwitchAccount={handleSwitchAccount}
          onToggleCreate={handleToggleCreate}
          onChangeUsername={setNewUsername}
          onChangeDisplayName={setNewDisplayName}
          onCreate={handleCreateAccount}
          onResetCreate={resetCreateAccount}
          t={t}
        />
      </Show>

      <Show when={activeSection() === "main"}>
        <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <h1 class="text-xl font-bold px-4 py-3">{t("settings.title")}</h1>
        </header>
        <div class="flex-1 overflow-y-auto">
          {/* Language */}
          <div class="border-b border-neutral-900">
            <div class="px-4 py-2 text-sm text-neutral-500 uppercase">
              {t("settings.sectionDisplay")}
            </div>
            <button
              type="button"
              onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
              class="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
            >
              <span>{t("settings.language")}</span>
              <span class="text-neutral-500">
                {language === "ja"
                  ? t("settings.languageJa")
                  : t("settings.languageEn")}
              </span>
            </button>
          </div>

          {/* Privacy */}
          <div class="border-b border-neutral-900">
            <div class="px-4 py-2 text-sm text-neutral-500 uppercase">
              {t("settings.sectionPrivacy")}
            </div>
            <button
              type="button"
              onClick={() => setActiveSection("blocked")}
              class="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
            >
              <span>{t("settings.blockedUsers")}</span>
              <ChevronRightIcon />
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("muted")}
              class="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
            >
              <span>{t("settings.mutedUsers")}</span>
              <ChevronRightIcon />
            </button>
          </div>

          {/* Account */}
          <div class="border-b border-neutral-900">
            <div class="px-4 py-2 text-sm text-neutral-500 uppercase">
              {t("settings.sectionAccount")}
            </div>
            <button
              type="button"
              onClick={() => setActiveSection("accounts")}
              class="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
            >
              <div class="flex items-center gap-3">
                <UserAvatar
                  avatarUrl={actor.icon_url}
                  name={actor.name || actor.preferred_username}
                  size={32}
                />
                <div class="text-left">
                  <div class="text-sm font-medium">
                    {actor.name || actor.preferred_username}
                  </div>
                  <div class="text-xs text-neutral-500">
                    @{actor.preferred_username}
                  </div>
                </div>
              </div>
              <ChevronRightIcon />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              class="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
            >
              <span>{t("settings.logout")}</span>
              <ChevronRightIcon />
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("delete")}
              class="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50 text-red-500"
            >
              <span>{t("settings.deleteAccount")}</span>
              <ChevronRightIcon />
            </button>
          </div>
        </div>
      </Show>
      <ConfirmSheet
        open={confirmingDeleteAccount()}
        title={t("confirm.deleteAccountTitle")}
        body={t("confirm.deleteAccountBody")}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={confirmDeleteAccount}
        onCancel={() => setConfirmingDeleteAccount(false)}
      />
    </div>
  );
}

export default SettingsPage;
