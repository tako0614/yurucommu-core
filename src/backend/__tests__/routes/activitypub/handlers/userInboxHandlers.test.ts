import { describe, expect, it, vi } from 'vitest';
import { handleDelete, handleLike } from '../../../../routes/activitypub/handlers/userInboxHandlers';

/**
 * Creates a mock Drizzle DB that supports chainable patterns:
 *   db.select().from().where().get()
 *   db.insert().values().onConflictDoNothing().returning().get()
 *   db.update().set().where()
 *   db.delete().where()
 *   db.insert().values().onConflictDoNothing()
 *
 * Each call to select/insert/update/delete returns a fresh chainable object.
 * Use `callTracker` to inspect what was called.
 */
function createMockDb(options: {
  selectResults?: unknown[];
  insertReturningResult?: unknown;
}) {
  const { selectResults = [], insertReturningResult = undefined } = options;
  let selectCallIndex = 0;

  const callTracker = {
    selects: [] as unknown[],
    inserts: [] as unknown[],
    updates: [] as unknown[],
    deletes: [] as unknown[],
  };

  const db = {
    select: vi.fn((...args: unknown[]) => {
      callTracker.selects.push(args);
      const result = selectResults[selectCallIndex] ?? undefined;
      selectCallIndex++;
      const chain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(result),
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue(result),
            }),
          }),
          get: vi.fn().mockResolvedValue(result),
        }),
      };
      return chain;
    }),

    insert: vi.fn((...args: unknown[]) => {
      callTracker.inserts.push(args);
      const returningGet = vi.fn().mockResolvedValue(insertReturningResult);
      const returning = vi.fn().mockReturnValue({ get: returningGet });
      const onConflictDoNothing = vi.fn().mockReturnValue({
        returning,
        get: returningGet,
      });
      const values = vi.fn().mockReturnValue({
        onConflictDoNothing,
        returning,
      });
      return { values };
    }),

    update: vi.fn((...args: unknown[]) => {
      callTracker.updates.push(args);
      const where = vi.fn().mockResolvedValue(undefined);
      const set = vi.fn().mockReturnValue({ where });
      return { set };
    }),

    delete: vi.fn((...args: unknown[]) => {
      callTracker.deletes.push(args);
      const where = vi.fn().mockResolvedValue(undefined);
      return { where };
    }),
  };

  return { db, callTracker };
}

describe('userInboxHandlers hardening', () => {
  it('handleLike writes like/count/inbox in a single transaction', async () => {
    const actorApId = 'https://example.com/ap/users/alice';
    const targetApId = 'https://example.com/ap/users/bob';
    const objectApId = 'https://example.com/ap/objects/note-1';

    // select[0] = lookup liked object -> returns attributedTo (local target)
    // insert[0] = insert like -> returns non-null (new like)
    // update[0] = increment likeCount
    // insert[1] = upsertActivityAndNotify -> insert activity (onConflictDoNothing)
    // insert[2] = upsertActivityAndNotify -> insert inbox
    const { db, callTracker } = createMockDb({
      selectResults: [{ attributedTo: targetApId }],
      insertReturningResult: { actorApId, objectApId, activityApId: 'like-1' },
    });

    const context = {
      get: (key: string) => {
        if (key === 'prisma') return db;
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

    // Verify select was called (lookup object)
    expect(db.select).toHaveBeenCalled();
    // Verify insert was called (like + activity + inbox)
    expect(db.insert).toHaveBeenCalled();
    // Verify update was called (likeCount)
    expect(db.update).toHaveBeenCalled();
  });

  it('handleLike treats unique conflicts as idempotent (no extra count update)', async () => {
    // select[0] = lookup liked object -> returns attributedTo
    // insert[0] = insert like -> returns null (duplicate, onConflictDoNothing returned nothing)
    const { db } = createMockDb({
      selectResults: [{ attributedTo: 'https://example.com/ap/users/bob' }],
      insertReturningResult: undefined, // null = duplicate, so skip
    });

    const context = {
      get: (key: string) => {
        if (key === 'prisma') return db;
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

    // insert was called for like, but returned undefined (duplicate)
    expect(db.insert).toHaveBeenCalledTimes(1);
    // update should NOT have been called (no count increment for duplicate)
    expect(db.update).not.toHaveBeenCalled();
  });

  it('handleDelete performs dependent deletes and counter update transactionally', async () => {
    // select[0] = lookup object -> returns attributedTo, type, replyCount
    const { db } = createMockDb({
      selectResults: [{
        attributedTo: 'https://example.com/ap/users/alice',
        type: 'Note',
        replyCount: 0,
      }],
    });

    const context = {
      get: (key: string) => {
        if (key === 'prisma') return db;
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

    // Verify select was called (lookup object)
    expect(db.select).toHaveBeenCalledTimes(1);
    // Verify delete was called (likes + objects)
    expect(db.delete).toHaveBeenCalledTimes(2);
    // Verify update was called (actor postCount decrement)
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
