import { TakosCallClient } from "./client.ts";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import { WSContext } from "hono/ws";
import PubSub from "pubsub-js";
import { z } from "zod";
import publish from "../../utils/redisClient.ts";
import { CallToken, callToken } from "../../models/call/token.ts";

// Zodスキーマ定義
// クライアントから送信されるメッセージの形式を定義
const connectSchema = z.object({
    type: z.literal("connect"),
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
type TextMessage = z.infer<typeof textMessageSchema>;
type CloseProducerMessage = z.infer<typeof closeProducerSchema>;
type CloseConsumerMessage = z.infer<typeof closeConsumerSchema>;
type WebSocketMessage = z.infer<typeof messageSchema>;

const client = new TakosCallClient({
    url: "ws://localhost:3000/takos-api",
    apiKey: "tako",
});

PubSub.subscribe("webRTC", async (_subpubType: string, message: string) => {
    const data = JSON.parse(message);
    switch (data.type) {
        case "join": {
            const { roomId, userId } = data;
            await handleNoticeJoin(roomId, userId);
            break;
        }
        case "leave": {
            const { roomId, userId } = data;
            await handleNoticeLeave(roomId, userId);
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
    await handleNoticeProduce(roomId, peerId, kind, producerId);
});

client.on("transportClosed", (data) => {
    const { roomId, peerId, transportId } = data;
    
    // セッションを検索してトランスポート切断されたユーザーを見つける
    for (const [sessionsKey, session] of sessions.entries()) {
        const [userId, sessionRoomId] = sessionsKey.split("@");
        
        // 該当するセッションを見つけたら切断処理
        if (sessionRoomId === roomId && userId === peerId && 
            (session.transportId.send === transportId || session.transportId.recv === transportId)) {
            
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
            
            // WebSocketも閉じる
            try {
                session.ws.close();
            } catch (error) {
                console.log("Error closing WebSocket:", error);
            }
            
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
}>();

const app = new Hono();

app.get(
    "/",
    upgradeWebSocket(async (c) => {
        let session: callToken | null = null;
        // クエリパラメータまたはクッキーからセッションIDを取得
        let isKill = false;
        const token = c.req.query("token");
        let sessionsKey: string | null = null;
        if (!token) {
            isKill = true;
        } else {
            session = await CallToken.findOne({ token });

            if (!session) {
                isKill = true;
            } else {
                sessionsKey = `${session.userId}@${session.roomId}`;
                await CallToken.deleteOne({ token });
            }
        }
        return {
            onOpen: async (e, ws) => {
                if (isKill || !session) {
                    ws.close();
                    return;
                }
                const { roomId, userId, callType } = session;
                if (!roomId || !userId || !sessionsKey) {
                    ws.close();
                    return;
                }

                if (sessions.get(sessionsKey)) {
                    ws.close();
                    return;
                }
                try {
                    let roomInfo = await client.getRoomInfo(roomId);
                    if (!roomInfo) {
                        roomInfo = await client.createRoom(roomId);
                    }
                    const peerInfo = await client.getPeerInfo(roomId, userId);
                    if (peerInfo) {
                        ws.close();
                        return;
                    }
                    await client.addPeer(roomId, userId);

                    // Initialize response object based on call type
                    const responseData: any = {
                        roomId,
                        peers: [],
                        callType,
                    };

                    // Set up WebRTC only for audio/video calls
                    if (callType === 'audio' || callType === 'video') {
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
                        
                        sessions.set(sessionsKey, {
                            ws,
                            transportId: {
                                send: sendTransport.id,
                                recv: recvTransport.id,
                            },
                        });

                        responseData.routerRtpCapabilities = routerRtpCapabilities;
                        responseData.transport = {
                            send: sendTransport,
                            recv: recvTransport,
                        };
                        responseData.producers = producers;
                        responseData.peers = producers.map((producer) => producer.peerId);
                    } else {
                        // For text calls, no transport needed
                        sessions.set(sessionsKey, {
                            ws,
                            transportId: { send: '', recv: '' }
                        });
                        
                        // Get peers for text call
                        if (roomInfo && roomInfo.peers) {
                            responseData.peers = Object.keys(roomInfo.peers).filter(
                                peerId => peerId !== userId
                            );
                        }
                    }

                    ws.send(
                        JSON.stringify({
                            type: "init",
                            data: responseData
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
                } catch (error) {
                    console.log(error);
                    ws.close();
                }
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
                                details: result.error.format()
                            })
                        );
                        return;
                    }
                    
                    const message = result.data;
                    
                    if (!sessionsKey) {
                        ws.close();
                        return;
                    }
                    
                    const [userId, roomId] = sessionsKey.split("@");
                    
                    switch (message.type) {
                        case "connect": {
                            await handleConnectTransport(ws, message, sessionsKey);
                            break;
                        }
                        case "produce": {
                            await handleProduce(ws, message, sessionsKey);
                            break;
                        }
                        case "consume": {
                            await handleConsume(ws, message, sessionsKey);
                            break;
                        }
                        case "message": {
                            // セッション情報を確認してテキスト通話の場合のみメッセージ処理
                            const sessionInfo = await CallToken.findOne({ userId, roomId });
                            if (sessionInfo?.callType === "text") {
                                await handleTextMessage(message, userId, roomId);
                            } else {
                                ws.send(
                                    JSON.stringify({
                                        type: "error",
                                        message: "Text messages are only allowed in text calls"
                                    })
                                );
                            }
                            break;
                        }
                        case "bye": {
                            // 明示的な通話終了
                            ws.close();
                            break;
                        }
                        case "closeProducer": {
                            await handleCloseProducer(ws, message, sessionsKey);
                            break;
                        }
                        case "closeConsumer": {
                            await handleCloseConsumer(ws, message, sessionsKey);
                            break;
                        }
                    }
                } catch (error) {
                    console.log("メッセージ処理エラー:", error);
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Failed to process message"
                        })
                    );
                }
            },
            onClose: async (e, ws) => {
                if (sessionsKey) {
                    sessions.delete(sessionsKey);
                    const [userId, roomId] = sessionsKey.split("@");
                    publish({
                        type: "leave",
                        data: JSON.stringify({
                            roomId,
                            userId,
                        }),
                        subPubType: "webRTC",
                    });
                }
            },
        };
    }),
);

// 型付きハンドラ関数
async function handleTextMessage(
    data: TextMessage,
    senderId: string,
    roomId: string
) {
    const { message, sign } = data;
    
    // 他のユーザーにメッセージを転送
    for (const [sessionsKey, session] of sessions) {
        const [userId, userRoomId] = sessionsKey.split("@");
        if (userRoomId === roomId && userId !== senderId) {
            session.ws.send(
                JSON.stringify({
                    type: "message",
                    message,
                    sign,
                    peerId: senderId
                })
            );
        }
    }
}

async function handleCloseProducer(
    ws: WSContext<WebSocket>,
    data: CloseProducerMessage,
    sessionsKey: string
) {
    const { producerId } = data;
    const [userId, roomId] = sessionsKey.split("@");
    const session = sessions.get(sessionsKey);
    
    if (!session) {
        ws.close();
        return;
    }
    
    try {
        // producerを閉じる処理
        await client.closeProducer(roomId, userId, producerId);
        
        ws.send(
            JSON.stringify({
                type: "producerClosed",
                producerId
            })
        );
    } catch (error) {
        console.log(error);
        ws.send(
            JSON.stringify({
                type: "error",
                message: "Failed to close producer"
            })
        );
    }
}

async function handleCloseConsumer(
    ws: WSContext<WebSocket>,
    data: CloseConsumerMessage,
    sessionsKey: string
) {
    const { consumerId } = data;
    const [userId, roomId] = sessionsKey.split("@");
    const session = sessions.get(sessionsKey);
    
    if (!session) {
        ws.close();
        return;
    }
    
    try {
        // consumerを閉じる処理
        await client.closeConsumer(roomId, userId, consumerId);
        
        ws.send(
            JSON.stringify({
                type: "consumerClosed",
                consumerId
            })
        );
    } catch (error) {
        console.log(error);
        ws.send(
            JSON.stringify({
                type: "error",
                message: "Failed to close consumer"
            })
        );
    }
}

async function handleNoticeJoin(roomId: string, userId: string) {
    for(const [sessionsKey, session] of sessions) {
        const [currentUserId, currentRoomId] = sessionsKey.split("@");
        if(currentRoomId === roomId && currentUserId !== userId) {
            const roomInfo = await client.getRoomInfo(roomId);
            if(!roomInfo) {
                return;
            }
            
            // Get call type for this session
            const sessionInfo = await CallToken.findOne({ userId: currentUserId, roomId: currentRoomId });
            const callType = sessionInfo?.callType || "audio"; // default to audio if not found
            
            if (callType === "audio" || callType === "video") {
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
            } else {
                // For text calls, only send the peerId
                session.ws.send(
                    JSON.stringify({
                        type: "join",
                        peerId: userId,
                    }),
                );
            }
        }
    }
}

async function handleNoticeLeave(roomId: string, userId: string) {
    for(const [sessionsKey, session] of sessions) {
        const [currentUserId, currentRoomId] = sessionsKey.split("@");
        if(currentRoomId === roomId && currentUserId !== userId) {
            session.ws.send(
                JSON.stringify({
                    type: "leave",
                    peerId: userId,
                }),
            );
        }
    }
}

async function handleNoticeProduce(
    roomId: string,
    userId: string,
    kind: string,
    producerId: string,
) {
    for(const [sessionsKey, session] of sessions) {
        const [currentUserId, currentRoomId] = sessionsKey.split("@");
        if(currentRoomId === roomId && currentUserId !== userId) {
            session.ws.send(
                JSON.stringify({
                    type: "newProduce",
                    producerId,
                    kind,
                    peerId: userId,
                }),
            );
        }
    }
}

async function handleConsume(
    ws: WSContext<WebSocket>,
    data: ConsumeMessage,
    sessionsKey: string,
) {
    const { producerId, rtpCapabilities } = data;
    const [userId, roomId] = sessionsKey.split("@");
    const session = sessions.get(sessionsKey);
    if (!session) {
        ws.close();
        return;
    }
    try {
        const consumer = await client.createConsumer(
            roomId,
            userId,
            session.transportId.recv,
            producerId,
            rtpCapabilities,
        );
        if (!consumer) {
            ws.send(
                JSON.stringify({
                    type: "producerNotFound",
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
            }),
        );
    } catch (error) {
        console.log(error);
        ws.send(
            JSON.stringify({
                type: "producerNotFound",
            }),
        );
    }
}

async function handleProduce(
    ws: WSContext<WebSocket>,
    data: ProduceMessage,
    sessionsKey: string,
) {
    const { kind, rtpParameters } = data;
    const [userId, roomId] = sessionsKey.split("@");
    const session = sessions.get(sessionsKey);
    if (!session) {
        ws.close();
        return;
    }
    try {
        const peerInfo = await client.getPeerInfo(roomId, userId);
        if (!peerInfo) {
            ws.close();
            return;
        }
        for (const key in peerInfo.producers) {
            const value = peerInfo.producers[key];
            if (value.kind === kind) {
                ws.send(
                    JSON.stringify({
                        type: "producerAlreadyExists",
                    }),
                );
                return;
            }
        }
        const producer = await client.createProducer(
            roomId,
            userId,
            session.transportId.send,
            kind,
            rtpParameters,
        );
        ws.send(
            JSON.stringify({
                type: "produced",
                producerId: producer.id,
                kind,
            }),
        );
    } catch (error) {
        console.log(error);
        ws.send(
            JSON.stringify({
                type: "producerNotFound",
            }),
        );
    }
}

async function handleConnectTransport(
    ws: WSContext<WebSocket>,
    data: ConnectMessage,
    sessionsKey: string,
) {
    const { dtlsParameters } = data;
    const session = sessions.get(sessionsKey);
    
    if (!session) {
        ws.close();
        return;
    }
    
    const [userId, roomId] = sessionsKey.split("@");
    
    if (!userId || !roomId) {
        ws.close();
        return;
    }
    
    let transportType: "send" | "recv" | null = null;
    
    try {
        transportType = data.type === "connect" ? "send" : "recv";
        
        if (transportType === "send") {
            await client.connectTransport(
                roomId,
                userId,
                session.transportId.send,
                dtlsParameters,
            );
        } else {
            await client.connectTransport(
                roomId,
                userId,
                session.transportId.recv,
                dtlsParameters,
            );
        }
        
        ws.send(
            JSON.stringify({
                type: "connected",
                transportType,
            }),
        );
    } catch (error) {
        console.log(error);
        ws.send(
            JSON.stringify({
                type: "error",
                message: `Failed to connect ${transportType} transport`
            })
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