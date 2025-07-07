import { Device } from "mediasoup-client";
import {
  Consumer,
  DtlsParameters,
  Producer,
  RtpCapabilities,
  Transport,
  TransportOptions,
  //@ts-expect-error
} from "mediasoup-client/lib/types";

// ブラウザ互換のカスタムイベントエミッター
class EventEmitter {
  private events: Map<string, Function[]> = new Map();

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)?.push(listener);
  }

  off(event: string, listener: Function): void {
    if (!this.events.has(event)) return;

    const listeners = this.events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    if (!this.events.has(event)) return;

    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}

export interface MediaClientEvents {
  connected: () => void;
  disconnected: () => void;
  newPeer: (peerId: string) => void;
  peerLeft: (peerId: string) => void;
  newTrack: (
    consumerId: string,
    peerId: string,
    kind: "audio" | "video",
    track: MediaStreamTrack,
  ) => void;
  trackEnded: (consumerId: string) => void;
  peerMuted: (peerId: string, kind: "audio" | "video") => void;
  error: (error: Error) => void;
}

interface TransportInfo {
  id: string;
  iceParameters: any;
  iceCandidates: any;
  dtlsParameters: any;
  sctpParameters?: any;
}

// トランスポートイベントハンドラの型定義
interface TransportConnectEvent {
  dtlsParameters: DtlsParameters;
}

interface TransportProduceEvent {
  kind: string;
  rtpParameters: any;
  appData?: any;
}

// コールバック型の定義
type ConnectCallback = () => void;
type ProduceCallback = ({ id }: { id: string }) => void;
type ErrorCallback = (error: Error) => void;

// SFU サーバーへの接続とメディア管理を担当するクラス
export class MediaSoupClient extends EventEmitter {
  private device: Device | null = null;
  private socket: WebSocket | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers: Map<string, Producer> = new Map();
  private consumers: Map<string, Consumer> = new Map();
  private roomId: string | null = null;
  private connected = false;
  private myPeerId: string = ""; // 自分のピアIDを保持する
  private serverDomain: string = ""; // サーバードメインを保持する

  constructor(private serverEndpoint: string = window.serverEndpoint || "") {
    super();
  }

  // トークンを使用してSFUサーバーに接続
  async connect(token: string, serverDomain?: string): Promise<void> {
    try {
      // サーバードメインが指定されていれば使用、なければデフォルトを使用
      const targetServer = serverDomain || this.serverDomain || this.serverEndpoint;
      
      // WebSocket接続の確立
      this.socket = new WebSocket(
        `wss://${targetServer}/_takos/v2/call?token=${token}`,
      );

      console.log(`接続先サーバー: ${targetServer}`);
      this.serverDomain = targetServer;

      this.socket.onmessage = (event) => this.handleSocketMessage(event);
      this.socket.onclose = () => this.handleSocketClose();
      this.socket.onerror = (error) => this.handleSocketError(error);

      // 接続完了を待つ Promise
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("接続タイムアウト"));
        }, 10000);

        this.socket!.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
      });

      console.log("SFUサーバーに接続しました");
      // WebRTC初期化は、initメッセージの受信後に行われる
    } catch (error) {
      console.error("SFU接続エラー:", error);
      throw error;
    }
  }

  // サーバードメインを設定するメソッド
  setServerDomain(domain: string): void {
    this.serverDomain = domain;
    console.log(`サーバードメインを設定しました: ${domain}`);
  }

  // メディアトラックをサーバーに送信
  async publish(track: MediaStreamTrack): Promise<string> {
    if (!this.connected || !this.sendTransport || !this.device) {
      throw new Error("先に接続を確立してください");
    }

    try {
      const producer = await this.sendTransport.produce({ track });

      this.producers.set(producer.id, producer);

      producer.on("trackended", () => {
        console.log(`トラック終了イベント (ローカル): ${producer.id}`);
        this.closeProducer(producer.id);
      });

      return producer.id;
    } catch (error) {
      console.error("メディア送信エラー:", error);
      throw error;
    }
  }

  // プロデューサーを閉じる
  async closeProducer(producerId: string): Promise<void> {
    const producer = this.producers.get(producerId);
    if (!producer) return;
    
    try {
      // サーバーにプロデューサー終了を通知
      this.socket?.send(JSON.stringify({
        type: "closeProducer",
        producerId
      }));
      
      // ローカルでのクリーンアップ
      producer.close();
      this.producers.delete(producerId);
      console.log(`プロデューサー ${producerId} を閉じました`);
    } catch (error) {
      console.error("プロデューサー終了エラー:", error);
    }
  }

  // コンシューマーを閉じる
  async closeConsumer(consumerId: string): Promise<void> {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) return;

    try {
      consumer.close();
      this.consumers.delete(consumerId);
    } catch (error) {
      console.error("コンシューマー終了エラー:", error);
    }
  }

  // WebSocketメッセージのハンドリング
  private async handleSocketMessage(event: MessageEvent): Promise<void> {
    try {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case "init":
          await this.handleInit(message.data);
          break;
        case "join":
          this.handlePeerJoin(message);
          break;
        case "leave":
          this.handlePeerLeave(message);
          break;
        case "produce":
          await this.handleNewProducer(message);
          break;
        case "consumed":
          await this.handleConsumed(message);
          break;
        case "connected":
          console.log(`${message.transportType} トランスポート接続完了`);
          break;
        case "producerClosed":
          this.handleProducerClosed(message);
          break;
        case "error":
          console.error("SFUエラー:", message.message);
          this.emit("error", new Error(message.message));
          break;
      }
    } catch (error) {
      console.error("メッセージ処理エラー:", error);
    }
  }

  // 初期化メッセージの処理
  private async handleInit(data: any): Promise<void> {
    this.roomId = data.roomId;
    // 自分のピアIDを記録（サーバーから送られるはず）
    if (data.myPeerId) {
      this.myPeerId = data.myPeerId;
      console.log(`自分のピアID: ${this.myPeerId}`);
    } else {
      // ピアIDがない場合は@以前の部分をユーザーIDとして扱う
      if (data.roomId && data.roomId.includes("@")) {
        const possiblePeerIds = data.roomId.split("-");
        for (const id of possiblePeerIds) {
          if (id.includes("@")) {
            this.myPeerId = id.split("@")[0];
            console.log(`roomIdから推測した自分のピアID: ${this.myPeerId}`);
            break;
          }
        }
      }
    }
    // テキスト通話の場合はWebRTCの初期化をスキップ

    try {
      // Device初期化
      this.device = new Device();

      console.log("MediaSoupデバイスを初期化中...");
      try {
        await this.device.load({
          routerRtpCapabilities: data.routerRtpCapabilities,
        });
        // バージョン互換性チェック
        console.log("MediaSoupデバイス機能確認:");
        console.log("- rtpCapabilities:", !!this.device.rtpCapabilities);
        console.log(
          "- canProduce(audio):",
          typeof this.device.canProduce === "function"
            ? this.device.canProduce("audio")
            : "メソッドなし",
        );
      } catch (loadError) {
        console.error("デバイスロードエラー:", loadError);
        throw loadError;
      }

      console.log("MediaSoupデバイス初期化完了");

      // 送信用トランスポートの作成と接続
      this.sendTransport = this.device.createSendTransport(
        data.transport.send as TransportOptions,
      );

      this.sendTransport.on(
        "connect",
        async (
          { dtlsParameters }: TransportConnectEvent,
          callback: ConnectCallback,
          errback: ErrorCallback,
        ) => {
          try {
            this.socket?.send(JSON.stringify({
              type: "connect",
              transportType: "send", // 明示的にトランスポートタイプを追加
              dtlsParameters,
            }));

            // 接続応答を待つ
            const onConnected = (event: MessageEvent) => {
              const message = JSON.parse(event.data);
              if (
                message.type === "connected" && message.transportType === "send"
              ) {
                this.socket?.removeEventListener("message", onConnected);
                callback();
              } else if (
                message.type === "error" && message.transportType === "send"
              ) {
                this.socket?.removeEventListener("message", onConnected);
                errback(
                  new Error(
                    message.message || "Failed to connect send transport",
                  ),
                );
              }
            };

            this.socket?.addEventListener("message", onConnected);

            // タイムアウト設定
            setTimeout(() => {
              this.socket?.removeEventListener("message", onConnected);
              errback(new Error("Connection timeout for send transport"));
            }, 10000);
          } catch (error) {
            console.error("送信トランスポート接続エラー:", error);
            errback(error as Error);
          }
        },
      );

      this.sendTransport.on(
        "produce",
        async (
          { kind, rtpParameters }: TransportProduceEvent,
          callback: ProduceCallback,
          errback: ErrorCallback,
        ) => {
          try {
            this.socket?.send(JSON.stringify({
              type: "produce",
              kind,
              rtpParameters,
            }));

            // produceリクエストの応答を待つ
            const onProduced = (event: MessageEvent) => {
              const message = JSON.parse(event.data);
              if (message.type === "produced") {
                this.socket?.removeEventListener("message", onProduced);
                callback({ id: message.producerId });
              } else if (
                message.type === "error" && message.context === "produce"
              ) {
                this.socket?.removeEventListener("message", onProduced);
                console.error("プロデューサー作成エラー:", message.message);
                errback(new Error(message.message || "Failed to produce"));
              }
            };

            this.socket?.addEventListener("message", onProduced);
          } catch (error) {
            console.error("プロデューサー作成エラー:", error);
            errback(error as Error);
          }
        },
      );

      // 受信用トランスポートの作成と接続
      try {
        this.recvTransport = this.device.createRecvTransport(
          data.transport.recv as TransportOptions,
        );
        console.log("受信トランスポート作成:", this.recvTransport.id);
      } catch (transportError) {
        console.error("受信トランスポート作成エラー:", transportError);
        throw transportError;
      }

      this.recvTransport.on(
        "connect",
        async (
          { dtlsParameters }: TransportConnectEvent,
          callback: ConnectCallback,
          errback: ErrorCallback,
        ) => {
          try {
            this.socket?.send(JSON.stringify({
              type: "connect",
              transportType: "recv", // 明示的にトランスポートタイプを追加
              dtlsParameters,
            }));

            // 接続応答を待つ
            const onConnected = (event: MessageEvent) => {
              const message = JSON.parse(event.data);
              if (
                message.type === "connected" && message.transportType === "recv"
              ) {
                this.socket?.removeEventListener("message", onConnected);
                callback();
              } else if (
                message.type === "error" && message.transportType === "recv"
              ) {
                this.socket?.removeEventListener("message", onConnected);
                errback(
                  new Error(
                    message.message || "Failed to connect receive transport",
                  ),
                );
              }
            };

            this.socket?.addEventListener("message", onConnected);

            // タイムアウト設定
            setTimeout(() => {
              this.socket?.removeEventListener("message", onConnected);
              errback(new Error("Connection timeout for receive transport"));
            }, 10000);
          } catch (error) {
            console.error("受信トランスポート接続エラー:", error);
            errback(error as Error);
          }
        },
      );

      // 既存のプロデューサーに対してコンシューム（遅延を入れて確実にトランスポート接続後に行う）
      if (data.producers && Array.isArray(data.producers)) {
        console.log(`既存プロデューサー検出: ${data.producers.length}個`);

        // トランスポート接続後に少し遅延させて既存プロデューサーを消費
        data.producers.forEach(async (producer: any) => {
          console.log(
            `既存プロデューサー処理: ${producer.id}, ピア: ${producer.peerId}`,
          );
          try {
            await this.consumeProducer(producer.id, producer.peerId);
          } catch (err) {
            console.error("既存プロデューサー消費エラー:", err);
          }
        });
      }

      this.connected = true;
      this.emit("connected");

      // 既存のピアを通知
      if (data.peers && Array.isArray(data.peers)) {
        data.peers.forEach((peerId: string) => {
          this.emit("newPeer", peerId);
        });
      }
    } catch (error) {
      console.error("初期化エラー:", error);
      this.emit("error", error as Error);
    }
  }

  // 他のピアが参加した際の処理
  private handlePeerJoin(message: any): void {
    const { peerId, producers } = message;

    // 自分自身の参加通知は無視（念のため）
    if (peerId === this.myPeerId) {
      console.log(`自分自身(${peerId})の参加通知を無視します`);
      return;
    }

    console.log(`新しいピア参加: ${peerId}`);
    this.emit("newPeer", peerId);

    // 新しいピアのプロデューサーをコンシューム
    if (producers && Array.isArray(producers)) {
      console.log(
        `ピア ${peerId} のプロデューサー ${producers.length}個を消費します`,
      );
      producers.forEach(async (producer: any) => {
        await this.consumeProducer(producer.id, peerId);
      });
    }
  }

  // ピア退出時の処理
  private handlePeerLeave(message: any): void {
    const { peerId } = message;
    this.emit("peerLeft", peerId);

    // そのピアに関連するコンシューマーをクリーンアップ
    for (const [id, consumer] of this.consumers.entries()) {
      if (consumer.appData.peerId === peerId) {
        this.closeConsumer(id);
      }
    }
  }

  // 新しいプロデューサー通知の処理
  private async handleNewProducer(message: any): Promise<void> {
    const { producerId, peerId, kind } = message;
    console.log(
      `新しいプロデューサー通知: ID=${producerId}, ピア=${peerId}, 種類=${kind}`,
    );

    if (!producerId || !peerId || !kind) {
      console.error("無効なプロデューサー情報", message);
      return;
    }

    // 自分自身のプロデューサーはスキップ
    if (peerId === this.myPeerId) {
      console.log(
        `自分自身のプロデューサー(${producerId})なのでコンシュームをスキップします`,
      );
      return;
    }

    // 既存のプロデューサーIDと比較
    const myProducerIds = [...this.producers.values()].map((p) => p.id);
    if (myProducerIds.includes(producerId)) {
      console.log(
        `プロデューサー ${producerId} は自分のものなのでスキップします`,
      );
      return;
    }

    try {
      console.log("コンシューム処理を開始します");

      // デバイスとトランスポートの状態を確認
      if (this.device && this.recvTransport) {
        const transportState = this.recvTransport.connectionState || "unknown";
        console.log(`現在のトランスポート状態: ${transportState}`);

        // トランスポートが接続されていない場合は少し待ってみる
        if (transportState !== "connected") {
          console.log(
            "トランスポートが準備できていません。1秒後に再試行します。",
          );
          setTimeout(() => {
            this.consumeProducer(producerId, peerId).catch((err) =>
              console.error("初回遅延コンシューム試行エラー:", err)
            );
          }, 1000);
          return;
        }
      }

      // 連続的な再試行を設定
      const retryIntervals = [2000, 5000, 10000]; // 2秒、5秒、10秒後に再試行

      for (let i = 0; i < retryIntervals.length; i++) {
        setTimeout(() => {
          if (
            ![...this.consumers.values()].some((consumer) =>
              consumer.producerId === producerId
            )
          ) {
            console.log(
              `プロデューサー ${producerId} のコンシューム ${i + 1}回目の試行`,
            );
            this.consumeProducer(producerId, peerId).catch((err) =>
              console.error(`${i + 1}回目のコンシューム試行エラー:`, err)
            );
          }
        }, retryIntervals[i]);
      }

      // 最初の試行
      await this.consumeProducer(producerId, peerId);
    } catch (error) {
      console.error(`プロデューサーのコンシューム失敗: ${producerId}`, error);
    }
  }

  // コンシューム成功時の処理
  private async handleConsumed(message: any): Promise<void> {
    const { consumerId, producerId, kind, rtpParameters, peerId } = message;

    try {
      console.log(
        `コンシューム応答処理: ID=${consumerId}, プロデューサーID=${producerId}, ピア=${peerId}`,
      );

      if (!this.recvTransport) {
        throw new Error("受信トランスポートが存在しません");
      }

      // 既に同じプロデューサーIDのコンシューマーがないか確認
      const existingConsumer = [...this.consumers.values()].find((c) =>
        c.producerId === producerId
      );
      if (existingConsumer) {
        console.log(
          `プロデューサー ${producerId} は既にコンシューム済み、ID: ${existingConsumer.id}`,
        );
        return;
      }

      try {
        // トランスポートの状態を確認
        console.log(
          `受信トランスポート状態: ${
            this.recvTransport.connectionState || "unknown"
          }`,
        );

        const consumer = await this.recvTransport.consume({
          id: consumerId,
          producerId,
          kind: kind as "audio" | "video",
          rtpParameters,
          appData: { peerId },
        });

        console.log(
          `コンシューマー作成成功: ${consumerId}, トラック情報:`,
          consumer.track
            ? {
              readyState: consumer.track.readyState,
              kind: consumer.track.kind,
              enabled: consumer.track.enabled,
            }
            : "トラックなし",
        );

        // 再生を自動的に開始
        try {
          await consumer.resume();
          console.log(`コンシューマー ${consumerId} の再生を開始`);
        } catch (resumeError) {
          console.error(`コンシューマー再開エラー:`, resumeError);
        }

        consumer.on("producerclose", () => {
          console.log(
            `producercloseによりコンシューマー削除: ${consumerId}`,
          );
          this.consumers.delete(consumerId);
        });

        consumer.on("transportclose", () => {
          console.log(
            `トランスポート終了によりコンシューマー削除: ${consumerId}`,
          );
          this.consumers.delete(consumerId);
        });

        consumer.on("producerpause", () => {
          console.log(`プロデューサー一時停止: ${consumerId}`);
        })

        // トラックイベントを発行
        if (consumer.track) {
          console.log(
            `トラックイベント発行: ${kind}, ピア: ${consumer.appData.peerId}`,
          );
          this.emit(
            "newTrack",
            consumerId,
            consumer.appData.peerId,
            kind,
            consumer.track,
          );
        } else {
          console.warn(`トラックがありません: ${consumerId}`);
        }

        // トラック終了時のハンドリング
        consumer.on("trackended", () => {
          console.log(`トラック終了イベント: ${consumerId}`);
          this.emit("trackEnded", consumerId);
          this.closeConsumer(consumerId);
        });
      } catch (consumeError) {
        console.error("コンシューマー作成詳細エラー:", consumeError);
        throw consumeError;
      }
    } catch (error) {
      console.error("コンシューマー作成エラー:", error);
    }
  }

  // プロデューサーをコンシュームするヘルパー関数
  public async consumeProducer(
    producerId: string,
    peerId: string,
  ): Promise<void> {
    if (!this.device || !this.recvTransport) {
      console.error(`コンシューム不可: デバイスまたはトランスポートが未初期化`);
      return;
    }
    try {
      if (!this.device.rtpCapabilities) {
        console.error("RTPケーパビリティがありません");
        return;
      }

      // トランスポートが接続されているか確認
      if (
        !this.recvTransport.connectionState ||
        this.recvTransport.connectionState === "disconnected"
      ) {
        console.error(
          "受信トランスポートが接続されていません:",
          this.recvTransport.connectionState,
        );
        return;
      }

      // 自分自身のプロデューサーのコンシュームはスキップ
      if (peerId === this.myPeerId) {
        console.log(
          `自分自身のプロデューサー(${producerId})なのでコンシュームをスキップします`,
        );
        return;
      }

      // 既存の自分のプロデューサーと比較
      const myProducerIds = [...this.producers.values()].map((p) => p.id);
      if (myProducerIds.includes(producerId)) {
        console.log(
        );
        return;
      }

      // RTCのケーパビリティをチェック（すでに消費済みでないことも確認）
      const alreadyConsuming = [...this.consumers.values()].some((consumer) =>
        consumer.producerId === producerId
      );

      if (alreadyConsuming) {
        return;
      }

      this.socket?.send(JSON.stringify({
        type: "consume",
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
        peerId, // ピアID情報を送信
      }));
    } catch (error) {
      console.error(`コンシューム要求エラー:`, error);
    }
  }

  // プロデューサー終了通知の処理
  private handleProducerClosed(message: any): void {
    const { producerId, peerId } = message;
    console.log(`リモートプロデューサー終了通知: ID=${producerId}, ピア=${peerId}`);
    
    let kind: "audio" | "video" | null = null;
    
    // 関連するコンシューマーを探して終了処理
    for (const [id, consumer] of this.consumers.entries()) {
      if (consumer.producerId === producerId) {
        console.log(`プロデューサー終了によりコンシューマー終了: ${id}`);
        
        // 終了前にkindを保存
        kind = consumer.kind as "audio" | "video";
        
        // トラック終了イベントを発行
        this.emit("trackEnded", id);
        
        // コンシューマーを閉じる
        this.closeConsumer(id);
      }
    }
    if (kind) {
      this.emit("peerMuted", peerId, kind);
    } else {
      this.emit("peerMuted", peerId, "audio");
    }
  }

  // WebSocketの切断処理
  private handleSocketClose(): void {
    this.connected = false;
    this.cleanup();
    this.emit("disconnected");
  }

  // WebSocketのエラー処理
  private handleSocketError(event: Event): void {
    console.error("WebSocket エラー:", event);
    this.emit("error", new Error("WebSocket接続エラー"));
  }

  // 通話終了
  disconnect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.cleanup();
  }

  // リソース解放
  private cleanup(): void {
    // プロデューサーの解放
    this.producers.forEach((producer) => producer.close());
    this.producers.clear();

    // コンシューマーの解放
    this.consumers.forEach((consumer) => consumer.close());
    this.consumers.clear();

    // トランスポートの解放
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }

    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }

    // その他のリソース解放
    this.device = null;
    this.socket = null;
    this.connected = false;
    this.roomId = null;
  }
}
