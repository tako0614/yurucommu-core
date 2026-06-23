import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
// Type-only: the ~300KB html5-qrcode runtime is dynamically imported inside
// startScanner() so it loads ONLY when the user opens the scanner tab, instead
// of being bundled into every ProfilePage load (QRCodeModal is statically
// imported by ProfilePage).
import type { Html5Qrcode } from "html5-qrcode";
import { Actor } from "../types/index.ts";
import { fetchActor, follow, searchRemote } from "../lib/api.ts";
import { UserAvatar } from "./UserAvatar.tsx";
import { QrSvg } from "./QrSvg.tsx";
import { useDialog } from "../lib/useDialog.ts";
import { useI18n } from "../lib/i18n.tsx";

interface QRCodeModalProps {
  actor: Actor;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

const ShareIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
    />
  </svg>
);

export function QRCodeModal(props: QRCodeModalProps) {
  const { t } = useI18n();
  const [copied, setCopied] = createSignal(false);
  const [tab, setTab] = createSignal<"myqr" | "scan">("myqr");
  const [scanning, setScanning] = createSignal(false);
  const [lookingUp, setLookingUp] = createSignal(false);
  const [scanResult, setScanResult] = createSignal<Actor | null>(null);
  const [scanError, setScanError] = createSignal<string | null>(null);
  const [following, setFollowing] = createSignal(false);
  const [followSuccess, setFollowSuccess] = createSignal(false);
  // A follow of a PRIVATE local account or ANY remote account lands as a pending
  // REQUEST (awaiting approval), not an established follow — show that honestly
  // instead of a green "Followed!", matching ProfilePage/SearchPage.
  const [followPending, setFollowPending] = createSignal(false);
  let scannerRef: Html5Qrcode | null = null;
  let scannerContainerRef!: HTMLDivElement;
  let dialogRef: HTMLDivElement | undefined;

  // The parent gates mounting behind a <Show>, so the dialog is open for its
  // whole lifetime: trap focus, lock scroll, and close on Escape while mounted.
  useDialog({
    isOpen: () => true,
    onClose: () => props.onClose(),
    container: () => dialogRef,
  });

  const stopScannerSafely = async () => {
    if (!scannerRef) return;

    try {
      await scannerRef.stop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("not running")) {
        console.warn("Failed to stop QR scanner:", err);
      }
    }
  };

  // Generate QR URL - include username for ActivityPub lookup
  const currentDomain = window.location.host;
  const qrUrl = () =>
    `${window.location.origin}/profile/${encodeURIComponent(
      props.actor.ap_id,
    )}#${props.actor.preferred_username}`;

  // Stop scanner when component unmounts
  onCleanup(() => {
    void stopScannerSafely();
  });

  // Start/stop scanner when the tab changes. Track ONLY `tab`: startScanner()
  // writes setScanning(true) synchronously (before its first await), so a bare
  // effect that also read scanning()/scanResult() would re-trigger itself. `on`
  // keeps those reads untracked so this fires once per tab change.
  createEffect(
    on(tab, (current) => {
      if (current === "scan" && !scanning() && !scanResult()) {
        startScanner();
      } else if (current !== "scan" && scannerRef) {
        void stopScannerSafely();
        setScanning(false);
      }
    }),
  );

  const startScanner = async () => {
    if (!scannerContainerRef) return;

    setScanError(null);
    setScanning(true);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const html5QrCode = new Html5Qrcode("qr-scanner");
      scannerRef = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        async (decodedText) => {
          // Stop scanning on success
          await html5QrCode.stop();
          setScanning(false);
          setLookingUp(true);

          try {
            // Parse the QR code URL
            const url = new URL(decodedText);
            const scannedDomain = url.host;
            const pathMatch = url.pathname.match(/\/profile\/([^\/\?]+)/);
            const username = url.hash
              ? decodeURIComponent(url.hash.slice(1))
              : null;

            if (!pathMatch) {
              setScanError(t("qr.invalidCode"));
              setLookingUp(false);
              return;
            }

            const identifier = decodeURIComponent(pathMatch[1]);

            // Check if same domain (local user) or different domain (remote user)
            if (scannedDomain === currentDomain) {
              // Local user - fetch directly
              try {
                const actorData = await fetchActor(identifier);
                setScanResult(actorData);
              } catch (localErr: unknown) {
                console.error("QR local user fetch failed", localErr);
                setScanError(t("qr.lookupFailed"));
              }
            } else if (username) {
              // Remote user - search via ActivityPub WebFinger
              const webfingerAddress = `@${username}@${scannedDomain}`;
              try {
                const results = await searchRemote(webfingerAddress);
                if (results.length > 0) {
                  setScanResult(results[0]);
                } else {
                  setScanError(t("qr.userNotFound"));
                }
              } catch (remoteErr: unknown) {
                console.error("QR remote search failed", remoteErr);
                setScanError(t("qr.lookupFailed"));
              }
            } else {
              setScanError(t("qr.invalidCode"));
            }
          } catch (err: unknown) {
            console.error("QR parse error", err);
            setScanError(t("qr.invalidCode"));
          } finally {
            setLookingUp(false);
          }
        },
        () => {}, // ignore errors during scanning
      );
    } catch (err) {
      console.error("Failed to start scanner:", err);
      setScanError(t("qr.cameraError"));
      setScanning(false);
    }
  };

  const handleFollow = async () => {
    const result = scanResult();
    if (!result || following()) return;

    setFollowing(true);
    try {
      const { status } = await follow(result.ap_id);
      if (status === "pending") setFollowPending(true);
      else setFollowSuccess(true);
    } catch (err) {
      console.error("Failed to follow:", err);
      setScanError(t("qr.followFailed"));
    } finally {
      setFollowing(false);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${
            props.actor.name || props.actor.preferred_username
          }'s profile`,
          url: qrUrl(),
        });
      } catch {
        // User cancelled sharing
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(qrUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const resetScan = () => {
    setScanResult(null);
    setScanError(null);
    setFollowSuccess(false);
    setLookingUp(false);
    if (tab() === "scan") {
      startScanner();
    }
  };

  return (
    <div
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <Show when={copied()}>
        <div class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-neutral-800 text-white text-sm rounded-full shadow-lg">
          {t("settings.linkCopied")}
        </div>
      </Show>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("qr.title")}
        class="bg-neutral-900 rounded-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h2 class="text-lg font-bold text-white">{t("qr.title")}</h2>
          <button
            onClick={props.onClose}
            aria-label={t("common.close")}
            class="p-1 hover:bg-neutral-800 rounded-full transition-colors text-neutral-400 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div class="flex border-b border-neutral-800">
          <button
            onClick={() => setTab("myqr")}
            class={`flex-1 py-3 text-center font-medium relative ${
              tab() === "myqr" ? "text-white" : "text-neutral-500"
            }`}
          >
            {t("qr.myQr")}
            <Show when={tab() === "myqr"}>
              <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-accent rounded-full" />
            </Show>
          </button>
          <button
            onClick={() => setTab("scan")}
            class={`flex-1 py-3 text-center font-medium relative ${
              tab() === "scan" ? "text-white" : "text-neutral-500"
            }`}
          >
            {t("qr.scan")}
            <Show when={tab() === "scan"}>
              <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-accent rounded-full" />
            </Show>
          </button>
        </div>

        {/* Content */}
        <div class="p-6">
          <Show
            when={tab() === "myqr"}
            fallback={
              /* Scanner */

              <div class="flex flex-col items-center space-y-4">
                <Show when={lookingUp()}>
                  {/* Loading State */}
                  <div class="flex flex-col items-center space-y-4 py-8">
                    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-accent" />
                    <div class="text-neutral-400">{t("qr.lookingUp")}</div>
                  </div>
                </Show>

                <Show when={!lookingUp() && scanResult()}>
                  {/* Scan Result */}
                  <div class="flex flex-col items-center space-y-4 w-full">
                    <UserAvatar
                      avatarUrl={scanResult()!.icon_url}
                      name={
                        scanResult()!.name || scanResult()!.preferred_username
                      }
                      size={80}
                    />
                    <div class="text-center">
                      <div class="font-bold text-white text-xl">
                        {scanResult()!.name || scanResult()!.preferred_username}
                      </div>
                      <div class="text-neutral-500">
                        @{scanResult()!.username}
                      </div>
                      <Show when={scanResult()!.summary}>
                        <div class="text-neutral-400 text-sm mt-2 max-w-xs">
                          {scanResult()!.summary}
                        </div>
                      </Show>
                    </div>

                    <Show
                      when={!followSuccess() && !followPending()}
                      fallback={
                        <div
                          class={`px-6 py-2 rounded-full font-medium ${
                            followPending()
                              ? "bg-neutral-700 text-neutral-200"
                              : "bg-green-600 text-white"
                          }`}
                        >
                          {followPending()
                            ? t("profile.followRequested")
                            : t("qr.followed")}
                        </div>
                      }
                    >
                      <Show
                        when={scanResult()!.ap_id !== props.actor.ap_id}
                        fallback={
                          <div class="text-neutral-500">
                            {t("qr.thisIsYou")}
                          </div>
                        }
                      >
                        <button
                          onClick={handleFollow}
                          disabled={following()}
                          class="px-6 py-2 bg-accent disabled:bg-neutral-700 text-white rounded-full font-medium transition-colors"
                        >
                          {following()
                            ? t("qr.following")
                            : t("profile.follow")}
                        </button>
                      </Show>
                    </Show>

                    <button
                      onClick={resetScan}
                      class="text-neutral-400 hover:text-white text-sm"
                    >
                      {t("qr.scanAgain")}
                    </button>
                  </div>
                </Show>

                <Show when={!lookingUp() && !scanResult() && scanError()}>
                  {/* Error State */}
                  <div class="flex flex-col items-center space-y-4">
                    <div class="text-red-400 text-center">{scanError()}</div>
                    <button
                      onClick={resetScan}
                      class="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-full transition-colors"
                    >
                      {t("common.retry")}
                    </button>
                  </div>
                </Show>

                <Show when={!lookingUp() && !scanResult() && !scanError()}>
                  {/* Scanner View */}
                  <div
                    id="qr-scanner"
                    ref={scannerContainerRef}
                    class="w-full aspect-square max-w-[300px] rounded-lg overflow-hidden bg-neutral-800"
                  />
                  <Show when={scanning()}>
                    <div class="text-neutral-400 text-sm">
                      {t("qr.pointCamera")}
                    </div>
                  </Show>
                </Show>
              </div>
            }
          >
            {/* My QR Code */}
            <div class="flex flex-col items-center space-y-6">
              {/* User Info */}
              <div class="flex flex-col items-center gap-2">
                <UserAvatar
                  avatarUrl={props.actor.icon_url}
                  name={props.actor.name || props.actor.preferred_username}
                  size={64}
                />
                <div class="text-center">
                  <div class="font-bold text-white text-lg">
                    {props.actor.name || props.actor.preferred_username}
                  </div>
                  <div class="text-neutral-500">@{props.actor.username}</div>
                </div>
              </div>

              {/* QR Code */}
              <div class="bg-white p-4 rounded-2xl">
                <QrSvg value={qrUrl()} size={200} />
              </div>

              {/* Share Button */}
              <button
                onClick={handleShare}
                class="flex items-center gap-2 px-6 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white transition-colors"
              >
                <ShareIcon />
                {t("qr.share")}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
