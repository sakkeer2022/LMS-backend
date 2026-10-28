import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AppError,
  OperationalError,
  SystemError,
  NotFoundError,
  DatabaseError,
  success,
  failure,
  CircuitBreaker,
  ServiceUnavailableError,
} from '@core/errors/index';

describe('Centralized Error Handling System', () => {
  it('should capture metadata on instantiation', () => {
    const rootCause = new Error('Original DB timeout');
    const err = new AppError('Main action failed', 500, false, {
      code: 'DATABASE_TIMEOUT',
      retryable: true,
      severity: 'fatal',
      context: { host: 'db-replica-1' },
      rootCause,
    });

    expect(err.message).toBe('Main action failed');
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(false);
    expect(err.code).toBe('DATABASE_TIMEOUT');
    expect(err.traceId).toBeDefined();
    expect(err.retryable).toBe(true);
    expect(err.severity).toBe('fatal');
    expect(err.context).toEqual({ host: 'db-replica-1' });
    expect(err.rootCause).toBe(rootCause);
  });

  it('should properly segment Operational and System errors', () => {
    const notFound = new NotFoundError('User');
    const dbErr = new DatabaseError('Failed connection');

    expect(notFound).toBeInstanceOf(OperationalError);
    expect(notFound.isOperational).toBe(true);
    expect(notFound.statusCode).toBe(404);

    expect(dbErr).toBeInstanceOf(SystemError);
    expect(dbErr.isOperational).toBe(false);
    expect(dbErr.statusCode).toBe(500);
  });

  describe('Functional Either/Result utility', () => {
    it('should resolve success states', () => {
      const res = success<string, AppError>('User verified');

      expect(res.isSuccess).toBe(true);
      expect(res.isFailure).toBe(false);
      if (res.isSuccess) {
        expect(res.value).toBe('User verified');
      }
    });

    it('should resolve failure states', () => {
      const dbErr = new DatabaseError('Connection dropped');
      const res = failure<string, AppError>(dbErr);

      expect(res.isSuccess).toBe(false);
      expect(res.isFailure).toBe(true);
      if (res.isFailure) {
        expect(res.error).toBe(dbErr);
      }
    });
  });

  describe('Type-Safe Circuit Breaker', () => {
    let mockAction: any;

    beforeEach(() => {
      mockAction = vi.fn();
    });

    it('should execute successfully when CLOSED', async () => {
      mockAction.mockResolvedValue('Data fetched');
      const breaker = new CircuitBreaker(mockAction);

      const result = await breaker.execute();
      expect(result).toBe('Data fetched');
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should trip to OPEN when failure threshold exceeded', async () => {
      mockAction.mockRejectedValue(new Error('Network error'));
      // threshold: 50%, min requests: 3
      const breaker = new CircuitBreaker(mockAction, {
        failureThreshold: 50,
        requestVolumeThreshold: 3,
      });

      // 1st request fails
      await expect(breaker.execute()).rejects.toThrow('Network error');
      expect(breaker.getState()).toBe('CLOSED');

      // 2nd request fails
      await expect(breaker.execute()).rejects.toThrow('Network error');
      expect(breaker.getState()).toBe('CLOSED');

      // 3rd request fails -> should trip
      await expect(breaker.execute()).rejects.toThrow('Network error');
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should throw ServiceUnavailableError immediately when OPEN', async () => {
      mockAction.mockRejectedValue(new Error('Network error'));
      const breaker = new CircuitBreaker(mockAction, {
        failureThreshold: 50,
        requestVolumeThreshold: 1,
      });

      await expect(breaker.execute()).rejects.toThrow('Network error');
      expect(breaker.getState()).toBe('OPEN');

      // Subsequent call should block immediately without calling raw action
      await expect(breaker.execute()).rejects.toThrow(ServiceUnavailableError);
      expect(mockAction).toHaveBeenCalledTimes(1);
    });

    it('should transition to HALF_OPEN after cooldown window', async () => {
      vi.useFakeTimers();
      mockAction.mockRejectedValue(new Error('Network error'));
      const breaker = new CircuitBreaker(mockAction, {
        failureThreshold: 100,
        requestVolumeThreshold: 1,
        cooldownWindow: 5000,
      });

      await expect(breaker.execute()).rejects.toThrow('Network error');
      expect(breaker.getState()).toBe('OPEN');

      // Advance clock by 5s
      vi.advanceTimersByTime(5000);

      expect(breaker.getState()).toBe('HALF_OPEN');
      vi.useRealTimers();
    });

    it('should close the circuit again after consecutive successes in HALF_OPEN', async () => {
      vi.useFakeTimers();
      mockAction.mockRejectedValue(new Error('Network error'));
      const breaker = new CircuitBreaker(mockAction, {
        failureThreshold: 100,
        requestVolumeThreshold: 1,
        cooldownWindow: 5000,
      });

      await expect(breaker.execute()).rejects.toThrow('Network error');
      expect(breaker.getState()).toBe('OPEN');

      // Cooldown resolves
      vi.advanceTimersByTime(5000);
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Success attempts
      mockAction.mockResolvedValue('Recovered service');

      await breaker.execute(); // 1st success
      await breaker.execute(); // 2nd success
      await breaker.execute(); // 3rd success -> should close

      expect(breaker.getState()).toBe('CLOSED');
      vi.useRealTimers();
    });
  });
});
