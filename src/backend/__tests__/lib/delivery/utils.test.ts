import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeDeliveryJobId,
  computeRetryDelaySeconds,
  DELIVERY_MAX_ATTEMPTS,
  safeEndpointHost,
  safeParseIsoTimeMs,
} from './utils';

describe('delivery/utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computeRetryDelaySeconds uses exponential series and jitter bounds', () => {
    const rand = vi.spyOn(Math, 'random');

    rand.mockReturnValue(0);
    expect(computeRetryDelaySeconds(1)).toBe(48); // 60s * 0.8
    expect(computeRetryDelaySeconds(DELIVERY_MAX_ATTEMPTS)).toBe(6144); // 7680s * 0.8

    rand.mockReturnValue(1);
    expect(computeRetryDelaySeconds(1)).toBe(72); // 60s * 1.2
    expect(computeRetryDelaySeconds(DELIVERY_MAX_ATTEMPTS)).toBe(9216); // 7680s * 1.2
  });

  it('computeRetryDelaySeconds clamps attempts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(computeRetryDelaySeconds(999)).toBe(6144);
  });

  it('computeDeliveryJobId is deterministic and hex', async () => {
    const id1 = await computeDeliveryJobId('activity-1', 'https://example.com/inbox');
    const id2 = await computeDeliveryJobId('activity-1', 'https://example.com/inbox');
    const id3 = await computeDeliveryJobId('activity-1', 'https://example.com/inbox2');

    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('safeParseIsoTimeMs returns ms or null', () => {
    const ms = safeParseIsoTimeMs('2026-02-15T00:00:00.000Z');
    expect(typeof ms).toBe('number');
    expect(Number.isFinite(ms)).toBe(true);

    expect(safeParseIsoTimeMs('not-a-date')).toBeNull();
    expect(safeParseIsoTimeMs(null)).toBeNull();
    expect(safeParseIsoTimeMs(undefined)).toBeNull();
  });

  it('safeEndpointHost returns host only for safe remote urls', () => {
    expect(safeEndpointHost('https://example.com/inbox')).toBe('example.com');
    expect(safeEndpointHost('http://127.0.0.1/inbox')).toBeNull();
    expect(safeEndpointHost('ftp://example.com/x')).toBeNull();
  });
});

