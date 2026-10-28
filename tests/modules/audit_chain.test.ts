import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@infrastructure/database/index.js';
import { logAction, verifyAuditChain, computeRecordHash } from '@modules/audit/audit.service.js';

describe('Audit Cryptographic Hash Chain Validation', () => {
  beforeEach(async () => {
    // Truncate audit logs before tests to start with a clean chain
    await prisma.auditLog.deleteMany({});
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({});
  });

  it('should successfully chain hashes together starting from genesis block seed', async () => {
    // Write first audit log
    await logAction({
      action: 'test.create',
      entity: 'document',
      severity: 'INFO',
    });

    // Write second audit log
    await logAction({
      action: 'test.update',
      entity: 'document',
      severity: 'WARN',
    });

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
    });

    expect(logs.length).toBe(2);

    // Genesis previousHash should be 64 zeros
    expect(logs[0].previousHash).toBe('0'.repeat(64));

    // The second log's previousHash must equal the first log's hash
    expect(logs[1].previousHash).toBe(logs[0].hash);

    // Re-verify calculations match
    const computedHash0 = computeRecordHash({
      actorId: logs[0].actorId,
      action: logs[0].action,
      entity: logs[0].entity,
      previousValue: logs[0].previousValue,
      newValue: logs[0].newValue,
      createdAt: logs[0].createdAt,
      previousHash: logs[0].previousHash,
    });
    expect(logs[0].hash).toBe(computedHash0);

    const computedHash1 = computeRecordHash({
      actorId: logs[1].actorId,
      action: logs[1].action,
      entity: logs[1].entity,
      previousValue: logs[1].previousValue,
      newValue: logs[1].newValue,
      createdAt: logs[1].createdAt,
      previousHash: logs[1].previousHash,
    });
    expect(logs[1].hash).toBe(computedHash1);
  });

  it('should validate a clean audit chain as isValid: true', async () => {
    await logAction({ action: 'log.1', entity: 'users' });
    await logAction({ action: 'log.2', entity: 'users' });
    await logAction({ action: 'log.3', entity: 'users' });

    const verification = await verifyAuditChain();
    expect(verification.isValid).toBe(true);
    expect(verification.brokenAt).toBeUndefined();
  });

  it('should fail validation if a middle record is tampered with', async () => {
    await logAction({ action: 'log.1', entity: 'users' });
    await logAction({ action: 'log.2', entity: 'users' });
    await logAction({ action: 'log.3', entity: 'users' });

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Tamper with log.2 by modifying the action field
    await prisma.auditLog.update({
      where: { id: logs[1].id },
      data: { action: 'log.tampered' },
    });

    const verification = await verifyAuditChain();
    expect(verification.isValid).toBe(false);
    expect(verification.brokenAt).toBe(logs[1].id);
  });

  it('should fail validation if a record is deleted from the middle of the chain', async () => {
    await logAction({ action: 'log.1', entity: 'users' });
    await logAction({ action: 'log.2', entity: 'users' });
    await logAction({ action: 'log.3', entity: 'users' });

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Delete log.2 from the database
    await prisma.auditLog.delete({
      where: { id: logs[1].id },
    });

    const verification = await verifyAuditChain();
    expect(verification.isValid).toBe(false);
    // Since log.2 is missing, log.3's previousHash will mismatch with log.1's hash, making log.3 the broken link point
    expect(verification.brokenAt).toBe(logs[2].id);
  });
});
