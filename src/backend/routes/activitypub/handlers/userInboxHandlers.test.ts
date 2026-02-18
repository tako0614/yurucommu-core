import { describe, expect, it, vi } from 'vitest';
import { handleDelete, handleLike } from './userInboxHandlers';

describe('userInboxHandlers hardening', () => {
  it('handleLike writes like/count/inbox in a single transaction', async () => {
    const actorApId = 'https://example.com/ap/users/alice';
    const targetApId = 'https://example.com/ap/users/bob';
    const objectApId = 'https://example.com/ap/objects/note-1';

    const tx = {
      like: { create: vi.fn().mockResolvedValue({}) },
      object: { update: vi.fn().mockResolvedValue({}) },
      activity: { upsert: vi.fn().mockResolvedValue({}) },
      inbox: { create: vi.fn().mockResolvedValue({}) },
    };

    const prisma = {
      object: {
        findUnique: vi.fn().mockResolvedValue({ attributedTo: targetApId }),
      },
      $transaction: vi.fn(async (cb: (txArg: any) => Promise<unknown>) => cb(tx)),
    };

    const context = {
      get: (key: string) => {
        if (key === 'prisma') return prisma;
        return null;
      },
    } as any;

    await handleLike(
      context,
      {
        id: 'https://example.com/ap/activities/like-1',
        type: 'Like',
        actor: actorApId,
        object: objectApId,
      } as any,
      {} as any,
      actorApId,
      'https://example.com'
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.like.create).toHaveBeenCalledTimes(1);
    expect(tx.object.update).toHaveBeenCalledTimes(1);
    expect(tx.activity.upsert).toHaveBeenCalledTimes(1);
    expect(tx.inbox.create).toHaveBeenCalledTimes(1);
  });

  it('handleLike treats unique conflicts as idempotent (no extra count update)', async () => {
    const tx = {
      like: { create: vi.fn().mockRejectedValue({ code: 'P2002' }) },
      object: { update: vi.fn().mockResolvedValue({}) },
      activity: { upsert: vi.fn().mockResolvedValue({}) },
      inbox: { create: vi.fn().mockResolvedValue({}) },
    };

    const prisma = {
      object: {
        findUnique: vi.fn().mockResolvedValue({ attributedTo: 'https://example.com/ap/users/bob' }),
      },
      $transaction: vi.fn(async (cb: (txArg: any) => Promise<unknown>) => cb(tx)),
    };

    const context = {
      get: (key: string) => {
        if (key === 'prisma') return prisma;
        return null;
      },
    } as any;

    await handleLike(
      context,
      {
        id: 'https://example.com/ap/activities/like-2',
        type: 'Like',
        actor: 'https://example.com/ap/users/alice',
        object: 'https://example.com/ap/objects/note-2',
      } as any,
      {} as any,
      'https://example.com/ap/users/alice',
      'https://example.com'
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.object.update).not.toHaveBeenCalled();
    expect(tx.activity.upsert).not.toHaveBeenCalled();
    expect(tx.inbox.create).not.toHaveBeenCalled();
  });

  it('handleDelete performs dependent deletes and counter update transactionally', async () => {
    const tx = {
      like: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      object: { delete: vi.fn().mockResolvedValue({}) },
      actor: { update: vi.fn().mockResolvedValue({}) },
      storyVote: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      storyView: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };

    const prisma = {
      object: {
        findUnique: vi.fn().mockResolvedValue({
          attributedTo: 'https://example.com/ap/users/alice',
          type: 'Note',
          replyCount: 0,
        }),
      },
      $transaction: vi.fn(async (cb: (txArg: any) => Promise<unknown>) => cb(tx)),
    };

    const context = {
      get: (key: string) => {
        if (key === 'prisma') return prisma;
        return null;
      },
    } as any;

    await handleDelete(
      context,
      {
        id: 'https://example.com/ap/activities/delete-1',
        type: 'Delete',
        actor: 'https://example.com/ap/users/alice',
        object: 'https://example.com/ap/objects/note-3',
      } as any
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.like.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.object.delete).toHaveBeenCalledTimes(1);
    expect(tx.actor.update).toHaveBeenCalledTimes(1);
  });
});
