import { TakosCallClient } from "./call/client.ts";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import { WSContext } from "hono/ws";
import PubSub from "pubsub-js";
import publish from "../utils/redisClient.ts";

PubSub.subscribe("webRTC", async (_subpubType: string, message: string) => {
    const data = JSON.parse(message);
});

// 型定義
type MessageType =
    | "join"
    | "joinResponse"
    | "connectTransport"
    | "transportConnected"
    | "produce"
    | "produced"
    | "consume"
    | "consumed"
    | "updatePeer"
    | "peerUpdated"
    | "peerEvent"
    | "error";

interface BaseMessage {
    type: MessageType;
}

interface ErrorMessage extends BaseMessage {
    type: "error";
    message: string;
}

interface JoinMessage extends BaseMessage {
    type: "join";
    roomId: string;
    peerId: string;
}

interface PeerEventMessage extends BaseMessage {
    type: "peerEvent";
    event: "joined" | "left" | "newProducer" | "info";
    peerId: string;
    roomId?: string;
    producerId?: string;
    kind?: string;
    info?: Record<string, unknown>;
}

interface ConnectTransportMessage extends BaseMessage {
    type: "connectTransport";
    roomId: string;
    peerId: string;
    transportId: string;
    dtlsParameters: any; // RTCDtlsParameters
}

interface ProduceMessage extends BaseMessage {
    type: "produce";
    roomId: string;
    peerId: string;
    transportId: string;
    kind: string;
    rtpParameters: any; // RTCRtpParameters
}

interface ConsumeMessage extends BaseMessage {
    type: "consume";
    roomId: string;
    peerId: string;
    transportId: string;
    producerId: string;
    rtpCapabilities: any; // RTCRtpCapabilities
}

interface UpdatePeerMessage extends BaseMessage {
    type: "updatePeer";
    roomId: string;
    peerId: string;
    info: Record<string, unknown>;
}

type AnyMessage =
    | JoinMessage
    | ConnectTransportMessage
    | ProduceMessage
    | ConsumeMessage
    | UpdatePeerMessage
    | ErrorMessage
    | PeerEventMessage;

// グローバル状態管理
const app = new Hono();
const client = new TakosCallClient({
    url: "ws://localhost:3000/takos-api",
    apiKey: "tako",
});

const sessions = new Map<string, WSContext>();
const peerRooms = new Map<string, string>();
const activePeers = new Set<string>();

// 初期化
await client.connect();

PubSub.subscribe("redis", async (_subpubType: string, message: string) => {
    const data = JSON.parse(message);
});

// WebSocketハンドラー
app.get(
    "/ws",
    upgradeWebSocket((c) => {
        return {
            onOpen: (_e: Event, _ws: WSContext): void => {
                logger.info("WebSocket接続が開かれました");
            },
            onMessage: async (
                e: MessageEvent,
                ws: WSContext,
            ): Promise<void> => {
                try {
                    const data = JSON.parse(e.data as string) as AnyMessage;
                    logger.info(
                        `受信したメッセージタイプ: ${data.type}, ピアID: ${
                            (data as any).peerId || "不明"
                        }`,
                    );

                    switch (data.type) {
                        case "join":
                            await handleJoinRequest(ws, data as JoinMessage);
                            break;
                        case "connectTransport":
                            await handleConnectTransport(
                                ws,
                                data as ConnectTransportMessage,
                            );
                            break;
                        case "produce":
                            await handleProduce(ws, data as ProduceMessage);
                            break;
                        case "consume":
                            await handleConsume(ws, data as ConsumeMessage);
                            break;
                        case "updatePeer":
                            await handleUpdatePeer(
                                ws,
                                data as UpdatePeerMessage,
                            );
                            break;
                        default:
                            sendError(
                                ws,
                                `未対応のメッセージタイプ: ${data.type}`,
                            );
                    }
                } catch (error) {
                    logger.error("メッセージ処理エラー:", error);
                }
            },
            onClose: (_e: CloseEvent, ws: WSContext): void =>
                handleClientDisconnect(ws),
        };
    }),
);

// イベントハンドラー関数
async function handleJoinRequest(
    ws: WSContext,
    data: JoinMessage,
): Promise<void> {
    const { roomId, peerId } = data;

    // バリデーション
    if (!roomId || !peerId) {
        return sendError(ws, "Invalid roomId or peerId");
    }

    if (sessions.get(peerId)) {
        return sendError(ws, "Peer already exists");
    }

    try {
        // ルーム作成または取得
        let roomInfo = await client.getRoomInfo(roomId);
        if (!roomInfo) {
            logger.info(`新しいルーム作成: ${roomId}`);
            roomInfo = await client.createRoom(roomId);
        }

        // ピア存在チェック
        const peerInfo = await client.getPeerInfo(roomId, peerId);
        if (peerInfo) {
            return sendError(ws, "Peer already exists");
        }

        // ピア追加処理
        await client.addPeer(roomId, peerId);
        peerRooms.set(peerId, roomId);
        activePeers.add(peerId);
        sessions.set(peerId, ws);

        logger.info(`ルーム ${roomId} に ${peerId} が参加しました`);
        logger.debug(`現在のアクティブピア: ${[...activePeers].join(", ")}`);

        // トランスポート作成
        const routerRtpCapabilities = await client.getRouterRtpCapabilities(
            roomId,
        );
        const sendTransport = await client.createTransport(
            roomId,
            peerId,
            "send",
        );
        const recvTransport = await client.createTransport(
            roomId,
            peerId,
            "recv",
        );

        // 既存のプロデューサーと参加者情報を収集
        const { producers, participants } = await collectRoomData(
            roomId,
            peerId,
            roomInfo,
        );

        // 応答送信
        ws.send(JSON.stringify({
            type: "joinResponse",
            routerRtpCapabilities,
            sendTransport,
            recvTransport,
            roomInfo,
            producers,
            participants,
        }));

        // 他のピアに参加を通知
        broadcastEvent(roomId, peerId, {
            type: "peerEvent",
            event: "joined",
            peerId: peerId,
            roomId: roomId,
        });
    } catch (error) {
        console.log("エラー:", error);
        sendError(ws, "Failed to update peer info");
    }
}

async function handleConnectTransport(
    ws: WSContext,
    data: ConnectTransportMessage,
): Promise<void> {
    const { roomId, peerId, transportId, dtlsParameters } = data;

    try {
        logger.info(`トランスポート接続リクエスト: ${transportId}`);
        await client.connectTransport(
            roomId,
            peerId,
            transportId,
            dtlsParameters,
        );

        ws.send(JSON.stringify({
            type: "transportConnected",
            transportId: transportId,
        }));
    } catch (error) {
        console.log("エラー:", error);
        sendError(ws, "Failed to update peer info");
    }
}

async function handleProduce(
    ws: WSContext,
    data: ProduceMessage,
): Promise<void> {
    const { roomId, peerId, transportId, kind, rtpParameters } = data;

    try {
        const producer = await client.createProducer(
            roomId,
            peerId,
            transportId,
            kind as "audio" | "video",
            rtpParameters,
        );

        logger.info(
            `新しいプロデューサー作成: ${producer.id}, ピア: ${peerId}, 種類: ${kind}`,
        );
        ws.send(JSON.stringify({
            type: "produced",
            producerId: producer.id,
            kind: kind,
        }));
        broadcastEvent(roomId, peerId, {
            type: "peerEvent",
            event: "newProducer",
            peerId: peerId,
            producerId: producer.id,
            kind: kind,
        });
    } catch (error) {
        console.log("エラー:", error);
        sendError(ws, "Failed to update peer info");
    }
}

async function handleConsume(
    ws: WSContext,
    data: ConsumeMessage,
): Promise<void> {
    const { roomId, peerId, transportId, producerId, rtpCapabilities } = data;

    try {
        const consumer = await client.createConsumer(
            roomId,
            peerId,
            transportId,
            producerId,
            rtpCapabilities,
        );

        ws.send(JSON.stringify({
            type: "consumed",
            consumer: consumer,
            producerId: producerId,
        }));
    } catch (error) {
        console.log("エラー:", error);
        sendError(ws, "Failed to update peer info");
    }
}

async function handleUpdatePeer(
    ws: WSContext,
    data: UpdatePeerMessage,
): Promise<void> {
    const { roomId, peerId, info } = data;
    const peerInfo = info || {};

    try {
        broadcastEvent(roomId, null, {
            type: "peerEvent",
            event: "info",
            peerId: peerId,
            info: peerInfo,
        });

        ws.send(JSON.stringify({
            type: "peerUpdated",
            peerId: peerId,
        }));
    } catch (error) {
        console.log("エラー:", error);
        sendError(ws, "Failed to update peer info");
    }
}

function handleClientDisconnect(ws: WSContext): void {
    for (const [peerId, session] of sessions.entries()) {
        if (session === ws) {
            sessions.delete(peerId);
            activePeers.delete(peerId);

            const roomId = peerRooms.get(peerId);
            if (roomId) {
                logger.info(`ピア退出: ${peerId} (ルーム: ${roomId})`);

                broadcastEvent(roomId, peerId, {
                    type: "peerEvent",
                    event: "left",
                    peerId: peerId,
                    roomId: roomId,
                });

                client.removePeer(roomId, peerId).catch((err) => {
                    logger.error(`ピア削除エラー: ${err.message}`);
                });

                peerRooms.delete(peerId);
            }
            break;
        }
    }
}

// ユーティリティ関数
async function collectRoomData(
    roomId: string,
    currentPeerId: string,
    roomInfo: any,
): Promise<{
    producers: Array<{ id: string; peerId: string; kind: string }>;
    participants: Array<{ id: string; active: boolean }>;
}> {
    const producers: Array<{ id: string; peerId: string; kind: string }> = [];
    const participants: Array<{ id: string; active: boolean }> = [];

    for (const [existingPeerId, peer] of Object.entries(roomInfo.peers)) {
        if (existingPeerId !== currentPeerId) {
            const peerInfo = await client.getPeerInfo(roomId, existingPeerId);
            if (peerInfo) {
                if (activePeers.has(existingPeerId)) {
                    participants.push({
                        id: existingPeerId,
                        active: true,
                    });
                }

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

    return { producers, participants };
}

function broadcastEvent(
    roomId: string,
    excludePeerId: string | null,
    eventData: PeerEventMessage,
): void {
    logger.info(
        `イベントブロードキャスト: ${eventData.type} - ${
            eventData.event || "不明"
        }`,
    );

    for (const [peerId, ws] of sessions.entries()) {
        const peerRoomId = peerRooms.get(peerId);
        if (
            peerRoomId === roomId &&
            (excludePeerId === null || peerId !== excludePeerId)
        ) {
            ws.send(JSON.stringify(eventData));
        }
    }
}

function sendError(ws: WSContext, message: string): void {
    const errorMessage: ErrorMessage = {
        type: "error",
        message,
    };
    ws.send(JSON.stringify(errorMessage));
}

// ロガー
interface Logger {
    info: (message: string, ...args: unknown[]) => void;
    debug: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
}

const logger: Logger = {
    info: (message: string, ...args: unknown[]): void =>
        console.log(`[INFO] ${message}`, ...args),
    debug: (message: string, ...args: unknown[]): void =>
        console.log(`[DEBUG] ${message}`, ...args),
    error: (message: string, ...args: unknown[]): void =>
        console.error(`[ERROR] ${message}`, ...args),
};

// サーバー起動
Deno.serve(app.fetch);
