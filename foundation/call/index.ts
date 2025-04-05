import { TakosCallClient } from "./client.ts";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import { WSContext } from "hono/ws";
import PubSub from "pubsub-js";
import { z } from "zod";
import publish from "../../utils/redisClient.ts";
import { CallToken, callToken } from "../../models/call/token.ts";
import { uuidv4 } from "npm:uuidv7@^1.0.2";

// Zodスキーマ定義
// クライアントから送信されるメッセージの形式を定義
const connectSchema = z.object({
  type: z.literal("connect"),
  transportType: z.enum(["send", "recv"]), // transportTypeフィールドを追加
  dtlsParameters: z.record(z.unknown()).or(z.string()),
});

const produceSchema = z.object({
  type: z.literal("produce"),
  kind: z.enum(["audio", "video"]),
  rtpParameters: z.record(z.unknown()).or(z.array(z.unknown())),
});

const consumeSchema = z.object({
  type: z.literal("consume"),
  producerId: z.string(),
  rtpCapabilities: z.record(z.unknown()).or(z.array(z.unknown())),
  peerId: z.string(),
});

const textMessageSchema = z.object({
  type: z.literal("message"),
  message: z.string(),
  sign: z.string(),
});

const byeSchema = z.object({
  type: z.literal("bye"),
});

const closeProducerSchema = z.object({
  type: z.literal("closeProducer"),
  producerId: z.string(),
});

const closeConsumerSchema = z.object({
  type: z.literal("closeConsumer"),
  consumerId: z.string(),
});

// すべてのメッセージタイプを含むスキーマを作成
const messageSchema = z.discriminatedUnion("type", [
  connectSchema,
  produceSchema,
  consumeSchema,
  textMessageSchema,
  byeSchema,
  closeProducerSchema,
  closeConsumerSchema,
]);

// 型定義を追加
type ConnectMessage = z.infer<typeof connectSchema>;
type ProduceMessage = z.infer<typeof produceSchema>;
type ConsumeMessage = z.infer<typeof consumeSchema>;
type CloseProducerMessage = z.infer<typeof closeProducerSchema>;
type CloseConsumerMessage = z.infer<typeof closeConsumerSchema>;

const client = new TakosCallClient({
  url: "ws://localhost:3000/takos-api",
  apiKey: "tako",
});


//client.closeProducer

PubSub.subscribe("webRTC", async (_subpubType: string, message: string) => {
  const data = JSON.parse(message);
  switch (data.type) {
    case "join": {
      const { roomId, userId } = data;
      await handleNoticeJoin(roomId, userId);
      break;
    }
    case "leave": {
      const { roomId, userId } = JSON.parse(data.data);
      handleNoticeLeave(roomId, userId);
      break;
    }
    default:
      break;
  }
});

client.on("producerCreated", async (data) => {
  const {
    roomId,
    peerId,
    producerId,
    kind,
  } = data;
  handleNoticeProduce(roomId, peerId, kind, producerId);
});

client.on("producerClosed", ({ roomId, peerId, producerId }) => {
    console.log(
      `プロデューサー切断: ルーム=${roomId}, ピア=${peerId}, プロデューサー=${producerId}`,
    );
});
  

client.on("transportClosed", (data) => {
  const { roomId, peerId, transportId } = data;

  // セッションを検索してトランスポート切断されたユーザーを見つける
  for (const [sessionsKey, session] of sessions.entries()) {
    const [userId, sessionRoomId] = sessionsKey.split("@");

    // 該当するセッションを見つけたら切断処理
    if (
      sessionRoomId === roomId && userId === peerId &&
      (session.transportId.send === transportId ||
        session.transportId.recv === transportId)
    ) {
      // セッションを削除
      sessions.delete(sessionsKey);

      // 他の参加者に退出通知
      publish({
        type: "leave",
        data: JSON.stringify({
          roomId,
          userId,
        }),
        subPubType: "webRTC",
      });

      session.ws.close();
      break;
    }
  }
});

const sessions = new Map<string, {
  ws: WSContext<WebSocket>;
  transportId: {
    send: string;
    recv: string;
  };
  userId: string;
  roomId: string;
  type: "friend" | "group";
  callType: string;
}>();

const app = new Hono();

app.get(
  "/",
  upgradeWebSocket(async (c) => {
    console.log("WebSocket接続要求を受信");
    let session: callToken | null = null;
    // クエリパラメータまたはクッキーからセッションIDを取得
    let isKill = false;
    const token = c.req.query("token");
    let sessionsInfo: {
      userId: string;
      roomId: string;
      uuid: string;
      type: "friend" | "group";
      callType: string;
    } | null = null;
    if (!token) {
      console.log("No token provided");
      isKill = true;
    } else {
      session = await CallToken.findOne({ token });
      if (!session) {
        console.log("Invalid token");
        isKill = true;
      } else {
        sessionsInfo = {
          userId: session.userId,
          roomId: session.roomId,
          uuid: uuidv4(),
          type: session.type,
          callType: session.callType!,
        };
      }
    }

    return {
      onOpen: async (e, ws) => {
        if (isKill || !session) {
          console.log("Invalid session");
          ws.close();
          return;
        }
        const { roomId, userId, callType } = session;
        if (!roomId || !userId || !sessionsInfo) {
          console.log("Invalid session data");
          ws.close();
          return;
        }

        console.log(
          `WebSocket接続成功: ルーム=${roomId}, ユーザー=${userId}, 種類=${callType}`,
        );

        let roomInfo = await client.getRoomInfo(roomId);
        if (!roomInfo) {
          roomInfo = await client.createRoom(roomId);
        }

        // ピア情報の確認と既存ピアのクリーンアップ
        const peerInfo = await client.getPeerInfo(roomId, userId);
        if (peerInfo) {
          console.log(`ピアが既に存在します: ${userId}、クリーンアップを実行`);

          // 古いセッションをチェックして削除
          for (const [sessionsKey, session] of sessions) {
            const [oldUserId, oldRoomId] = sessionsKey.split("@");
            if (oldRoomId === roomId && oldUserId === userId) {
              console.log(`古いセッションを削除: ${sessionsKey}`);
              sessions.delete(sessionsKey);
              try {
                session.ws.close();
              } catch (error) {
                console.log("WebSocket閉じるエラー:", error);
              }
            }
          }

          // SFUサーバーから古いピアを強制的に削除
          try {
            await client.removePeer(roomId, userId);
            console.log(`SFUサーバーから古いピアを削除: ${userId}`);
          } catch (error) {
            console.log(
              `古いピア削除エラー (無視して継続): ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            // 削除に失敗しても続行
          }
        }

        // 新しいピアを追加
        await client.addPeer(roomId, userId);

        // Initialize response object based on call type
        const responseData: any = {
          roomId,
          peers: [],
          callType,
          myPeerId: userId, // 自分自身のピアIDを明示的に送信
        };
        // Set up WebRTC only for audio/video calls
        if (callType === "audio" || callType === "video") {
          const routerRtpCapabilities = await client
            .getRouterRtpCapabilities(roomId);
          const sendTransport = await client.createTransport(
            roomId,
            userId,
            "send",
          );
          const recvTransport = await client.createTransport(
            roomId,
            userId,
            "recv",
          );

          const { producers } = await collectRoomData(
            roomId,
            userId,
            roomInfo,
          );

          sessions.set(sessionsInfo.uuid, {
            ws,
            transportId: {
              send: sendTransport.id,
              recv: recvTransport.id,
            },
            userId,
            roomId,
            type: sessionsInfo.type,
            callType,
          });

          responseData.routerRtpCapabilities = routerRtpCapabilities;
          responseData.transport = {
            send: sendTransport,
            recv: recvTransport,
          };
          responseData.producers = producers;
          responseData.peers = producers.map((producer) => producer.peerId);
        } else {
          sessions.set(sessionsInfo.uuid, {
            ws,
            transportId: { send: "", recv: "" },
            userId,
            roomId,
            type: sessionsInfo.type,
            callType,
          });

          // Get peers for text call
          if (roomInfo && roomInfo.peers) {
            responseData.peers = Object.keys(roomInfo.peers).filter(
              (peerId) => peerId !== userId,
            );
          }
        }

        ws.send(
          JSON.stringify({
            type: "init",
            data: responseData,
          }),
        );

        publish({
          type: "join",
          data: JSON.stringify({
            roomId,
            userId,
          }),
          subPubType: "webRTC",
        });
      },
      onMessage: async (e, ws) => {
        try {
          const rawData = JSON.parse(e.data as string);

          // Zodを使用したバリデーション
          const result = messageSchema.safeParse(rawData);

          if (!result.success) {
            console.log("メッセージバリデーションエラー:", result.error);
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid message format",
                details: result.error.format(),
              }),
            );
            return;
          }

          const message = result.data;

          if (!sessionsInfo) {
            ws.close();
            return;
          }
          switch (message.type) {
            case "connect": {
              await handleConnectTransport(ws, message, sessionsInfo);
              break;
            }
            case "produce": {
              await handleProduce(ws, message, sessionsInfo);
              break;
            }
            case "consume": {
              await handleConsume(ws, message, sessionsInfo);
              break;
            }
            case "closeProducer": {
              await handleCloseProducer(ws, message, sessionsInfo);
              break;
            }
            case "closeConsumer": {
              await handleCloseConsumer(ws, message, sessionsInfo);
              break;
            }
          }
        } catch (error) {
          console.log("メッセージ処理エラー:", error);
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Failed to process message",
            }),
          );
        }
      },
      onClose: async (e, ws) => {
        if (sessionsInfo) {
          const { roomId, userId, uuid } = sessionsInfo;
          sessions.delete(uuid);
          publish({
            type: "leave",
            data: JSON.stringify({
              roomId,
              userId,
            }),
            subPubType: "webRTC",
          });

          try {
            // ピアを削除
            const peerInfo = await client.getPeerInfo(roomId, userId);
            if (peerInfo) {
              await client.removePeer(roomId, userId);
            }

            // ルーム情報を取得して、ピアが残っていなければルームを削除
            const roomInfo = await client.getRoomInfo(roomId);
            if (
              roomInfo &&
              (!roomInfo.peers || Object.keys(roomInfo.peers).length === 0)
            ) {
              await client.closeRoom(roomId);
            }
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : JSON.stringify(error);
            console.log(`Error cleaning up resources: ${errorMessage}`);
          }
        }
      },
    };
  }),
);

async function handleCloseProducer(
  ws: WSContext<WebSocket>,
  data: CloseProducerMessage,
  sessionsKey: {
    userId: string;
    roomId: string;
    uuid: string;
  },
) {
  const { producerId } = data;
  const { userId, roomId } = sessionsKey;
  const session = sessions.get(sessionsKey.uuid);

  if (!session) {
    ws.close();
    return;
  }

  try {
    // producerを閉じる処理
    await client.closeProducer(roomId, userId, producerId);
    
    // 他のクライアントにプロデューサーが閉じられたことを通知
    for (const [uuid, value] of sessions.entries()) {
      const [sessionUserId, sessionRoomId] = [value.userId, value.roomId];
      if (sessionRoomId === roomId && sessionUserId !== userId) {
        const targetSession = sessions.get(uuid);
        if (targetSession) {
          try {
            targetSession.ws.send(
              JSON.stringify({
                type: "producerClosed",
                producerId,
                peerId: userId,
              }),
            );
          } catch (error) {
            console.log(
              `プロデューサー終了通知送信エラー to ${sessionUserId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    }
  } catch (error) {
    console.log(error);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Failed to close producer",
      }),
    );
  }
}

async function handleCloseConsumer(
  ws: WSContext<WebSocket>,
  data: CloseConsumerMessage,
  sessionsKey: {
    userId: string;
    roomId: string;
    uuid: string;
  },
) {
  const { consumerId } = data;
  const { userId, roomId } = sessionsKey;
  const session = sessions.get(sessionsKey.uuid);

  if (!session) {
    ws.close();
    return;
  }

  try {
    // consumerを閉じる処理
    await client.closeConsumer(roomId, userId, consumerId);
  } catch (error) {
    console.log(error);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Failed to close consumer",
      }),
    );
  }
}

async function handleNoticeJoin(roomId: string, userId: string) {
  for (const [sessionsKey, session] of sessions) {
    const [currentUserId, currentRoomId] = sessionsKey.split("@");
    if (currentRoomId === roomId && currentUserId !== userId) {
      const roomInfo = await client.getRoomInfo(roomId);
      if (!roomInfo) {
        return;
      }
      const { producers } = await collectRoomData(
        roomId,
        userId,
        roomInfo,
      );
      session.ws.send(
        JSON.stringify({
          type: "join",
          peerId: userId,
          producers,
        }),
      );
    }
  }
}

function handleNoticeLeave(roomId: string, userId: string) {
  for (const [key, session] of sessions) {
    const [currentUserId, currentRoomId] = [session.userId, session.roomId];
    console.log(currentRoomId, roomId, currentUserId, userId);
    console.log(currentRoomId === roomId && currentUserId !== userId);
    if (currentRoomId === roomId && currentUserId !== userId) {
      if (session.type === "friend") {
        session.ws.close();
        return;
      }
      session.ws.send(
        JSON.stringify({
          type: "leave",
          peerId: userId,
        }),
      );
    }
  }
}

function handleNoticeProduce(
  roomId: string,
  userId: string,
  kind: string,
  producerId: string,
) {
  for (const [uuid, value] of sessions.entries()) {
    const [sessionUserId, sessionRoomId] = [value.userId, value.roomId];
    if (sessionRoomId === roomId && sessionUserId !== userId) {
      const session = sessions.get(uuid);
      if (session) {
        try {
          session.ws.send(
            JSON.stringify({
              type: "produce",
              producerId,
              kind,
              peerId: userId,
            }),
          );
        } catch (error) {
          console.log(
            `通知送信エラー to ${sessionUserId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }
}

async function handleConsume(
  ws: WSContext<WebSocket>,
  data: ConsumeMessage,
  sessionsInfo: {
    userId: string;
    roomId: string;
    uuid: string;
  },
) {
  const { producerId, rtpCapabilities, peerId: clientProvidedPeerId } = data;
  const { userId, roomId } = sessionsInfo;

  const peerInfo = await client.getPeerInfo(roomId, userId);
  if (
    peerInfo && peerInfo.producers &&
    Object.keys(peerInfo.producers).includes(producerId)
  ) {
    ws.send(
      JSON.stringify({
        type: "selfProducer",
        message: "Cannot consume your own producer",
        producerId,
      }),
    );
    return;
  }

  const session = sessions.get(sessionsInfo.uuid);
  if (!session) {
    console.log(`セッションが見つかりません: ${sessionsInfo.uuid}`);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Session not found",
      }),
    );
    return;
  }

  try {
    const producerPeerId = clientProvidedPeerId;
    const roomInfo = await client.getRoomInfo(roomId);
    if (!roomInfo) {
      throw new Error(`Room ${roomId} not found`);
    }
    if (!producerPeerId) {
      ws.send(
        JSON.stringify({
          type: "producerNotFound",
          producerId,
        }),
      );
      return;
    }

    if (!Object.keys(roomInfo.peers || {}).includes(producerPeerId)) {
      ws.send(
        JSON.stringify({
          type: "producerNotFound",
          producerId,
          message: `Producer ${producerId} not found in room ${roomId}`,
        }),
      );
      return;
    }

    const consumer = await client.createConsumer(
      roomId,
      userId,
      session.transportId.recv,
      producerId,
      rtpCapabilities,
    );

    if (!consumer) {
      console.log(`プロデューサー ${producerId} が見つかりません`);
      ws.send(
        JSON.stringify({
          type: "producerNotFound",
          producerId,
        }),
      );
      return;
    }

    ws.send(
      JSON.stringify({
        type: "consumed",
        consumerId: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        peerId: producerPeerId,
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`コンシューマー作成エラー: ${errorMessage}`);
    ws.send(
      JSON.stringify({
        type: "producerNotFound",
        error: errorMessage,
        producerId,
      }),
    );
  }
}

async function handleProduce(
  ws: WSContext<WebSocket>,
  data: ProduceMessage,
  sessionsInfo: {
    userId: string;
    roomId: string;
    uuid: string;
  },
) {
  const { kind, rtpParameters } = data;
  const { userId, roomId } = sessionsInfo;
  console.log(`プロデュース要求: ユーザー=${userId}, 種類=${kind}`);

  const session = sessions.get(sessionsInfo.uuid);
  if (!session) {
    console.log("セッションが見つかりません、WebSocketを閉じます");
    ws.close();
    return;
  }

  try {
    const peerInfo = await client.getPeerInfo(roomId, userId);
    if (!peerInfo) {
      console.log(`ピア情報が見つかりません: ${userId}`);
      ws.close();
      return;
    }

    // 同じ種類のプロデューサーがすでに存在するかチェック
    let existingProducerFound = false;
    for (const key in peerInfo.producers) {
      const value = peerInfo.producers[key];
      if (value.kind === kind) {
        console.log(
          `既存プロデューサーが見つかりました: ${key}, 種類=${value.kind}`,
        );
        existingProducerFound = true;

        ws.send(
          JSON.stringify({
            type: "producerAlreadyExists",
            producerId: key,
          }),
        );
        break;
      }
    }

    if (existingProducerFound) {
      return;
    }

    const producer = await client.createProducer(
      roomId,
      userId,
      session.transportId.send,
      kind,
      rtpParameters,
    );

    // クライアントに応答
    ws.send(
      JSON.stringify({
        type: "produced",
        producerId: producer.id,
        kind,
      }),
    );
    // 他の参加者への通知を確実に行う
    try {
      // 作成されたプロデューサーが実際に存在するか再確認
      const refreshedPeerInfo = await client.getPeerInfo(roomId, userId);
      if (
        refreshedPeerInfo &&
        refreshedPeerInfo.producers &&
        Object.keys(refreshedPeerInfo.producers).includes(producer.id)
      ) {
        console.log(`プロデューサー ${producer.id} の通知送信`);

        // 他のクライアントに再通知
        handleNoticeProduce(roomId, userId, kind, producer.id);
      }
    } catch (error) {
      console.log(
        `通知再送信エラー: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: "error",
        context: "produce",
        message: error instanceof Error
          ? error.message
          : "Failed to create producer",
      }),
    );
  }
}

async function handleConnectTransport(
  ws: WSContext<WebSocket>,
  data: ConnectMessage,
  sessionsKey: {
    userId: string;
    roomId: string;
    uuid: string;
  },
) {
  const { dtlsParameters, transportType } = data; // transportTypeを取得
  const session = sessions.get(sessionsKey.uuid);

  if (!session) {
    console.log(`セッションが見つかりません: ${sessionsKey.uuid}`);
    ws.close();
    return;
  }

  const { userId, roomId } = sessionsKey;

  if (!userId || !roomId) {
    ws.close();
    return;
  }

  try {
    // 明示的に指定されたtransportTypeを使用
    if (transportType === "send") {
      await client.connectTransport(
        roomId,
        userId,
        session.transportId.send,
        dtlsParameters,
      );
    } else if (transportType === "recv") {
      await client.connectTransport(
        roomId,
        userId,
        session.transportId.recv,
        dtlsParameters,
      );
    } else {
      throw new Error(`不明なトランスポートタイプ: ${transportType}`);
    }

    ws.send(
      JSON.stringify({
        type: "connected",
        transportType, // 応答にもtransportTypeを含める
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ws.send(
      JSON.stringify({
        type: "error",
        transportType, // エラー応答にもtransportTypeを含める
        message:
          `Failed to connect ${transportType} transport: ${errorMessage}`,
      }),
    );
  }
}

async function collectRoomData(
  roomId: string,
  currentPeerId: string,
  roomInfo: any,
): Promise<{
  producers: Array<{ id: string; peerId: string; kind: string }>;
}> {
  const producers: Array<{ id: string; peerId: string; kind: string }> = [];

  for (const [existingPeerId, peer] of Object.entries(roomInfo.peers)) {
    if (existingPeerId !== currentPeerId) {
      const peerInfo = await client.getPeerInfo(roomId, existingPeerId);
      if (peerInfo) {
        if (peerInfo.producers) {
          for (const producerId of Object.keys(peerInfo.producers)) {
            const producerInfo = await client.getProducerInfo(
              roomId,
              existingPeerId,
              producerId,
            );
            if (producerInfo) {
              producers.push({
                id: producerId,
                peerId: existingPeerId,
                kind: producerInfo.kind,
              });
            }
          }
        }
      }
    }
  }
  return { producers };
}

export default app;
