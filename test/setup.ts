/**
 * Test Setup for yurucommu (Deno)
 *
 * This file provides:
 * - Mock Cloudflare Workers bindings (D1, R2, KV)
 * - Mock database client
 * - Hono app testing utilities
 * - ActivityPub test helpers
 */
import { spy } from 'jsr:@std/testing/mock';
import { Hono } from 'hono';

// ============================================================================
// Mock D1Database (Cloudflare D1)
// ============================================================================

export class MockD1Database {
  private data: Map<string, unknown[]> = new Map();

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  exec(_query: string): Promise<{ count: number; duration: number }> {
    return Promise.resolve({ count: 1, duration: 0 });
  }

  batch<T>(statements: MockD1PreparedStatement[]): Promise<T[]> {
    return Promise.all(statements.map((s) => s.run())) as Promise<T[]>;
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

export class MockD1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private query: string,
    private db: MockD1Database
  ) {}

  bind(...values: unknown[]): MockD1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = unknown>(_column?: string): Promise<T | null> {
    return null as T | null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
    return { results: [], success: true, meta: {} };
  }

  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number; duration: number } }> {
    return { success: true, meta: { changes: 1, last_row_id: 1, duration: 0 } };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return [];
  }
}

// ============================================================================
// Mock R2Bucket (Cloudflare R2)
// ============================================================================

export class MockR2Bucket {
  private objects: Map<string, { body: ArrayBuffer; metadata: Record<string, string> }> = new Map();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: { customMetadata?: Record<string, string> }
  ): Promise<MockR2Object> {
    let body: ArrayBuffer;
    if (typeof value === 'string') {
      body = new TextEncoder().encode(value).buffer as ArrayBuffer;
    } else if (value instanceof ArrayBuffer) {
      body = value;
    } else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      body = combined.buffer as ArrayBuffer;
    }

    this.objects.set(key, { body, metadata: options?.customMetadata || {} });
    return new MockR2Object(key, body, options?.customMetadata || {});
  }

  async get(key: string): Promise<MockR2ObjectBody | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockR2ObjectBody(key, obj.body, obj.metadata);
  }

  async head(key: string): Promise<MockR2Object | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockR2Object(key, obj.body, obj.metadata);
  }

  async delete(key: string | string[]): Promise<void> {
    if (Array.isArray(key)) {
      key.forEach((k) => this.objects.delete(k));
    } else {
      this.objects.delete(key);
    }
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{
    objects: MockR2Object[];
    truncated: boolean;
  }> {
    let objects = Array.from(this.objects.entries()).map(
      ([key, { body, metadata }]) => new MockR2Object(key, body, metadata)
    );

    if (options?.prefix) {
      objects = objects.filter((obj) => obj.key.startsWith(options.prefix!));
    }

    if (options?.limit) {
      objects = objects.slice(0, options.limit);
    }

    return { objects, truncated: false };
  }
}

export class MockR2Object {
  readonly size: number;
  readonly etag: string;
  readonly uploaded: Date;

  constructor(
    readonly key: string,
    protected readonly bodyBytes: ArrayBuffer,
    readonly customMetadata: Record<string, string>
  ) {
    this.size = bodyBytes.byteLength;
    this.etag = 'mock-etag';
    this.uploaded = new Date();
  }
}

export class MockR2ObjectBody extends MockR2Object {
  constructor(key: string, bodyBytes: ArrayBuffer, customMetadata: Record<string, string>) {
    super(key, bodyBytes, customMetadata);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bodyBytes;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.bodyBytes);
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text());
  }

  get body(): ReadableStream {
    return new ReadableStream({
      start: (controller) => {
        controller.enqueue(new Uint8Array(this.bodyBytes));
        controller.close();
      },
    });
  }
}

// ============================================================================
// Mock KVNamespace (Cloudflare KV)
// ============================================================================

export class MockKVNamespace {
  private store: Map<string, { value: string; metadata?: unknown; expiration?: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiration && item.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async getWithMetadata<T = unknown>(key: string): Promise<{ value: string | null; metadata: T | null }> {
    const item = this.store.get(key);
    if (!item) return { value: null, metadata: null };
    return { value: item.value, metadata: (item.metadata as T) || null };
  }

  async put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }
  ): Promise<void> {
    let expiration: number | undefined;
    if (options?.expiration) {
      expiration = options.expiration;
    } else if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }
    this.store.set(key, { value, metadata: options?.metadata, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: { name: string; expiration?: number; metadata?: unknown }[];
    list_complete: boolean;
  }> {
    let keys = Array.from(this.store.entries())
      .filter(([name]) => !options?.prefix || name.startsWith(options.prefix))
      .map(([name, { expiration, metadata }]) => ({ name, expiration, metadata }));

    if (options?.limit) {
      keys = keys.slice(0, options.limit);
    }

    return { keys, list_complete: true };
  }
}

// ============================================================================
// Mock Database Client
// ============================================================================

export interface MockDbOperation {
  findUnique: (...args: any[]) => Promise<any>;
  findFirst: (...args: any[]) => Promise<any>;
  findMany: (...args: any[]) => Promise<any>;
  create: (...args: any[]) => Promise<any>;
  createMany: (...args: any[]) => Promise<any>;
  update: (...args: any[]) => Promise<any>;
  updateMany: (...args: any[]) => Promise<any>;
  delete: (...args: any[]) => Promise<any>;
  deleteMany: (...args: any[]) => Promise<any>;
  count: (...args: any[]) => Promise<any>;
  aggregate: (...args: any[]) => Promise<any>;
  upsert: (...args: any[]) => Promise<any>;
}

function createMockDbOperation(): MockDbOperation {
  return {
    findUnique: spy((..._args: any[]) => Promise.resolve(null)),
    findFirst: spy((..._args: any[]) => Promise.resolve(null)),
    findMany: spy((..._args: any[]) => Promise.resolve([])),
    create: spy((args: { data: unknown }) => Promise.resolve(args.data)),
    createMany: spy((..._args: any[]) => Promise.resolve({ count: 0 })),
    update: spy((args: { data: unknown }) => Promise.resolve(args.data)),
    updateMany: spy((..._args: any[]) => Promise.resolve({ count: 0 })),
    delete: spy((..._args: any[]) => Promise.resolve(null)),
    deleteMany: spy((..._args: any[]) => Promise.resolve({ count: 0 })),
    count: spy((..._args: any[]) => Promise.resolve(0)),
    aggregate: spy((..._args: any[]) => Promise.resolve({})),
    upsert: spy((args: { create: unknown }) => Promise.resolve(args.create)),
  };
}

export function createMockDbClient() {
  return {
    actor: createMockDbOperation(),
    actorCache: createMockDbOperation(),
    apObject: createMockDbOperation(),
    follow: createMockDbOperation(),
    like: createMockDbOperation(),
    announce: createMockDbOperation(),
    community: createMockDbOperation(),
    communityMember: createMockDbOperation(),
    communityMessage: createMockDbOperation(),
    story: createMockDbOperation(),
    storyView: createMockDbOperation(),
    storyReaction: createMockDbOperation(),
    dmConversation: createMockDbOperation(),
    dmParticipant: createMockDbOperation(),
    dmMessage: createMockDbOperation(),
    notification: createMockDbOperation(),
    $transaction: spy((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    $connect: spy(() => Promise.resolve(undefined)),
    $disconnect: spy(() => Promise.resolve(undefined)),
  };
}

// ============================================================================
// Hono Test Utilities
// ============================================================================

export interface HonoTestRequest {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface HonoTestResponse {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

/**
 * Make a test request to a Hono app
 */
export async function testHonoRequest<E extends Record<string, unknown>>(
  app: Hono<{ Bindings: E }>,
  env: E,
  options: HonoTestRequest
): Promise<HonoTestResponse> {
  const url = new URL(options.path, 'http://localhost');

  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
  }

  const request = new Request(url.toString(), {
    method: options.method || 'GET',
    headers,
    body,
  });

  const response = await app.fetch(request, env);
  const text = await response.text();

  let responseBody: unknown;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    body: responseBody,
    text,
  };
}

// ============================================================================
// ActivityPub Test Helpers
// ============================================================================

export interface MockActor {
  ap_id: string;
  type: string;
  preferred_username: string;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  header_url: string | null;
  inbox: string;
  outbox: string;
  followers_url: string;
  following_url: string;
  public_key_pem: string;
  private_key_pem: string;
  takos_user_id: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_private: number;
  role: 'owner' | 'moderator' | 'member';
  created_at: string;
}

export function createMockActor(overrides: Partial<MockActor> = {}): MockActor {
  const username = overrides.preferred_username || `user_${Date.now()}`;
  const domain = 'test.yurucommu.com';
  const baseUrl = `https://${domain}/ap/users/${username}`;

  return {
    ap_id: overrides.ap_id || baseUrl,
    type: overrides.type || 'Person',
    preferred_username: username,
    name: overrides.name !== undefined ? overrides.name : `Test User ${username}`,
    summary: overrides.summary !== undefined ? overrides.summary : null,
    icon_url: overrides.icon_url !== undefined ? overrides.icon_url : null,
    header_url: overrides.header_url !== undefined ? overrides.header_url : null,
    inbox: overrides.inbox || `${baseUrl}/inbox`,
    outbox: overrides.outbox || `${baseUrl}/outbox`,
    followers_url: overrides.followers_url || `${baseUrl}/followers`,
    following_url: overrides.following_url || `${baseUrl}/following`,
    public_key_pem: overrides.public_key_pem || '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----',
    private_key_pem: overrides.private_key_pem || '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
    takos_user_id: overrides.takos_user_id !== undefined ? overrides.takos_user_id : null,
    follower_count: overrides.follower_count || 0,
    following_count: overrides.following_count || 0,
    post_count: overrides.post_count || 0,
    is_private: overrides.is_private || 0,
    role: overrides.role || 'member',
    created_at: overrides.created_at || new Date().toISOString(),
  };
}

export interface MockAPObject {
  ap_id: string;
  type: string;
  attributed_to: string;
  content: string;
  summary: string | null;
  attachments_json: string;
  in_reply_to: string | null;
  visibility: string;
  community_ap_id: string | null;
  end_time: string | null;
  like_count: number;
  reply_count: number;
  announce_count: number;
  share_count: number;
  published: string;
  is_local: number;
}

export function createMockAPObject(overrides: Partial<MockAPObject> = {}): MockAPObject {
  const id = overrides.ap_id || `https://test.yurucommu.com/ap/objects/${Date.now()}`;

  return {
    ap_id: id,
    type: overrides.type || 'Note',
    attributed_to: overrides.attributed_to || 'https://test.yurucommu.com/ap/users/test',
    content: overrides.content || '<p>Test content</p>',
    summary: overrides.summary !== undefined ? overrides.summary : null,
    attachments_json: overrides.attachments_json || '[]',
    in_reply_to: overrides.in_reply_to !== undefined ? overrides.in_reply_to : null,
    visibility: overrides.visibility || 'public',
    community_ap_id: overrides.community_ap_id !== undefined ? overrides.community_ap_id : null,
    end_time: overrides.end_time !== undefined ? overrides.end_time : null,
    like_count: overrides.like_count || 0,
    reply_count: overrides.reply_count || 0,
    announce_count: overrides.announce_count || 0,
    share_count: overrides.share_count || 0,
    published: overrides.published || new Date().toISOString(),
    is_local: overrides.is_local !== undefined ? overrides.is_local : 1,
  };
}

// ============================================================================
// Environment Factory
// ============================================================================

export function createMockEnv(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    DB: new MockD1Database(),
    MEDIA: new MockR2Bucket(),
    KV: new MockKVNamespace(),
    ASSETS: {
      fetch: spy(() => Promise.resolve(new Response('', { status: 404 }))),
    },
    DB_CLIENT: createMockDbClient(),
    APP_URL: 'https://test.yurucommu.com',
    TAKOS_URL: 'https://takos.jp',
    ...overrides,
  };
}
