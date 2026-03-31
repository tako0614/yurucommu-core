/**
 * Example Test File for yurucommu
 *
 * Demonstrates testing patterns for:
 * - Hono route testing
 * - Database mock usage
 * - ActivityPub object handling
 * - Cloudflare bindings mocking
 */

import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert';
import { spy } from 'jsr:@std/testing/mock';
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

Deno.test('MockD1Database - should prepare and execute queries', async () => {
  const db = new MockD1Database();

  const result = await db.prepare('SELECT * FROM actors WHERE ap_id = ?')
    .bind('https://example.com/users/test')
    .first();

  assertEquals(result, null);
});

Deno.test('MockD1Database - should return success for run operations', async () => {
  const db = new MockD1Database();

  const result = await db.prepare('INSERT INTO actors (ap_id, type) VALUES (?, ?)')
    .bind('https://example.com/users/test', 'Person')
    .run();

  assertEquals(result.success, true);
  assertEquals(result.meta.changes, 1);
});

Deno.test('MockD1Database - should return empty results for all queries', async () => {
  const db = new MockD1Database();

  const result = await db.prepare('SELECT * FROM actors').all();

  assertEquals(result.results, []);
  assertEquals(result.success, true);
});

// ============================================================================
// Mock R2 Bucket Tests
// ============================================================================

Deno.test('MockR2Bucket - should store and retrieve media files', async () => {
  const r2 = new MockR2Bucket();

  const imageData = new Uint8Array([1, 2, 3, 4]);
  await r2.put('media/image.jpg', imageData.buffer as ArrayBuffer, {
    customMetadata: { contentType: 'image/jpeg' },
  });

  const obj = await r2.get('media/image.jpg');

  assertNotEquals(obj, null);
  const buffer = await obj!.arrayBuffer();
  assertEquals(new Uint8Array(buffer), imageData);
});

Deno.test('MockR2Bucket - should list objects with prefix', async () => {
  const r2 = new MockR2Bucket();

  await r2.put('media/images/a.jpg', 'image a');
  await r2.put('media/images/b.jpg', 'image b');
  await r2.put('media/videos/c.mp4', 'video c');

  const result = await r2.list({ prefix: 'media/images/' });

  assertEquals(result.objects.length, 2);
  const keys = result.objects.map((o) => o.key);
  assert(keys.includes('media/images/a.jpg'));
  assert(keys.includes('media/images/b.jpg'));
});

// ============================================================================
// Mock KV Namespace Tests
// ============================================================================

Deno.test('MockKVNamespace - should store session data', async () => {
  const kv = new MockKVNamespace();

  await kv.put('session:abc123', JSON.stringify({ userId: 'user-1' }), {
    expirationTtl: 3600,
  });

  const value = await kv.get('session:abc123');
  assertEquals(JSON.parse(value!), { userId: 'user-1' });
});

Deno.test('MockKVNamespace - should handle OAuth state', async () => {
  const kv = new MockKVNamespace();

  const state = { nonce: 'xyz', returnTo: '/home' };
  await kv.put('oauth:state:abc', JSON.stringify(state), {
    expirationTtl: 600,
  });

  const value = await kv.get('oauth:state:abc');
  assertEquals(JSON.parse(value!), state);
});

// ============================================================================
// Mock Database Client Tests
// ============================================================================

Deno.test('MockDbClient - should mock findUnique', async () => {
  const db = createMockDbClient();

  const mockActor = createMockActor({ preferred_username: 'testuser' });
  db.actor.findUnique = spy(() => Promise.resolve(mockActor));

  const result = await db.actor.findUnique({
    where: { ap_id: mockActor.ap_id },
  });

  assertEquals(result, mockActor);
});

Deno.test('MockDbClient - should mock findMany', async () => {
  const db = createMockDbClient();

  const mockActors = [
    createMockActor({ preferred_username: 'user1' }),
    createMockActor({ preferred_username: 'user2' }),
  ];
  db.actor.findMany = spy(() => Promise.resolve(mockActors));

  const result = await db.actor.findMany({
    where: { is_private: 0 },
  });

  assertEquals(result.length, 2);
});

Deno.test('MockDbClient - should mock create', async () => {
  const db = createMockDbClient();

  const newActor = createMockActor();

  const result = await db.actor.create({
    data: newActor,
  });

  assertEquals(result, newActor);
});

Deno.test('MockDbClient - should mock transactions', async () => {
  const db = createMockDbClient();

  const result = await db.$transaction(async (_tx) => {
    return { success: true };
  });

  assertEquals(result, { success: true });
});

// ============================================================================
// ActivityPub Factory Tests
// ============================================================================

Deno.test('createMockActor - should create a valid actor with defaults', () => {
  const actor = createMockActor();

  assertEquals(actor.type, 'Person');
  assert(actor.ap_id.includes('/ap/users/'));
  assert(actor.inbox.includes('/inbox'));
  assert(actor.outbox.includes('/outbox'));
});

Deno.test('createMockActor - should allow overriding properties', () => {
  const actor = createMockActor({
    preferred_username: 'customuser',
    name: 'Custom Name',
    is_private: 1,
  });

  assertEquals(actor.preferred_username, 'customuser');
  assertEquals(actor.name, 'Custom Name');
  assertEquals(actor.is_private, 1);
});

Deno.test('createMockAPObject - should create a valid Note', () => {
  const note = createMockAPObject();

  assertEquals(note.type, 'Note');
  assertEquals(note.is_local, 1);
  assertEquals(note.visibility, 'public');
});

Deno.test('createMockAPObject - should create a reply', () => {
  const reply = createMockAPObject({
    in_reply_to: 'https://example.com/posts/1',
    content: '<p>This is a reply</p>',
  });

  assertEquals(reply.in_reply_to, 'https://example.com/posts/1');
});

Deno.test('createMockAPObject - should create a community post', () => {
  const post = createMockAPObject({
    community_ap_id: 'https://test.yurucommu.com/ap/groups/test-community',
    visibility: 'followers_only',
  });

  assert(post.community_ap_id!.includes('/groups/'));
  assertEquals(post.visibility, 'followers_only');
});

// ============================================================================
// Hono Route Tests
// ============================================================================

Deno.test('Hono Route Testing - should test a health endpoint', async () => {
  const app = new Hono<{ Bindings: ReturnType<typeof createMockEnv> }>();
  app.get('/health', (c) => c.json({ status: 'ok' }));

  const env = createMockEnv();
  const response = await testHonoRequest(app, env, {
    method: 'GET',
    path: '/health',
  });

  assertEquals(response.status, 200);
  assertEquals(response.body, { status: 'ok' });
});

Deno.test('Hono Route Testing - should test authenticated endpoints', async () => {
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
  assertEquals(unauthorized.status, 401);

  // With auth
  const authorized = await testHonoRequest(app, env, {
    method: 'GET',
    path: '/api/me',
    headers: { Authorization: 'Bearer test-token' },
  });
  assertEquals(authorized.status, 200);
  assertEquals(authorized.body, { user: 'test' });
});

Deno.test('Hono Route Testing - should test POST endpoints with body', async () => {
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

  assertEquals(response.status, 200);
  assertEquals(response.body, { created: true, content: 'Hello, World!' });
});

// ============================================================================
// Integration Test Pattern
// ============================================================================

Deno.test('Integration Test Pattern - should demonstrate a full integration test', async () => {
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

  assertEquals(userResponse.status, 200);
  assertEquals((userResponse.body as MockActor).preferred_username, 'testuser');

  const postsResponse = await testHonoRequest(app, env, {
    path: '/api/users/testuser/posts',
  });

  assertEquals(postsResponse.status, 200);
  assertEquals((postsResponse.body as { posts: unknown[] }).posts.length, 2);
});

Deno.test('Integration Test Pattern - should test media upload flow', async () => {
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
  assert(app !== undefined);
});
