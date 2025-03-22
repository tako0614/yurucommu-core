import { zValidator } from "@hono/zod-validator";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
import { z } from "zod";
import friends from "../../models/users/friends.ts";
import { load } from "@std/dotenv";
import { isValidMessage } from "@takos/takos-encrypt-ink";
import Message from "../../models/message.ts";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { fff } from "../../utils/foundationReq.ts";
import publish from "../../utils/redisClient.ts";
import { Channels, Member } from "../../models/groups/groups.ts";
import { getUserPermission } from "../../utils/getUserPermission.ts";
import { uploadFile } from "../../utils/S3Client.ts";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

// メッセージ作成の共通関数
async function createMessage(
    userId: string,
    roomId: string,
    message: string,
    sign: string | undefined,
    isLarge: boolean,
    isEncrypted: boolean,
    channelId?: string,
): Promise<string> {
    const messageid = uuidv7() + "@" + env["domain"];
    const timestamp = new Date();

    const messageData: any = {
        userName: userId,
        timestamp,
        roomId,
        messageid,
        isEncrypted,
        isSigned: isEncrypted,
        sign,
        isLarge,
    };

    if (channelId) {
        messageData.channelId = channelId;
    }

    if (isLarge) {
        await Message.create(messageData);
        await uploadFile(messageid, message);
    } else {
        messageData.message = message;
        await Message.create(messageData);
    }

    return messageid;
}

function notifyExternalDomains(
    event: string,
    userId: string,
    messageId: string,
    roomId: string,
    roomType: string,
    domains: string[],
    channelId?: string,
) {
    return fff(
        JSON.stringify({
            event,
            eventId: uuidv7(),
            payload: {
                userId,
                messageId,
                roomId,
                roomType,
                channelId,
            },
        }),
        domains,
    );
}

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            roomId: z.string(),
            message: z.string(),
            sign: z.string().optional(),
            type: z.string(),
            channelId: z.string().optional(),
            isEncrypted: z.boolean(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }

        const { roomId, message, sign, type, channelId, isEncrypted } = c.req
            .valid(
                "json",
            );
        const parsedMessage = JSON.parse(message);
        const isLarge = parsedMessage.isLarge;
        const userId = user.userName + "@" + env["domain"];
        if (isEncrypted) {
            if (!sign) {
                return c.json(
                    { message: "Cannot sign and encrypt at the same time" },
                    400,
                );
            }
        }

        // メッセージの検証
        if (!isValidMessage(message)) {
            return c.json({ message: "Invalid message format" }, 400);
        }

        if (type === "friend") {
            // フレンドタイプのメッセージ処理
            if (!friends.findOne({ userName: userId, friendId: roomId })) {
                return c.json({ message: "Not a friend with this user" }, 401);
            }
            const messageid = await createMessage(
                userId,
                roomId,
                message,
                sign,
                isLarge,
                isEncrypted,
            );

            // 大きなメッセージでない場合は通知を送信
            if (!isLarge) {
                publish({
                    type: "message",
                    users: [userId, roomId],
                    data: JSON.stringify({
                        messageid,
                        timestamp: new Date(),
                        userName: userId,
                        roomid: roomId,
                    }),
                    subPubType: "client",
                });

                // 外部ドメインへの通知
                if (roomId.split("@")[1] !== env["domain"]) {
                    const res = await notifyExternalDomains(
                        "t.message.send",
                        userId,
                        messageid,
                        roomId,
                        "friend",
                        [roomId.split("@")[1]],
                    );

                    if ("error" in res) {
                        return c.json({ message: res.error }, 500);
                    }
                    if (res[0].status !== 200) {
                        return c.json({
                            message:
                                "Failed to send message to external domain",
                        }, 500);
                    }
                }
            }

            return c.json({ messageId: messageid }, 200);
        }

        if (type === "group") {
            // グループタイプのメッセージ処理
            const match = roomId.match(/^g\{([^}]+)\}@(.+)$/);
            if (!match) {
                return c.json({ error: "Invalid group roomId format" }, 400);
            }

            const groupName = match[1];
            const domainFromRoom = match[2];
            const groupId = groupName + "@" + domainFromRoom;

            if (!channelId) {
                return c.json(
                    { message: "Channel ID is required for group messages" },
                    400,
                );
            }

            // グループメンバーシップの確認
            if (!await Member.findOne({ groupId, userId })) {
                return c.json({ message: "Not a member of this group" }, 401);
            }

            // チャンネルの存在確認
            if (!await Channels.findOne({ id: channelId })) {
                return c.json({ message: "Channel not found" }, 404);
            }

            // 権限チェック
            const permission = await getUserPermission(
                userId,
                groupId,
                channelId,
            );
            if (
                !permission.includes("SEND_MESSAGE") &&
                !permission.includes("ADMIN")
            ) {
                return c.json({
                    message: "No permission to send messages in this channel",
                }, 403);
            }

            const messageid = await createMessage(
                userId,
                roomId,
                message,
                sign,
                isLarge,
                isEncrypted,
                channelId,
            );

            // メンバーリストの取得とフィルタリング
            const members = await Member.find({ groupId });
            const memberIds = members.map((member) => member.userId);

            // ドメイン別のメンバー処理
            const membersByDomain = memberIds.filter((id) =>
                id.split("@")[1] === env["domain"]
            );
            const externalDomains = [
                ...new Set(memberIds.map((id) => id.split("@")[1])),
            ].filter(
                (domain) => domain !== env["domain"],
            );

            // 同じドメインのメンバーへ通知
            publish({
                type: "message",
                users: membersByDomain,
                data: JSON.stringify({
                    messageid,
                    timestamp: new Date(),
                    userName: userId,
                    roomid: roomId,
                    channelId,
                }),
                subPubType: "client",
            });

            // 他のドメインにも通知
            if (!isLarge && externalDomains.length > 0) {
                await notifyExternalDomains(
                    "t.message.send",
                    userId,
                    messageid,
                    roomId,
                    "group",
                    externalDomains,
                    channelId,
                );
            }
            return c.json({ messageId: messageid }, 200);
        }
        return c.json({ message: "Invalid message type" }, 400);
    },
);

export default app;
