<!--
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Realtime WebSocket fanout — yurucommu / yurumeet トークとアプリ内ポーリング全廃 設計

Status: **実装完了・E2E 検証済み**（2026-07-16、core/api 3.4.0 として npm publish 済み）
Owner: `yurucommu-core`（DO / hub / emit / WS client 本体）
Consumers: `yurucommu`, `yurumeet`（クライアント配線 + deploy 配線）

> **実装時の確定事項（設計との差分・具体化）**
>
> - チケットは KV ではなく**ユーザー自身の stream DO の storage** に保存（強整合・one-time consume を DO 内でアトミックに実施）。socket URL は `?actor=<apId>&ticket=<one-time>`（actor は「どの DO がチケットを検証するか」の選択にのみ使われ、偽装は検証失敗になる）。同一オリジンの session cookie がある場合はチケット不要の session 経路も許可。
> - イベント id は DO storage の per-user 単調 seq。ring buffer は 200 件、`hello{lastEventId}` で差分 replay、超過時 `resync`。
> - heartbeat は client→`ping`/server→`pong`（25s間隔、60s 無応答で再接続）。alarm 不使用。
> - community chat は inbox 行を作らないため sweep に乗らず、**送信 route から local member（cap 200）へ直接 emit**。
> - リモート(連合)相手の DM 本文は talk.message emit が無いため、クライアントは `unread` イベント受信時に開いているスレッドを 1 回 refetch して追随する。
> - notification sweep は `notification_push_jobs.createdAt` の per-isolate カーソルで新規行の actor を検出（choke point 2 箇所: post-response waitUntil / queue consumer tail）。
> - フォールバックポーリング: yurumeet = メッセージ 15s / 連絡先 60s / バッジ 60s、yurucommu = メッセージ 15s / バッジ 60s / typing 4s。いずれも WS connected 中は発火しない。
> - deploy: `calls-v1`（並行作業で追加済みだった CallSignalingDurableObject 配線）と統合し、tf 側は `realtime-v1` 1 step で両クラスを宣言。wrangler.jsonc は tag 2 段（calls-v1 → realtime-v1）。compat date default を 2026-07-16 に統一。
> - 検証: core 854 tests green（新規 realtime 7 tests 含む）、両プロダクト gates green、**workerd (wrangler dev --local) で login → ticket → WS → hello_ok → サーバ emit → `unread` 受信 → チケット再利用 401 の E2E PASS**。

---

## 1. 背景と目的

現状 yurucommu / yurumeet の web クライアントは、リアルタイム性をすべて **短周期ポーリング**で得ている:

| プロダクト | ポーリング | 場所 |
|---|---|---|
| yurumeet | トークメッセージ + タイピング 4s | `src/lib/chat-context.tsx` (`POLL_MS=4000`, :336-381) |
| yurumeet | 連絡先 20s | 同 (`CONTACTS_POLL_MS=20000`, :386-392) |
| yurumeet | 未読バッジ 20s | `src/main.tsx` (`refreshBadges`, :82-90 / interval :92-104) |
| yurucommu | 通知バッジ 30s | `src/hooks/useNotificationPolling.ts` → `useUnreadPolling` |
| yurucommu | DM バッジ 30s | `src/hooks/useDmUnreadPolling.ts` |
| yurucommu | DM メッセージ + タイピング 4s | `src/components/dm/DMChatPanel.tsx` (`MESSAGE_POLL_MS=4000`, :32/:238-333) |

WebSocket / SSE は現状**一切存在しない**（意図的にポーリングのみ）。

**目的**: トークを本来あるべき push 型（サーバ→クライアント）にし、同じ1本の接続に通知・未読も相乗りさせ、**アプリ内の定常ポーリングを全廃**する。

### 非目標
- 通話 (RTC) シグナリングの置き換え（`CallSignalingDurableObject` は別 DO のまま）。
- Web Push / native push（gateway モデル）の変更。realtime WS は「アプリを開いている間」を担い、push は「閉じている間」を担う二層構成を維持する。
- Cloudflare Workers 以外の transport（SSE 等）。DO WebSocket に一本化する。

---

## 2. 前提（grounding 調査で確定した事実）

1. **hibernatable WS DO の雛形が repo 内に既存**: `src/backend/runtime/call-signaling-do.ts` の `CallSignalingDurableObject`（per-actor `idFromName`、`state.acceptWebSocket`、`getWebSockets()` broadcast、`alarm()`）。
2. **汎用 fanout DO のお手本が takos に既存**: `takos/src/worker/runtime/durable-objects/notifier-base.ts` の `NotifierBase`（per-user WS + ring-buffer replay + `/emit` `/events` `/state` + heartbeat + stale cleanup）。emit フックは `takos/.../notifications/service.ts:674-686`（DB 挿入成功後に best-effort emit、失敗は warn で握り潰す）。
3. **CF / in-process 切替の seam が既存**: `src/backend/runtime/signaling-hub.ts` の `getSignalingHub(env)` は `env.CALL_SIGNALING` の有無で `CloudflareSignalingHub` / `LocalSignalingHub` を返す。realtime も同型で書ける。
4. **認証再利用ポイント**: `src/backend/lib/session-actor.ts` の `extractActorFromSession(c)` / `rawSessionCredential(c)`。actor 一意キーは `actor.ap_id`（= `actorApId`）。
5. **未読カウントの権威クエリが既存**: `src/backend/lib/unread-counts.ts` の `yurumeUnreadCounts(db, apId)` → `{ total, dm, community }`（push バッジと共有、indexed）。
6. **DM 送信 = batch 挿入**: `src/backend/routes/dm/messages.ts:542-582`。ローカル受信者へ `inbox` 行を挿入 (:570-573)。クライアント返却 shape は `{ message, conversation_id }` (:604-614)。
7. **conversation ID**: `src/backend/routes/dm/query-helpers.ts` の `getConversationId(baseUrl, ap1, ap2)`（2 AP-ID をソート→連結→base64url、決定的・衝突フリー）。
8. **通知/フェデレーション flush の choke point**: post-response `waitUntil` ミドルウェア `src/backend/index.ts:571-611`（mutating 時 `enqueuePendingNotificationPushJobs`）と、queue consumer 末尾 `src/backend/lib/delivery/queue.ts:526-533`。inbox の DB トリガー (`0019_notification_push_delivery.sql`) からは DO を呼べないため、この2点に emit を寄せる。
9. **worker 組み立て**: `src/backend/index.ts` が `export default { fetch, queue }`。`/server` バレル = `src/backend/public.ts`。生成 entry は `yurumeet/scripts/build-takos-worker.ts` / `yurucommu/scripts/build-yurucommu-worker.ts` の `createEntrySource` が文字列生成。
10. **deploy 現状**: `wrangler.jsonc` / `main.tf` に DO binding も migrations も無い（`CallSignalingDurableObject` すら未配線）。両プロダクトは Cloudflare Queues 利用 = **Workers Paid 前提**なので SQLite-backed DO 追加でプラン制約は増えない。
11. **クライアント state**: yurumeet は 100% SolidJS signal/store。yurucommu は横断バッジに jotai atom + ページローカルに Solid signal。両者とも `@takosjp/yurucommu-api` を共有。

### 確定した設計判断（本設計のスコープ内で合意済み）
- **ポーリング**: 定常状態は全廃。残すのは (a) 画面マウント/cold 再接続時の初回1回フェッチ、(b) **WS 不通/未配線時だけ発火するフォールバックポーラー**（self-host 保険。定常運用では回らない）。
- **WS 認証**: **短命チケット方式**。生 session id を URL に載せない。

---

## 3. アーキテクチャ

```
              ┌─────────────────────── one WebSocket per user ───────────────────────┐
  browser ────┤  wss://<origin>/api/realtime/socket?ticket=<one-time>                 │
   (tab/app)  └──────────────────────────────────────────────────────────────────────┘
                                    │ upgrade (worker validates ticket → actorApId)
                                    ▼
                    REALTIME_STREAM.idFromName(actorApId)   ← per-user DO (hibernatable)
                                    ▲   ▲
       emit (talk.message/typing/read)│   │ emit (notification.new / unread)
                                    │   │
  DM send  ────────────────────────┘   └──────── waitUntil middleware / queue consumer tail
  (messages.ts batch success)                     (likes/replies/follows/federation/community)
```

- **1ユーザー = WS 1本**。その1本で talk 本文・typing・既読・通知・未読カウントを全部受ける。
- DO は **per-user**（`idFromName(actorApId)`）。会話ごとではない。同一ユーザーの複数タブ/端末 = 同一 DO 内の複数 WS。
- **書き込みは従来どおり REST**。WS は基本受信専用（＋制御フレームのみ）。移行が最小。

---

## 4. Durable Object: `RealtimeStreamDO`（新規）

`CallSignalingDurableObject` の WS 機構 ＋ `NotifierBase` の fanout/replay を合わせた per-user fanout DO を **新規**に作る（CallDO は RTC 専用のため相乗りしない）。

配置: `src/backend/runtime/realtime-stream-do.ts`

| 項目 | 設計 |
|---|---|
| キー | `REALTIME_STREAM.idFromName(actorApId)` |
| WS | `state.acceptWebSocket(server)`（Hibernatable）。`state.getWebSockets()` で broadcast |
| storage | ring-buffer（直近 N=200 イベント、`{id,type,data}`）+ 接続メタを DO storage に保持 → hibernation 越しに replay 可能 |
| イベント id | DO 内 monotonic（storage の連番）。クライアントの `lastEventId` と突合 |
| HTTP 面 | `POST /emit`（producer からの投入。DO binding = 信頼境界）／ `GET /ws`（worker からの upgrade 転送）／ `GET /state`（デバッグ） |
| 再接続 | `hello {lastEventId}` を受けて buffer 差分を replay。buffer 外なら `{type:"resync"}` を返し、クライアントが初回フェッチで全同期 |
| heartbeat / 掃除 | `alarm()` で ping / stale 接続 close（`NotifierBase` と同型） |

### イベント封筒とタイプ

封筒: `{ id: number, type: string, data: object }`。

| type | data | 代替するポーリング |
|---|---|---|
| `talk.message` | `{ conversationId, message }`（messages.ts の返却 shape） | yurumeet 4s / yurucommu DMChatPanel 4s のメッセージ |
| `talk.typing` | `{ conversationId, actorApId, isTyping }` | 両者 4s typing |
| `talk.read` | `{ conversationId, actorApId, lastReadAt }` | partner 既読反映 |
| `talk.contacts_changed` | `{}`（or 更新後 contact summary） | yurumeet 20s 連絡先 |
| `notification.new` | `{ activity summary }` | yurucommu 通知一覧更新トリガ |
| `unread` | `{ dm, notifications, communities }`（サーバ算出の権威値） | yurumeet 20s / yurucommu 30s×2 バッジ |

`unread` は emit のたびにサーバが `yurumeUnreadCounts` を回して確定値を push → クライアントはカウントを取りに行かない。1ユーザーなら再計算コストは誤差。

---

## 5. サーバ配線

### 5.1 hub seam（CF / in-process）
`src/backend/runtime/realtime-hub.ts`（`signaling-hub.ts` と同型）:
- `getRealtimeStream(env)`:
  - `env.REALTIME_STREAM` あり → `CloudflareRealtimeStream`（`ns.get(ns.idFromName(actorApId)).fetch("https://realtime-do/emit", {method:"POST", body})`）
  - 無し → `LocalRealtimeStream`（Bun/Node 自ホスト、同一プロセス内 broadcast）
  - どちらも無効なら emit は no-op（クライアントはフォールバックポーラーで動く）
- `isRealtimeAvailable(env)` = `Boolean(env.REALTIME_STREAM)` 相当（＋ in-process 実装があれば true）。capability 広告に使う。

### 5.2 emit フック点

| 経路 | フック位置 | emit 先 / type |
|---|---|---|
| ローカル DM 送信（本文） | `routes/dm/messages.ts` の batch 成功直後 (:582 付近) | 受信者 + 送信者 DO へ `talk.message` |
| タイピング送出 | 既存 typing route | 相手 DO へ `talk.typing` |
| 既読 | `markDMAsRead` 経路 | 相手 DO へ `talk.read` |
| ローカル通知（like/reply/follow/story 等） | `index.ts:571-611` の post-response `waitUntil`（既に push job flush してる所） | 受信者 DO へ `notification.new` + `unread` |
| フェデレーション受信 / community fanout | `delivery/queue.ts:526-533` の consumer 末尾 flush 点 | 受信者 DO へ `notification.new` + `unread` |

- 送信者 DO にも `talk.message` を emit → 送信者の他タブ/端末が同期。既存の楽観的更新（yurumeet の `pending`/`failed` バブル）と id dedupe マージで冪等。
- emit は **best-effort**（失敗は warn、リクエスト本体は成功させる）。takos `notifications/service.ts:674-686` と同じ扱い。
- **DB トリガーからは DO を呼べない**ため、トリガーが書いた inbox/push_jobs を読む既存 flush 点2つに emit を寄せるのが唯一正しい形（全 inbox 生成経路を一点で拾う）。

### 5.3 認証（短命チケット方式・確定）

1. 認証済みエンドポイント `POST /api/realtime/ticket`（`extractActorFromSession` を通過するミドルウェア配下）で、**使い捨て・短命（例 30s）の WS チケット**を発行。チケットは actorApId に紐づけて KV（or DO storage）に保存、one-time consume。
2. クライアントは `wss://<origin>/api/realtime/socket?ticket=<t>` で接続。
3. upgrade route（`/api/rtc/socket` がテンプレ）で worker がチケットを検証・consume → `actorApId` を確定 → `REALTIME_STREAM.idFromName(actorApId)` の DO stub に `X-Realtime-Actor: <actorApId>` を付けて `/ws` 転送。**DO binding が信頼境界**（CallDO の `X-Call-Actor` / `NotifierBase.isAuthorizedHttp` と同思想）。
4. 生 session id を URL に載せない（ログ漏洩回避）。cross-origin（yurumeet の別 serverOrigin）でも cookie 依存にならず確実。

### 5.4 worker binding 型
`src/backend/types.ts` の `Env` に `REALTIME_STREAM?: DurableObjectNamespace` を追記（DB/MEDIA/KV/ASSETS 以外なので `wrapCloudflareBindings` を素通り）。

---

## 6. クライアント配線

### 6.1 WS クライアント（共有）
`@takosjp/yurucommu-api`（物理: `yurucommu-core/packages/api/`）に新規:
- `src/lib/realtime-client.ts`: `transport.resolveUrl` を流用して `wss://` URL を構築、`POST /api/realtime/ticket` → 接続、自動再接続（指数バックオフ）、`hello {lastEventId}` 送出、heartbeat、`onEvent(type, handler)` 購読 API、capability 検知。
- `src/types/realtime.ts`: イベント型（`types/call.ts` の隣）。

### 6.2 state 流し込み（調査の対応表そのまま）

| イベント | yurumeet | yurucommu |
|---|---|---|
| `talk.message` | `chat-context` `setMessages(appendFresh(...))`（4s 削除） | `DMChatPanel` `setMessages(mergeMessagesById(...))`（4s 削除） |
| `talk.typing` | `setIsTyping` | `DMChatPanel` `setIsTyping` |
| `talk.read` | `setPartnerLastReadAt`/`setReadStates` | `DMChatPanel` の read state |
| `talk.contacts_changed` | `refetchContacts()`（20s 削除） | `DMPage` `loadContacts()` |
| `unread` | `setUnreadTalk`/`setUnreadNotifications`（main.tsx 20s 削除） | `set(dmUnreadCountAtom)`/`set(notificationUnreadAtom)`（30s×2 削除） |
| `notification.new` | — | `NotificationPage.refreshInPlace()` を trigger |

### 6.3 削除 / 残す
- **削除（定常ポーリング）**: yurumeet `chat-context.tsx` の `POLL_MS`/`CONTACTS_POLL_MS` 2ループ + `main.tsx` 20s badge interval。yurucommu `useUnreadPolling` の interval（notification/dm）+ `DMChatPanel` の `MESSAGE_POLL_MS`/typing poll。
- **残す**: 各画面マウント時の初回フェッチ（`loadMessagesPage`/`fetchNotifications`/`fetchDMContacts`）、cold 再接続時の再同期、`visibilitychange`/`focus` 時の in-place refresh（belt-and-suspenders）。
- **フォールバック（確定）**: `realtime-client` が「接続不可 / サーバ capability 無し」を検知したら旧ポーリングを**低頻度で復帰**（self-host で DO 未配線でも無停止）。定常運用では発火しない。実装は「ポーラー関数を capability 有無で start/stop する 1 スイッチ」に集約する。

---

## 7. デプロイ配線（4箇所 × 2プロダクト、`new_sqlite_classes`）

1. `yurucommu-core/src/backend/public.ts`（`/server` バレル）に `export { RealtimeStreamDO } from "./runtime/realtime-stream-do.ts";`。
2. 両 `scripts/build-*-worker.ts` の `createEntrySource` 生成テンプレに `export { RealtimeStreamDO } from "@takosjp/yurucommu-core/server";`（takos-git `worker.ts:76-79` と同型）。
3. 両 `wrangler.jsonc`:
   ```jsonc
   "durable_objects": { "bindings": [
     { "name": "REALTIME_STREAM", "class_name": "RealtimeStreamDO" }
   ]},
   "migrations": [
     { "tag": "realtime-v1", "new_sqlite_classes": ["RealtimeStreamDO"] }
   ]
   ```
4. 両 `main.tf` の `cloudflare_workers_script.worker`（takos-git `main.tf:513-606` がテンプレ）:
   ```hcl
   migrations = { new_tag = "realtime-v1", new_sqlite_classes = ["RealtimeStreamDO"] }
   # bindings concat に追加:
   { type = "durable_object_namespace", name = "REALTIME_STREAM", class_name = "RealtimeStreamDO" }
   ```
5. **compat date 不一致を解消**: `wrangler.jsonc`（`2026-07-16`）と `main.tf` の `worker_compatibility_date` default（`2026-04-01`）を揃える。
6. direct `wrangler deploy` 経路と OpenTofu Capsule 経路は同一 class 名・同一 storage 種別（sqlite）を宣言（DO migration 状態は Cloudflare 側で一元管理）。

---

## 8. 移行フェーズ（安全順）

1. **DO + hub + emit + `/api/realtime/ticket` + `/api/realtime/socket` + WS client** を追加。クライアントは購読するが**ポーリングは残したまま**（二重稼働の安全期間）。
2. LAN dev（`*.takos.test` / `yurucommu.test`）と direct `wrangler deploy` の両方で WS 即時反映を実測（chrome-MCP）。送信→相手タブ反映、typing、未読バッジ、通知一覧の各イベントを確認。
3. 確認後、**定常ポーリングのタイマーを撤去**（初回フェッチ + capability-gated フォールバックのみ残す）。
4. self-host（Bun/Node、DO 無し）で in-process hub 経路とフォールバックが効くことを確認。
5. gate（`bun test` / `bunx tsc --noEmit` / lint）green を確認して各 repo でコミット。

---

## 9. リスク / エッジケース

| リスク | 対応 |
|---|---|
| cross-origin cookie（yurumeet 別 serverOrigin） | 短命チケット方式で cookie 非依存（§5.3） |
| 既存 self-host が DO 未デプロイ | capability 検知 + フォールバックポーラーで無停止（§6.3） |
| メッセージ順序 / 重複 | 既存 id dedupe マージ（`appendFresh` / `mergeMessagesById`）で冪等。WS も poll も同じ経路 |
| 切断中の取りこぼし | ring-buffer replay（warm）／ buffer 外は `resync`→初回フェッチ（cold） |
| DO migration tag 競合 | direct/tf 両経路で同一 class・同一 storage 種別・単調 tag |
| emit 失敗でリクエスト巻き添え | emit は best-effort（warn 握り潰し）、REST 本体は成功させる |
| チケット漏洩 | one-time consume + 短命（~30s）+ actorApId 紐づけ |

---

## 10. 変更ファイル一覧（実装時のチェックリスト）

**yurucommu-core**
- 追加: `src/backend/runtime/realtime-stream-do.ts`（DO 本体）
- 追加: `src/backend/runtime/realtime-hub.ts`（CF/in-process seam）
- 追加: `src/backend/routes/realtime/index.ts`（`/api/realtime/ticket` + `/api/realtime/socket`）→ `index.ts` に mount
- 追加: `packages/api/src/lib/realtime-client.ts` + `packages/api/src/types/realtime.ts`（+ index re-export）
- 変更: `src/backend/types.ts`（`Env.REALTIME_STREAM?`）
- 変更: `src/backend/public.ts`（DO re-export）
- 変更（emit フック）: `routes/dm/messages.ts`, typing route, `markDMAsRead` 経路, `index.ts:571-611`, `lib/delivery/queue.ts:526-533`

**yurumeet / yurucommu（各々）**
- 変更: `scripts/build-*-worker.ts`（DO named export）
- 変更: `wrangler.jsonc`（DO binding + migrations + compat date）
- 変更: `main.tf`（DO namespace binding + migrations + compat date）
- 変更（client 購読 + ポーリング撤去）: yurumeet `src/lib/chat-context.tsx`, `src/main.tsx`, `src/lib/app-context.tsx` / yurucommu `src/components/dm/DMChatPanel.tsx`, `src/hooks/useUnreadPolling.ts` 利用箇所, `src/atoms/notifications.ts`, `src/atoms/dm-unread.ts`, `src/pages/NotificationPage.tsx`, `src/pages/DMPage.tsx`

---

## 付録: 参照した既存実装
- hibernatable WS DO 雛形: `src/backend/runtime/call-signaling-do.ts`
- CF/in-process seam 雛形: `src/backend/runtime/signaling-hub.ts`（`getSignalingHub`）
- 汎用 fanout DO（replay 付き）お手本: `takos/src/worker/runtime/durable-objects/notifier-base.ts`, `notification-notifier.ts`
- emit フックのお手本: `takos/src/worker/application/services/notifications/service.ts:674-686`
- tf 側 DO 宣言の実例: `takos-git/main.tf:513-606`, `takos-git/src/worker.ts:76-79`
- 未読権威クエリ: `src/backend/lib/unread-counts.ts`（`yurumeUnreadCounts`）
- conversation ID: `src/backend/routes/dm/query-helpers.ts`（`getConversationId`）
