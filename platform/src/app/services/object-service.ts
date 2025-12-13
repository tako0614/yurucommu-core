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
  "@context"?: string | (string | Record<string, unknown>)[] | Record<string, unknown>;
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
  actor?: string | string[];
  context?: string;
  visibility?: APVisibility;
  inReplyTo?: string;
  isLocal?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
  includeDirect?: boolean;
  participant?: string;
  order?: "asc" | "desc";
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
  includeDirect?: boolean;
  actor?: string | string[];
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
    actor?: string | string[];
    context?: string;
    visibility?: string | string[];
    in_reply_to?: string;
    include_deleted?: boolean;
    exclude_direct?: boolean;
    include_direct?: boolean;
    participant?: string;
    since?: string;
    until?: string;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): Promise<StoredObject[]>;
  deleteObject(id: string): Promise<void>;
  replaceObjectRecipients?(
    objectId: string,
    recipients: { object_id: string; recipient: string; recipient_type: string }[],
  ): Promise<void>;
  listObjectRecipients?(
    objectId: string,
  ): Promise<{ object_id: string; recipient: string; recipient_type: string }[]>;
  appendAuditLog(entry: {
    id?: string;
    timestamp?: string;
    actor_type: string;
    actor_id?: string | null;
    action: string;
    target?: string | null;
    details?: Record<string, unknown> | null;
    checksum: string;
    prev_checksum?: string | null;
  }): Promise<any>;
  getLatestAuditLog(): Promise<{ checksum?: string | null } | null>;
  adjustMediaRefCounts?(urls: string[], delta: number): Promise<void>;
};

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";

const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
};

const normalizeStringList = (value: unknown): string[] => {
  const values = toArray(value)
    .map((item) => (typeof item === "string" ? item : String(item)))
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of values) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
};

type RecipientSet = { to: string[]; cc: string[]; bto: string[]; bcc: string[] };

const normalizeRecipients = (recipients: {
  to?: unknown;
  cc?: unknown;
  bto?: unknown;
  bcc?: unknown;
}): RecipientSet => {
  const order = ["to", "cc", "bto", "bcc"] as const;
  const seen = new Set<string>();
  const result: Record<(typeof order)[number], string[]> = {
    to: [],
    cc: [],
    bto: [],
    bcc: [],
  };
  for (const key of order) {
    const list = normalizeStringList((recipients as any)[key]);
    result[key] = list.filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  }
  return result;
};

const hasRecipients = (recipients: RecipientSet): boolean =>
  recipients.to.length > 0 || recipients.cc.length > 0 || recipients.bto.length > 0 || recipients.bcc.length > 0;

const recipientRowsFromSet = (
  objectId: string,
  recipients: RecipientSet,
): { object_id: string; recipient: string; recipient_type: string }[] => {
  const rows: { object_id: string; recipient: string; recipient_type: string }[] = [];
  const push = (list: string[], type: string) => {
    for (const recipient of list) {
      rows.push({ object_id: objectId, recipient, recipient_type: type });
    }
  };
  push(recipients.to, "to");
  push(recipients.cc, "cc");
  push(recipients.bto, "bto");
  push(recipients.bcc, "bcc");
  return rows;
};

const recipientSetFromRows = (
  rows: { recipient: string; recipient_type: string }[] | null | undefined,
): RecipientSet => {
  const bucket: RecipientSet = { to: [], cc: [], bto: [], bcc: [] };
  if (!rows) return bucket;
  for (const row of rows) {
    if (!row?.recipient_type || !row?.recipient) continue;
    switch ((row.recipient_type || "").toLowerCase()) {
      case "to":
        bucket.to.push(row.recipient);
        break;
      case "cc":
        bucket.cc.push(row.recipient);
        break;
      case "bto":
        bucket.bto.push(row.recipient);
        break;
      case "bcc":
        bucket.bcc.push(row.recipient);
        break;
      default:
        break;
    }
  }
  return normalizeRecipients(bucket);
};

const normalizeTags = (tags?: unknown, stickers?: unknown): APTag[] | undefined => {
  const result: APTag[] = [];
  const seen = new Set<string>();
  const addTag = (tag: APTag) => {
    const key = `${tag.type}:${tag.name ?? tag.href ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(tag);
  };

  if (typeof tags === "string" && tags.trim()) {
    addTag({ type: "Hashtag", name: tags.startsWith("#") ? tags.trim() : `#${tags.trim()}` });
  }

  if (Array.isArray(tags)) {
    for (const entry of tags) {
      if (typeof entry === "string" && entry.trim()) {
        addTag({ type: "Hashtag", name: entry.startsWith("#") ? entry.trim() : `#${entry.trim()}` });
      } else if (entry && typeof entry === "object") {
        addTag(entry as APTag);
      }
    }
  } else if (tags && typeof tags === "object") {
    addTag(tags as APTag);
  }

  if (Array.isArray(stickers)) {
    for (const sticker of stickers) {
      if (sticker && typeof sticker === "object") {
        const href =
          typeof (sticker as any).url === "string"
            ? (sticker as any).url
            : typeof (sticker as any).src === "string"
              ? (sticker as any).src
              : undefined;
        if (!href) continue;
        addTag({
          type: "Sticker",
          href,
          name: typeof (sticker as any).name === "string" ? (sticker as any).name : undefined,
        });
      }
    }
  }

  return result.length ? result : undefined;
};

const normalizePoll = (poll?: APPoll | null): APPoll | undefined => {
  if (!poll) return undefined;
  const options = Array.isArray(poll.options)
    ? poll.options
        .map((opt) =>
          typeof opt === "string" ? { name: opt } : { ...opt, name: typeof opt.name === "string" ? opt.name : "" },
        )
        .map((opt) => ({ ...opt, name: opt.name?.trim?.() ?? "" }))
        .filter((opt) => opt.name)
    : [];
  if (!options.length) return undefined;
  const normalized: APPoll = {
    ...poll,
    options,
  };
  if (poll.expiresAt) {
    const expires = new Date(poll.expiresAt);
    normalized.expiresAt = Number.isNaN(expires.getTime()) ? poll.expiresAt : expires.toISOString();
  }
  return normalized;
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

const encoder = new TextEncoder();
async function sha256(input: string): Promise<string> {
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function mergeStoredObject(stored: StoredObject, recipientsOverride?: RecipientSet): APObject {
  const content = parseJson<Record<string, unknown>>(stored.content, {});
  const recipients =
    recipientsOverride ??
    normalizeRecipients({
      to: stored.to ?? (content.to as any),
      cc: stored.cc ?? (content.cc as any),
      bto: stored.bto ?? (content.bto as any),
      bcc: stored.bcc ?? (content.bcc as any),
    });
  const inferredVisibility = hasRecipients(recipients)
    ? recipientsToVisibility(recipients.to, recipients.cc, recipients.bto, recipients.bcc)
    : undefined;
  const visibility =
    (content.visibility as APVisibility | undefined) ??
    (stored.visibility as APVisibility | null) ??
    inferredVisibility;
  const base: APObject = {
    "@context": (content["@context"] as APObject["@context"]) ?? createTakosContext(),
    id: (content.id as string) ?? stored.id,
    type: (content.type as string) ?? stored.type,
    actor: (content.actor as string) ?? stored.actor,
    to: recipients.to,
    cc: recipients.cc,
    bto: recipients.bto,
    bcc: recipients.bcc,
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
  (base as any).visibility = visibility ?? null;
  return base;
}

const loadRecipientsForObject = async (store: ObjectStore, stored: StoredObject): Promise<RecipientSet | undefined> => {
  if (typeof store.listObjectRecipients === "function") {
    try {
      const rows = await store.listObjectRecipients(stored.id);
      const recipients = recipientSetFromRows(rows);
      if (hasRecipients(recipients)) {
        return recipients;
      }
    } catch {
      // fall through to stored values
    }
  }
  const existing = normalizeRecipients({
    to: stored.to,
    cc: stored.cc,
    bto: stored.bto,
    bcc: stored.bcc,
  });
  return hasRecipients(existing) ? existing : undefined;
};

const persistRecipients = async (store: ObjectStore, objectId: string, recipients: RecipientSet) => {
  if (typeof store.replaceObjectRecipients !== "function") return;
  const rows = recipientRowsFromSet(objectId, recipients);
  await store.replaceObjectRecipients(objectId, rows);
};

const toApObject = async (store: ObjectStore, stored: StoredObject): Promise<APObject> => {
  const recipients = await loadRecipientsForObject(store, stored);
  return mergeStoredObject(stored, recipients);
};

const storyExpiresAt = (object: APObject): Date | null => {
  const story = (object as any)["takos:story"] ?? (object as any).story;
  const expiresRaw =
    (story as any)?.expiresAt ??
    (story as any)?.expires_at ??
    (object as any).expiresAt ??
    (object as any).expires_at;
  if (typeof expiresRaw === "string") {
    const d = new Date(expiresRaw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (expiresRaw instanceof Date) return expiresRaw;
  if (story || object.type === "Story") {
    const published = object.published ? new Date(object.published) : null;
    if (published && !Number.isNaN(published.getTime())) {
      return new Date(published.getTime() + STORY_TTL_MS);
    }
  }
  return null;
};

const isStoryExpired = (object: APObject, now: Date): boolean => {
  const expiresAt = storyExpiresAt(object);
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
};

const ensureStoryExpiry = (object: APObject, now: Date): APObject => {
  const story = (object as any)["takos:story"] ?? (object as any).story;
  const hasStory =
    Boolean(story) ||
    object.type === "Story" ||
    (object as any).expiresAt !== undefined ||
    (object as any).expires_at !== undefined;
  if (!hasStory) return object;
  const published = object.published ? new Date(object.published) : now;
  const expiresRaw =
    (story as any)?.expiresAt ??
    (story as any)?.expires_at ??
    (object as any).expiresAt ??
    (object as any).expires_at;
  const parsed = expiresRaw ? new Date(expiresRaw) : null;
  const expiresAt =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed
      : new Date(published.getTime() + STORY_TTL_MS);
  const expiresIso = expiresAt.toISOString();
  const storyValue = story ? { ...story, expiresAt: expiresIso } : { expiresAt: expiresIso };
  const next: any = { ...object, "takos:story": storyValue };
  if (!(object as any).expiresAt) {
    next.expiresAt = expiresIso;
  }
  return next;
};

const attachmentUrls = (attachments?: APAttachment[] | null): string[] => {
  if (!attachments || !attachments.length) return [];
  return Array.from(new Set(attachments.map((a) => String(a.url || "").trim()).filter(Boolean)));
};

async function adjustMediaRefCount(store: ObjectStore, attachments: APAttachment[] | undefined, delta: number) {
  if (!attachments || !attachments.length) return;
  const urls = attachmentUrls(attachments);
  if (!urls.length) return;
  if (typeof store.adjustMediaRefCounts !== "function") return;
  await store.adjustMediaRefCounts(urls, delta);
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
): { to: string[]; cc: string[]; bto?: string[]; bcc?: string[] } {
  switch (visibility) {
    case "public":
      return {
        to: [PUBLIC_AUDIENCE],
        cc: followersUri ? [followersUri] : [],
      };
    case "unlisted":
      return {
        to: followersUri ? [followersUri] : [],
        cc: [PUBLIC_AUDIENCE],
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
export function recipientsToVisibility(
  to: string[],
  cc: string[],
  bto: string[] = [],
  bcc: string[] = [],
): APVisibility {
  if (to.includes(PUBLIC_AUDIENCE) || bto.includes(PUBLIC_AUDIENCE)) {
    return "public";
  }
  if (cc.includes(PUBLIC_AUDIENCE) || bcc.includes(PUBLIC_AUDIENCE)) {
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

function pickVisibility(input: {
  visibility?: APVisibility;
  to?: string[] | null;
  cc?: string[] | null;
  bto?: string[] | null;
  bcc?: string[] | null;
}): APVisibility | undefined {
  if (input.visibility) return input.visibility;
  const to = toArray(input.to);
  const cc = toArray(input.cc);
  const bto = toArray(input.bto);
  const bcc = toArray(input.bcc);
  if (to.length || cc.length || bto.length || bcc.length) {
    return recipientsToVisibility(to, cc, bto, bcc);
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
    const normalizedRecipients = normalizeRecipients({
      to: object.to,
      cc: object.cc,
      bto: object.bto,
      bcc: object.bcc,
    });
    const visibilityValue =
      visibility ??
      recipientsToVisibility(
        normalizedRecipients.to,
        normalizedRecipients.cc,
        normalizedRecipients.bto,
        normalizedRecipients.bcc,
      );
    return {
      id: object.id,
      local_id: localId ?? null,
      type: object.type,
      actor,
      published: object.published ?? new Date().toISOString(),
      updated: object.updated ?? null,
      to: normalizedRecipients.to,
      cc: normalizedRecipients.cc,
      bto: normalizedRecipients.bto.length ? normalizedRecipients.bto : null,
      bcc: normalizedRecipients.bcc.length ? normalizedRecipients.bcc : null,
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

  const appendAudit = async (
    store: ObjectStore,
    actor: string | null,
    action: string,
    target: string,
    details: Record<string, unknown>,
  ) => {
    if (typeof store.appendAuditLog !== "function" || typeof store.getLatestAuditLog !== "function") {
      throw new Error("audit log support is required (appendAuditLog/getLatestAuditLog missing)");
    }
    const prev = (await store.getLatestAuditLog()) ?? null;
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const prevChecksum = (prev as any)?.checksum ?? (prev as any)?.prev_checksum ?? null;
    const checksum = await sha256(
      [
        id,
        timestamp,
        actor ?? "",
        action,
        target,
        JSON.stringify(details ?? {}),
        prevChecksum ?? "",
      ].join(""),
    );
    await store.appendAuditLog({
      id,
      timestamp,
      actor_type: actor ? "user" : "system",
      actor_id: actor ?? null,
      action,
      target,
      details,
      checksum,
      prev_checksum: prevChecksum ?? null,
    });
  };

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
        const defaults = visibilityToRecipients(input.visibility ?? "public", actor, `${actor}/followers`);
        const audience = normalizeRecipients({
          to: input.to ?? defaults.to,
          cc: input.cc ?? defaults.cc,
          bto: input.bto ?? (defaults as any).bto,
          bcc: input.bcc ?? (defaults as any).bcc,
        });
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
        const poll = normalizePoll(input.poll ?? (input as any)["takos:poll"]);
        const tags = normalizeTags(input.tag, (input as any).stickers ?? (input as any).sticker);

        const apObject: APObject = ensureStoryExpiry(
          {
            "@context": createTakosContext(),
            id: objectId,
            type: input.type,
            actor,
            to: audience.to,
            cc: audience.cc,
            bto: audience.bto,
            bcc: audience.bcc,
            content: input.content,
            summary: input.summary,
            inReplyTo: input.inReplyTo ?? null,
            context: input.context ?? undefined,
            attachment: input.attachment,
            tag: tags,
            published: now.toISOString(),
            updated: now.toISOString(),
            "takos:poll": poll,
            "takos:story": story,
            visibility: input.visibility,
          },
          now,
        );

        const stored = mapToStored(
          actor,
          apObject,
          pickVisibility({
            visibility: input.visibility,
            to: audience.to,
            cc: audience.cc,
            bto: audience.bto,
            bcc: audience.bcc,
          }),
          localId,
          true,
        );
        const created = await store.createObject(stored);
        await persistRecipients(store, stored.id, audience);
        await adjustMediaRefCount(store, apObject.attachment as APAttachment[] | undefined, 1);
        await appendAudit(store, actor, "object.create", stored.id, {
          type: stored.type,
          visibility: stored.visibility ?? null,
          is_local: stored.is_local,
          recipients: audience,
        });
        return mergeStoredObject(created, audience);
      } finally {
        await releaseStore(store as any);
      }
    },

    async get(_ctx, id) {
      const store = getStore();
      try {
        const row = await store.getObject(id);
        if (!row) return null;
        const object = await toApObject(store, row);
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
        const object = await toApObject(store, row);
        return isStoryExpired(object, new Date()) ? null : object;
      } finally {
        await releaseStore(store as any);
      }
    },

    async query(_ctx, params) {
      const store = getStore();
      const offset = params.cursor ? parseInt(params.cursor, 10) || 0 : 0;
      const limit = params.limit ?? 20;
      const excludeDirect = !params.visibility && !params.includeDirect;
      const visibility = params.visibility ?? (excludeDirect ? ["public", "unlisted", "followers", "community"] : undefined);
      try {
        const rows = await store.queryObjects({
          type: params.type,
          actor: params.actor,
          context: params.context,
          visibility,
          in_reply_to: params.inReplyTo,
          include_deleted: params.includeDeleted,
          exclude_direct: excludeDirect,
          include_direct: params.includeDirect,
          participant: params.participant,
          order: params.order,
          since: params.since,
          until: params.until,
          limit,
          offset,
        });
        const now = new Date();
        const mapped = await Promise.all(rows.map((row: any) => toApObject(store, row)));
        const visible = mapped.filter((obj) => !isStoryExpired(obj, now));
        return toPage(visible, limit, offset);
      } finally {
        await releaseStore(store as any);
      }
    },

    async update(ctx, id, input) {
      const store = getStore();
      try {
        const existing = await store.getObject(id);
        if (!existing) throw new Error("Object not found");
        const current = await toApObject(store, existing);
        const {
          content: nextContent,
          summary: nextSummary,
          attachment: nextAttachment,
          tag: nextTag,
          poll: nextPollInput,
          ...rest
        } = (input as Record<string, unknown>) ?? {};
        const nextTags =
          nextTag !== undefined
            ? normalizeTags(nextTag as any, (input as any).stickers ?? (input as any).sticker) ?? current.tag
            : current.tag;
        const nextPoll =
          nextPollInput !== undefined || (input as any)["takos:poll"] !== undefined
            ? normalizePoll((nextPollInput as any) ?? (input as any)["takos:poll"]) ?? current["takos:poll"]
            : current["takos:poll"];
        const updatedObject: APObject = {
          ...current,
          ...rest,
          id: current.id,
          actor: current.actor,
          content: (nextContent as any) ?? current.content,
          summary: (nextSummary as any) ?? current.summary,
          attachment: (nextAttachment as any) ?? current.attachment,
          tag: nextTags,
          "takos:poll": nextPoll,
          updated: new Date().toISOString(),
        };

        const stored = mapToStored(
          current.actor,
          updatedObject,
          pickVisibility({
            visibility: ((updatedObject as any).visibility as APVisibility | undefined) ?? (existing.visibility as APVisibility | undefined),
            to: updatedObject.to,
            cc: updatedObject.cc,
            bto: (updatedObject as any).bto,
            bcc: (updatedObject as any).bcc,
          }),
          existing.local_id,
          existing.is_local === 1,
        );
        const beforeAttachments = current.attachment as APAttachment[] | undefined;
        const afterAttachments = updatedObject.attachment as APAttachment[] | undefined;
        await store.updateObject(id, stored as any);
        const normalizedRecipients = normalizeRecipients({
          to: stored.to ?? undefined,
          cc: stored.cc ?? undefined,
          bto: stored.bto ?? undefined,
          bcc: stored.bcc ?? undefined,
        });
        await persistRecipients(store, id, normalizedRecipients);

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

        await appendAudit(store, current.actor, "object.update", id, {
          type: stored.type,
          visibility: stored.visibility ?? existing.visibility,
          updated: stored.updated ?? new Date().toISOString(),
          recipients: normalizedRecipients,
        });
        return mergeStoredObject({ ...existing, ...stored } as unknown as StoredObject, normalizedRecipients);
      } finally {
        await releaseStore(store as any);
      }
    },

    async delete(_ctx, id) {
      const store = getStore();
      try {
        const existing = await store.getObject(id);
        if (existing) {
          const object = await toApObject(store, existing);
          await adjustMediaRefCount(store, object.attachment as APAttachment[] | undefined, -1);
          await store.updateObject(id, { deleted_at: new Date().toISOString() });
          await appendAudit(store, object.actor, "object.delete", id, {
            type: existing.type,
            visibility: existing.visibility ?? null,
            recipients: normalizeRecipients({
              to: object.to,
              cc: object.cc,
              bto: (object as any).bto,
              bcc: (object as any).bcc,
            }),
          });
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
        : ["public", "unlisted", "followers", "community"];
      const types = params.type ?? ["Note", "Article", "Question", "Announce", "Like"];
      try {
        const rows = await store.queryObjects({
          type: types,
          actor: params.actor,
          context: params.communityId ?? undefined,
          visibility,
          include_deleted: false,
          include_direct: params.includeDirect,
          exclude_direct: !params.includeDirect && !(params.visibility || []).includes("direct"),
          limit,
          offset,
        });
        const now = new Date();
        const mapped = (await Promise.all(rows.map((row: any) => toApObject(store, row))))
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
        const rows = await store.queryObjects({
          context: contextId,
          include_deleted: false,
          limit: 200,
          order: "asc",
          include_direct: true,
        });
        const now = new Date();
        const mapped = await Promise.all(rows.map((row: any) => toApObject(store, row)));
        return mapped.filter((obj) => !isStoryExpired(obj, now));
      } finally {
        await releaseStore(store as any);
      }
    },

    async receiveRemote(_ctx, object) {
      const store = getStore();
      try {
        const recipients = normalizeRecipients({
          to: object.to,
          cc: object.cc,
          bto: (object as any).bto,
          bcc: (object as any).bcc,
        });
        const visibility =
          pickVisibility({
            visibility: (object as any).visibility as APVisibility | undefined,
            to: recipients.to,
            cc: recipients.cc,
            bto: recipients.bto,
            bcc: recipients.bcc,
          }) ??
          recipientsToVisibility(recipients.to, recipients.cc, recipients.bto, recipients.bcc);
        const parsed = ensureStoryExpiry(
          {
            ...object,
            to: recipients.to,
            cc: recipients.cc,
            bto: recipients.bto,
            bcc: recipients.bcc,
            tag: normalizeTags(object.tag, (object as any).stickers ?? (object as any).sticker),
            "takos:poll": normalizePoll((object as any)["takos:poll"] ?? (object as any).poll ?? null),
          },
          new Date(),
        );
        const stored = mapToStored(
          object.actor,
          {
            ...parsed,
            "@context": (parsed["@context"] as APObject["@context"]) ?? createTakosContext(),
          },
          visibility,
          parsed.id ? parsed.id.split("/").pop() ?? null : null,
          false,
        );
        const existing = await store.getObject(parsed.id);
        const saved = existing ? await store.updateObject(parsed.id, stored as any) : await store.createObject(stored);
        await persistRecipients(store, stored.id, recipients);
        await appendAudit(store, object.actor ?? null, existing ? "object.receive.update" : "object.receive", parsed.id, {
          type: stored.type,
          visibility: stored.visibility ?? null,
          is_local: stored.is_local,
          recipients,
        });
        return mergeStoredObject(saved, recipients);
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
