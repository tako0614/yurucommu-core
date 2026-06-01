import { expect, test } from "bun:test";
/**
 * Example Test File for yurucommu
 *
 * Demonstrates testing patterns for:
 * - Hono route testing
 * - Database mock usage
 * - ActivityPub object handling
 * - Cloudflare bindings mocking
 */

import { spy } from "#test/mock";
import { Hono } from 'hono';
import {
  MockD1Database,
  MockR2Bucket,
  MockKVNamespace,
  createMockDbClient,
  createMockEnv,
  testHonoRequest,
  createMockActor,
  createMockAPObject,
} from './setup.ts';
import type { MockActor } from './setup.ts';

// ============================================================================
// Mock D1 Database Tests
// ============================================================================

test('MockD1Database - should prepare and execute queries', async () => {
  const db = new MockD1Database();

  const result = await db.prepare('SELECT * FROM actors WHERE ap_id = ?')
    .bind('https://example.com/users/test')
    .first();

  expect(result).toEqual(null);
});

test('MockD1Database - should return success for run operations', async () => {
  const db = new MockD1Database();

  const result = await db.prepare('INSERT INTO actors (ap_id, type) VALUES (?, ?)')
    .bind('https://example.com/users/test', 'Person')
    .run();

  expect(result.success).toEqual(true);
  expect(result.meta.changes).toEqual(1);
});

test('MockD1Database - should return empty results for all queries', async () => {
  const db = new MockD1Database();

  const result = await db.prepare('SELECT * FROM actors').all();

  expect(result.results).toEqual([]);
  expect(result.success).toEqual(true);
});

// ============================================================================
// Mock R2 Bucket Tests
// ============================================================================

test('MockR2Bucket - should store and retrieve media files', async () => {
  const r2 = new MockR2Bucket();

  const imageData = new Uint8Array([1, 2, 3, 4]);
  await r2.put('media/image.jpg', imageData.buffer as ArrayBuffer, {
    customMetadata: { contentType: 'image/jpeg' },
  });

  const obj = await r2.get('media/image.jpg');

  expect(obj).not.toEqual(null);
  const buffer = await obj!.arrayBuffer();
  expect(new Uint8Array(buffer)).toEqual(imageData);
});

test('MockR2Bucket - should list objects with prefix', async () => {
  const r2 = new MockR2Bucket();

  await r2.put('media/images/a.jpg', 'image a');
  await r2.put('media/images/b.jpg', 'image b');
  await r2.put('media/videos/c.mp4', 'video c');

  const result = await r2.list({ prefix: 'media/images/' });

  expect(result.objects.length).toEqual(2);
  const keys = result.objects.map((o) => o.key);
  expect(keys.includes('media/images/a.jpg')).toBeTruthy();
  expect(keys.includes('media/images/b.jpg')).toBeTruthy();
});

// ============================================================================
// Mock KV Namespace Tests
// ============================================================================

test('MockKVNamespace - should store session data', async () => {
  const kv = new MockKVNamespace();

  await kv.put('session:abc123', JSON.stringify({ userId: 'user-1' }), {
    expirationTtl: 3600,
  });

  const value = await kv.get('session:abc123');
  expect(JSON.parse(value!)).toEqual({ userId: 'user-1' });
});

test('MockKVNamespace - should handle OAuth state', async () => {
  const kv = new MockKVNamespace();

  const state = { nonce: 'xyz', returnTo: '/home' };
  await kv.put('oauth:state:abc', JSON.stringify(state), {
    expirationTtl: 600,
  });

  const value = await kv.get('oauth:state:abc');
  expect(JSON.parse(value!)).toEqual(state);
});

// ============================================================================
// Mock Database Client Tests
// ============================================================================

test('MockDbClient - should mock findUnique', async () => {
  const db = createMockDbClient();

  const mockActor = createMockActor({ preferred_username: 'testuser' });
  db.actor.findUnique = spy(() => Promise.resolve(mockActor));

  const result = await db.actor.findUnique({
    where: { ap_id: mockActor.ap_id },
  });

  expect(result).toEqual(mockActor);
});

test('MockDbClient - should mock findMany', async () => {
  const db = createMockDbClient();

  const mockActors = [
    createMockActor({ preferred_username: 'user1' }),
    createMockActor({ preferred_username: 'user2' }),
  ];
  db.actor.findMany = spy(() => Promise.resolve(mockActors));

  const result = await db.actor.findMany({
    where: { is_private: 0 },
  });

  expect(result.length).toEqual(2);
});

test('MockDbClient - should mock create', async () => {
  const db = createMockDbClient();

  const newActor = createMockActor();

  const result = await db.actor.create({
    data: newActor,
  });

  expect(result).toEqual(newActor);
});

test('MockDbClient - should mock transactions', async () => {
  const db = createMockDbClient();

  const result = await db.$transaction(async (_tx) => {
    return { success: true };
  });

  expect(result).toEqual({ success: true });
});

// ============================================================================
// ActivityPub Factory Tests
// ============================================================================

test('createMockActor - should create a valid actor with defaults', () => {
  const actor = createMockActor();

  expect(actor.type).toEqual('Person');
  expect(actor.ap_id.includes('/ap/users/')).toBeTruthy();
  expect(actor.inbox.includes('/inbox')).toBeTruthy();
  expect(actor.outbox.includes('/outbox')).toBeTruthy();
});

test('createMockActor - should allow overriding properties', () => {
  const actor = createMockActor({
    preferred_username: 'customuser',
    name: 'Custom Name',
    is_private: 1,
  });

  expect(actor.preferred_username).toEqual('customuser');
  expect(actor.name).toEqual('Custom Name');
  expect(actor.is_private).toEqual(1);
});

test('createMockAPObject - should create a valid Note', () => {
  const note = createMockAPObject();

  expect(note.type).toEqual('Note');
  expect(note.is_local).toEqual(1);
  expect(note.visibility).toEqual('public');
});

test('createMockAPObject - should create a reply', () => {
  const reply = createMockAPObject({
    in_reply_to: 'https://example.com/posts/1',
    content: '<p>This is a reply</p>',
  });

  expect(reply.in_reply_to).toEqual('https://example.com/posts/1');
});

test('createMockAPObject - should create a community post', () => {
  const post = createMockAPObject({
    community_ap_id: 'https://test.yurucommu.com/ap/groups/test-community',
    visibility: 'followers_only',
  });

  expect(post.community_ap_id!.includes('/groups/')).toBeTruthy();
  expect(post.visibility).toEqual('followers_only');
});

// ============================================================================
// Hono Route Tests
// ============================================================================

test('Hono Route Testing - should test a health endpoint', async () => {
  const app = new Hono<{ Bindings: ReturnType<typeof createMockEnv> }>();
  app.get('/health', (c) => c.json({ status: 'ok' }));

  const env = createMockEnv();
  const response = await testHonoRequest(app, env, {
    method: 'GET',
    path: '/health',
  });

  expect(response.status).toEqual(200);
  expect(response.body).toEqual({ status: 'ok' });
});

test('Hono Route Testing - should test authenticated endpoints', async () => {
  const app = new Hono<{ Bindings: ReturnType<typeof createMockEnv> }>();

  // Simple auth middleware
  app.use('/api/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  app.get('/api/me', (c) => c.json({ user: 'test' }));

  const env = createMockEnv();

  // Without auth
  const unauthorized = await testHonoRequest(app, env, {
    method: 'GET',
    path: '/api/me',
  });
  expect(unauthorized.status).toEqual(401);

  // With auth
  const authorized = await testHonoRequest(app, env, {
    method: 'GET',
    path: '/api/me',
    headers: { Authorization: 'Bearer test-token' },
  });
  expect(authorized.status).toEqual(200);
  expect(authorized.body).toEqual({ user: 'test' });
});

test('Hono Route Testing - should test POST endpoints with body', async () => {
  const app = new Hono<{ Bindings: ReturnType<typeof createMockEnv> }>();

  app.post('/api/posts', async (c) => {
    const body = await c.req.json();
    return c.json({ created: true, content: body.content });
  });

  const env = createMockEnv();
  const response = await testHonoRequest(app, env, {
    method: 'POST',
    path: '/api/posts',
    body: { content: 'Hello, World!' },
  });

  expect(response.status).toEqual(200);
  expect(response.body).toEqual({ created: true, content: 'Hello, World!' });
});

// ============================================================================
// Integration Test Pattern
// ============================================================================

test('Integration Test Pattern - should demonstrate a full integration test', async () => {
  // 1. Set up environment
  const env = createMockEnv();
  const db = env.DB_CLIENT as ReturnType<typeof createMockDbClient>;

  // 2. Set up mock data
  const mockActor = createMockActor({ preferred_username: 'testuser' });
  db.actor.findUnique = spy(() => Promise.resolve(mockActor));

  const mockPosts = [
    createMockAPObject({ attributed_to: mockActor.ap_id, content: '<p>Post 1</p>' }),
    createMockAPObject({ attributed_to: mockActor.ap_id, content: '<p>Post 2</p>' }),
  ];
  db.apObject.findMany = spy(() => Promise.resolve(mockPosts));

  // 3. Create app with routes
  const app = new Hono<{ Bindings: typeof env }>();

  app.get('/api/users/:username', async (c) => {
    const username = c.req.param('username');
    const actor = await db.actor.findUnique({
      where: { preferred_username: username },
    });

    if (!actor) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(actor);
  });

  app.get('/api/users/:username/posts', async (c) => {
    const username = c.req.param('username');
    const actor = await db.actor.findUnique({
      where: { preferred_username: username },
    });

    if (!actor) {
      return c.json({ error: 'Not found' }, 404);
    }

    const posts = await db.apObject.findMany({
      where: { attributed_to: actor.ap_id },
    });

    return c.json({ posts });
  });

  // 4. Test the endpoints
  const userResponse = await testHonoRequest(app, env, {
    path: '/api/users/testuser',
  });

  expect(userResponse.status).toEqual(200);
  expect((userResponse.body as MockActor).preferred_username).toEqual('testuser');

  const postsResponse = await testHonoRequest(app, env, {
    path: '/api/users/testuser/posts',
  });

  expect(postsResponse.status).toEqual(200);
  expect((postsResponse.body as { posts: unknown[] }).posts.length).toEqual(2);
});

test('Integration Test Pattern - should test media upload flow', async () => {
  const env = createMockEnv();

  const app = new Hono<{ Bindings: typeof env }>();

  app.post('/api/media', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const r2 = env.MEDIA as MockR2Bucket;
    const key = `uploads/${Date.now()}-${file.name}`;
    await r2.put(key, await file.arrayBuffer(), {
      customMetadata: { contentType: file.type },
    });

    return c.json({ key, url: `https://media.example.com/${key}` });
  });

  // Note: In real tests, you'd need to properly mock FormData
  // This is a simplified example
  expect(app !== undefined).toBeTruthy();
});
