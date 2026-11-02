import { describe, it, expect, vi } from 'vitest';
import { InMemoryJsonCache, RedisJsonCache } from '@infrastructure/cache/index';
import { errorResponse } from '@core/response/index';

describe('JSON cache', () => {
  it('stores, expires and deletes values in memory', async () => {
    vi.useFakeTimers();
    const cache = new InMemoryJsonCache();
    await cache.set('k', { a: 1 }, 10);
    expect(await cache.get('k')).toEqual({ a: 1 });
    vi.advanceTimersByTime(10_001);
    expect(await cache.get('k')).toBeNull();
    await cache.set('k', 'v', 10);
    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
    vi.useRealTimers();
  });

  it('fails open when Redis errors, so a request never fails because of the cache', async () => {
    const failing = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      del: vi.fn().mockRejectedValue(new Error('down')),
    };
    const cache = new RedisJsonCache(
      failing as unknown as ConstructorParameters<typeof RedisJsonCache>[0]
    );
    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.set('k', 1, 10)).resolves.toBeUndefined();
    await expect(cache.del('k')).resolves.toBeUndefined();
  });
});

describe('error envelope', () => {
  it('carries a machine-readable code only when given', () => {
    expect(errorResponse('Stale', undefined, 't1', 'STALE_VERSION')).toEqual({
      success: false,
      message: 'Stale',
      code: 'STALE_VERSION',
      traceId: 't1',
    });
    expect(errorResponse('Oops')).toEqual({ success: false, message: 'Oops' });
  });
});
