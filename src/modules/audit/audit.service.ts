import crypto from 'crypto';
import { prisma } from '@infrastructure/database/index.js';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination.js';
import type { AuditLogQueryInput } from './audit.dto.js';
import { NotFoundError } from '@core/errors/index.js';
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

export interface AuditLogSummary {
  id: string;
  traceId: string;
  correlationId: string;
  actorId: string | null;
  ipAddress: string;
  userAgent: string;
  deviceFingerprint: string | null;
  severity: string;
  entity: string;
  resource: string; // backwards compatibility
  action: string;
  resourceId: string | null;
  status: string; // backwards compatibility
  createdAt: Date;
  hash: string;
  previousHash: string;
  user: {
    id: string;
    email: string;
  } | null;
}

export interface AuditLogDetail extends AuditLogSummary {
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
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

// ── Log an Action ────────────────────────────────────────────────
export async function logAction(params: LogActionParams): Promise<void> {
  const traceId = params.traceId || 'system-trace';
  const correlationId = params.correlationId || 'system-correlation';
  const ipAddress = params.ipAddress || '127.0.0.1';
  const userAgent = params.userAgent || 'unknown';
  const severity = params.severity || 'INFO';
  const createdAt = new Date();

  // Find the latest audit log to fetch its hash
  const latestLog = await prisma.auditLog.findFirst({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const previousHash = latestLog ? latestLog.hash : '0'.repeat(64);

  const hash = computeRecordHash({
    actorId: params.actorId || null,
    action: params.action,
    entity: params.entity,
    previousValue: params.previousValue || null,
    newValue: params.newValue || null,
    createdAt,
    previousHash,
  });

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

  await prisma.auditLog.create({
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
}

// ── List ─────────────────────────────────────────────────────────
export async function listAuditLogs(
  query: AuditLogQueryInput
): Promise<PaginatedResult<AuditLogSummary>> {
  const { page, limit, search, userId, actorId, action, resource, entity, resourceId } = query;
  const offset = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {};

  // Support both old (userId/resource) and new (actorId/entity) filters
  const finalActorId = actorId || userId;
  if (finalActorId) where.actorId = finalActorId;

  if (action) where.action = action;

  const finalEntity = entity || resource;
  if (finalEntity) where.entity = finalEntity;

  if (resourceId) where.resourceId = resourceId;

  if (search) {
    where.OR = [
      { action: { contains: search, mode: 'insensitive' } },
      { entity: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [count, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const items: AuditLogSummary[] = rows.map((row) => ({
    id: row.id,
    traceId: row.traceId,
    correlationId: row.correlationId,
    actorId: row.actorId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    deviceFingerprint: row.deviceFingerprint,
    severity: row.severity,
    entity: row.entity,
    resource: row.entity,
    action: row.action,
    resourceId: row.resourceId,
    status: row.severity === 'CRITICAL' || row.severity === 'SECURITY' ? 'failure' : 'success',
    createdAt: row.createdAt,
    hash: row.hash,
    previousHash: row.previousHash,
    user: row.user,
  }));

  return { items, meta: buildPaginationMeta(count, page, limit) };
}

// ── Get by ID ────────────────────────────────────────────────────
export async function getAuditLogById(id: string): Promise<AuditLogDetail> {
  const log = await prisma.auditLog.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  if (!log) throw new NotFoundError('AuditLog');

  return {
    id: log.id,
    traceId: log.traceId,
    correlationId: log.correlationId,
    actorId: log.actorId,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    deviceFingerprint: log.deviceFingerprint,
    severity: log.severity,
    entity: log.entity,
    resource: log.entity,
    action: log.action,
    resourceId: log.resourceId,
    status: log.severity === 'CRITICAL' || log.severity === 'SECURITY' ? 'failure' : 'success',
    createdAt: log.createdAt,
    hash: log.hash,
    previousHash: log.previousHash,
    user: log.user,
    previousValue: log.previousValue as Record<string, unknown> | null,
    newValue: log.newValue as Record<string, unknown> | null,
  };
}

// ── Verify Ledger Integrity ──────────────────────────────────────
export async function verifyAuditChain(): Promise<{ isValid: boolean; brokenAt?: string }> {
  const logs = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  let expectedPreviousHash = '0'.repeat(64);

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
