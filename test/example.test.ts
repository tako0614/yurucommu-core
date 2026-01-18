/**
 * Example Test File for yurucommu
 *
 * Demonstrates testing patterns for:
 * - Hono route testing
 * - Prisma mock usage
 * - ActivityPub object handling
 * - Cloudflare bindings mocking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  MockD1Database,
  MockR2Bucket,
  MockKVNamespace,
  createMockPrismaClient,
  createMockEnv,
  testHonoRequest,
  createMockActor,
  createMockAPObject,
} from './setup';

// ============================================================================
// Mock D1 Database Tests
// ============================================================================

describe('MockD1Database', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = new MockD1Database();
  });

  it('should prepare and execute queries', async () => {
    const result = await db.prepare('SELECT * FROM actors WHERE ap_id = ?')
      .bind('https://example.com/users/test')
      .first();

    expect(result).toBeNull();
  });

  it('should return success for run operations', async () => {
    const result = await db.prepare('INSERT INTO actors (ap_id, type) VALUES (?, ?)')
      .bind('https://example.com/users/test', 'Person')
      .run();

    expect(result.success).toBe(true);
    expect(result.meta.changes).toBe(1);
  });

  it('should return empty results for all queries', async () => {
    const result = await db.prepare('SELECT * FROM actors').all();

    expect(result.results).toEqual([]);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Mock R2 Bucket Tests
// ============================================================================

describe('MockR2Bucket', () => {
  let r2: MockR2Bucket;

  beforeEach(() => {
    r2 = new MockR2Bucket();
  });

  it('should store and retrieve media files', async () => {
    const imageData = new Uint8Array([1, 2, 3, 4]);
    await r2.put('media/image.jpg', imageData.buffer as ArrayBuffer, {
      customMetadata: { contentType: 'image/jpeg' },
    });

    const obj = await r2.get('media/image.jpg');

    expect(obj).not.toBeNull();
    const buffer = await obj!.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(imageData);
  });

  it('should list objects with prefix', async () => {
    await r2.put('media/images/a.jpg', 'image a');
    await r2.put('media/images/b.jpg', 'image b');
    await r2.put('media/videos/c.mp4', 'video c');

    const result = await r2.list({ prefix: 'media/images/' });

    expect(result.objects).toHaveLength(2);
    expect(result.objects.map((o) => o.key)).toContain('media/images/a.jpg');
    expect(result.objects.map((o) => o.key)).toContain('media/images/b.jpg');
  });
});

// ============================================================================
// Mock KV Namespace Tests
// ============================================================================

describe('MockKVNamespace', () => {
  let kv: MockKVNamespace;

  beforeEach(() => {
    kv = new MockKVNamespace();
  });

  it('should store session data', async () => {
    await kv.put('session:abc123', JSON.stringify({ userId: 'user-1' }), {
      expirationTtl: 3600,
    });

    const value = await kv.get('session:abc123');
    expect(JSON.parse(value!)).toEqual({ userId: 'user-1' });
  });

  it('should handle OAuth state', async () => {
    const state = { nonce: 'xyz', returnTo: '/home' };
    await kv.put('oauth:state:abc', JSON.stringify(state), {
      expirationTtl: 600,
    });

    const value = await kv.get('oauth:state:abc');
    expect(JSON.parse(value!)).toEqual(state);
  });
});

// ============================================================================
// Mock Prisma Client Tests
// ============================================================================

describe('MockPrismaClient', () => {
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    prisma = createMockPrismaClient();
  });

  it('should mock findUnique', async () => {
    const mockActor = createMockActor({ preferred_username: 'testuser' });
    prisma.actor.findUnique.mockResolvedValue(mockActor);

    const result = await prisma.actor.findUnique({
      where: { ap_id: mockActor.ap_id },
    });

    expect(result).toEqual(mockActor);
    expect(prisma.actor.findUnique).toHaveBeenCalledWith({
      where: { ap_id: mockActor.ap_id },
    });
  });

  it('should mock findMany', async () => {
    const mockActors = [
      createMockActor({ preferred_username: 'user1' }),
      createMockActor({ preferred_username: 'user2' }),
    ];
    prisma.actor.findMany.mockResolvedValue(mockActors);

    const result = await prisma.actor.findMany({
      where: { is_private: 0 },
    });

    expect(result).toHaveLength(2);
  });

  it('should mock create', async () => {
    const newActor = createMockActor();

    const result = await prisma.actor.create({
      data: newActor,
    });

    expect(result).toEqual(newActor);
  });

  it('should mock transactions', async () => {
    const result = await prisma.$transaction(async (tx) => {
      // Transaction operations would go here
      return { success: true };
    });

    expect(result).toEqual({ success: true });
  });
});

// ============================================================================
// ActivityPub Factory Tests
// ============================================================================

describe('ActivityPub Factories', () => {
  describe('createMockActor', () => {
    it('should create a valid actor with defaults', () => {
      const actor = createMockActor();

      expect(actor.type).toBe('Person');
      expect(actor.ap_id).toContain('/ap/users/');
      expect(actor.inbox).toContain('/inbox');
      expect(actor.outbox).toContain('/outbox');
    });

    it('should allow overriding properties', () => {
      const actor = createMockActor({
        preferred_username: 'customuser',
        name: 'Custom Name',
        is_private: 1,
      });

      expect(actor.preferred_username).toBe('customuser');
      expect(actor.name).toBe('Custom Name');
      expect(actor.is_private).toBe(1);
    });
  });

  describe('createMockAPObject', () => {
    it('should create a valid Note', () => {
      const note = createMockAPObject();

      expect(note.type).toBe('Note');
      expect(note.is_local).toBe(1);
      expect(note.visibility).toBe('public');
    });

    it('should create a reply', () => {
      const reply = createMockAPObject({
        in_reply_to: 'https://example.com/posts/1',
        content: '<p>This is a reply</p>',
      });

      expect(reply.in_reply_to).toBe('https://example.com/posts/1');
    });

    it('should create a community post', () => {
      const post = createMockAPObject({
        community_ap_id: 'https://test.yurucommu.com/ap/groups/test-community',
        visibility: 'followers_only',
      });

      expect(post.community_ap_id).toContain('/groups/');
      expect(post.visibility).toBe('followers_only');
    });
  });
});

// ============================================================================
// Hono Route Tests
// ============================================================================

describe('Hono Route Testing', () => {
  it('should test a health endpoint', async () => {
    const app = new Hono<{ Bindings: ReturnType<typeof createMockEnv> }>();
    app.get('/health', (c) => c.json({ status: 'ok' }));

    const env = createMockEnv();
    const response = await testHonoRequest(app, env, {
      method: 'GET',
      path: '/health',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('should test authenticated endpoints', async () => {
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
    expect(unauthorized.status).toBe(401);

    // With auth
    const authorized = await testHonoRequest(app, env, {
      method: 'GET',
      path: '/api/me',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ user: 'test' });
  });

  it('should test POST endpoints with body', async () => {
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

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ created: true, content: 'Hello, World!' });
  });
});

// ============================================================================
// Integration Test Pattern
// ============================================================================

describe('Integration Test Pattern', () => {
  it('should demonstrate a full integration test', async () => {
    // 1. Set up environment
    const env = createMockEnv();
    const prisma = env.PRISMA as ReturnType<typeof createMockPrismaClient>;

    // 2. Set up mock data
    const mockActor = createMockActor({ preferred_username: 'testuser' });
    prisma.actor.findUnique.mockResolvedValue(mockActor);

    const mockPosts = [
      createMockAPObject({ attributed_to: mockActor.ap_id, content: '<p>Post 1</p>' }),
      createMockAPObject({ attributed_to: mockActor.ap_id, content: '<p>Post 2</p>' }),
    ];
    prisma.apObject.findMany.mockResolvedValue(mockPosts);

    // 3. Create app with routes
    const app = new Hono<{ Bindings: typeof env }>();

    app.get('/api/users/:username', async (c) => {
      const username = c.req.param('username');
      const actor = await prisma.actor.findUnique({
        where: { preferred_username: username },
      });

      if (!actor) {
        return c.json({ error: 'Not found' }, 404);
      }

      return c.json(actor);
    });

    app.get('/api/users/:username/posts', async (c) => {
      const username = c.req.param('username');
      const actor = await prisma.actor.findUnique({
        where: { preferred_username: username },
      });

      if (!actor) {
        return c.json({ error: 'Not found' }, 404);
      }

      const posts = await prisma.apObject.findMany({
        where: { attributed_to: actor.ap_id },
      });

      return c.json({ posts });
    });

    // 4. Test the endpoints
    const userResponse = await testHonoRequest(app, env, {
      path: '/api/users/testuser',
    });

    expect(userResponse.status).toBe(200);
    expect((userResponse.body as MockActor).preferred_username).toBe('testuser');

    const postsResponse = await testHonoRequest(app, env, {
      path: '/api/users/testuser/posts',
    });

    expect(postsResponse.status).toBe(200);
    expect((postsResponse.body as { posts: unknown[] }).posts).toHaveLength(2);

    // 5. Verify Prisma was called correctly
    expect(prisma.actor.findUnique).toHaveBeenCalledWith({
      where: { preferred_username: 'testuser' },
    });
  });

  it('should test media upload flow', async () => {
    const env = createMockEnv();
    const r2 = env.MEDIA as MockR2Bucket;

    const app = new Hono<{ Bindings: typeof env }>();

    app.post('/api/media', async (c) => {
      const formData = await c.req.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'No file provided' }, 400);
      }

      const key = `uploads/${Date.now()}-${file.name}`;
      await r2.put(key, await file.arrayBuffer(), {
        customMetadata: { contentType: file.type },
      });

      return c.json({ key, url: `https://media.example.com/${key}` });
    });

    // Note: In real tests, you'd need to properly mock FormData
    // This is a simplified example
    expect(app).toBeDefined();
  });
});
