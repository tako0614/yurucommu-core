# Takos Story (ActivityPub) v1 — 実装ガイド

> 目的：ActivityPub 上で互換性を保ちつつ、24 時間で消えるストーリー（画像/動画＋オーバレイ）を配信・表示する。
> 最小実装（MVP）→拡張可能。未対応実装には通常の Image/Video としてフォールバック表示。

---

## 0. クイックスタート（最短導入手順）

1. **コンテキスト公開（GitHub）**
   追加: `docs/ap-story/v1.jsonld`（下の「1. JSON‑LD コンテキスト」そのまま保存）
   参照 URL（raw）をオブジェクトの `@context` に入れる。

2. **データモデル・DB**
   追加: `app/takos_server/models/story.ts`（下の TypeScript 型 & Zod）
   Mongo に TTL index：`expiresAt` で自動削除。

3. **連合処理**

   * inbox: `Create{Story}` を受け取り保存、`expiresAt` 尊重。
   * outbox: ローカル投稿から `Create{Story}` を生成・配送。
   * collections: `GET /users/:name/stories` で有効ストーリーを `OrderedCollectionPage` 返却。

4. **フロント**
   追加: ストーリーリール（アイコンのリング表示）＆プレイヤー（`items` を順に再生、オーバレイ描画）。

5. **クリーンアップ**
   TTL index + バックグラウンドワーカー（アーカイブ/ハイライト処理は設定次第）。

---

## 1. JSON‑LD コンテキスト（GitHub にそのまま配置）

**ファイル:** `docs/ap-story/v1.jsonld`

```json
{
  "@context": {
    "@version": 1.1,
    "as": "https://www.w3.org/ns/activitystreams#",
    "ts": "https://takos.social/ns#",
    "Story": "ts:Story",
    "StoryItem": "ts:StoryItem",
    "Overlay": "ts:Overlay",
    "Reaction": "ts:Reaction",
    "StoryView": "ts:StoryView",
    "expiresAt": { "@id": "ts:expiresAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
    "items": { "@id": "ts:items", "@container": "@list" },
    "overlays": { "@id": "ts:overlays", "@container": "@set" },
    "duration": { "@id": "ts:duration", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
    "link": { "@id": "ts:link", "@type": "@id" },
    "x": { "@id": "ts:x", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
    "y": { "@id": "ts:y", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
    "w": { "@id": "ts:w", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
    "h": { "@id": "ts:h", "@type": "http://www.w3.org/2001/XMLSchema#decimal" },
    "style": "ts:style",
    "fallback": "ts:fallback",
    "storyType": "ts:storyType",
    "archived": { "@id": "ts:archived", "@type": "http://www.w3.org/2001/XMLSchema#boolean" },
    "highlightOf": { "@id": "ts:highlightOf", "@type": "@id" },
    "viewCount": { "@id": "ts:viewCount", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
    "emoji": "ts:emoji"
  }
}
```

**README 例:** `docs/ap-story/README.md` に語彙・変更履歴を簡記（任意）。

---

## 2. データモデル（TypeScript 型 & Zod スキーマ）

**ファイル:** `app/takos_server/models/story.ts`

```ts
// deno-lint-ignore-file no-explicit-any
import { z } from "zod";

// ---------- Types ----------
export type OverlayType = "Text" | "Mention" | "Hashtag" | "Link";

export interface OverlayBase {
  type: OverlayType;
  x: number; y: number; w: number; h: number; // 0..1 相対座標
  style?: Record<string, string | number>;
}
export interface TextOverlay extends OverlayBase { type: "Text"; content: string; }
export interface MentionOverlay extends OverlayBase { type: "Mention"; href: string; }
export interface HashtagOverlay extends OverlayBase { type: "Hashtag"; name: string; }
export interface LinkOverlay extends OverlayBase { type: "Link"; link: string; }
export type Overlay = TextOverlay | MentionOverlay | HashtagOverlay | LinkOverlay;

export type MediaKind = "Image" | "Video" | "Audio";
export interface StoryMedia {
  type: MediaKind;
  url: string;
  mediaType: string;
  width?: number; height?: number; duration?: number;
}

export interface StoryItem {
  type: "StoryItem";
  media: StoryMedia;
  duration?: number;      // 秒（動画は media.duration 優先）
  alt?: string;
  overlays?: Overlay[];
}

export type StoryType = "image" | "video" | "mix";
export interface StoryDoc {
  _id: string;            // DB 内部 ID
  id: string;             // 公開 IRI
  actor: string;          // actor IRI
  items: StoryItem[];
  published: Date;
  expiresAt: Date;
  storyType: StoryType;
  to: string[];
  cc?: string[]; bto?: string[]; bcc?: string[];
  fallback?: StoryMedia;
  viewCount?: number;     // ローカルのみ
  archived?: boolean;
  highlightOf?: string | null;
}

// ---------- Zod Schemas (validate inbox/outbox payloads) ----------
const overlayBase = z.object({
  type: z.enum(["Text", "Mention", "Hashtag", "Link"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  style: z.record(z.union([z.string(), z.number()])).optional(),
});
export const zTextOverlay = overlayBase.extend({ type: z.literal("Text"), content: z.string().min(1) });
export const zMentionOverlay = overlayBase.extend({ type: z.literal("Mention"), href: z.string().url() });
export const zHashtagOverlay = overlayBase.extend({ type: z.literal("Hashtag"), name: z.string().min(1) });
export const zLinkOverlay = overlayBase.extend({ type: z.literal("Link"), link: z.string().url() });
export const zOverlay = z.discriminatedUnion("type", [zTextOverlay, zMentionOverlay, zHashtagOverlay, zLinkOverlay]);

export const zMedia = z.object({
  type: z.enum(["Image", "Video", "Audio"]),
  url: z.string().url(),
  mediaType: z.string().min(3),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().positive().optional(),
});

export const zStoryItem = z.object({
  type: z.literal("StoryItem"),
  media: zMedia,
  duration: z.number().positive().optional(),
  alt: z.string().optional(),
  overlays: z.array(zOverlay).optional(),
});

export const zStoryObject = z.object({
  "@context": z.any().optional(),
  id: z.string().url().optional(),
  type: z.literal("Story"),
  attributedTo: z.string().url(),
  published: z.string().datetime(),
  expiresAt: z.string().datetime(),
  storyType: z.enum(["image", "video", "mix"]),
  items: z.array(zStoryItem).min(1),
  fallback: zMedia.optional(),
  to: z.array(z.string().url()).default([]),
  cc: z.array(z.string().url()).optional(),
  bto: z.array(z.string().url()).optional(),
  bcc: z.array(z.string().url()).optional(),
});
```

**Mongo TTL index（起動時一回）**

```ts
// app/takos_server/db/ensure_ttl.ts
export async function ensureStoryTTLIndex(db: any) {
  await db.collection("stories").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
```

---

## 3. Federation（Activities とコレクション）

### 3.1 送信（outbox 生成例）

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://raw.githubusercontent.com/takoserver/takos/master/docs/ap-story/v1.jsonld"
  ],
  "type": "Create",
  "actor": "https://example.com/users/alice",
  "to": ["https://example.com/users/alice/followers"],
  "object": {
    "id": "https://example.com/users/alice/stories/01HX...",
    "type": "Story",
    "attributedTo": "https://example.com/users/alice",
    "published": "2025-07-29T03:00:00Z",
    "expiresAt": "2025-07-30T03:00:00Z",
    "storyType": "image",
    "items": [
      {
        "type": "StoryItem",
        "media": {
          "type": "Image",
          "url": "https://cdn.example.com/stories/01HX/frame1.webp",
          "mediaType": "image/webp",
          "width": 1080,
          "height": 1920
        },
        "duration": 5,
        "alt": "夜景に hello の文字",
        "overlays": [
          { "type": "Text", "content": "hello", "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.1 }
        ]
      }
    ],
    "fallback": {
      "type": "Image",
      "url": "https://cdn.example.com/stories/01HX/cover.webp",
      "mediaType": "image/webp",
      "width": 1080,
      "height": 1920
    }
  }
}
```

### 3.2 受信（inbox）

* `type=Create && object.type=Story` を受理。
* `expiresAt` が過去なら破棄、未来なら保存。
* `bto/bcc` を含むものは**再配布禁止**（ローカル配達のみにする）。

### 3.3 コレクション（現行ストーリー一覧）

* `GET /users/:name/stories` → `OrderedCollection` or `OrderedCollectionPage`
* `orderedItems` は `Story` オブジェクト（`@context` 付き）を返す。期限切れは出さない。

---

## 4. サーバ実装（Hono/Deno 例・AI コーディング用スケルトン）

**ファイル:** `app/takos_server/routes/ap_story.ts`

```ts
import { Hono } from "hono";
import { zStoryObject } from "../models/story.ts";
import { deliverToRecipients } from "../federation/deliver.ts";
import { nowISO, isLocalActor, buildStoryIRI } from "../utils/ap.ts";

export const story = new Hono();

// outbox: ローカル投稿 -> Create{Story}
story.post("/ap/users/:name/outbox/story", async (c) => {
  const actor = `https://${c.req.header("host")}/users/${c.req.param("name")}`;
  if (!await isLocalActor(actor)) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json();
  // body: { object: <Story>, to?, cc?, bto?, bcc? }
  const storyObj = zStoryObject.parse({
    ...body.object,
    attributedTo: actor,
    published: body.object?.published ?? nowISO(),
    expiresAt: body.object?.expiresAt ?? new Date(Date.now()+24*3600*1000).toISOString(),
  });

  const id = buildStoryIRI(actor);
  storyObj.id = id;

  // DB 保存（省略: repo.createStory(storyObj)）
  // await repo.createStory(storyObj, body.to, body.cc, body.bto, body.bcc);

  // 配送
  await deliverToRecipients({
    activity: {
      "@context": ["https://www.w3.org/ns/activitystreams",
                   "https://raw.githubusercontent.com/takoserver/takos/master/docs/ap-story/v1.jsonld"],
      type: "Create",
      actor, to: body.to ?? [], cc: body.cc ?? [], bto: body.bto ?? [], bcc: body.bcc ?? [],
      object: storyObj
    },
    to: body.to ?? [], cc: body.cc ?? [], bto: body.bto ?? [], bcc: body.bcc ?? [],
  });

  return c.json({ id });
});

// inbox: Create{Story} 受信
story.post("/ap/inbox", async (c) => {
  const activity = await c.req.json();
  if (activity?.type === "Create" && activity?.object?.type === "Story") {
    try {
      const obj = zStoryObject.parse(activity.object);
      // await repo.saveRemoteStory(obj, activity);
      return c.json({ ok: true });
    } catch (_e) {
      return c.json({ ok: false }, 400);
    }
  }
  // 他の Activity へフォールバック
  return c.json({ ok: true });
});

// 現在有効なストーリーの一覧
story.get("/users/:name/stories", async (c) => {
  const actor = `https://${c.req.header("host")}/users/${c.req.param("name")}`;
  const now = new Date();
  // const items = await repo.findStories({ actor, expiresAfter: now }); // 期限内のみ
  const items: unknown[] = []; // 実装: DB から取り出す
  return c.json({
    "@context": ["https://www.w3.org/ns/activitystreams",
                 "https://raw.githubusercontent.com/takoserver/takos/master/docs/ap-story/v1.jsonld"],
    "id": `${actor}/stories`,
    "type": "OrderedCollection",
    "totalItems": items.length,
    "orderedItems": items
  });
});

export default story;
```

**登録:** `app/takos_server/server.ts`

```ts
import story from "./routes/ap_story.ts";
app.route("/", story);
```

**配送ダミー:** `app/takos_server/federation/deliver.ts`

```ts
export async function deliverToRecipients(_args: {
  activity: unknown; to: string[]; cc?: string[]; bto?: string[]; bcc?: string[];
}) {
  // ここで HTTP 署名・inbox 配送を実施（既存の配送ロジックに委譲）
}
```

**ユーティリティ:** `app/takos_server/utils/ap.ts`

```ts
export const nowISO = () => new Date().toISOString();
export async function isLocalActor(_iri: string) { return true; }
export function buildStoryIRI(actorIri: string) {
  const id = crypto.randomUUID();
  return `${actorIri}/stories/${id}`;
}
```

---

## 5. バックグラウンド & クリーニング

**ファイル:** `app/takos_server/jobs/story_cleanup.ts`

```ts
// 役割: expiresAt < now の Story を UI から除外。TTL index で物理削除。
// アーカイブ/ハイライト運用をする場合のみ、期限切れ直前に移動。
export async function runStoryCleanup() {
  // const soonExpired = await repo.findExpiringStories({ withinMinutes: 5 });
  // for (const s of soonExpired) await repo.maybeArchiveOrKeepIfHighlighted(s);
}
```

cron などで 5 分おき起動。
TTL index（expiresAt）で物理削除は自動。

---

## 6. セキュリティ＆モデレーション要点（実装のコツ）

* **bto/bcc を含む Story は再配布しない。** ローカル配達のみにとどめる。
* メディアは**プロキシ経由**で取得＆NSFW/ウイルススキャン。
* **レート制限**：短時間の連投防止。
* **署名検証**：inbox で HTTP Signatures/LD-Signatures（既存実装に準拠）。

---

## 7. フロント実装（SolidJS 例・最小）

**ファイル:** `app/takos_host/client/src/components/StoryReel.tsx`

```tsx
import { createResource, For, Show } from "solid-js";

async function fetchStories(url: string) {
  const res = await fetch(url, { headers: { accept: "application/activity+json" } });
  if (!res.ok) return { orderedItems: [] };
  return await res.json();
}

export default function StoryReel(props: { actorUrl: string }) {
  const storiesUrl = `${props.actorUrl}/stories`;
  const [data] = createResource(() => storiesUrl, fetchStories);

  return (
    <div class="flex gap-3 overflow-x-auto py-2">
      <Show when={data()?.orderedItems?.length} fallback={<div class="text-sm text-zinc-500">No stories</div>}>
        <For each={data()!.orderedItems}>
          {(story: any) => (
            <button class="relative w-16 h-16 rounded-full ring-2 ring-pink-400 overflow-hidden"
                    onClick={() => window.dispatchEvent(new CustomEvent("open-story", { detail: story }))}>
              <img src={story.fallback?.url ?? story.items?.[0]?.media?.url} alt="" class="w-full h-full object-cover" />
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}
```

**ファイル:** `app/takos_host/client/src/components/StoryPlayer.tsx`

```tsx
import { createSignal, onCleanup } from "solid-js";

export default function StoryPlayer() {
  const [open, setOpen] = createSignal(false);
  const [story, setStory] = createSignal<any>(null);
  const handler = (e: any) => { setStory(e.detail); setOpen(true); };
  window.addEventListener("open-story", handler);
  onCleanup(() => window.removeEventListener("open-story", handler));

  const next = () => { /* 次フレームへ */ };

  return open() && story() ? (
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center">
      <div class="w-[360px] h-[640px] bg-black relative">
        {/* 最小: 画像/動画のみ表示（オーバレイ描画は後述） */}
        {/* TODO: overlays を canvas/SVG で描画 */}
        <img src={story().items[0].media.url} class="w-full h-full object-cover" />
        <button class="absolute top-2 right-2 text-white" onClick={() => setOpen(false)}>×</button>
      </div>
    </div>
  ) : null;
}
```

> オーバレイは `<svg>` レイヤに `x/y/w/h`（0..1）をビューボックスに掛けて描画するのが実装簡単です。

---

## 8. メディア仕様（推奨）

* 画像: WebP（1080×1920 推奨）
* 動画: MP4/H.264 + AAC（縦 1080×1920、<= 15 秒/フレーム推奨）
* `fallback` はカバー画像（ストーリーリールのサムネに使用）

---

## 9. 相互運用とフォールバック

* 未対応のリモートでは `object.fallback`（Image/Video）を普通の投稿として表示できる。
* 通常 TL とは分離（`/stories` コレクションのみで扱い、TL を汚さない）。

---

## 10. cURL / テスト用スニペット

**送信（ローカル作成）**

```bash
curl -sS -X POST https://example.com/ap/users/alice/outbox/story \
  -H 'content-type: application/json' \
  -d '{
    "to": ["https://example.com/users/alice/followers"],
    "object": {
      "type":"Story",
      "attributedTo":"https://example.com/users/alice",
      "published":"2025-07-29T03:00:00Z",
      "expiresAt":"2025-07-30T03:00:00Z",
      "storyType":"image",
      "items":[{"type":"StoryItem","media":{"type":"Image","url":"https://cdn.example.com/1.webp","mediaType":"image/webp","width":1080,"height":1920},"duration":5}]
    }
  }'
```

**取得（コレクション）**

```bash
curl -H 'accept: application/activity+json' https://example.com/users/alice/stories
```

---

## 11. バリデーション規約（AI が実装すべき判定）

* `items` は 1 以上、各 `StoryItem.media.url` は https、`x/y/w/h` は 0..1。
* `expiresAt` は `published` より後（デフォルト 24h）。
* 動画は `media.duration || item.duration` を再生秒として扱う。
* `bto/bcc` を含む場合は**配送先のみ配達**（フォワードやリレーしない）。

---

## 12. バージョニング & 将来拡張

* `docs/ap-story/v1.jsonld` は**破壊的変更禁止**。追加プロパティのみ。
* 大きな変更は `v2.jsonld` を新規に用意。
* 拡張 Overlay: `Poll`, `Sticker`, `Music`, `Question` などは `Overlay.type` の追加で表現。

---

## 13. AI コーディング用タスクリスト（そのまま貼って実行）

> **各タスクは「ファイル作成 or 追記」の形式**です。順に実行してください。

1. **コンテキストを追加**

   * 追加: `docs/ap-story/v1.jsonld`（本ドキュメントの「1. JSON‑LD コンテキスト」を全文）

2. **モデルとスキーマ**

   * 追加: `app/takos_server/models/story.ts`（「2. データモデル」を全文）

3. **TTL index 初期化**

   * 追加: `app/takos_server/db/ensure_ttl.ts`（上記コード）
   * 既存 DB 初期化処理に `ensureStoryTTLIndex(db)` を呼び出し

4. **連合ルート**

   * 追加: `app/takos_server/routes/ap_story.ts`（「4. サーバ実装」スケルトン）
   * 既存 `server.ts` に `app.route("/", story)` を追記

5. **配送ロジック結線**

   * 既存の配送実装がある場合、`deliverToRecipients` 内で署名＆POST を呼ぶよう接続

6. **コレクション公開**

   * `GET /users/:name/stories` が `OrderedCollection` を返すことを確認（期限切れは除外）

7. **フロント**

   * 追加: `StoryReel.tsx`, `StoryPlayer.tsx`（「7. フロント実装」）
   * 既存のヘッダー等に `<StoryReel actorUrl={currentUserActorUrl} />` を設置

8. **メディアプロキシと検査**

   * 既存パイプラインに「webp/mp4 のみ」「最大解像度/サイズ」などの制限を追加

9. **E2EE（任意）**

   * 将来、MLS/E2EE 経由でメディア取得する場合は `media.url` をプロキシスキーム化し復号（別ドキュメント）

---

## 14. 参考 UI ロジック（オーバレイ描画・疑似コード）

```ts
// 描画領域: width H, height W
function place(rect: {x:number; y:number; w:number; h:number}, W:number, H:number) {
  return { left: rect.x*W, top: rect.y*H, width: rect.w*W, height: rect.h*H };
}
// Text: style.fontSize を px にマップ（例: 高さ比率 * H）
```