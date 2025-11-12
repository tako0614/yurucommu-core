import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import Avatar from "./Avatar";
import { generateQrCode } from "@platform/lib/qrcode";
import { IconSend, IconQr } from "./icons";

type ProfileModalProps = {
  open: boolean;
  onClose: () => void;
  profileUrl: string;
  displayName?: string;
  handle?: string;
  avatarUrl?: string;
  title?: string;
  initialView?: "share" | "scan";
  onScanDetected?: (value: string) => void;
};

const QUIET_ZONE = 4;

export default function ProfileModal(props: ProfileModalProps) {
  const qrData = createMemo(() => {
    if (!props.open || !props.profileUrl) return null;
    try {
      return generateQrCode(props.profileUrl);
    } catch (error) {
      console.warn("QRコードの生成に失敗しました", error);
      return null;
    }
  });

  const [shareMessage, setShareMessage] = createSignal<string | null>(null);
  const [view, setView] = createSignal<"share" | "scan">("share");

  let wasOpen = false;

  createEffect(() => {
    if (!props.open) {
      setShareMessage(null);
      setView("share");
    }
  });

  createEffect(() => {
    const isOpen = props.open;
    if (isOpen && !wasOpen) {
      setView(props.initialView ?? "share");
    }
    wasOpen = isOpen;
  });

  const handleScannerDetected = (value: string) => {
    if (value) {
      setShareMessage("スキャン結果を検出しました。");
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(value)
          .then(() => setShareMessage("スキャン結果をコピーしました。"))
          .catch((error) => {
            console.warn("スキャンした値のコピーに失敗しました", error);
            setShareMessage("スキャン結果を検出しました。");
          });
      }
      props.onScanDetected?.(value);
    }
  };

  const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
  const hasUrl = () => Boolean((props.profileUrl || "").trim());

  const handleShare = async () => {
    setShareMessage(null);
    if (!hasUrl()) {
      setShareMessage("共有できるリンクがありません。");
      return;
    }
    if (canShare()) {
      try {
        await navigator.share({
          title: props.displayName ? `${props.displayName}のプロフィール` : "プロフィール",
          url: props.profileUrl,
        });
        setShareMessage("共有しました。");
        return;
      } catch (error: unknown) {
        if ((error as { name?: string } | undefined)?.name === "AbortError") {
          return;
        }
        console.warn("Webシェアに失敗しました", error);
        setShareMessage("共有に失敗しました。もう一度お試しください。");
        return;
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(props.profileUrl);
        setShareMessage("リンクをコピーしました。");
        return;
      } catch (error) {
        console.warn("プロフィールURLのコピーに失敗しました", error);
      }
    }
    setShareMessage("共有できませんでした。");
  };

  const handleCopyLink = async () => {
    setShareMessage(null);
    if (!hasUrl()) {
      setShareMessage("コピーできるリンクがありません。");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(props.profileUrl);
        setShareMessage("リンクをコピーしました。");
        return;
      } catch (error) {
        console.warn("プロフィールURLのコピーに失敗しました", error);
      }
    }
    setShareMessage("リンクをコピーできませんでした。");
  };

  const headerTitle = () => props.title ?? "プロフィール";
  const profileName = () => (props.displayName && props.displayName.trim()) || "プロフィール";
  const handleLabel = () => {
    const value = (props.handle || "").trim();
    if (!value) return null;
    return value.startsWith("@") ? value : `@${value}`;
  };
  const shortUrl = () => (props.profileUrl || "").replace(/^https?:\/\//, "");
  const isShareView = () => view() === "share";
  const isScanView = () => view() === "scan";

  const enterScanView = () => {
    setShareMessage(null);
    setView("scan");
  };

  const leaveScanView = () => {
    setView("share");
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-start justify-center pt-3 px-0 md:items-center md:px-4">
        <button
          type="button"
          class="absolute inset-0 bg-black"
          aria-label="閉じる"
          onClick={props.onClose}
        />
        <div class="relative z-10 w-full md:max-w-md max-h-[calc(100vh-24px)] md:h-auto">
          <div class="rounded-t-3xl md:rounded-3xl overflow-hidden bg-white/95 dark:bg-black/95 text-black dark:text-white shadow-2xl">
            <div class="flex items-center justify-between px-5 py-4 bg-white/5">
              <div class="text-sm font-medium tracking-wide text-gray-200">
                {isScanView() ? "QRコードをスキャン" : headerTitle()}
              </div>
              <div class="flex items-center gap-3 text-xs text-gray-300">
                <Show when={isScanView()}>
                  <button type="button" class="hover:text-white" onClick={leaveScanView}>
                    戻る
                  </button>
                </Show>
                <button type="button" class="hover:text-white" onClick={props.onClose}>
                  閉じる
                </button>
              </div>
            </div>
            <Show
              when={isShareView()}
              fallback={
                <div class="px-5 pb-6 pt-5 space-y-5 overflow-auto">
                  <QrScannerSection onDetected={handleScannerDetected} />
                  <div class="text-[11px] text-gray-400 leading-relaxed">
                    QRコードを枠内に収めると、自動的に内容を読み取ります。検出されるとここに表示されます。
                  </div>
                  <Show when={shareMessage()}>
                    {(message) => (
                      <div class="rounded-xl bg-white/10 text-xs px-3 py-2 text-gray-200">
                        {message()}
                      </div>
                    )}
                  </Show>
                </div>
              }
            >
              <div class="px-5 pb-6 pt-5 space-y-6 overflow-auto">
                <div class="flex flex-col items-center text-center gap-3">
                  <Avatar
                    src={props.avatarUrl || ""}
                    alt={props.displayName || "プロフィール"}
                    class="w-20 h-20 rounded-full border border-white/20 shadow-lg object-cover"
                  />
                  <div class="space-y-1">
                    <div class="text-base font-semibold text-gray-900 dark:text-white">
                      {profileName()}
                    </div>
                    <Show when={handleLabel()}>
                      {(label) => (
                        <div class="text-sm text-gray-500 dark:text-gray-400">{label()}</div>
                      )}
                    </Show>
                  </div>
                  <button
                    type="button"
                    class="px-4 py-2 rounded-full border hairline text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors text-gray-100 dark:text-gray-100"
                    onClick={() => void handleCopyLink()}
                    disabled={!hasUrl()}
                  >
                    <span class="break-all">{hasUrl() ? shortUrl() : "リンクがありません"}</span>
                  </button>
                </div>

                <div class="bg-white/95 dark:bg-black/95 text-black dark:text-white rounded-2xl px-5 py-5 flex flex-col items-center shadow-inner">
                  <div class="w-full max-w-[260px] aspect-square">
                    <Show
                      when={qrData()}
                      fallback={<div class="w-full h-full flex items-center justify-center text-sm text-gray-500">QRコードを生成中...</div>}
                    >
                      {(qr) => <QrSvg modules={qr().modules} />}
                    </Show>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-sm">
                  <button
                    type="button"
                    class="flex flex-col items-center gap-0 sm:gap-2 rounded-2xl bg-white/10 px-3 py-3 hover:bg-white/20 transition-colors"
                    onClick={() => void handleShare()}
                  >
                    <IconSend size={22} />
                    <span>{canShare() ? "共有する" : "コピーで共有"}</span>
                  </button>
                  <button
                    type="button"
                    class="flex flex-col items-center gap-0 sm:gap-2 rounded-2xl bg-white/10 px-3 py-3 hover:bg-white/20 transition-colors"
                    onClick={enterScanView}
                  >
                    <IconQr size={22} />
                    <span>QRリーダー</span>
                  </button>
                </div>

                <Show when={shareMessage()}>
                  {(message) => (
                    <div class="rounded-xl bg-white/10 text-xs px-3 py-2 text-gray-200">
                      {message()}
                    </div>
                  )}
                </Show>
                <div class="text-[11px] text-gray-400 leading-relaxed">
                  プロフィールを表示している友達にリンクを共有できます。リンク部分をタップするとコピーできます。
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

type QrSvgProps = {
  modules: boolean[][];
};

function QrSvg(props: QrSvgProps) {
  const moduleCount = () => props.modules.length;
  const size = () => moduleCount() + QUIET_ZONE * 2;
  return (
    <svg
      viewBox={`0 0 ${size()} ${size()}`}
      xmlns="http://www.w3.org/2000/svg"
      shape-rendering="crispEdges"
      class="w-full h-full"
    >
      <rect width={size()} height={size()} fill="none" />
      <For each={props.modules}>
        {(row, rowIndex) => (
          <For each={row}>
            {(cell, colIndex) =>
              cell ? (
                <rect
                  x={colIndex() + QUIET_ZONE}
                  y={rowIndex() + QUIET_ZONE}
                  width="1"
                  height="1"
                  fill="currentColor"
                />
              ) : null
            }
          </For>
        )}
      </For>
    </svg>
  );
}

type CopyStatus = "idle" | "copied" | "error";

type QrScannerSectionProps = {
  onDetected?: (value: string) => void;
};

function QrScannerSection(props: QrScannerSectionProps) {
  let videoRef: HTMLVideoElement | undefined;
  let activeStream: MediaStream | null = null;
  const [error, setError] = createSignal<string | null>(null);
  const [detectedValue, setDetectedValue] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal<CopyStatus>("idle");
  const [session, setSession] = createSignal(0);

  const barcodeDetectorAvailable = () =>
    typeof window !== "undefined" && Boolean((window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector);

  const detectedUrl = createMemo(() => {
    const value = detectedValue();
    if (!value) return null;
    try {
      return new URL(value);
    } catch {
      if (typeof window !== "undefined") {
        try {
          return new URL(value, window.location.origin);
        } catch {
          return null;
        }
      }
      return null;
    }
  });

  createEffect(() => {
    session();
    setError(null);
    setDetectedValue(null);
    setCopyStatus("idle");

    let cancelled = false;
    let stream: MediaStream | null = null;
    let animationId: number | null = null;
    type DetectorInstance = { detect: (element: HTMLVideoElement) => Promise<{ rawValue?: string }[]> };
    let detector: DetectorInstance | null = null;

    const stopStream = () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      try {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
      } catch (e) {
        console.warn("ストリームの停止中にエラーが発生しました", e);
      }
      try {
        if (activeStream) {
          activeStream.getTracks().forEach((t) => t.stop());
          activeStream = null;
        }
      } catch (e) {
        console.warn("アクティブなストリームを停止できませんでした", e);
      }
      if (videoRef) {
        try {
          videoRef.srcObject = null;
        } catch (e) {
          /* noop */
        }
      }
    };

    const scanLoop = async () => {
      if (!detector || !videoRef || cancelled) return;
      try {
        const results = await detector.detect(videoRef);
        if (results && results.length > 0) {
          const raw = results[0]?.rawValue ?? "";
          if (raw) {
            setDetectedValue(raw);
            props.onDetected?.(raw);
            cancelled = true;
            setScanning(false);
            stopStream();
            return;
          }
        }
      } catch (scanError) {
        console.warn("バーコード検出でエラーが発生しました", scanError);
      }
      if (!cancelled) {
        animationId = requestAnimationFrame(scanLoop);
      }
    };

    const start = async () => {
      if (!videoRef) {
        setError("カメラの初期化に失敗しました。");
        return;
      }
      const BarcodeDetectorClass = barcodeDetectorAvailable()
        ? (window as unknown as { BarcodeDetector: new (...args: any[]) => DetectorInstance }).BarcodeDetector
        : null;
      if (!BarcodeDetectorClass) {
        setError("このブラウザはQRコードのスキャンに対応していません。");
        return;
      }
      try {
        detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
      } catch (detectorError) {
        console.warn("BarcodeDetectorの初期化に失敗しました", detectorError);
        setError("QRコードリーダーを初期化できませんでした。");
        return;
      }
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setError("カメラ機能が利用できません。");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        activeStream = stream;
        if (!videoRef) return;
        videoRef.srcObject = stream;
        await videoRef.play();
        setScanning(true);
        animationId = requestAnimationFrame(scanLoop);
      } catch (cameraError) {
        console.warn("カメラへのアクセスに失敗しました", cameraError);
        setError("カメラにアクセスできませんでした。設定を確認してください。");
        stopStream();
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopStream();
      setScanning(false);
    };
  });

  onCleanup(() => {
    try {
      if (videoRef && videoRef.srcObject) {
        const stream = videoRef.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      /* noop */
    }
    try {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
        activeStream = null;
      }
    } catch {
      /* noop */
    }
  });

  const restart = () => {
    setDetectedValue(null);
    setCopyStatus("idle");
    setSession((value) => value + 1);
  };

  const handleCopy = async () => {
    const value = detectedValue();
    if (!value) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        setCopyStatus("copied");
        setTimeout(() => setCopyStatus("idle"), 2000);
        return;
      } catch (err) {
        console.warn("QRスキャン結果のコピーに失敗しました", err);
      }
    }
    setCopyStatus("error");
  };

  const copyLabel = () => (copyStatus() === "copied" ? "コピー済み" : "結果をコピー");
  const hasResult = () => Boolean(detectedValue());

  return (
    <div class="space-y-4">
      <div class="w-full max-w-[240px] aspect-square mx-auto relative rounded-2xl overflow-hidden border border-current/10 bg-white/95 dark:bg-black/95">
        <video
          ref={(el) => {
            videoRef = el;
          }}
          class="w-full h-full object-cover"
          autoplay
          muted
          playsinline
        />
        <Show when={!scanning()}>
          <div class="absolute inset-0 flex items-center justify-center bg-transparent text-sm text-current">
            カメラを準備中...
          </div>
        </Show>
      </div>
      <Show when={error()}>
        {(message) => (
          <div class="rounded-xl bg-red-500/20 text-red-200 text-sm px-3 py-2">{message()}</div>
        )}
      </Show>
      <Show when={hasResult()}>
        <div class="space-y-3">
          <div class="rounded-xl bg-white text-black px-4 py-3">
            <div class="text-xs text-gray-500">検出した内容</div>
            <div class="mt-1 text-sm break-all leading-relaxed">{detectedValue()}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Show when={detectedUrl()}>
              {(url) => (
                <a
                  href={url().toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex-1 min-w-[140px] text-center px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
                >
                  リンクを開く
                </a>
              )}
            </Show>
            <button
              type="button"
              class="flex-1 min-w-[140px] px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
              onClick={() => void handleCopy()}
            >
              {copyLabel()}
            </button>
            <button
              type="button"
              class="flex-1 min-w-[140px] px-3 py-2 rounded-full border border-white/20 hover:bg-white/10 transition-colors"
              onClick={restart}
            >
              もう一度スキャン
            </button>
          </div>
          <Show when={copyStatus() === "error"}>
            <div class="text-xs text-red-200">クリップボードにコピーできませんでした。手動で選択してください。</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
