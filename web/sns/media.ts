import { Hono } from "hono";
import { downloadFile } from "../../utils/S3Client.ts";

const app = new Hono();

app.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!id) {
        return c.body("File not found", 404);
    }

    try {
        const file = await downloadFile(`posts/${id}`);
        if (!file) {
            return c.body("File not found", 404);
        }

        // ファイルがbase64文字列として返された場合、バイナリデータに変換する
        let binaryData;
        if (typeof file === "string") {
            // 典型的なbase64プレフィックス（例：data:image/jpeg;base64,）を除去
            const base64Data = file.includes(",") ? file.split(",")[1] : file;

            try {
                // base64をバイナリデータに変換
                binaryData = Uint8Array.from(
                    atob(base64Data),
                    (c) => c.charCodeAt(0),
                );
            } catch (error) {
                console.warn("Failed to decode as base64:", error);
                binaryData = file; // デコードに失敗した場合は元のデータを使用
            }
        } else {
            // すでにバイナリデータの場合はそのまま使用
            binaryData = file;
        }

        // 画像として返す
        return new Response(binaryData, {
            headers: {
                "Content-Type": "image/jpeg", // 画像タイプに応じて調整
            },
        });
    } catch (error) {
        console.error("Error serving image:", error);
        return c.body("Error serving image", 500);
    }
});

export default app;
