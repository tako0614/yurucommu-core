/** Native Cloudflare transport/storage adapter for the shared call runtime. */
import { getDb } from "../../db/index.ts";
import type { EnvVars } from "../types.ts";
import { createCallHubPort } from "./call-hub-port.ts";
import {
  CallSignalingRuntime,
  type CallSocket,
} from "./call-signaling-runtime.ts";
import type { OneTimeTicketStorage } from "./one-time-ticket.ts";

interface DoSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
interface DoState {
  acceptWebSocket(socket: DoSocket): void;
  getWebSockets(): DoSocket[];
  readonly storage: OneTimeTicketStorage & {
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
  };
}
declare const WebSocketPair: { new (): { 0: DoSocket; 1: DoSocket } };
type CallDoEnv = EnvVars & {
  DB: D1Database;
  CALL_SIGNALING?: DurableObjectNamespace;
};

export class CallSignalingDurableObject {
  private readonly runtime: CallSignalingRuntime;
  constructor(state: DoState, env: CallDoEnv) {
    this.runtime = new CallSignalingRuntime(
      state.storage,
      {
        list: async () => state.getWebSockets().map(wrap),
        accept: async () => {
          const pair = new WebSocketPair();
          state.acceptWebSocket(pair[1]);
          return new Response(null, {
            status: 101,
            webSocket: pair[0],
          } as ResponseInit);
        },
        getAlarm: () => state.storage.getAlarm(),
        setAlarm: (at) => state.storage.setAlarm(at),
      },
      (actor, clients) =>
        createCallHubPort({
          localActorApId: actor,
          db: getDb(env.DB),
          env,
          ...clients,
        }),
    );
  }
  fetch(request: Request): Promise<Response> {
    return this.runtime.fetch(request);
  }
  webSocketMessage(
    socket: DoSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    return this.runtime.message(wrap(socket), message);
  }
  async webSocketClose(socket: DoSocket): Promise<void> {
    wrap(socket).close();
  }
  async webSocketError(): Promise<void> {
    /* Native enumeration excludes failed sockets. */
  }
  alarm(): Promise<void> {
    return this.runtime.alarm();
  }
}
function wrap(socket: DoSocket): CallSocket {
  return {
    send: (data) => {
      try {
        socket.send(data);
      } catch {
        /* Native socket gone. */
      }
    },
    close: (code, reason) => {
      try {
        socket.close(code, reason);
      } catch {
        /* Already closing. */
      }
    },
  };
}
export type { RtcSignalEnvelopeV1 } from "../../../packages/api/src/types/call.ts";
