import { extname } from "@std/path";
import type { Context } from "hono";
import {
  registerBinaryHandler,
  registerCloseHandler,
  registerMessageHandler,
  registerOpenHandler,
} from "./ws.ts";
import { getEnv } from "../../shared/config.ts";
import { initFileService, saveFile } from "../services/file.ts";

export async function initAttachmentWsModule(env: Record<string, string>) {
  await initFileService(env);
}

export function initAttachmentWebSocket() {
  registerOpenHandler((_ws, state) => {
    state.chunks = [];
    state.fileMeta = undefined;
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
    state.fileMeta = data;
    state.chunks = [];
    ws.send(JSON.stringify({ status: "ready for binary" }));
  });

  registerMessageHandler("file-finish", async (_payload, ws, state) => {
    const c = state.context as Context;
    const env = getEnv(c);
    const meta = state.fileMeta as {
      originalName: string;
      mediaType?: string;
      key?: string;
      iv?: string;
    } | undefined;
    const ext = meta ? extname(meta.originalName) : "";
    const chunks = state.chunks as Uint8Array[];
    if (!meta || chunks.length === 0) {
      ws.close(1003, "No data");
      return;
    }
    const data = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
    let offset = 0;
    for (const ch of chunks) {
      data.set(ch, offset);
      offset += ch.length;
    }
    const { url } = await saveFile(data, env, {
      mediaType: meta.mediaType ?? "application/octet-stream",
      key: meta.key,
      iv: meta.iv,
      ext,
    });
    ws.send(JSON.stringify({ status: "uploaded", url }));
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
  });
}
