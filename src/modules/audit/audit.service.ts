import crypto from 'crypto';
import { prisma } from '@infrastructure/database/index.js';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination.js';
import { MAX_WINDOW_DAYS, type AuditLogQueryInput } from './audit.dto.js';
import { redact } from './audit.redact.js';
import { logger } from '@core/logger/index.js';
import type { Prisma } from '@prisma/client';

export interface LogActionParams {
  traceId?: string | null;
  correlationId?: string | null;
  actorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  severity?: 'INFO' | 'WARN' | 'SECURITY' | 'CRITICAL';
  entity: string;
  action: string;
  resourceId?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

/** Request details a service passes through so its audit entries name the actor. */
export type AuditContext = Pick<
  LogActionParams,
  'actorId' | 'ipAddress' | 'userAgent' | 'traceId' | 'correlationId'
>;

/** One audit entry as the contract's `AuditEvent` returns it: no IP, user agent, fingerprint or hashes. */
export interface AuditEvent {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  resourceId: string | null;
  severity: string;
  traceId: string;
  createdAt: Date;
  changes?: { before?: unknown; after?: unknown };
}

/**
 * Serializes a value canonically for hashing.
 */
function serializeField(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    return JSON.stringify(val);
  }
  return String(val);
}

/**
 * Computes the SHA-256 hash of a log record linked to the previous hash.
 */
export function computeRecordHash(record: {
  actorId: string | null;
  action: string;
  entity: string;
  previousValue: unknown;
  newValue: unknown;
  createdAt: Date;
  previousHash: string;
}): string {
  const dataString = [
    serializeField(record.actorId),
    serializeField(record.action),
    serializeField(record.entity),
    serializeField(record.previousValue),
    serializeField(record.newValue),
    record.createdAt.toISOString(),
    serializeField(record.previousHash),
  ].join('|');

  return crypto.createHash('sha256').update(dataString).digest('hex');
}

const GENESIS_HASH = '0'.repeat(64);

// Arbitrary constant identifying the audit chain's Postgres advisory lock.
const AUDIT_CHAIN_LOCK_KEY = 7_240_102;

// ── Log an Action ────────────────────────────────────────────────
export async function logAction(params: LogActionParams): Promise<void> {
  const traceId = params.traceId || 'system-trace';
  const correlationId = params.correlationId || 'system-correlation';
  const ipAddress = params.ipAddress || '127.0.0.1';
  const userAgent = params.userAgent || 'unknown';
  const severity = params.severity || 'INFO';
  const createdAt = new Date();

  // Emit to SIEM/JSON Logger
  logger.info({
    type: 'audit',
    traceId,
    correlationId,
    actorId: params.actorId || 'system',
    action: params.action,
    entity: params.entity,
    resourceId: params.resourceId || null,
    severity,
    changes: {
      before: params.previousValue,
      after: params.newValue,
    },
    ipAddress,
  });

  // Chain writes run one at a time: the advisory lock is held until this
  // transaction commits, so no two records can link to the same predecessor,
  // and each new record gets the next sequence after the one it links to.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;

    const latestLog = await tx.auditLog.findFirst({
      orderBy: { sequence: 'desc' },
      select: { hash: true },
    });
    const previousHash = latestLog ? latestLog.hash : GENESIS_HASH;

    const hash = computeRecordHash({
      actorId: params.actorId || null,
      action: params.action,
      entity: params.entity,
      previousValue: params.previousValue || null,
      newValue: params.newValue || null,
      createdAt,
      previousHash,
    });

    await tx.auditLog.create({
      data: {
        traceId,
        correlationId,
        actorId: params.actorId || null,
        ipAddress,
        userAgent,
        deviceFingerprint: params.deviceFingerprint || null,
        severity,
        entity: params.entity,
        action: params.action,
        resourceId: params.resourceId || null,
        previousValue: (params.previousValue as Prisma.JsonObject) || null,
        newValue: (params.newValue as Prisma.JsonObject) || null,
        hash,
        previousHash,
        createdAt,
      },
    });
  });
}

// ── List ─────────────────────────────────────────────────────────
export async function listAuditLogs(
  query: AuditLogQueryInput
): Promise<PaginatedResult<AuditEvent>> {
  const { page, limit, actorId, action, entity, resourceId } = query;
  // A window with one bound still spans at most MAX_WINDOW_DAYS
  const span = MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const from = query.from ?? (query.to && new Date(query.to.getTime() - span));
  const to = query.to ?? (query.from && new Date(query.from.getTime() + span));

  const where: Prisma.AuditLogWhereInput = {
    actorId,
    action,
    entity,
    resourceId,
    createdAt: from && to ? { gte: from, lt: to } : undefined,
  };

  const [count, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        actorId: true,
        action: true,
        entity: true,
        resourceId: true,
        severity: true,
        traceId: true,
        createdAt: true,
        previousValue: true,
        newValue: true,
      },
    }),
  ]);

  const items = rows.map(({ previousValue, newValue, ...event }): AuditEvent => {
    const changes = {
      ...(previousValue != null && { before: redact(previousValue) }),
      ...(newValue != null && { after: redact(newValue) }),
    };
    return Object.keys(changes).length > 0 ? { ...event, changes } : event;
  });

  return { items, meta: buildPaginationMeta(count, page, limit) };
}

// ── Verify Ledger Integrity ──────────────────────────────────────
export async function verifyAuditChain(): Promise<{ isValid: boolean; brokenAt?: string }> {
  const logs = await prisma.auditLog.findMany({
    orderBy: { sequence: 'asc' },
  });

  let expectedPreviousHash = GENESIS_HASH;

  for (const log of logs) {
    // 1. Verify previousHash matches expected link
    if (log.previousHash !== expectedPreviousHash) {
      return { isValid: false, brokenAt: log.id };
    }

    // 2. Verify computed hash matches database hash
    const computed = computeRecordHash({
      actorId: log.actorId,
      action: log.action,
      entity: log.entity,
      previousValue: log.previousValue,
      newValue: log.newValue,
      createdAt: log.createdAt,
      previousHash: log.previousHash,
    });

    if (log.hash !== computed) {
      return { isValid: false, brokenAt: log.id };
    }

    expectedPreviousHash = log.hash;
  }

  return { isValid: true };
}
