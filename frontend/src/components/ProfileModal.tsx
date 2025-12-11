import { useEffect, useMemo, useRef, useState } from "react";
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
  const qrData = useMemo(() => {
    if (!props.open || !props.profileUrl) return null;
    try {
      return generateQrCode(props.profileUrl);
    } catch (error) {
      console.warn("QRコードの生成に失敗しました", error);
      return null;
    }
  }, [props.open, props.profileUrl]);

  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [view, setView] = useState<"share" | "scan">("share");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!props.open) {
      setShareMessage(null);
      setView("share");
    }
  }, [props.open]);

  useEffect(() => {
    if (props.open && !wasOpenRef.current) {
      setView(props.initialView ?? "share");
    }
    wasOpenRef.current = props.open;
  }, [props.initialView, props.open]);

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

  const headerTitle = props.title ?? "プロフィール";
  const profileName = (props.displayName && props.displayName.trim()) || "プロフィール";
  const handleLabel = () => {
    const value = (props.handle || "").trim();
    if (!value) return null;
    return value.startsWith("@") ? value : `@${value}`;
  };
  const shortUrl = () => (props.profileUrl || "").replace(/^https?:\/\//, "");
  const isShareView = view === "share";

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-3 px-0 md:items-center md:px-4">
      <button type="button" className="absolute inset-0 bg-black" aria-label="閉じる" onClick={props.onClose} />
      <div className="relative z-10 w-full md:max-w-md max-h-[calc(100vh-24px)] md:h-auto">
        <div className="rounded-t-3xl md:rounded-3xl overflow-hidden bg-white/95 dark:bg-black/95 text-black dark:text-white shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 bg-white/5">
            <div className="text-sm font-medium tracking-wide text-gray-200">
              {isShareView ? headerTitle : "QRコードをスキャン"}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-300">
              {!isShareView && (
                <button type="button" className="hover:text-white" onClick={() => setView("share")}>
                  戻る
                </button>
              )}
              <button type="button" className="hover:text-white" onClick={props.onClose}>
                閉じる
              </button>
            </div>
          </div>
          {isShareView ? (
            <div className="px-5 pb-6 pt-5 space-y-6 overflow-auto">
              <div className="flex flex-col items-center text-center gap-3">
                <Avatar
                  src={props.avatarUrl || ""}
                  alt={props.displayName || "プロフィール"}
                  className="w-20 h-20 rounded-full border border-white/20 shadow-lg object-cover"
                />
                <div className="space-y-1">
                  <div className="text-base font-semibold text-gray-900 dark:text-white">{profileName}</div>
                  {handleLabel() && <div className="text-sm text-gray-500 dark:text-gray-400">{handleLabel()}</div>}
                </div>
                <button
                  type="button"
                  className="px-4 py-2 rounded-full border hairline text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors text-gray-100 dark:text-gray-100"
                  onClick={() => void handleCopyLink()}
                  disabled={!hasUrl()}
                >
                  <span className="break-all">{hasUrl() ? shortUrl() : "リンクがありません"}</span>
                </button>
              </div>

              <div className="bg-white/95 dark:bg-black/95 text-black dark:text-white rounded-2xl px-5 py-5 flex flex-col items-center shadow-inner">
                <div className="w-full max-w-[260px] aspect-square">
                  {qrData ? (
                    <QrSvg modules={qrData.modules} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">QRコードを生成中...</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <button
                  type="button"
                  className="flex flex-col items-center gap-0 sm:gap-2 rounded-2xl bg-white/10 px-3 py-3 hover:bg-white/20 transition-colors"
                  onClick={() => void handleShare()}
                >
                  <IconSend size={22} />
                  <span>{canShare() ? "共有する" : "コピーで共有"}</span>
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center gap-0 sm:gap-2 rounded-2xl bg-white/10 px-3 py-3 hover:bg-white/20 transition-colors"
                  onClick={() => setView("scan")}
                >
                  <IconQr size={22} />
                  <span>QRリーダー</span>
                </button>
              </div>

              {shareMessage && <div className="rounded-xl bg-white/10 text-xs px-3 py-2 text-gray-200">{shareMessage}</div>}
              <div className="text-[11px] text-gray-400 leading-relaxed">
                プロフィールを表示している友達にリンクを共有できます。リンク部分をタップするとコピーできます。
              </div>
            </div>
          ) : (
            <div className="px-5 pb-6 pt-5 space-y-5 overflow-auto">
              <QrScannerSection onDetected={handleScannerDetected} />
              <div className="text-[11px] text-gray-400 leading-relaxed">
                QRコードを枠内に収めると、自動的に内容を読み取ります。検出されるとここに表示されます。
              </div>
              {shareMessage && <div className="rounded-xl bg-white/10 text-xs px-3 py-2 text-gray-200">{shareMessage}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type QrSvgProps = {
  modules: boolean[][];
};

function QrSvg(props: QrSvgProps) {
  const moduleCount = props.modules.length;
  const size = moduleCount + QUIET_ZONE * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" className="w-full h-full">
      <rect width={size} height={size} fill="none" />
      {props.modules.map((row, rowIndex) =>
        row.map((cell, colIndex) =>
          cell ? <rect key={`${rowIndex}-${colIndex}`} x={colIndex + QUIET_ZONE} y={rowIndex + QUIET_ZONE} width="1" height="1" fill="currentColor" /> : null,
        ),
      )}
    </svg>
  );
}

type CopyStatus = "idle" | "copied" | "error";

type QrScannerSectionProps = {
  onDetected?: (value: string) => void;
};

function QrScannerSection(props: QrScannerSectionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectedValue, setDetectedValue] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [session, setSession] = useState(0);

  const barcodeDetectorAvailable = () =>
    typeof window !== "undefined" && Boolean((window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector);

  const detectedUrl = useMemo(() => {
    if (!detectedValue) return null;
    try {
      return new URL(detectedValue);
    } catch {
      if (typeof window !== "undefined") {
        try {
          return new URL(detectedValue, window.location.origin);
        } catch {
          return null;
        }
      }
      return null;
    }
  }, [detectedValue]);

  useEffect(() => {
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
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
      } catch (e) {
        console.warn("ストリームの停止中にエラーが発生しました", e);
      }
      try {
        activeStreamRef.current?.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = null;
      } catch (e) {
        console.warn("アクティブなストリームを停止できませんでした", e);
      }
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = null;
        } catch {
          /* noop */
        }
      }
    };

    const scanLoop = async () => {
      if (!detector || !videoRef.current || cancelled) return;
      try {
        const results = await detector.detect(videoRef.current);
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
      if (!videoRef.current) {
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
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("カメラ機能が利用できません。");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        activeStreamRef.current = stream;
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
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
  }, [props, session]);

  const restart = () => {
    setDetectedValue(null);
    setCopyStatus("idle");
    setSession((value) => value + 1);
  };

  const handleCopy = async () => {
    if (!detectedValue) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(detectedValue);
        setCopyStatus("copied");
        setTimeout(() => setCopyStatus("idle"), 2000);
        return;
      } catch (err) {
        console.warn("QRスキャン結果のコピーに失敗しました", err);
      }
    }
    setCopyStatus("error");
  };

  const copyLabel = copyStatus === "copied" ? "コピー済み" : "結果をコピー";
  const hasResult = Boolean(detectedValue);

  return (
    <div className="space-y-4">
      <div className="w-full max-w-[240px] aspect-square mx-auto relative rounded-2xl overflow-hidden border border-current/10 bg-white/95 dark:bg-black/95">
        <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-transparent text-sm text-current">
            カメラを準備中...
          </div>
        )}
      </div>
      {error && <div className="rounded-xl bg-red-500/20 text-red-200 text-sm px-3 py-2">{error}</div>}
      {hasResult && (
        <div className="space-y-3">
          <div className="rounded-xl bg-white text-black px-4 py-3">
            <div className="text-xs text-gray-500">検出した内容</div>
            <div className="mt-1 text-sm break-all leading-relaxed">{detectedValue}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {detectedUrl && (
              <a
                href={detectedUrl.toString()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-[140px] text-center px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
              >
                リンクを開く
              </a>
            )}
            <button
              type="button"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
              onClick={() => void handleCopy()}
            >
              {copyLabel}
            </button>
            <button
              type="button"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-full border border-white/20 hover:bg-white/10 transition-colors"
              onClick={restart}
            >
              もう一度スキャン
            </button>
          </div>
          {copyStatus === "error" && (
            <div className="text-xs text-red-200">クリップボードにコピーできませんでした。手動で選択してください。</div>
          )}
        </div>
      )}
    </div>
  );
}
