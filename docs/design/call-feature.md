<!--
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# 通話機能 (WebRTC voice + video) — yurucommu / yurumeet 設計と実装状況

Status: **Phase 1 (core signaling engine + shared CallClient) 実装完了・gates green・test-proven / Phase 2 以降 未着手**（2026-07-16）
Owner: `yurucommu-core`（signaling DO / hub / RtcProvider / transport / CallClient 本体）
Consumers: `yurucommu`, `yurumeet`（通話 UI + deploy 配線）

姉妹設計: [`realtime-websocket-fanout.md`](./realtime-websocket-fanout.md)（トーク/通知の push 化）。両者は **別 DO** で協調する（§11）。

---

## 1. 背景・目的・非目標

yurucommu / yurumeet は現状リアルタイムを全て HTTP polling で得ており、WebRTC/通話は一切存在しない（greenfield）。本機能は両プロダクトに **音声+ビデオ通話** を追加する。

### 確定要件（ユーザー合意）

1. **音声+ビデオ両対応**（単一 WebRTC pipeline、UI で camera on/off）。
2. **SFU 導入可だが Cloudflare 依存不可** — open protocol で SFU を差し替え可能に。
3. **両プロダクト**に展開。
4. **cross-instance が唯一のケース** — 各ユーザーが自分の instance を self-host するため、1:1 通話は必ず別 instance 間 = server-to-server。same-instance-only は無意味。

### 非目標

- グループ通話（SFU）は後続 phase。1:1 = 純 P2P を先行。
- mobile（Tauri）は後続 phase。
- トーク/通知の realtime 化は別設計（[`realtime-websocket-fanout.md`](./realtime-websocket-fanout.md)）。

---

## 2. 設計方針: signaling = federation / media = open protocol

MatrixRTC (MSC4143/4195) の「signaling=federation / media=差し替え可能な SFU focus」分離を ActivityPub に写像し、IETF 標準 **WHIP (RFC 9725)/WHEP** を SFU 接続に使う。これにより **Cloudflare Realtime は数ある adapter の1つ**に降格でき、要件2を満たす。

- **1:1 media** = P2P WebRTC + STUN/**TURN**（coturn 等、env の `iceServers`）。SFU 不要 / Cloudflare 不要。
- **group media（後続）** = WHIP/WHEP adapter 経由の SFU focus。call ごとに選択。
- **local browser への push** = **per-user Signaling Durable Object + Hibernatable WebSocket**（このスタック初の DO）。

### なぜ signaling を ActivityPub inbox に相乗りさせないか（重要な制約）

core の `lib/activitypub-validators.ts` の `parseActivity`/`parseActivityObjectFields` は **非 whitelist field を全 strip**（`sdp`/`candidate` が消える）、`claimActivityForDispatch` は strip 後を永続化する。そのため signaling を inbox pipeline に流すと SDP/ICE が破壊され、かつ ephemeral frame が `activities` ledger を汚す。
→ **専用の署名付き endpoint `POST /ap/rtc/signal`** が inbox pipeline を完全バイパスし、HTTP Signature 認証だけ再利用して Signaling DO に直行する。

---

## 3. アーキテクチャ（3 プレーン）

```
  browser A ─wss─ /api/rtc/socket ─┐                        ┌─ /api/rtc/socket ─wss─ browser B
  (caller)                         ▼                        ▼                        (callee)
                    CALL_SIGNALING.idFromName(A)   CALL_SIGNALING.idFromName(B)
                    per-user Signaling DO (A)  ──► per-user Signaling DO (B)
                              │  signed POST /ap/rtc/signal (server-to-server, HTTP-Sig)  ▲
                              └──────────────  signaling plane (federation)  ─────────────┘

  media plane:  A ◄───────── P2P WebRTC (SRTP) over STUN/TURN ──────────► B   (SFU focus は group 時のみ)
```

- **signaling plane**: cross-instance は `POST /ap/rtc/signal`（署名付き s2s）。local instance→browser は Signaling DO + WebSocket。
- **media plane**: 1:1 は P2P 直結（TURN は NAT 越え relay）。group は WHIP/WHEP SFU focus。
- **DO topology**: per-local-user（`idFromName(actorApId)`）。常設 presence socket + 通話状態機械 + cross-instance signal の fan-in を兼ねる。per-call DO ではない（着信を受ける常設 socket が call object 生成前に必要、glare を1 DO で解決できる）。

---

## 4. Wire contract（単一 source）

`packages/api/src/types/call.ts`。backend（s2s signal 検証）と browser `CallClient` が同一ファイルを参照（DOM-structural 型で両文脈で type-check 可能）。

- **`RtcSignalEnvelopeV1`**（s2s 封筒）: `{ v, callId, from, to, type(offer|answer|candidate|accept|reject|hangup|cancel), media?, sdp?, candidates?, sfuFocus?, reason?, ts, ttlMs }`。`callId` は anti-replay nonce も兼ね、`ts`/`ttlMs` で freshness を縛る。`parseRtcSignalEnvelope()` / `isEnvelopeFresh()` を提供。
- **browser↔DO frames**: `ClientToHubFrame`（hello/invite/offer/answer/candidates/accept/reject/hangup/resume/ping）、`HubToClientFrame`（ready/ringing/offer/answer/candidates/peer-accepted/peer-rejected/peer-hangup/ice-servers/call-state/pong/error）。
- **REST 契約**: `StartCallRequest`/`StartCallResponse`、`IceServersResponse`、`CallSessionSummary`。
- **状態**: `CallState`（idle→ringing→connecting→connected→ended、+ rejected/missed/failed/cancelled）、`isTerminalCallState()`。

---

## 5. Signaling（core）

- **`runtime/call-hub-core.ts` `CallHub`** — runtime 中立の状態機械 + frame router。connection は保持せず（DO の hibernation で失われるため）、host が `HubPort.broadcast`/`hasClients` を提供。calls は host が永続化し `hydrate()` で復元。
  - **glare**（同時発信）: peer-based Perfect Negotiation。2 actor ap_id の辞書順で impolite（低い方）が自分の outgoing を維持、polite（高い方）が自分の outgoing を cancel して incoming を受ける。両者が impolite 側の callId に収束。
  - **timeout**: `tick()` sweep で ringing>45s→missed、connecting>40s→failed。
- **`runtime/call-signaling-do.ts` `CallSignalingDurableObject`** — Hibernatable WebSocket（`state.acceptWebSocket`/`getWebSockets`）。call metadata を DO storage に持ち hibernation 越しに rehydrate。CF/DO 固有 API は file-local 型で workers-types のバージョン差から切り離す。`/_ws`（upgrade）/`/_ingest`（s2s signal 流入）。`alarm()` で tick。
- **`runtime/signaling-hub.ts` `ISignalingHub`** — seam。`CloudflareSignalingHub`（DO stub 転送）/ `LocalSignalingHub`（bun in-process、`attach/message/detach` API 実装済み・server.ts 配線は後続）/ `getSignalingHub(env)` factory / `isSignalingAvailable(env)`。
- **`runtime/call-hub-port.ts`** — DO と local hub 共有の `HubPort` 構築（signer lazy load、`RtcProvider`、`call_sessions` persist）。
- **`lib/rtc/signal-transport.ts` `sendCallSignal`** — `signRequest`+`fetchWithTimeout` の**直接署名 POST**（queued delivery を使わない: ephemeral SDP に backoff/circuit-breaker は不適）。peer endpoint は actor doc の `endpoints.rtcSignal` → fallback で `<inbox-origin>/ap/rtc/signal`。
- **`lib/rtc/call-store.ts`** — `call_sessions` upsert/list/get（history/missed-call）。

---

## 6. Media / RtcProvider（= Cloudflare 非依存の実体）

`lib/rtc/provider.ts` `RtcProvider`:

- `getIceServers()` — env `YURUCOMMU_RTC_ICE_SERVERS`（静的 STUN/TURN JSON）＋ coturn REST 短命 cred（`YURUCOMMU_RTC_TURN_URIS`/`_TURN_SECRET`/`_TURN_TTL`、HMAC-SHA1、static long-lived cred を配らない）。
- `getSfuFocus(media)` — `YURUCOMMU_RTC_SFU_ADAPTER`（default `p2p`=null）。`whip`/`livekit`/`cloudflare-realtime` は WHIP/WHEP focus。**1:1 は SFU config 不要**。group 用 token 実発行は Phase 3。

env は `EnvVars`（`types.ts`）に追加済み。secret（`_TURN_SECRET`/`_SFU_TOKEN` 等）は operator が wrangler secret / OpenTofu で注入。

---

## 7. Server 配線（core）

- routes `routes/rtc/index.ts`（`index.ts` の `mountCoreRoutes` に `app.route("/", rtcRoutes)`）:
  - `POST /ap/rtc/signal` — s2s ingest。`verifyHttpSignature` → `signingActorFromKeyId`/`isActorMismatch` で signer===from を強制 → 受信者が local actor か確認 → sender が block 済みなら silently drop → `getSignalingHub().deliver`。per-IP rate-limit（`federationDiscovery`）。
  - `POST /api/rtc/ticket` — 通常の認証済みfetch（cookie / bearer）で、対象userのCall DO内に約60秒・一回限りのticketを発行。
  - `GET /api/rtc/socket` — browser WS upgrade。`?actor=&ticket=`を必須とし、Call DO自身が検証・読み込む。cookie-at-upgrade経路は持たない。
  - `GET /api/rtc/ice` — 短命 ICE 発行。
  - `POST /api/rtc/calls` — 発信開始。双方向 block-list gate → `{callId, iceServers, sfuFocus}`。
  - `GET /api/rtc/calls[/:id]` — history / current state。
- `index.ts` の重要修正:
  - **101 WS response の security-header 保護**（`if (c.res.status === 101) return;`。101 のヘッダ変更は upgrade を壊す）。
  - **Permissions-Policy `camera=(self) microphone=(self)`**（旧 `camera=() microphone=()` は getUserMedia を全面ブロックしていた）。CSP は既に `connect-src ... wss:` を許可済み。
- `Env` に `CALL_SIGNALING?: DurableObjectNamespace`（`wrapCloudflareBindings` を `...rest` で素通り）。`WorkerBindings`（raw）にも追加。`public.ts` から `CallSignalingDurableObject` を re-export。
- actor doc に `endpoints.rtcSignal` を advertise（未対応 peer は inbox origin から導出）。

通話とrealtimeは同じ `one-time-ticket.ts` primitiveを使う。ticketは平文を保存せずSHA-256 hashだけを対象userのDOに保存し、約60秒で失効、検証時に先に削除する。browser WebSocket APIがAuthorization headerを設定できなくても、Yurumeet/mobileはbearer付きticket fetchから安全に接続できる。

---

## 8. Client（共有 CallClient）

`packages/api/src/lib/rtc-client.ts` `CallClient`（framework 非依存、`@takosjp/yurucommu-api` から export）:

- 共通`ApiTransport`経由でone-time ticketを取得してからWS connect/reconnect（指数バックオフ）、`hello`/`resume`。cookieとbearerの両transportで同じ経路を使う。
- `RTCPeerConnection` lifecycle、`getUserMedia({audio, video})`、half-trickle ICE（~200ms flush）、caller=offer / callee=answer。
- event emitter: `state/incoming/localstream/remotestream/muted/cameraoff/error`。
- API: `startCall(peer, media)` / `accept()` / `reject()` / `hangup()` / `setMuted()` / `setCameraEnabled()`。
- single-active-call（2つ目の着信は自動 busy reject）。camera on/off は track enable 切替（mid-call 再ネゴ無し = PC-level glare 無し）。

各プロダクトはこれを自分の state 層で wrap する（yurumeet=signals+context、yurucommu=jotai）。**未実装**（Phase 2）。

---

## 9. Product / deploy 配線（未実装）

以下は通話を採用するproductが所有する未実装作業である。現行の`yurucommu`/`yurumeet`はこの配線を持たない。

1. `public.ts` の DO re-export（Core側は済）に加え、各 `scripts/build-*-worker.ts` の生成entryから `CallSignalingDurableObject` をre-exportし、`CALL_SIGNALING?: DurableObjectNamespace`をbinding型へ追加する。
2. 各 `wrangler.jsonc` に `CALL_SIGNALING` binding、`new_sqlite_classes` migration、RTC vars/secretを追加する。
3. 各 `main.tf`/`outputs.tf` にDO namespace binding、migration、RTC用variable/connectionを追加する。
4. **realtime-websocket-fanout と同時に DO を足す場合**、`migrations` の `new_sqlite_classes` は両クラスを1 tag で宣言し tag 競合を避ける。

---

## 10. 実装状況（2026-08-09 current source）

**DONE — Phase 1 core engine（session 1、gates green）**:

- wire contract / `CallHub` / `CallSignalingDurableObject` / `ISignalingHub` seam / port factory / `RtcProvider` / `signal-transport` / `call-store` / routes / `call_sessions` schema + migration `0020` / DO re-export / 共有 `CallClient`。
- index.ts: Env+binding+RTC env+route mount+rate-limit+101 guard+Permissions-Policy 修正。shim に DO 型。
- **test**: `__tests__/rtc/call-hub.test.ts` 6/6 green（full 1:1 / reject / glare / stale-TTL / timeout）。
- actor文書の`endpoints.rtcSignal`は`CALL_SIGNALING` bindingがあるdeploymentだけで広告する。未配線productは存在しないcapabilityをremote peerへ宣言しない。

**未実装 — Product UI / deploy wiring**:

1. 現行`yurucommu`/`yurumeet`のsourceには`CallClient`利用、call context/overlay/button、通話i18nが存在しない。
2. 現行の生成Worker entry、`wrangler.jsonc`、`main.tf`に`CALL_SIGNALING`/`CallSignalingDurableObject`配線は存在しない。
3. したがってCoreのprotocol testはgreenでも、どちらのproductにもユーザーが利用できる通話surfaceはなく、2-instance browser E2Eを成功したとは扱えない。
4. 以前この文書にあった「Phase 2 UI/deploy配線済み」という記録はcurrent sourceと一致しないため撤回した。実装する場合はproduct側の正本 (正とする情報)・差分・owner gateを証拠とする。

**残**:

1. 各productが通話を採用するかを決め、採用するproductでUIと§9のruntime/Capsule配線を実装する。
2. 配線後に2 instance + Chrome fake-deviceで1:1音声+ビデオ / mute / camera / hangupをE2E検証する。
3. bun WS local hub のserver.ts配線（非CF self-host。`LocalSignalingHub.attach/message/detach`は実装済み）。
4. ~~WS認証をrealtime側の短命ticket方式にunify~~ — 2026-08-09に共通one-time-ticket primitiveで完了。
5. 採用後のPhase 3 group SFU（WHIP/WHEP token実発行）、Phase 4 Tauri mobile（`call.incoming` push category）。

---

## 11. realtime-websocket-fanout との関係

- **別 DO**。通話は RTC 専用 `CallSignalingDurableObject`、トーク/通知 push は別 `RealtimeStreamDO`（[`realtime-websocket-fanout.md`](./realtime-websocket-fanout.md) §1 非目標・§4 で明記）。相乗りしない。
- 共有パターン: hibernatable WS DO の雛形は本設計の `call-signaling-do.ts`（realtime doc が「雛形」として参照）、CF/in-process seam は `signaling-hub.ts` の `getSignalingHub` と同型。
- WS認証も整合済み。realtimeと通話はendpoint/DOを分離したまま、同じ短命・一回限りticket primitiveを共有する。deploy では2 DO を同一 `migrations` tag で宣言。

---

## 12. リスク / 対策

| リスク                                                | 対策                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2 self-host instance 間の NAT 越え                    | coturn を必須の env-config provider として短命 REST cred を発行、half-trickle ICE。TURN が通話成否の最大要因（default、optional ではない） |
| DO はスタック初の stateful primitive・Cloudflare-only | `ISignalingHub` seam + `LocalSignalingHub`（bun in-process）で非 CF self-host も担保。media は WHIP/TURN で完全ベンダー中立                |
| signaling が AP ledger に漏れる/破壊される            | 専用 `/ap/rtc/signal` が activity pipeline を完全バイパス。SDP/ICE は `activities`/`objects` に触れず `call_sessions` のみ                 |
| replay / abuse                                        | HTTP Signature（keyId-owner===from）+ 双方向 block-list + invite rate-limit + `callId` nonce + 短 TTL                                      |
| callee offline / tab closed                           | Signaling DO が主経路。push-gateway で端末 wake（現状 gateway 未設定で dormant、operator 設定時のみ）。SDP は push で運ばない              |
| cross-origin（yurumeet 別 serverOrigin）の cookie     | bearer/cookie対応の認証済みfetchでone-time ticketを発行し、Call DOが検証・consume                                                          |

---

## 付録: 新規/変更ファイル

**yurucommu-core（session 1 で実装済み）**

- 新規: `packages/api/src/types/call.ts`, `packages/api/src/lib/rtc-client.ts`, `src/backend/runtime/call-hub-core.ts`, `.../call-signaling-do.ts`, `.../signaling-hub.ts`, `.../call-hub-port.ts`, `src/backend/lib/rtc/{provider,signal-transport,call-store}.ts`, `src/backend/routes/rtc/index.ts`, `src/db/schema/calls.ts`, `migrations/0020_call_sessions.sql`, `src/backend/__tests__/rtc/call-hub.test.ts`
- 変更: `src/backend/types.ts`, `src/backend/index.ts`, `src/backend/public.ts`, `src/backend/routes/activitypub.ts`, `src/db/schema/index.ts`, `shims/cloudflare-globals.d.ts`, `packages/api/src/index.ts`, `packages/api/src/types/index.ts`, `package.json`

**yurumeet / yurucommu（Phase 2 未実装）**

- 変更: `scripts/build-*-worker.ts`, `wrangler.jsonc`, `main.tf`, `outputs.tf`
- 新規: UI（context/atoms + overlays + call button）
