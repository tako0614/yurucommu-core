/**
 * Core Kernel ObjectService API
 *
 * PLAN.md 10.2 / 10.5 に基づく Objects コレクションの統一インターフェース
 * ActivityPub オブジェクトを統合管理するためのサービスAPI
 *
 * Objects コレクションは以下を統合:
 * - 投稿 (Note, Article, Question)
 * - DM (Note with to/bto)
 * - ストーリー (Note with takos:story)
 * - コメント (Note with inReplyTo)
 * - リアクション (Like, Announce)
 */

import type { AppAuthContext } from "../runtime/types";
import { makeData } from "../../server/data-factory";
import { requireInstanceDomain } from "../../subdomain";
import { releaseStore } from "../../utils/utils";

// ActivityPub Visibility
export type APVisibility = "public" | "unlisted" | "followers" | "direct" | "community";

// ActivityPub Object Types
export type APObjectType =
  | "Note"
  | "Article"
  | "Question"
  | "Like"
  | "Announce"
  | "Create"
  | "Update"
  | "Delete"
  | "Follow"
  | "Accept"
  | "Reject";

/**
 * ActivityPub Object (JSON-LD format)
 */
export interface APObject {
  "@context"?: string | string[] | Record<string, unknown>;
  id: string;
  type: APObjectType | string;
  actor: string;
  to?: string[];
  cc?: string[];
  bto?: string[];
  bcc?: string[];
  content?: string;
  summary?: string;
  published?: string;
  updated?: string;
  inReplyTo?: string | null;
  context?: string;
  attachment?: APAttachment[];
  tag?: APTag[];
  // takos extensions
  "takos:poll"?: APPoll;
  "takos:story"?: APStory;
  // Additional properties
  [key: string]: unknown;
}

export interface APAttachment {
  type: string;
  mediaType?: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface APTag {
  type: string;
  name?: string;
  href?: string;
  [key: string]: unknown;
}

export interface APPoll {
  options: { name: string; votes?: number }[];
  multiple?: boolean;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface APStory {
  items: APStoryItem[];
  expiresAt?: string;
  [key: string]: unknown;
}

export interface APStoryItem {
  type: string;
  url?: string;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  text?: string;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Stored Object (database representation)
 */
export interface StoredObject {
  id: string;
  local_id: string | null;
  type: string;
  actor: string;
  published: string | null;
  updated: string | null;
  to: string | null; // JSON array
  cc: string | null; // JSON array
  bto: string | null; // JSON array
  bcc: string | null; // JSON array
  context: string | null;
  in_reply_to: string | null;
  content: string; // JSON-LD object
  is_local: number;
  visibility: string | null;
  deleted_at: string | null;
  created_at: string;
}

/**
 * Create Object Input
 */
export interface CreateObjectInput {
  type: APObjectType | string;
  content?: string;
  summary?: string;
  visibility?: APVisibility;
  inReplyTo?: string | null;
  context?: string | null;
  to?: string[];
  cc?: string[];
  bto?: string[];
  bcc?: string[];
  attachment?: APAttachment[];
  tag?: APTag[];
  poll?: APPoll | null;
  story?: APStory | null;
  // Allow additional properties
  [key: string]: unknown;
}

/**
 * Update Object Input
 */
export interface UpdateObjectInput {
  content?: string;
  summary?: string;
  attachment?: APAttachment[];
  tag?: APTag[];
  poll?: APPoll | null;
  [key: string]: unknown;
}

/**
 * Object Query Parameters
 */
export interface ObjectQueryParams {
  type?: string | string[];
  actor?: string;
  context?: string;
  visibility?: APVisibility;
  inReplyTo?: string;
  isLocal?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
}

/**
 * Timeline Parameters
 */
export interface ObjectTimelineParams {
  type?: string | string[];
  visibility?: APVisibility[];
  limit?: number;
  cursor?: string;
  communityId?: string;
  listId?: string;
  onlyMedia?: boolean;
}

/**
 * Object Page (paginated result)
 */
export interface ObjectPage {
  items: APObject[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * ObjectService Interface
 *
 * Core Kernel サービスとして Objects コレクションへのアクセスを提供
 */
export interface ObjectService {
  /**
   * オブジェクトを作成
   * @param ctx 認証コンテキスト
   * @param input 作成内容
   * @returns 作成された AP オブジェクト
   */
  create(ctx: AppAuthContext, input: CreateObjectInput): Promise<APObject>;

  /**
   * オブジェクトを取得（ID による）
   * @param ctx 認証コンテキスト
   * @param id AP Object ID (URI)
   * @returns AP オブジェクト、または null
   */
  get(ctx: AppAuthContext, id: string): Promise<APObject | null>;

  /**
   * オブジェクトを取得（ローカル ID による）
   * @param ctx 認証コンテキスト
   * @param localId ローカル短縮 ID
   * @returns AP オブジェクト、または null
   */
  getByLocalId(ctx: AppAuthContext, localId: string): Promise<APObject | null>;

  /**
   * オブジェクトをクエリ
   * @param ctx 認証コンテキスト
   * @param params クエリパラメータ
   * @returns オブジェクトのページ
   */
  query(ctx: AppAuthContext, params: ObjectQueryParams): Promise<ObjectPage>;

  /**
   * オブジェクトを更新
   * @param ctx 認証コンテキスト
   * @param id オブジェクト ID
   * @param input 更新内容
   * @returns 更新後の AP オブジェクト
   */
  update(ctx: AppAuthContext, id: string, input: UpdateObjectInput): Promise<APObject>;

  /**
   * オブジェクトを削除（論理削除）
   * @param ctx 認証コンテキスト
   * @param id オブジェクト ID
   */
  delete(ctx: AppAuthContext, id: string): Promise<void>;

  /**
   * タイムラインを取得
   * @param ctx 認証コンテキスト
   * @param params タイムラインパラメータ
   * @returns オブジェクトのページ
   */
  getTimeline(ctx: AppAuthContext, params: ObjectTimelineParams): Promise<ObjectPage>;

  /**
   * スレッドを取得
   * @param ctx 認証コンテキスト
   * @param contextId スレッドコンテキスト ID
   * @returns スレッド内のオブジェクト配列
   */
  getThread(ctx: AppAuthContext, contextId: string): Promise<APObject[]>;

  /**
   * リモートオブジェクトを受信・保存
   * @param ctx 認証コンテキスト
   * @param object 受信した AP オブジェクト
   * @returns 保存された AP オブジェクト
   */
  receiveRemote(ctx: AppAuthContext, object: APObject): Promise<APObject>;

  /**
   * オブジェクトの存在確認
   * @param ctx 認証コンテキスト
   * @param id オブジェクト ID
   * @returns 存在する場合 true
   */
  exists(ctx: AppAuthContext, id: string): Promise<boolean>;
}

/** 
 * ObjectService の実装を提供するファクトリー関数の型
 */
export type ObjectServiceFactory = (env: unknown) => ObjectService;

type ObjectStore = {
  createObject(object: {
    id: string;
    local_id: string | null;
    type: string;
    actor: string;
    published: string | null;
    updated: string | null;
    to: string[] | null;
    cc: string[] | null;
    bto: string[] | null;
    bcc: string[] | null;
    context: string | null;
    in_reply_to: string | null;
    content: Record<string, unknown>;
    is_local: number | boolean;
    visibility: string | null;
    deleted_at?: string | null;
  }): Promise<StoredObject>;
  updateObject(id: string, data: Partial<Omit<StoredObject, "id">>): Promise<StoredObject>;
  getObject(id: string): Promise<StoredObject | null>;
  getObjectByLocalId(localId: string): Promise<StoredObject | null>;
  queryObjects(params: {
    type?: string | string[];
    actor?: string;
    context?: string;
    visibility?: string | string[];
    in_reply_to?: string;
    include_deleted?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<StoredObject[]>;
  deleteObject(id: string): Promise<void>;
  queryRaw?<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  executeRaw?(sql: string, ...params: any[]): Promise<number>;
};

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

function mergeStoredObject(stored: StoredObject): APObject {
  const content = parseJson<Record<string, unknown>>(stored.content, {});
  const to = toArray(stored.to ?? (content.to as any));
  const cc = toArray(stored.cc ?? (content.cc as any));
  const bto = toArray(stored.bto ?? (content.bto as any));
  const bcc = toArray(stored.bcc ?? (content.bcc as any));
  const base: APObject = {
    "@context": content["@context"] ?? createTakosContext(),
    id: (content.id as string) ?? stored.id,
    type: (content.type as string) ?? stored.type,
    actor: (content.actor as string) ?? stored.actor,
    to,
    cc,
    bto,
    bcc,
    content: content.content as string | undefined,
    summary: content.summary as string | undefined,
    published: (content.published as string) ?? stored.published ?? undefined,
    updated: (content.updated as string) ?? stored.updated ?? undefined,
    inReplyTo:
      (content.inReplyTo as string | null | undefined) ??
      (content.in_reply_to as string | null | undefined) ??
      stored.in_reply_to,
    context: (content.context as string | undefined) ?? stored.context ?? undefined,
    attachment: (content.attachment as APAttachment[]) ?? undefined,
    tag: (content.tag as APTag[]) ?? undefined,
    "takos:poll": (content["takos:poll"] as APPoll | undefined) ?? undefined,
    "takos:story": (content["takos:story"] as APStory | undefined) ?? undefined,
    ...content,
  };
  (base as any).local_id = stored.local_id ?? null;
  if ((base as any).visibility === undefined && stored.visibility) {
    (base as any).visibility = stored.visibility;
  }
  return base;
}

const storyExpiresAt = (object: APObject): Date | null => {
  const story = object["takos:story"];
  if (!story) return null;
  const expiresRaw = story.expiresAt ?? (story as any).expires_at;
  if (typeof expiresRaw === "string") {
    const d = new Date(expiresRaw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (expiresRaw instanceof Date) return expiresRaw;
  return null;
};

const isStoryExpired = (object: APObject, now: Date): boolean => {
  const expiresAt = storyExpiresAt(object);
  if (!expiresAt && object["takos:story"]) {
    const published = object.published ? new Date(object.published) : null;
    if (published && !Number.isNaN(published.getTime())) {
      return published.getTime() + STORY_TTL_MS <= now.getTime();
    }
  }
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
};

const ensureStoryExpiry = (object: APObject, now: Date): APObject => {
  const story = object["takos:story"];
  if (!story) return object;
  if (!story.expiresAt) {
    const published = object.published ? new Date(object.published) : now;
    const expiresAt = new Date(published.getTime() + STORY_TTL_MS);
    return { ...object, "takos:story": { ...story, expiresAt: expiresAt.toISOString() } };
  }
  return object;
};

const attachmentUrls = (attachments?: APAttachment[] | null): string[] => {
  if (!attachments || !attachments.length) return [];
  return Array.from(new Set(attachments.map((a) => String(a.url || "").trim()).filter(Boolean)));
};

async function adjustMediaRefCount(store: ObjectStore, attachments: APAttachment[] | undefined, delta: number) {
  if (!attachments || !attachments.length) return;
  if (typeof store.queryRaw !== "function" || typeof store.executeRaw !== "function") return;
  const urls = attachmentUrls(attachments);
  if (!urls.length) return;
  const columns = await store
    .queryRaw<{ name: string }>(`PRAGMA table_info(media)`)
    .catch(() => []);
  const hasRefCount = columns?.some((c) => c.name === "ref_count");
  if (!hasRefCount) return;
  for (const url of urls) {
    await store.executeRaw?.(
      `UPDATE media SET ref_count = MAX(COALESCE(ref_count, 0) + ?, 0) WHERE url = ?`,
      delta,
      url,
    );
  }
}

function computeNextCursor(items: APObject[], limit: number | undefined, offset: number): string | null {
  if (!limit) return null;
  if (items.length < limit) return null;
  return String(offset + items.length);
}
/**
 * Visibility から to/cc を生成するヘルパー
 */
export function visibilityToRecipients(
  visibility: APVisibility,
  actorUri: string,
  followersUri?: string
): { to: string[]; cc: string[] } {
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

  switch (visibility) {
    case "public":
      return {
        to: [PUBLIC],
        cc: followersUri ? [followersUri] : [],
      };
    case "unlisted":
      return {
        to: followersUri ? [followersUri] : [],
        cc: [PUBLIC],
      };
    case "followers":
      return {
        to: followersUri ? [followersUri] : [],
        cc: [],
      };
    case "direct":
    case "community":
    default:
      return {
        to: [],
        cc: [],
      };
  }
}

/**
 * to/cc から Visibility を推測するヘルパー
 */
export function recipientsToVisibility(to: string[], cc: string[]): APVisibility {
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

  if (to.includes(PUBLIC)) {
    return "public";
  }
  if (cc.includes(PUBLIC)) {
    return "unlisted";
  }
  if (to.length > 0 && to.some((r) => r.endsWith("/followers"))) {
    return "followers";
  }
  return "direct";
}

/**
 * takos 標準の @context を生成
 */
export function createTakosContext(): (string | Record<string, unknown>)[] {
  return [
    "https://www.w3.org/ns/activitystreams",
    "https://docs.takos.jp/ns/activitypub/v1.jsonld",
    {
      takos: "https://docs.takos.jp/ns/",
      "takos:poll": { "@type": "@json" },
      "takos:story": { "@type": "@json" },
    },
  ];
}

/**
 * ローカル ID を生成
 */
export function generateLocalId(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * ActivityPub オブジェクト ID を生成
 */
export function generateObjectId(baseUrl: string, localId: string): string {
  return `${baseUrl}/objects/${localId}`;
}

function pickVisibility(input: { visibility?: APVisibility; to?: string[]; cc?: string[] }): APVisibility | undefined {
  if (input.visibility) return input.visibility;
  const to = toArray(input.to);
  const cc = toArray(input.cc);
  if (to.length || cc.length) {
    return recipientsToVisibility(to, cc);
  }
  return undefined;
}

export const createObjectService: ObjectServiceFactory = (env: unknown): ObjectService => {
  const getStore = () => makeData(env as any) as unknown as ObjectStore;
  const baseUrl = (() => {
    try {
      const domain = requireInstanceDomain(env as any);
      return `https://${domain}/ap`;
    } catch {
      return "";
    }
  })();

  const mapToStored = (
    actor: string,
    object: APObject,
    visibility?: APVisibility,
    localId?: string | null,
    isLocal = true,
  ) => {
    const to = toArray(object.to);
    const cc = toArray(object.cc);
    const bto = toArray(object.bto);
    const bcc = toArray(object.bcc);
    const visibilityValue = visibility ?? recipientsToVisibility(to, cc);
    return {
      id: object.id,
      local_id: localId ?? null,
      type: object.type,
      actor,
      published: object.published ?? new Date().toISOString(),
      updated: object.updated ?? null,
      to,
      cc,
      bto: bto.length ? bto : null,
      bcc: bcc.length ? bcc : null,
      context: object.context ?? null,
      in_reply_to: (object.inReplyTo as string | null | undefined) ?? null,
      content: object as Record<string, unknown>,
      is_local: isLocal ? 1 : 0,
      visibility: visibilityValue ?? null,
      deleted_at: (object as any).deleted_at ?? null,
    };
  };

  const toPage = (objects: APObject[], limit: number | undefined, offset: number): ObjectPage => ({
    items: objects,
    nextCursor: computeNextCursor(objects, limit, offset),
    hasMore: !!limit && objects.length === limit,
  });

  const ensureActor = (ctx: AppAuthContext): string => {
    const actor = (ctx.userId || "").toString().trim();
    if (!actor) {
      throw new Error("Authentication required");
    }
    return actor;
  };

  return {
    async create(ctx, input) {
      const actor = ensureActor(ctx);
      const store = getStore();
      try {
        const localId = (input as any).local_id || generateLocalId();
        const objectId = (input as any).id || generateObjectId(baseUrl || "", localId);
        const now = new Date();
        const { to, cc } =
          input.to || input.cc
            ? { to: input.to ?? [], cc: input.cc ?? [] }
            : visibilityToRecipients(input.visibility ?? "public", actor, `${actor}/followers`);
        const story =
          input.story || (input as any)["takos:story"]
            ? {
                ...(input.story || (input as any)["takos:story"] || {}),
                expiresAt:
                  input.story?.expiresAt ||
                  (input as any)["takos:story"]?.expiresAt ||
                  new Date(now.getTime() + STORY_TTL_MS).toISOString(),
              }
            : undefined;

        const apObject: APObject = ensureStoryExpiry(
          {
            "@context": createTakosContext(),
            id: objectId,
            type: input.type,
            actor,
            to,
            cc,
            bto: input.bto,
            bcc: input.bcc,
            content: input.content,
            summary: input.summary,
            inReplyTo: input.inReplyTo ?? null,
            context: input.context ?? null,
            attachment: input.attachment,
            tag: input.tag,
            published: now.toISOString(),
            updated: now.toISOString(),
            "takos:poll": input.poll ?? (input as any)["takos:poll"] ?? undefined,
            "takos:story": story,
            visibility: input.visibility,
          },
          now,
        );

        const stored = mapToStored(actor, apObject, pickVisibility(input), localId, true);
        const created = await store.createObject(stored);
        await adjustMediaRefCount(store, apObject.attachment as APAttachment[] | undefined, 1);
        return mergeStoredObject(created);
      } finally {
        await releaseStore(store as any);
      }
    },

    async get(_ctx, id) {
      const store = getStore();
      try {
        const row = await store.getObject(id);
        if (!row) return null;
        const object = mergeStoredObject(row);
        return isStoryExpired(object, new Date()) ? null : object;
      } finally {
        await releaseStore(store as any);
      }
    },

    async getByLocalId(_ctx, localId) {
      const store = getStore();
      try {
        const row = await store.getObjectByLocalId(localId);
        if (!row) return null;
        const object = mergeStoredObject(row);
        return isStoryExpired(object, new Date()) ? null : object;
      } finally {
        await releaseStore(store as any);
      }
    },

    async query(_ctx, params) {
      const store = getStore();
      const offset = params.cursor ? parseInt(params.cursor, 10) || 0 : 0;
      const limit = params.limit ?? 20;
      try {
        const rows = await store.queryObjects({
          type: params.type,
          actor: params.actor,
          context: params.context,
          visibility: params.visibility,
          in_reply_to: params.inReplyTo,
          include_deleted: params.includeDeleted,
          limit,
          offset,
        });
        const now = new Date();
        const items = rows
          .map(mergeStoredObject)
          .filter((obj) => !isStoryExpired(obj, now));
        return toPage(items, limit, offset);
      } finally {
        await releaseStore(store as any);
      }
    },

    async update(ctx, id, input) {
      const store = getStore();
      try {
        const existing = await store.getObject(id);
        if (!existing) throw new Error("Object not found");
        const current = mergeStoredObject(existing);
        const updatedObject: APObject = {
          ...current,
          content: input.content ?? current.content,
          summary: input.summary ?? current.summary,
          attachment: input.attachment ?? current.attachment,
          tag: input.tag ?? current.tag,
          "takos:poll": (input.poll ?? (input as any)["takos:poll"]) ?? current["takos:poll"],
          updated: new Date().toISOString(),
        };

        const stored = mapToStored(
          current.actor,
          updatedObject,
          pickVisibility({ visibility: existing.visibility as APVisibility | undefined, to: current.to, cc: current.cc }),
          existing.local_id,
          existing.is_local === 1,
        );
        const beforeAttachments = current.attachment as APAttachment[] | undefined;
        const afterAttachments = updatedObject.attachment as APAttachment[] | undefined;
        await store.updateObject(id, stored as any);

        const beforeUrls = new Set(attachmentUrls(beforeAttachments));
        const afterUrls = new Set(attachmentUrls(afterAttachments));

        const added = Array.from(afterUrls).filter((u) => !beforeUrls.has(u));
        const removed = Array.from(beforeUrls).filter((u) => !afterUrls.has(u));

        if (added.length) {
          await adjustMediaRefCount(
            store,
            added.map((url) => ({ type: "Document", url })),
            1,
          );
        }
        if (removed.length) {
          await adjustMediaRefCount(
            store,
            removed.map((url) => ({ type: "Document", url })),
            -1,
          );
        }

        return mergeStoredObject({ ...existing, ...stored });
      } finally {
        await releaseStore(store as any);
      }
    },

    async delete(_ctx, id) {
      const store = getStore();
      try {
        const existing = await store.getObject(id);
        if (existing) {
          const object = mergeStoredObject(existing);
          await adjustMediaRefCount(store, object.attachment as APAttachment[] | undefined, -1);
          await store.updateObject(id, { deleted_at: new Date().toISOString() });
        } else {
          await store.deleteObject(id).catch(() => undefined);
        }
      } finally {
        await releaseStore(store as any);
      }
    },

    async getTimeline(_ctx, params) {
      const store = getStore();
      const offset = params.cursor ? parseInt(params.cursor, 10) || 0 : 0;
      const limit = params.limit ?? 20;
      const visibility = params.visibility?.length
        ? params.visibility
        : ["public", "unlisted", "followers", "direct", "community"];
      const types = params.type ?? ["Note", "Article", "Question", "Announce", "Like"];
      try {
        const rows = await store.queryObjects({
          type: types,
          context: params.communityId ?? undefined,
          visibility,
          include_deleted: false,
          limit,
          offset,
        });
        const now = new Date();
        const mapped = rows
          .map(mergeStoredObject)
          .filter((obj) => !isStoryExpired(obj, now))
          .filter((obj) => !params.onlyMedia || (obj.attachment && obj.attachment.length > 0));
        return toPage(mapped, limit, offset);
      } finally {
        await releaseStore(store as any);
      }
    },

    async getThread(_ctx, contextId) {
      const store = getStore();
      try {
        let rows: StoredObject[] = [];
        if (typeof store.queryRaw === "function") {
          rows = await store.queryRaw<StoredObject>(
            `SELECT * FROM objects WHERE context = ? AND deleted_at IS NULL ORDER BY published ASC`,
            contextId,
          );
        } else {
          rows = await store.queryObjects({ context: contextId, include_deleted: false, limit: 200 });
          rows.sort((a, b) => (a.published || "").localeCompare(b.published || ""));
        }
        const now = new Date();
        return rows
          .map(mergeStoredObject)
          .filter((obj) => !isStoryExpired(obj, now));
      } finally {
        await releaseStore(store as any);
      }
    },

    async receiveRemote(_ctx, object) {
      const store = getStore();
      try {
        const to = toArray(object.to);
        const cc = toArray(object.cc);
        const visibility =
          pickVisibility({ visibility: (object as any).visibility as APVisibility | undefined, to, cc }) ??
          recipientsToVisibility(to, cc);
        const parsed = ensureStoryExpiry(object, new Date());
        const stored = mapToStored(
          object.actor,
          {
            ...parsed,
            "@context": parsed["@context"] ?? createTakosContext(),
          },
          visibility,
          parsed.id ? parsed.id.split("/").pop() ?? null : null,
          false,
        );
        const existing = await store.getObject(parsed.id);
        const saved = existing ? await store.updateObject(parsed.id, stored as any) : await store.createObject(stored);
        return mergeStoredObject(saved);
      } finally {
        await releaseStore(store as any);
      }
    },

    async exists(_ctx, id) {
      const store = getStore();
      try {
        const row = await store.getObject(id);
        return !!row;
      } finally {
        await releaseStore(store as any);
      }
    },
  };
};
