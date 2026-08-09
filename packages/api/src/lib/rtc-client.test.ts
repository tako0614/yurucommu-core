import { expect, test } from "bun:test";

import { CallClient } from "./rtc-client.ts";
import {
  clearYurucommuApiTransport,
  setYurucommuApiTransport,
} from "./transport.ts";

test("CallClient mints a bearer-authenticated ticket before opening its socket", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    credentials: RequestCredentials | undefined;
  }> = [];
  const sockets: string[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    readonly readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(url: string | URL) {
      sockets.push(String(url));
    }

    send(): void {}
    close(): void {}
  }

  try {
    setYurucommuApiTransport({
      credentials: "omit",
      resolveUrl(path) {
        return new URL(path, "https://server.example/").toString();
      },
      getAuthHeaders() {
        return { authorization: "Bearer mobile-session" };
      },
    });
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get("authorization"),
        credentials: init?.credentials,
      });
      return Response.json({
        ticket: "one-time-call-ticket",
        actor_ap_id: "https://server.example/ap/users/owner",
      });
    }) as typeof fetch;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const client = new CallClient();
    client.connect();
    for (let attempt = 0; attempt < 20 && sockets.length === 0; attempt++) {
      await Bun.sleep(1);
    }

    expect(requests).toEqual([
      {
        url: "https://server.example/api/rtc/ticket",
        method: "POST",
        authorization: "Bearer mobile-session",
        credentials: "omit",
      },
    ]);
    expect(sockets).toHaveLength(1);
    const socket = new URL(sockets[0]!);
    expect(socket.origin).toBe("wss://server.example");
    expect(socket.pathname).toBe("/api/rtc/socket");
    expect(socket.searchParams.get("actor")).toBe(
      "https://server.example/ap/users/owner",
    );
    expect(socket.searchParams.get("ticket")).toBe("one-time-call-ticket");

    client.disconnect();
  } finally {
    clearYurucommuApiTransport();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("CallClient preserves the initial invite and offer until the ticket socket opens", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalNavigator = globalThis.navigator;
  const originalPeerConnection = globalThis.RTCPeerConnection;
  const sockets: FakeCallSocket[] = [];

  class FakeCallSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    readyState = FakeCallSocket.CONNECTING;
    readonly sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
      sockets.push(this);
    }

    send(data: string): void {
      this.sent.push(JSON.parse(data));
    }

    open(): void {
      this.readyState = FakeCallSocket.OPEN;
      this.onopen?.();
    }

    close(): void {}
  }

  class FakePeerConnection {
    connectionState = "new";
    onicecandidate: ((event: { candidate: null }) => void) | null = null;
    ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;

    addTrack(): void {}
    async createOffer(): Promise<RTCSessionDescriptionInit> {
      return { type: "offer", sdp: "offer-sdp" };
    }
    async setLocalDescription(): Promise<void> {}
    getSenders(): RTCRtpSender[] {
      return [];
    }
    close(): void {}
  }

  try {
    setYurucommuApiTransport({
      credentials: "include",
      resolveUrl(path) {
        return new URL(path, "https://server.example/").toString();
      },
      getAuthHeaders() {
        return {};
      },
    });
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/rtc/calls") {
        return Response.json({ callId: "call-1", iceServers: [] });
      }
      if (url.pathname === "/api/rtc/ticket") {
        return Response.json({
          ticket: "ticket-1",
          actor_ap_id: "https://server.example/ap/users/owner",
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    globalThis.WebSocket = FakeCallSocket as unknown as typeof WebSocket;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          async getUserMedia() {
            return {
              getTracks: () => [],
              getAudioTracks: () => [],
              getVideoTracks: () => [],
            };
          },
        },
      },
    });
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;

    const client = new CallClient();
    await client.startCall("https://peer.example/ap/users/alice", {
      audio: true,
      video: false,
    });
    for (let attempt = 0; attempt < 20 && sockets.length === 0; attempt++) {
      await Bun.sleep(1);
    }
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent).toEqual([]);

    sockets[0]!.open();
    expect(sockets[0]!.sent.map((frame) => (frame as { t: string }).t)).toEqual(
      ["hello", "invite", "offer"],
    );
    client.disconnect();
  } finally {
    clearYurucommuApiTransport();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    globalThis.RTCPeerConnection = originalPeerConnection;
  }
});
