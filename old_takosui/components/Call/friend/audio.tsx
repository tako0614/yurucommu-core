import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { callState } from "../index";
import { TakosFetch } from "../../../utils/TakosFetch";
import { MediaSoupClient } from "../webrtc/mediasoup";

export default function AudiCallFriend() {
  const [call, setCall] = useAtom(callState);
  const [isMuted, setIsMuted] = createSignal(false); // 自分のミュート状態
  const [isFriendMuted, setIsFriendMuted] = createSignal(true); // 相手のミュート状態（デフォルトでミュート状態とする）
  const [callDuration, setCallDuration] = createSignal(0); // 通話時間（秒）
  const [mediaClient, setMediaClient] = createSignal<MediaSoupClient | null>(
    null,
  );
  const [localStream, setLocalStream] = createSignal<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = createSignal<MediaStream | null>(
    null,
  );
  const [audioProducerId, setAudioProducerId] = createSignal<string | null>(
    null,
  );
  const [hasMicrophone, setHasMicrophone] = createSignal(true); // マイクの有無
  const [isDebugMode, setIsDebugMode] = createSignal(false); // デバッグモード追加
  const [connectionStatus, setConnectionStatus] = createSignal<{
    localProducer: boolean;
    remoteConsumer: boolean;
    transportState: string;
  }>({
    localProducer: false,
    remoteConsumer: false,
    transportState: "disconnected",
  });
  const [serverDomain, setServerDomain] = createSignal<string | null>(null); // サーバードメインを保持するための状態
  const [audioOutput, setAudioOutput] = createSignal<"speaker" | "earpiece">("speaker");

  // 追加する状態変数
  const [audioDevices, setAudioDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string>('default');
  const [isDeviceListOpen, setIsDeviceListOpen] = createSignal(false);

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

  // MediaSoupクライアント初期化
  const initializeMediaClient = async () => {
    const client = new MediaSoupClient();
    setMediaClient(client);

    // マイク取得を開始するフラグ
    let micInitialized = false;

    // Androidの場合、電話モードに設定

    // メディアクライアントイベントのセットアップ
    client.on("connected", async () => {
      console.log("MediaSoup接続成功");
      setConnectionStatus((prev) => ({ ...prev, transportState: "connected" }));

      if (micInitialized) return; // 2回目の呼び出しを防止
      micInitialized = true;

      // マイクを取得してサーバーに送信
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
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          })
            .catch((err) => {
              console.error("マイク取得失敗:", err);
              return null;
            });

          if (!stream) {
            console.log("マイクが利用できません");
            setHasMicrophone(false);
            setIsMuted(true);
            return;
          }

          setLocalStream(stream);
          setHasMicrophone(true);

          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            console.log("オーディオトラックを取得しました。発行を開始します");
            try {
              const producerId = await client.publish(audioTrack);
              setAudioProducerId(producerId);
              setIsMuted(false);
              setConnectionStatus((prev) => ({
                ...prev,
                localProducer: true,
              }));
              console.log(`オーディオトラック発行成功: ${producerId}`);
            } catch (publishError) {
              console.error("オーディオトラック発行エラー:", publishError);
            }
          } else {
            console.warn("オーディオトラックが取得できませんでした");
            setHasMicrophone(false);
            setIsMuted(true);
          }
        } catch (error) {
          console.error("マイク取得エラー:", error);
          setHasMicrophone(false);
          setIsMuted(true);
        }
      } catch (error) {
        console.error("トランスポート初期化エラー:", error);
      }
    });

    client.on("newPeer", (peerId: any) => {
      console.log(`新しいピアが参加: ${peerId}`);
      // ここでは相手はまだプロデューサーを作成していないのでミュート状態のまま
    });

    client.on("disconnected", () => {
      console.log("MediaSoup切断");
      handleCallEnded();
    });

    // プロデューサー終了（相手がミュートした）イベントを処理
    client.on("peerMuted", (peerId: string, kind: string) => {
      console.log(`ピア ${peerId} の${kind}がミュートになりました`);
      if (kind === "audio") {
        console.log("相手のオーディオがミュートになりました - UI更新");
        setIsFriendMuted(true);
        
        // リモート音声要素をクリーンアップ
        if (remoteAudioElement) {
          console.log("リモートオーディオ要素をクリーンアップします");
          remoteAudioElement.pause();
          remoteAudioElement.remove();
          setRemoteAudioElement(null);
        }
        
        // リモートストリームもクリア
        setRemoteStream(null);
        
        // 接続状態の更新
        setConnectionStatus((prev) => ({ ...prev, remoteConsumer: false }));
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
          console.log(
            `相手の音声トラックを受信: ${peerId}, ID: ${consumerId}, 有効=${track.enabled}`,
          );
          setConnectionStatus((prev) => ({ ...prev, remoteConsumer: true }));

          try {
            const stream = new MediaStream([track]);
            setRemoteStream(stream);
            setIsFriendMuted(false); // 相手がオーディオを送信しているのでミュート解除

            // 音声出力を設定
            const audioElement = document.createElement("audio");
            audioElement.srcObject = stream;
            audioElement.autoplay = true;
            audioElement.volume = 1.0; // 音量を最大に

            // デバッグ用に音声プロパティをログ出力
            console.log(
              `音声要素作成: autoplay=${audioElement.autoplay}, muted=${audioElement.muted}`,
            );

            // 実際に再生開始されるかを確認
            audioElement.oncanplay = () => {
              console.log("音声再生可能状態");
              audioElement.play()
                .then(() => console.log("音声再生開始"))
                .catch((err) => {
                  console.error("音声再生エラー:", err);
                  // 自動再生失敗時の処理を追加（例：ユーザー操作後に再試行）
                });
            };

            audioElement.onerror = (e) => {
              console.error("音声要素エラー:", e);
            };

            document.body.appendChild(audioElement);

            // クリーンアップ用に要素を保存
            setRemoteAudioElement(audioElement);
          } catch (error) {
            console.error("音声トラック処理エラー:", error);
          }
        }
      },
    );

    client.on("trackEnded", (consumerId: any) => {
      // トラックが終了した場合の処理
      console.log(`トラックが終了: ${consumerId}`);
      setIsFriendMuted(true);
      
      // 接続状態の更新
      setConnectionStatus((prev) => ({ ...prev, remoteConsumer: false }));

      // リモート音声要素をクリーンアップ
      if (remoteAudioElement) {
        console.log("トラック終了によりリモートオーディオ要素をクリーンアップします");
        remoteAudioElement.pause();
        remoteAudioElement.remove();
        setRemoteAudioElement(null);
      }
      
      // リモートストリームもクリア
      setRemoteStream(null);
    });

    client.on("error", (error: any) => {
      console.error("MediaSoupエラー:", error);
      // 重大なエラーの場合、ユーザーに通知することも検討
    });

    // 通話トークンがある場合は接続開始
    const currentCall = call();
    if (
      currentCall && currentCall.token && currentCall.status === "connected"
    ) {
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
      const res = await TakosFetch("/api/v2/call/friend/audio/accept", {
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
      // エラー処理
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
      await TakosFetch("/api/v2/call/friend/audio/reject", {
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
        ? "/api/v2/call/friend/audio/cancel"
        : "/api/v2/call/friend/audio/end";

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
    const localAudio = localStream();
    if (localAudio) {
      localAudio.getTracks().forEach((track) => {
        track.stop(); // 全てのトラックを確実に停止
        console.log("オーディオトラックを停止しました", track.id);
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
    setAudioProducerId(null);
  };

  // ミュート状態を切り替え
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
            console.log("プロデューサーを停止しました");
            setAudioProducerId(null);
            setConnectionStatus((prev) => ({ ...prev, localProducer: false }));
          })
          .catch((err) => {
            console.error("プロデューサー停止エラー:", err);
          });
      }

      // ミュート解除時にプロデューサーを再作成
      if (!newMuteState) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
          .catch((err) => {
            console.error("マイク取得失敗:", err);
            return null;
          });
        if (!stream) {
          console.log("マイクが利用できません");
          setHasMicrophone(false);
          setIsMuted(true);
          return;
        }
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          client.publish(audioTrack)
            .then((producerId) => {
              console.log("プロデューサーを再作成しました:", producerId);
              setAudioProducerId(producerId);
              setConnectionStatus((prev) => ({
                ...prev,
                localProducer: true,
              }));
            })
            .catch((err) => {
              console.error("プロデューサー再作成エラー:", err);
            });
        }
      }
    }
  };

  // オーディオデバイス一覧を取得する関数
  const getAudioDevices = async () => {
    try {
      // マイクへのアクセスを要求せずにデバイス一覧を取得
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // オーディオ出力デバイスのみをフィルタリング
      const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
      
      console.log('利用可能なオーディオ出力デバイス:', audioOutputs);
      setAudioDevices(audioOutputs);
      
      // デフォルトデバイスがない場合は最初のデバイスを選択
      if (audioOutputs.length > 0 && !selectedDeviceId()) {
        setSelectedDeviceId(audioOutputs[0].deviceId);
      }
    } catch (error) {
      console.error('オーディオデバイス取得エラー:', error);
    }
  };

  // 選択したデバイスに音声出力を切り替える
  const changeAudioOutput = async (deviceId: string) => {
    if (!remoteAudioElement) {
      console.warn('音声要素がありません');
      return;
    }
    
    try {
      // setSinkId はブラウザによってはサポートされていない場合がある
      if ('setSinkId' in remoteAudioElement) {
        // @ts-ignore: setSinkId が TypeScript の型定義に含まれていない場合がある
        await remoteAudioElement.setSinkId(deviceId);
        setSelectedDeviceId(deviceId);
        console.log(`オーディオ出力を変更: ${deviceId}`);
        
        // デバイスリストを閉じる
        setIsDeviceListOpen(false);
      } else {
        console.warn('このブラウザはオーディオ出力デバイスの切り替えをサポートしていません');
      }
    } catch (error) {
      console.error('オーディオ出力切り替えエラー:', error);
    }
  };

  // スピーカーの名前を取得する関数
  const getDeviceName = (deviceId: string) => {
    const device = audioDevices().find(d => d.deviceId === deviceId);
    if (!device) return 'デフォルト';
    
    // デバイス名をシンプルにする
    let name = device.label || `デバイス ${deviceId.substring(0, 4)}...`;
    // 必要に応じて名前を短くする
    if (name.length > 20) {
      name = name.substring(0, 17) + '...';
    }
    return name;
  };

  // コンポーネントがアンマウントされたときに着信音を停止
  onCleanup(() => {
    const currentCall = call();
    if (currentCall && currentCall._audioRef) {
      currentCall._audioRef.pause();
      currentCall._audioRef.currentTime = 0;
    }

    // オーディオモードを通常に戻す

    // MediaSoupクライアントを切断
    const client = mediaClient();
    if (client) {
      client.disconnect();
    }

    // ローカルストリームを停止
    const stream = localStream();
    if (stream) {
      stream.getTracks().forEach((track) => stop());
    }

    // リモート音声要素の削除
    if (remoteAudioElement) {
      remoteAudioElement.remove();
    }
  });

  // 通話タイマーの設定とMediaSoup初期化
  onMount(() => {
    // タイマー初期化のみをここで行う
    const timer = setInterval(() => {
      if (isConnected()) {
        setCallDuration((prev) => prev + 1);
      }
    }, 1000);

    onCleanup(() => clearInterval(timer));

    // マイクアクセスなしでデバイス一覧を取得
    getAudioDevices();
    
    // デバイス変更検知用のイベントリスナーを追加
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    
    // クリーンアップ
    onCleanup(() => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
      
      // コンポーネントのクリーンアップ時にマイクを確実に停止
      const stream = localStream();
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
          console.log("コンポーネント解除時にオーディオトラックを停止しました", track.id);
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
      // 通話がない場合は、マイクを確実にオフにする
      const stream = localStream();
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
          console.log("通話外でオーディオトラックを停止しました", track.id);
        });
        setLocalStream(null);
      }
    }
  });

  // デバッグモード切替
  const toggleDebugMode = () => {
    setIsDebugMode(!isDebugMode());
  };

  // デバイスリストの表示切替 - マイクアクセスを必要としないように修正
  const toggleAudioDeviceList = () => {
    // マイクアクセスなしでデバイスのリストを更新してから表示
    getAudioDevices().then(() => {
      setIsDeviceListOpen(!isDeviceListOpen());
    });
  };

  return (
    <div class="fixed inset-0 flex flex-col w-screen h-screen bg-gray-900 text-white z-[19999]">
      {/* ヘッダー部分 - よりシンプルに */}
      <div class="w-full pt-6 pb-2 flex items-center justify-center">
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

      {/* メインコンテンツ - シンプルなプロフィール表示 */}
      <div class="flex-grow flex flex-col items-center justify-center px-4">
        <Show
          when={isIncoming()}
          fallback={
            <div class="flex flex-col items-center justify-center text-center">
              {/* プロフィール画像 - シンプルな配色 */}
              <div class={`w-40 h-40 sm:w-48 sm:h-48 rounded-full bg-gray-700 flex items-center justify-center mb-6 shadow-lg border-2 border-gray-600 
                ${isWaiting() ? "animate-pulse" : ""}`}>
                <span class="text-7xl">👤</span>
              </div>
              
              <p class="text-center text-2xl font-semibold mb-2">友達の名前</p>
              
              <Show when={isConnected()}>
                <div class="flex items-center mt-2 mb-5">
                  <span class={`inline-block w-2 h-2 rounded-full mr-2 ${isFriendMuted() ? "bg-red-500" : "bg-green-400"}`}></span>
                  <p class="text-sm text-white text-opacity-90">
                    {isFriendMuted() ? "マイクOFF" : "通話中"}
                  </p>
                </div>
              </Show>
              
              <Show when={isWaiting()}>
                <div class="flex space-x-2 mt-4 mb-6">
                  <span class="animate-ping inline-block h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                  <span class="animate-ping inline-block h-2 w-2 rounded-full bg-blue-400 opacity-75" style="animation-delay: 0.2s"></span>
                  <span class="animate-ping inline-block h-2 w-2 rounded-full bg-blue-400 opacity-75" style="animation-delay: 0.4s"></span>
                </div>
              </Show>
            </div>
          }
        >
          {/* 着信中の画面 - シンプル */}
          <div class="flex flex-col items-center justify-center">
            <div class="w-40 h-40 sm:w-48 sm:h-48 rounded-full bg-gray-700 flex items-center justify-center mb-6 shadow-lg border-2 border-gray-600 animate-pulse">
              <span class="text-7xl">👤</span>
            </div>
            
            <p class="text-center text-2xl font-semibold mb-3">友達の名前</p>
            <p class="text-lg text-gray-300 mb-8">音声通話</p>

            {/* 応答・拒否ボタン - シンプルな配色 */}
            <div class="flex space-x-10 mt-6">
              {/* 拒否ボタン */}
              <button
                onClick={handleDecline}
                class="bg-gray-700 hover:bg-gray-600 w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-8 w-8 text-red-500"
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
                class="bg-gray-700 hover:bg-gray-600 w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-8 w-8 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* 通話中のみ表示するコントロールエリア - シンプル */}
      <Show when={isConnected()}>
        <div class="w-full px-4 mb-10">
          <div class="flex justify-center space-x-8 w-full max-w-md mx-auto">
            {/* マイクボタン */}
            <button
              class={`flex flex-col items-center justify-center ${
                hasMicrophone() ? "" : "opacity-50 cursor-not-allowed"
              }`}
              onClick={toggleMute}
              disabled={!hasMicrophone()}
            >
              <div class={`w-14 h-14 rounded-full flex items-center justify-center mb-1 ${
                isMuted() ? "bg-red-500" : "bg-gray-700"
              }`}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-7 w-7"
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
              <div class="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center mb-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-7 w-7"
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
            
            {/* スピーカー切替ボタン (デバイス選択用に修正) */}
            <div class="relative flex flex-col items-center justify-center">
              <button
                onClick={toggleAudioDeviceList}
                class="flex flex-col items-center justify-center"
              >
                <div class="w-14 h-14 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center mb-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-7 w-7"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                  </svg>
                </div>
                <span class="text-xs max-w-[80px] truncate text-center">
                  {getDeviceName(selectedDeviceId())}
                </span>
              </button>
              
              {/* スピーカーデバイス選択モーダル */}
              <Show when={isDeviceListOpen()}>
                <div class="absolute bottom-full mb-2 w-56 bg-gray-800 rounded-lg shadow-lg z-10 overflow-hidden">
                  <div class="p-2 border-b border-gray-700 flex justify-between items-center">
                    <span class="text-sm font-medium">スピーカー選択</span>
                    <div class="flex items-center">
                      {/* 更新ボタンを追加 */}
                      <button 
                        onClick={() => getAudioDevices()}
                        class="text-gray-400 hover:text-white mr-2"
                        title="デバイスリストを更新"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                      <button 
                        onClick={() => setIsDeviceListOpen(false)}
                        class="text-gray-400 hover:text-white"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="max-h-60 overflow-y-auto p-1">
                    {audioDevices().length === 0 ? (
                      <div class="p-3 text-center text-sm text-gray-400">
                        利用可能なデバイスがありません
                      </div>
                    ) : (
                      <div class="space-y-1">
                        {audioDevices().map(device => (
                          <button
                            class={`w-full text-left px-3 py-2 rounded text-sm ${
                              selectedDeviceId() === device.deviceId 
                                ? 'bg-blue-600 text-white' 
                                : 'hover:bg-gray-700'
                            }`}
                            onClick={() => changeAudioOutput(device.deviceId)}
                          >
                            <div class="flex items-center">
                              <div class="mr-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                  {selectedDeviceId() === device.deviceId && (
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                      d="M15.536 8.464a5 5 0 010 7.072" />
                                  )}
                                </svg>
                              </div>
                              <div class="truncate">{device.label || `デバイス ${device.deviceId.substring(0, 8)}...`}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* 発信中の場合のキャンセルボタン - シンプル */}
      <Show when={isWaiting()}>
        <div class="w-full px-4 mb-10 flex justify-center">
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

      {/* デバッグモードの場合のみ表示 - 隠しデバッグ機能として残す */}
      <Show when={isDebugMode()}>
        <div class="absolute bottom-24 left-4 bg-black bg-opacity-70 p-2 rounded text-xs">
          <p>接続状態: {connectionStatus().transportState}</p>
          <p>送信: {connectionStatus().localProducer ? "✓" : "✗"}</p>
          <p>受信: {connectionStatus().remoteConsumer ? "✓" : "✗"}</p>
          <p>サーバー: {serverDomain() || "デフォルト"}</p>
          <p>音声モード: {audioOutput()}</p>
        </div>
      </Show>
    </div>
  );
}
