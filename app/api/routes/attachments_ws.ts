import { extname } from "@std/path";
import type { Context } from "hono";
import {
  registerBinaryHandler,
  registerCloseHandler,
  registerMessageHandler,
  registerOpenHandler,
} from "./ws.ts";
import { createDB } from "../DB/mod.ts";
import {
  createStorage,
  type ObjectStorage,
} from "../services/object-storage.ts";
import { getEnv } from "../../shared/config.ts";

let storage: ObjectStorage;
export async function initAttachmentWsModule(env: Record<string, string>) {
  const db = createDB(env);
  storage = await createStorage(env, db);
}

export function initAttachmentWebSocket() {
  registerOpenHandler((_ws, state) => {
    state.chunks = [];
    state.fileMeta = undefined;
    state.storageKey = undefined;
  });

  registerMessageHandler("file-meta", (payload, ws, state) => {
    const data = payload as {
      originalName: string;
      mediaType?: string;
      key?: string;
      iv?: string;
    };
    if (!data || !data.originalName) {
      ws.close(1003, "Invalid metadata payload");
      return;
    }
    const ext = extname(data.originalName);
    state.fileMeta = data;
    state.chunks = [];
    state.storageKey = `${crypto.randomUUID()}${ext}`;
    ws.send(JSON.stringify({ status: "ready for binary" }));
  });

  registerMessageHandler("file-finish", async (_payload, ws, state) => {
    const c = state.context as Context;
    const env = getEnv(c);
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
    const meta = state.fileMeta as {
      originalName: string;
      mediaType?: string;
      key?: string;
      iv?: string;
    } | undefined;
    const key = state.storageKey as string | undefined;
    const chunks = state.chunks as Uint8Array[];
    if (!meta || !key || chunks.length === 0) {
      ws.close(1003, "No data");
      return;
    }
    const data = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
    let offset = 0;
    for (const ch of chunks) {
      data.set(ch, offset);
      offset += ch.length;
    }
    await storage.put(`files/${key}`, data);
    const db = createDB(env);
    const obj = await db.saveObject({
      type: "Attachment",
      attributedTo: `https://${domain}/system`,
      extra: {
        mediaType: meta.mediaType ?? "application/octet-stream",
        key: meta.key,
        iv: meta.iv,
        storageKey: `files/${key}`,
      },
    });
    ws.send(
      JSON.stringify({
        status: "uploaded",
        url: `https://${domain}/api/files/${obj._id}`,
      }),
    );
  });

  registerBinaryHandler((payload, ws, state) => {
    if (!state.fileMeta) {
      ws.close(1003, "Not ready for binary data");
      return;
    }
    const chunks = state.chunks as Uint8Array[];
    chunks.push(new Uint8Array(payload as ArrayBuffer));
  });

  registerCloseHandler((_ws, state) => {
    state.chunks = [];
    state.fileMeta = undefined;
    state.storageKey = undefined;
  });
}
