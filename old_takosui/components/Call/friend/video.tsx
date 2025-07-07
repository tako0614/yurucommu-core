import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { callState } from "../index";
import { TakosFetch } from "../../../utils/TakosFetch";
import { MediaSoupClient } from "../webrtc/mediasoup";

export default function VideoCallFriend() {
  const [call, setCall] = useAtom(callState);
  const [isMuted, setIsMuted] = createSignal(false); // 音声ミュート状態
  const [isVideoMuted, setIsVideoMuted] = createSignal(false); // ビデオミュート状態
  const [isFriendMuted, setIsFriendMuted] = createSignal(true); // 相手の音声ミュート状態
  const [isFriendVideoMuted, setIsFriendVideoMuted] = createSignal(true); // 相手のビデオミュート状態
  const [callDuration, setCallDuration] = createSignal(0); // 通話時間（秒）
  const [mediaClient, setMediaClient] = createSignal<MediaSoupClient | null>(null);
  const [localStream, setLocalStream] = createSignal<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = createSignal<MediaStream | null>(null);
  const [remoteVideoStream, setRemoteVideoStream] = createSignal<MediaStream | null>(null);
  const [audioProducerId, setAudioProducerId] = createSignal<string | null>(null);
  const [videoProducerId, setVideoProducerId] = createSignal<string | null>(null);
  const [hasMicrophone, setHasMicrophone] = createSignal(true); // マイクの有無
  const [hasCamera, setHasCamera] = createSignal(true); // カメラの有無
  const [isDebugMode, setIsDebugMode] = createSignal(false); // デバッグモード
  const [connectionStatus, setConnectionStatus] = createSignal<{
    localProducer: boolean;
    remoteConsumer: boolean;
    transportState: string;
  }>({
    localProducer: false,
    remoteConsumer: false,
    transportState: "disconnected",
  });
  const [serverDomain, setServerDomain] = createSignal<string | null>(null);
  const [audioOutput, setAudioOutput] = createSignal<"speaker" | "earpiece">("speaker");
  const [videoDevice, setVideoDevice] = createSignal<string>("user"); // フロントカメラがデフォルト
  const [audioDevices, setAudioDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = createSignal<string>('default');
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = createSignal<string>('');
  const [isAudioDeviceListOpen, setIsAudioDeviceListOpen] = createSignal(false);
  const [isVideoDeviceListOpen, setIsVideoDeviceListOpen] = createSignal(false);

  // ローカルビデオ参照用
  let localVideoRef: HTMLVideoElement | undefined;
  // リモートビデオ参照用
  let remoteVideoRef: HTMLVideoElement | undefined;

  // 時間のフォーマット (MM:SS)
  const formattedDuration = () => {
    const minutes = Math.floor(callDuration() / 60);
    const seconds = callDuration() % 60;
    return `${minutes.toString().padStart(2, "0")}:${
      seconds.toString().padStart(2, "0")
    }`;
  };

  // status に基づく状態確認用ヘルパー関数
  const isWaiting = () => call()?.status === "outgoing";
  const isIncoming = () => call()?.status === "incoming";
  const isConnected = () => call()?.status === "connected";

  // フレンドのドメイン情報を取得する関数
  const extractDomainFromFriendId = (friendId: string) => {
    if (!friendId) return null;
    
    // username@domain 形式からドメインを取得
    const parts = friendId.split('@');
    if (parts.length === 2) {
      return parts[1];
    }
    return null;
  };

  // カメラとマイクを取得
  const getMediaDevices = async () => {
    try {
      // ビデオとオーディオデバイスの一覧を取得
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // オーディオ入力デバイス
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      // オーディオ出力デバイス
      const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
      // ビデオ入力デバイス
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      
      console.log('利用可能なオーディオ入力デバイス:', audioInputs);
      console.log('利用可能なオーディオ出力デバイス:', audioOutputs);
      console.log('利用可能なビデオデバイス:', videoInputs);
      
      setAudioDevices(audioOutputs);
      setVideoDevices(videoInputs);
      
      // デフォルトデバイスがない場合は最初のデバイスを選択
      if (videoInputs.length > 0 && !selectedVideoDeviceId()) {
        setSelectedVideoDeviceId(videoInputs[0].deviceId);
      }
      
      if (audioOutputs.length > 0 && !selectedAudioDeviceId()) {
        setSelectedAudioDeviceId(audioOutputs[0].deviceId);
      }
    } catch (error) {
      console.error('デバイス取得エラー:', error);
    }
  };

  // カメラデバイスを切り替える
  const switchCamera = async () => {
    if (!hasCamera()) return;
    
    try {
      // 既存のビデオトラックを停止
      const stream = localStream();
      if (stream) {
        stream.getVideoTracks().forEach(track => {
          track.stop();
        });
      }
      
      // カメラを切り替え（フロント⇔バック）
      const newFacingMode = videoDevice() === 'user' ? 'environment' : 'user';
      setVideoDevice(newFacingMode);
      
      // 新しいカメラで再取得
      const constraints = {
        video: { 
          facingMode: newFacingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false
      };
      
      const newVideoStream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = newVideoStream.getVideoTracks()[0];
      
      // 既存のストリームに新しいビデオトラックを追加
      const currentLocalStream = localStream();
      if (currentLocalStream) {
        const audioTracks = currentLocalStream.getAudioTracks();
        const newStream = new MediaStream([...audioTracks, videoTrack]);
        setLocalStream(newStream);
        
        // ローカルビデオ表示を更新
        if (localVideoRef) {
          localVideoRef.srcObject = newStream;
        }
        
        // MediaSoupクライアントが接続済みの場合、新しいビデオトラックを発行
        const client = mediaClient();
        if (client && isConnected()) {
          // 既存のビデオプロデューサーがあれば閉じる
          const videoId = videoProducerId();
          if (videoId) {
            await client.closeProducer(videoId);
          }
          
          // 新しいビデオトラックを発行
          const newProducerId = await client.publish(videoTrack);
          setVideoProducerId(newProducerId);
          setIsVideoMuted(false);
          console.log(`新しいビデオトラック発行: ${newProducerId}`);
        }
      }
    } catch (error) {
      console.error('カメラ切り替えエラー:', error);
    }
  };

  // MediaSoupクライアント初期化
  const initializeMediaClient = async () => {
    const client = new MediaSoupClient();
    setMediaClient(client);

    // メディア初期化フラグ
    let mediaInitialized = false;

    // メディアクライアントイベントのセットアップ
    client.on("connected", async () => {
      console.log("MediaSoup接続成功");
      setConnectionStatus((prev) => ({ ...prev, transportState: "connected" }));

      if (mediaInitialized) return; // 2回目の呼び出しを防止
      mediaInitialized = true;

      // マイクとカメラを取得してサーバーに送信
      try {
        // トランスポート状態を更新
        const transport = (client as any).recvTransport;
        if (transport) {
          setConnectionStatus((prev) => ({
            ...prev,
            transportState: transport.connectionState || "unknown",
          }));

          transport.on("connectionstatechange", (state: string) => {
            console.log(`受信トランスポート状態変更: ${state}`);
            setConnectionStatus((prev) => ({ ...prev, transportState: state }));
          });
        }
        
        try {
          // オーディオとビデオを同時に取得
          const constraints = {
            audio: true,
            video: { 
              facingMode: videoDevice(),
              width: { ideal: 640 },
              height: { ideal: 480 },
            }
          };
          
          const stream = await navigator.mediaDevices.getUserMedia(constraints)
            .catch(async (err) => {
              console.error("メディア取得失敗:", err);
              
              // オーディオのみ取得を試みる
              try {
                console.log("オーディオのみで再試行");
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                setHasCamera(false);
                return audioStream;
              } catch (audioErr) {
                console.error("オーディオも取得失敗:", audioErr);
                setHasMicrophone(false);
                return null;
              }
            });

          if (!stream) {
            console.log("メディアが利用できません");
            setHasMicrophone(false);
            setHasCamera(false);
            setIsMuted(true);
            setIsVideoMuted(true);
            return;
          }

          setLocalStream(stream);

          // マイク状態を設定
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            setHasMicrophone(true);
            console.log("オーディオトラックを取得しました。発行を開始します");
            try {
              const producerId = await client.publish(audioTrack);
              setAudioProducerId(producerId);
              setIsMuted(false);
              console.log(`オーディオトラック発行成功: ${producerId}`);
            } catch (publishError) {
              console.error("オーディオトラック発行エラー:", publishError);
            }
          } else {
            console.warn("オーディオトラックが取得できませんでした");
            setHasMicrophone(false);
            setIsMuted(true);
          }

          // カメラ状態を設定
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            setHasCamera(true);
            console.log("ビデオトラックを取得しました。発行を開始します");
            
            // ローカルビデオに表示
            if (localVideoRef) {
              localVideoRef.srcObject = stream;
              localVideoRef.muted = true; // 自分の音声はミュート
            }
            
            try {
              const producerId = await client.publish(videoTrack);
              setVideoProducerId(producerId);
              setIsVideoMuted(false);
              setConnectionStatus((prev) => ({
                ...prev,
                localProducer: true,
              }));
              console.log(`ビデオトラック発行成功: ${producerId}`);
            } catch (publishError) {
              console.error("ビデオトラック発行エラー:", publishError);
            }
          } else {
            console.warn("ビデオトラックが取得できませんでした");
            setHasCamera(false);
            setIsVideoMuted(true);
          }
        } catch (error) {
          console.error("メディア取得エラー:", error);
          setHasMicrophone(false);
          setHasCamera(false);
          setIsMuted(true);
          setIsVideoMuted(true);
        }
      } catch (error) {
        console.error("トランスポート初期化エラー:", error);
      }
    });

    client.on("newPeer", (peerId: any) => {
      console.log(`新しいピアが参加: ${peerId}`);
    });

    client.on("disconnected", () => {
      console.log("MediaSoup切断");
      handleCallEnded();
    });

    // プロデューサー終了（相手がミュートした）イベントを処理
    client.on("peerMuted", (peerId: string, kind: string) => {
      console.log(`ピア ${peerId} の${kind}がミュートになりました`);
      if (kind === "audio") {
        console.log("相手のオーディオがミュートになりました");
        setIsFriendMuted(true);
      } else if (kind === "video") {
        console.log("相手のビデオがミュートになりました");
        setIsFriendVideoMuted(true);
        
        // リモートビデオ要素をクリーンアップ
        if (remoteVideoRef) {
          console.log("リモートビデオ要素を更新します");
          const audioOnlyStream = remoteStream();
          if (audioOnlyStream) {
            remoteVideoRef.srcObject = audioOnlyStream;
          } else {
            remoteVideoRef.srcObject = null;
          }
        }
      }
    });

    client.on(
      "newTrack",
      (consumerId: any, peerId: any, kind: string, track: MediaStreamTrack) => {
        console.log(
          `新しいトラック受信: ID=${consumerId}, ピア=${peerId}, 種類=${kind}, 状態=${track.readyState}`,
        );

        if (kind === "audio") {
          // 相手の音声トラックを受信
          console.log(`相手の音声トラックを受信: ${peerId}`);
          setConnectionStatus((prev) => ({ ...prev, remoteConsumer: true }));

          try {
            const stream = new MediaStream([track]);
            setRemoteStream(stream);
            setIsFriendMuted(false);

            // 音声要素の作成と再生
            const audioElement = document.createElement("audio");
            audioElement.srcObject = stream;
            audioElement.autoplay = true;
            audioElement.volume = 1.0;

            // 音声再生状態の確認
            audioElement.oncanplay = () => {
              console.log("音声再生可能状態");
              audioElement.play()
                .then(() => console.log("音声再生開始"))
                .catch((err) => console.error("音声再生エラー:", err));
            };

            audioElement.onerror = (e) => {
              console.error("音声要素エラー:", e);
            };

            document.body.appendChild(audioElement);
            setRemoteAudioElement(audioElement);
            
            // もし既存のビデオトラックがある場合は、オーディオと結合
            if (remoteVideoStream()) {
              const combinedStream = new MediaStream([
                ...remoteVideoStream()!.getVideoTracks(),
                track
              ]);
              if (remoteVideoRef) {
                remoteVideoRef.srcObject = combinedStream;
              }
            }
          } catch (error) {
            console.error("音声トラック処理エラー:", error);
          }
        } else if (kind === "video") {
          // 相手のビデオトラックを受信
          console.log(`相手のビデオトラックを受信: ${peerId}`);
          
          try {
            // ビデオストリームを作成
            const videoStream = new MediaStream([track]);
            setRemoteVideoStream(videoStream);
            setIsFriendVideoMuted(false);
            
            // 既存のオーディオトラックと結合
            const audioStream = remoteStream();
            if (audioStream && audioStream.getAudioTracks().length > 0) {
              const combinedStream = new MediaStream([
                ...audioStream.getAudioTracks(),
                track
              ]);
              if (remoteVideoRef) {
                remoteVideoRef.srcObject = combinedStream;
              }
            } else {
              // オーディオがなければビデオのみ
              if (remoteVideoRef) {
                remoteVideoRef.srcObject = videoStream;
              }
            }
          } catch (error) {
            console.error("ビデオトラック処理エラー:", error);
          }
        }
      },
    );

    client.on("trackEnded", (consumerId: any) => {
      // トラックが終了した場合の処理
      console.log(`トラックが終了: ${consumerId}`);
    });

    client.on("error", (error: any) => {
      console.error("MediaSoupエラー:", error);
    });

    // 通話トークンがある場合は接続開始
    const currentCall = call();
    if (currentCall && currentCall.token && currentCall.status === "connected") {
      try {
        if(currentCall.isCaller) {
          console.log("発信者として接続します");
          await client.connect(currentCall.token, window.serverEndpoint);
        } else {
          console.log("受信者として接続します");
          await client.connect(currentCall.token, extractDomainFromFriendId(currentCall.friendId!)!);
        }
      } catch (error) {
        console.error("MediaSoup接続エラー:", error);
      }
    }
  };

  // リモート音声要素の参照を保持
  let remoteAudioElement: HTMLAudioElement | null = null;
  const setRemoteAudioElement = (element: HTMLAudioElement | null) => {
    // 以前の要素があれば削除
    if (remoteAudioElement) {
      remoteAudioElement.remove();
    }
    remoteAudioElement = element;
  };

  // 通話応答処理
  const handleAnswer = async () => {
    const currentCall = call();
    if (!currentCall) return;

    try {
      // 着信音を停止
      if (currentCall._audioRef) {
        currentCall._audioRef.pause();
        currentCall._audioRef.currentTime = 0;
      }
      
      // 通話受け入れAPIを呼び出す
      const res = await TakosFetch("/api/v2/call/friend/video/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friendId: currentCall.friendId,
        }),
      });

      if (res.status !== 200) {
        throw new Error("通話応答エラー");
      }

      const { token } = await res.json();

      // フレンドIDからドメインを抽出して保存
      const domain = extractDomainFromFriendId(currentCall.friendId!);
      setServerDomain(domain);

      // 状態を通話中に更新
      setCall((prev) => prev ? { ...prev, status: "connected", token } : null);

      // MediaSoupクライアント初期化
      await initializeMediaClient();
    } catch (error) {
      console.error("通話応答エラー:", error);
    }
  };

  // 通話拒否処理
  const handleDecline = async () => {
    const currentCall = call();
    if (!currentCall) return;

    try {
      // 着信音を停止
      if (currentCall._audioRef) {
        currentCall._audioRef.pause();
        currentCall._audioRef.currentTime = 0;
      }

      // 拒否APIを呼び出す
      await TakosFetch("/api/v2/call/friend/video/reject", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friendId: currentCall.friendId,
        }),
      });

      // 通話状態をリセット
      setCall(null);
    } catch (error) {
      console.error("通話拒否エラー:", error);
    }
  };

  // 通話終了/キャンセル処理
  const handleHangup = async () => {
    const currentCall = call();
    if (!currentCall) return;

    try {
      const endpointPath = isWaiting()
        ? "/api/v2/call/friend/video/cancel"
        : "/api/v2/call/friend/video/end";

      await TakosFetch(endpointPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friendId: currentCall.friendId,
        }),
      });

      // MediaSoupの切断処理
      const client = mediaClient();
      if (client) {
        client.disconnect();
      }

      // 通話状態をリセット
      handleCallEnded();
    } catch (error) {
      console.error("通話終了エラー:", error);
    }
  };

  // 通話終了時の共通処理
  const handleCallEnded = () => {
    // ストリームのクリーンアップ
    const localMedia = localStream();
    if (localMedia) {
      localMedia.getTracks().forEach((track) => {
        track.stop();
        console.log("メディアトラックを停止しました", track.id);
      });
      setLocalStream(null);
    }

    // リモート音声要素の削除
    if (remoteAudioElement) {
      remoteAudioElement.remove();
      remoteAudioElement = null;
    }

    // 通話状態をリセット
    setCall(null);
    
    // ミュート状態もリセット
    setIsMuted(true);
    setIsVideoMuted(true);
    setAudioProducerId(null);
    setVideoProducerId(null);
  };

  // 音声ミュート状態を切り替え
  const toggleMute = async () => {
    const client = mediaClient();
    const audioId = audioProducerId();
    const stream = localStream();

    // マイクがない場合はミュート状態を変更不可
    if (!hasMicrophone()) {
      return;
    }

    if (client && stream) {
      const newMuteState = !isMuted();

      // ローカルのオーディオトラックをミュート/ミュート解除
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !newMuteState;
      });

      setIsMuted(newMuteState);

      // 完全にプロデューサーを停止する
      if (newMuteState && audioId) {
        client.closeProducer(audioId)
          .then(() => {
            console.log("オーディオプロデューサーを停止しました");
            setAudioProducerId(null);
          })
          .catch((err) => {
            console.error("オーディオプロデューサー停止エラー:", err);
          });
      }

      // ミュート解除時にプロデューサーを再作成
      if (!newMuteState) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true
          });
          const audioTrack = audioStream.getAudioTracks()[0];
          
          if (audioTrack) {
            // 既存のストリームにオーディオトラックを追加
            const videoTracks = stream.getVideoTracks();
            const newStream = new MediaStream([...videoTracks, audioTrack]);
            setLocalStream(newStream);
            
            // ローカルビデオを更新
            if (localVideoRef) {
              localVideoRef.srcObject = newStream;
            }
            
            // 新しいオーディオトラックを発行
            const producerId = await client.publish(audioTrack);
            setAudioProducerId(producerId);
            console.log("オーディオプロデューサーを再作成しました:", producerId);
          }
        } catch (err) {
          console.error("マイク再取得エラー:", err);
        }
      }
    }
  };

  // ビデオミュート状態を切り替え
  const toggleVideoMute = async () => {
    const client = mediaClient();
    const videoId = videoProducerId();
    const stream = localStream();

    // カメラがない場合はミュート状態を変更不可
    if (!hasCamera()) {
      return;
    }

    if (client && stream) {
      const newVideoMuteState = !isVideoMuted();

      // ローカルのビデオトラックをミュート/ミュート解除
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !newVideoMuteState;
      });

      setIsVideoMuted(newVideoMuteState);

      // 完全にプロデューサーを停止する
      if (newVideoMuteState && videoId) {
        client.closeProducer(videoId)
          .then(() => {
            console.log("ビデオプロデューサーを停止しました");
            setVideoProducerId(null);
          })
          .catch((err) => {
            console.error("ビデオプロデューサー停止エラー:", err);
          });
      }

      // ミュート解除時にプロデューサーを再作成
      if (!newVideoMuteState) {
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: { 
              facingMode: videoDevice(),
              width: { ideal: 640 },
              height: { ideal: 480 }
            }
          });
          const videoTrack = videoStream.getVideoTracks()[0];
          
          if (videoTrack) {
            // 既存のストリームにビデオトラックを追加
            const audioTracks = stream.getAudioTracks();
            const newStream = new MediaStream([...audioTracks, videoTrack]);
            setLocalStream(newStream);
            
            // ローカルビデオを更新
            if (localVideoRef) {
              localVideoRef.srcObject = newStream;
            }
            
            // 新しいビデオトラックを発行
            const producerId = await client.publish(videoTrack);
            setVideoProducerId(producerId);
            console.log("ビデオプロデューサーを再作成しました:", producerId);
          }
        } catch (err) {
          console.error("カメラ再取得エラー:", err);
        }
      }
    }
  };

  // コンポーネントがアンマウントされたときに着信音を停止
  onCleanup(() => {
    const currentCall = call();
    if (currentCall && currentCall._audioRef) {
      currentCall._audioRef.pause();
      currentCall._audioRef.currentTime = 0;
    }

    // MediaSoupクライアントを切断
    const client = mediaClient();
    if (client) {
      client.disconnect();
    }

    // ローカルストリームを停止
    const stream = localStream();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    // リモート音声要素の削除
    if (remoteAudioElement) {
      remoteAudioElement.remove();
    }
  });

  // 通話タイマーの設定とMediaSoup初期化
  onMount(() => {
    // タイマー初期化
    const timer = setInterval(() => {
      if (isConnected()) {
        setCallDuration((prev) => prev + 1);
      }
    }, 1000);

    onCleanup(() => clearInterval(timer));

    // デバイス一覧を取得
    getMediaDevices();
    
    // デバイス変更検知用のイベントリスナー
    navigator.mediaDevices.addEventListener('devicechange', getMediaDevices);
    
    // クリーンアップ
    onCleanup(() => {
      navigator.mediaDevices.removeEventListener('devicechange', getMediaDevices);
      
      // コンポーネントのクリーンアップ時にメディアを確実に停止
      const stream = localStream();
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
          console.log("コンポーネント解除時にメディアトラックを停止しました", track.id);
        });
      }
    });
  });

  // 通話状態の変化を監視して MediaSoup を初期化
  createEffect(() => {
    const currentCall = call();
    // 通話状態が connected で、トークンが存在する場合に初期化
    if (currentCall?.status === "connected" && currentCall.token) {
      console.log(
        "通話状態が connected に変更されました。MediaSoup を初期化します。",
      );
      initializeMediaClient();
    } else if (!currentCall) {
      // 通話がない場合は、メディアを確実にオフにする
      const stream = localStream();
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
          console.log("通話外でメディアトラックを停止しました", track.id);
        });
        setLocalStream(null);
      }
    }
  });

  return (
    <div class="fixed inset-0 flex flex-col w-screen h-screen bg-gray-900 text-white z-[19999]">
      {/* ヘッダー部分 */}
      <div class="w-full pt-6 pb-2 flex items-center justify-center bg-gray-800 border-b border-gray-700">
        <Show when={isConnected()}>
          <div class="text-center">
            <p class="text-xl font-medium">{formattedDuration()}</p>
          </div>
        </Show>
        <Show when={isWaiting() || isIncoming()}>
          <div class="text-center">
            <p class="text-xl font-light">
              {isWaiting() ? "発信中..." : "着信中..."}
            </p>
          </div>
        </Show>
      </div>

      {/* メインコンテンツ - ビデオ表示エリア */}
      <div class="flex-grow flex flex-col relative">
        {/* 相手のビデオ - 大画面表示 */}
        <div class="absolute inset-0 bg-black flex items-center justify-center">
          <video 
            ref={remoteVideoRef}
            autoplay 
            playsinline 
            class={`w-full h-full object-cover ${isFriendVideoMuted() ? 'hidden' : ''}`}
          />
          
          {/* 相手がビデオをオフにしている場合のプレースホルダー */}
          <Show when={isFriendVideoMuted() && isConnected()}>
            <div class="w-full h-full flex items-center justify-center bg-gray-800">
              <div class="flex flex-col items-center">
                <div class="w-32 h-32 rounded-full bg-gray-700 flex items-center justify-center mb-4">
                  <span class="text-5xl">👤</span>
                </div>
                <p class="text-xl">ビデオオフ</p>
              </div>
            </div>
          </Show>
          
          {/* 発信中または着信中の表示 */}
          <Show when={isWaiting() || isIncoming()}>
            <div class="w-full h-full flex flex-col items-center justify-center bg-gray-800">
              <div class="w-40 h-40 rounded-full bg-gray-700 flex items-center justify-center mb-6 shadow-lg border-2 border-gray-600 animate-pulse">
                <span class="text-7xl">👤</span>
              </div>
              
              <p class="text-center text-2xl font-semibold mb-3">友達の名前</p>
              <p class="text-lg text-gray-300 mb-6">ビデオ通話</p>
              
              <Show when={isWaiting()}>
                <div class="flex space-x-2 mt-4">
                  <span class="animate-ping inline-block h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                  <span class="animate-ping inline-block h-2 w-2 rounded-full bg-blue-400 opacity-75" style="animation-delay: 0.2s"></span>
                  <span class="animate-ping inline-block h-2 w-2 rounded-full bg-blue-400 opacity-75" style="animation-delay: 0.4s"></span>
                </div>
              </Show>
            </div>
          </Show>
        </div>
        
        {/* 自分のビデオ - 小窓表示 (ピクチャーインピクチャー) */}
        <div class="absolute bottom-4 right-4 w-1/4 max-w-[160px] aspect-video rounded-lg overflow-hidden shadow-lg border border-gray-600 z-10">
          <video 
            ref={localVideoRef}
            autoplay 
            playsinline 
            muted 
            class={`w-full h-full object-cover ${isVideoMuted() || !hasCamera() ? 'hidden' : ''}`}
          />
          
          {/* 自分がビデオをオフにしている場合 */}
          <Show when={isVideoMuted() || !hasCamera()}>
            <div class="w-full h-full bg-gray-700 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18" />
              </svg>
            </div>
          </Show>
        </div>
      </div>

      {/* 着信中のボタン */}
      <Show when={isIncoming()}>
        <div class="w-full px-4 py-8 bg-gray-800 border-t border-gray-700">
          <div class="flex justify-center space-x-10">
            {/* 拒否ボタン */}
            <button
              onClick={handleDecline}
              class="bg-red-500 hover:bg-red-600 w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* 応答ボタン */}
            <button
              onClick={handleAnswer}
              class="bg-green-500 hover:bg-green-600 w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>
          </div>
        </div>
      </Show>

      {/* 発信中のキャンセルボタン */}
      <Show when={isWaiting()}>
        <div class="w-full px-4 py-8 bg-gray-800 border-t border-gray-700 flex justify-center">
          <button
            onClick={handleHangup}
            class="bg-red-500 hover:bg-red-600 w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </Show>

      {/* 通話中のコントロールエリア */}
      <Show when={isConnected()}>
        <div class="w-full px-4 py-4 bg-gray-800 border-t border-gray-700">
          <div class="flex justify-center space-x-6 w-full max-w-md mx-auto">
            {/* マイクボタン */}
            <button
              class={`flex flex-col items-center justify-center ${
                hasMicrophone() ? "" : "opacity-50 cursor-not-allowed"
              }`}
              onClick={toggleMute}
              disabled={!hasMicrophone()}
            >
              <div class={`w-12 h-12 rounded-full flex items-center justify-center mb-1 ${
                isMuted() ? "bg-red-500" : "bg-gray-700"
              }`}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d={isMuted()
                      ? "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z M21 12H3"
                      : "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"}
                  />
                </svg>
              </div>
              <span class="text-xs">
                {!hasMicrophone()
                  ? "マイクなし"
                  : (isMuted() ? "ミュート中" : "ミュート")}
              </span>
            </button>
            
            {/* 通話終了ボタン */}
            <button
              onClick={handleHangup}
              class="flex flex-col items-center justify-center"
            >
              <div class="w-12 h-12 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center mb-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z"
                  />
                </svg>
              </div>
              <span class="text-xs">終了</span>
            </button>
            
            {/* ビデオ切替ボタン */}
            <button
              class={`flex flex-col items-center justify-center ${
                hasCamera() ? "" : "opacity-50 cursor-not-allowed"
              }`}
              onClick={toggleVideoMute}
              disabled={!hasCamera()}
            >
              <div class={`w-12 h-12 rounded-full flex items-center justify-center mb-1 ${
                isVideoMuted() ? "bg-red-500" : "bg-gray-700"
              }`}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d={isVideoMuted()
                      ? "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z M3 3l18 18"
                      : "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"}
                  />
                </svg>
              </div>
              <span class="text-xs">
                {!hasCamera()
                  ? "カメラなし"
                  : (isVideoMuted() ? "カメラOFF" : "カメラON")}
              </span>
            </button>
            
            {/* カメラ切替ボタン（フロント/バック） */}
            <button
              class={`flex flex-col items-center justify-center ${
                hasCamera() && !isVideoMuted() ? "" : "opacity-50 cursor-not-allowed"
              }`}
              onClick={switchCamera}
              disabled={!hasCamera() || isVideoMuted()}
            >
              <div class="w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center mb-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <span class="text-xs">カメラ切替</span>
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
