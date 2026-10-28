import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../src/core/security/policy';

describe('Policy Evaluator (ABAC)', () => {
  const userContext = {
    sub: 'user-uuid-123',
    email: 'user@example.com',
    tenantId: 'tenant-abc',
    policies: [
      {
        subject: 'document',
        action: 'read',
        conditions: {
          userId: { $eq: 'user.sub' },
        },
      },
      {
        subject: 'document',
        action: 'update',
        conditions: {
          tenantId: { $eq: 'user.tenantId' },
          status: { $in: ['draft', 'review'] },
        },
      },
      {
        subject: 'report',
        action: 'export',
        conditions: {
          departments: { $isSubset: ['HR', 'Finance'] },
        },
      },
      {
        subject: 'settings',
        action: '*',
      },
    ],
  };

  it('should authorize if permission has no conditions', () => {
    const isAuthorized = evaluatePolicy(userContext, {}, 'settings.write');
    expect(isAuthorized).toBe(true);
  });

  it('should authorize if $eq condition matches resolved user context value', () => {
    const resourceInstance = { userId: 'user-uuid-123' };
    const isAuthorized = evaluatePolicy(userContext, resourceInstance, 'document.read');
    expect(isAuthorized).toBe(true);
  });

  it('should reject if $eq condition does not match', () => {
    const resourceInstance = { userId: 'different-user-uuid' };
    const isAuthorized = evaluatePolicy(userContext, resourceInstance, 'document.read');
    expect(isAuthorized).toBe(false);
  });

  it('should authorize if $in condition matches resource value', () => {
    const resourceInstance = { tenantId: 'tenant-abc', status: 'draft' };
    const isAuthorized = evaluatePolicy(userContext, resourceInstance, 'document.update');
    expect(isAuthorized).toBe(true);
  });

  it('should reject if $in condition does not match', () => {
    const resourceInstance = { tenantId: 'tenant-abc', status: 'published' };
    const isAuthorized = evaluatePolicy(userContext, resourceInstance, 'document.update');
    expect(isAuthorized).toBe(false);
  });

  it('should authorize if $isSubset condition matches', () => {
    // Array in resource is subset of user's allowed departments (e.g. ['HR'] is subset of ['HR', 'Finance'])
    const resourceInstance = { departments: ['HR'] };
    const isAuthorized = evaluatePolicy(userContext, resourceInstance, 'report.export');
    expect(isAuthorized).toBe(true);
  });

  it('should reject if $isSubset condition does not match', () => {
    // ['Engineering'] is not subset of ['HR', 'Finance']
    const resourceInstance = { departments: ['Engineering'] };
    const isAuthorized = evaluatePolicy(userContext, resourceInstance, 'report.export');
    expect(isAuthorized).toBe(false);
  });

  it('should reject if no policy matches required permission', () => {
    const isAuthorized = evaluatePolicy(userContext, {}, 'billing.read');
    expect(isAuthorized).toBe(false);
  });
});
