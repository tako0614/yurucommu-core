import { createBaseApp, env } from "./base.ts";
import Message from "../../models/message.ts";
import { downloadFile } from "../../utils/S3Client.ts";

const app = createBaseApp();

app.get("message/:messageId", async (c) => {
    const messageId = c.req.param("messageId");
    if (messageId.split("@")[1] !== env["domain"]) {
        return c.json({
            error: "Invalid messageId",
        }, 400);
    }
    const message = await Message.findOne({
        messageid: messageId,
    });
    if (!message) {
        return c.json({ error: "Invalid messageId" }, 400);
    }
    if (!message.isLarge) {
        return c.json({
            message: message.message,
            signature: message.sign,
            timestamp: message.timestamp.getTime(),
            userName: message.userName,
        });
    } else {
        try {
            const messageContent = await downloadFile(messageId);
            //Content-Lengthを返す
            c.header("Content-Length", messageContent.length.toString());
            return c.json({
                message: messageContent,
                signature: message.sign,
                timestamp: message.timestamp.getTime(),
                userName: message.userName,
            });
        } catch (_error) {
            return c.json({ error: "Invalid messageId" }, 400);
        }
    }
});

export default app;
