import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { Actor } from '../types';
import { fetchActor, follow, searchRemote } from '../lib/api';
import { UserAvatar } from './UserAvatar';

interface QRCodeModalProps {
  actor: Actor;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ShareIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
  </svg>
);

export function QRCodeModal({ actor, onClose }: QRCodeModalProps) {
  const [tab, setTab] = useState<'myqr' | 'scan'>('myqr');
  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [scanResult, setScanResult] = useState<Actor | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followSuccess, setFollowSuccess] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  // Generate QR URL - include username for ActivityPub lookup
  const currentDomain = window.location.host;
  const qrUrl = `${window.location.origin}/profile/${encodeURIComponent(actor.ap_id)}#${actor.preferred_username}`;

  // Stop scanner when component unmounts or tab changes
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  // Start/stop scanner when tab changes
  useEffect(() => {
    if (tab === 'scan' && !scanning && !scanResult) {
      startScanner();
    } else if (tab !== 'scan' && scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      setScanning(false);
    }
  }, [tab]);

  const startScanner = async () => {
    if (!scannerContainerRef.current) return;

    setScanError(null);
    setScanning(true);

    try {
      const html5QrCode = new Html5Qrcode('qr-scanner');
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
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
            const username = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;

            if (!pathMatch) {
              setScanError('Invalid QR code');
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
              } catch (localErr: any) {
                setScanError(`Local user fetch error: ${localErr.message || 'Unknown'}`);
              }
            } else if (username) {
              // Remote user - search via ActivityPub WebFinger
              const webfingerAddress = `@${username}@${scannedDomain}`;
              try {
                const results = await searchRemote(webfingerAddress);
                if (results.length > 0) {
                  setScanResult(results[0]);
                } else {
                  setScanError(`Remote user not found: ${webfingerAddress}`);
                }
              } catch (remoteErr: any) {
                setScanError(`Remote search error: ${remoteErr.message || 'Unknown'}`);
              }
            } else {
              setScanError(`Remote user info insufficient (hash=${url.hash})`);
            }
          } catch (err: any) {
            setScanError(`QR parse error: ${err.message || 'Unknown'}`);
          } finally {
            setLookingUp(false);
          }
        },
        () => {} // ignore errors during scanning
      );
    } catch (err) {
      console.error('Failed to start scanner:', err);
      setScanError('Failed to start camera. Please allow camera access.');
      setScanning(false);
    }
  };

  const handleFollow = async () => {
    if (!scanResult || following) return;

    setFollowing(true);
    try {
      await follow(scanResult.ap_id);
      setFollowSuccess(true);
    } catch (err) {
      console.error('Failed to follow:', err);
      setScanError('Failed to follow');
    } finally {
      setFollowing(false);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${actor.name || actor.preferred_username}'s profile`,
          url: qrUrl,
        });
      } catch {
        // User cancelled sharing
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(qrUrl);
      alert('URL copied to clipboard');
    }
  };

  const resetScan = () => {
    setScanResult(null);
    setScanError(null);
    setFollowSuccess(false);
    setLookingUp(false);
    if (tab === 'scan') {
      startScanner();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h2 className="text-lg font-bold text-white">QR Code</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-800 rounded-full transition-colors text-neutral-400 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-800">
          <button
            onClick={() => setTab('myqr')}
            className={`flex-1 py-3 text-center font-medium relative ${tab === 'myqr' ? 'text-white' : 'text-neutral-500'}`}
          >
            My QR
            {tab === 'myqr' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />}
          </button>
          <button
            onClick={() => setTab('scan')}
            className={`flex-1 py-3 text-center font-medium relative ${tab === 'scan' ? 'text-white' : 'text-neutral-500'}`}
          >
            Scan
            {tab === 'scan' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />}
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {tab === 'myqr' ? (
            /* My QR Code */
            <div className="flex flex-col items-center space-y-6">
              {/* User Info */}
              <div className="flex flex-col items-center gap-2">
                <UserAvatar
                  avatarUrl={actor.icon_url}
                  name={actor.name || actor.preferred_username}
                  size={64}
                />
                <div className="text-center">
                  <div className="font-bold text-white text-lg">
                    {actor.name || actor.preferred_username}
                  </div>
                  <div className="text-neutral-500">@{actor.username}</div>
                </div>
              </div>

              {/* QR Code */}
              <div className="bg-white p-4 rounded-2xl">
                <QRCodeSVG
                  value={qrUrl}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              </div>

              {/* Share Button */}
              <button
                onClick={handleShare}
                className="flex items-center gap-2 px-6 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white transition-colors"
              >
                <ShareIcon />
                Share
              </button>
            </div>
          ) : (
            /* Scanner */
            <div className="flex flex-col items-center space-y-4">
              {lookingUp ? (
                /* Loading State */
                <div className="flex flex-col items-center space-y-4 py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                  <div className="text-neutral-400">Looking up user...</div>
                </div>
              ) : scanResult ? (
                /* Scan Result */
                <div className="flex flex-col items-center space-y-4 w-full">
                  <UserAvatar
                    avatarUrl={scanResult.icon_url}
                    name={scanResult.name || scanResult.preferred_username}
                    size={80}
                  />
                  <div className="text-center">
                    <div className="font-bold text-white text-xl">
                      {scanResult.name || scanResult.preferred_username}
                    </div>
                    <div className="text-neutral-500">@{scanResult.username}</div>
                    {scanResult.summary && (
                      <div className="text-neutral-400 text-sm mt-2 max-w-xs">
                        {scanResult.summary}
                      </div>
                    )}
                  </div>

                  {followSuccess ? (
                    <div className="px-6 py-2 bg-green-600 text-white rounded-full font-medium">
                      Followed!
                    </div>
                  ) : scanResult.ap_id === actor.ap_id ? (
                    <div className="text-neutral-500">This is you</div>
                  ) : (
                    <button
                      onClick={handleFollow}
                      disabled={following}
                      className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 text-white rounded-full font-medium transition-colors"
                    >
                      {following ? 'Following...' : 'Follow'}
                    </button>
                  )}

                  <button
                    onClick={resetScan}
                    className="text-neutral-400 hover:text-white text-sm"
                  >
                    Scan again
                  </button>
                </div>
              ) : scanError ? (
                /* Error State */
                <div className="flex flex-col items-center space-y-4">
                  <div className="text-red-400 text-center">{scanError}</div>
                  <button
                    onClick={resetScan}
                    className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-full transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                /* Scanner View */
                <>
                  <div
                    id="qr-scanner"
                    ref={scannerContainerRef}
                    className="w-full aspect-square max-w-[300px] rounded-lg overflow-hidden bg-neutral-800"
                  />
                  {scanning && (
                    <div className="text-neutral-400 text-sm">
                      Point camera at QR code
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
