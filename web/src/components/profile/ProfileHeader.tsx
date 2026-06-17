import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { BackIcon } from "./ProfileIcons.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface ProfileHeaderProps {
  actorId?: string;
  isOwnProfile: boolean;
  // The federated handle (user@domain) of the profile being viewed.
  handle: string;
  // Opens the QR / handle-share modal (own profile only).
  onOpenQr: () => void;
}

// Federated-handle (`@user@domain`) marker — the canonical cross-instance
// identity the owner shares. A small QR glyph hangs off it on the own profile.
const QrIcon = () => (
  <svg
    class="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 3h3m-3 3h6v-6m0 6v.01M17 14h3"
    />
  </svg>
);

// Profile top bar. The account switcher / Bookmarks / Settings now live in the
// shared AppMenu (Phase A), so this header no longer duplicates account-switch
// logic — it only carries the back affordance, the prominent federated handle,
// and (on the own profile) a QR/share trigger.
export function ProfileHeader(props: ProfileHeaderProps) {
  const { t } = useI18n();
  return (
    <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
      <div class="flex items-center justify-between px-4 py-3">
        {/* Left: Back button (only when viewing another's profile) */}
        <div class="w-10">
          <Show when={props.actorId}>
            <A
              href="/"
              aria-label={t("common.back")}
              class="p-2 -ml-2 hover:bg-neutral-900 rounded-full inline-block"
            >
              <BackIcon />
            </A>
          </Show>
        </div>

        {/* Center: prominent federated handle (user@domain). Empty while another
            user's profile is still loading — never falls back to the viewer's
            own handle. */}
        <span
          class="min-w-0 truncate font-bold text-white"
          title={props.handle ? `@${props.handle}` : undefined}
        >
          <Show when={props.handle}>@{props.handle}</Show>
        </span>

        {/* Right: QR / share (own profile) */}
        <div class="flex w-10 justify-end">
          <Show when={props.isOwnProfile}>
            <button
              type="button"
              onClick={props.onOpenQr}
              aria-label={t("profile.showQr")}
              class="p-2 -mr-2 rounded-full text-white transition-colors hover:bg-neutral-900"
            >
              <QrIcon />
            </button>
          </Show>
        </div>
      </div>
    </header>
  );
}
