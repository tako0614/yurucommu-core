import { describe, it, expect, vi, afterEach } from 'vitest';
import { planEndpointsFromActorCache } from './planner';
import { DELIVERY_ENDPOINT_CACHE_TTL_MS } from './utils';

describe('delivery/planner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates by sharedInbox and prefers sharedInbox', async () => {
    const nowMs = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const nowIso = new Date(nowMs).toISOString();

    const prisma = {
      actorCache: {
        findMany: vi.fn().mockResolvedValue([
          {
            apId: 'https://a.example/ap/users/u1',
            inbox: 'https://a.example/inbox',
            sharedInbox: 'https://a.example/shared',
            lastFetchedAt: nowIso,
          },
          {
            apId: 'https://a.example/ap/users/u2',
            inbox: 'https://a.example/inbox2',
            sharedInbox: 'https://a.example/shared',
            lastFetchedAt: nowIso,
          },
          {
            apId: 'https://b.example/ap/users/u3',
            inbox: 'https://b.example/inbox',
            sharedInbox: null,
            lastFetchedAt: nowIso,
          },
        ]),
      },
    };

    const res = await planEndpointsFromActorCache(prisma as any, [
      'https://a.example/ap/users/u1',
      'https://a.example/ap/users/u2',
      'https://b.example/ap/users/u3',
    ]);

    expect(res.totalRecipients).toBe(3);
    expect(res.sharedInboxRecipients).toBe(2);
    expect(res.unknownRecipients).toEqual([]);

    const byEndpoint = new Map(res.groups.map((g) => [g.endpoint, g.recipientCount]));
    expect(byEndpoint.get('https://a.example/shared')).toBe(2);
    expect(byEndpoint.get('https://b.example/inbox')).toBe(1);
  });

  it('marks stale and missing recipients as unknown', async () => {
    const nowMs = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const staleIso = new Date(nowMs - DELIVERY_ENDPOINT_CACHE_TTL_MS - 1000).toISOString();

    const prisma = {
      actorCache: {
        findMany: vi.fn().mockResolvedValue([
          {
            apId: 'https://a.example/ap/users/u1',
            inbox: 'https://a.example/inbox',
            sharedInbox: null,
            lastFetchedAt: staleIso,
          },
        ]),
      },
    };

    const res = await planEndpointsFromActorCache(prisma as any, [
      'https://a.example/ap/users/u1',
      'https://missing.example/ap/users/u2',
    ]);

    expect(res.groups).toEqual([]);
    expect(res.totalRecipients).toBe(2);
    expect(res.unknownRecipients.sort()).toEqual(
      ['https://a.example/ap/users/u1', 'https://missing.example/ap/users/u2'].sort()
    );
  });
});

