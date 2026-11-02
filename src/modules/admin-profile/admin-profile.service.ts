import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { NotFoundError } from '@core/errors/index';
import { buildPaginationMeta } from '@shared/types/pagination';
import type { PaginationQuery } from '@shared/validation/index';
import { logAction, type AuditContext } from '../audit/audit.service.js';
import { loadContractUser, type ContractUser } from '../auth/contract-user.js';
import type { AdminProfileUpdateInput } from './admin-profile.dto.js';

/** The events an admin can see about their own account; request logs and others stay private. */
export const SECURITY_ACTIONS = [
  'login.success',
  'login.failed',
  'session.revoked',
  'session.revoked_others',
  'session.reuse_detected',
  'reauth.success',
  'reauth.failed',
  'profile.updated',
] as const;

export async function updateProfile(
  userId: string,
  input: AdminProfileUpdateInput,
  audit: AuditContext
): Promise<ContractUser> {
  const current = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { fullName: true, mobileNumber: true, timezone: true },
  });
  if (!current) throw new NotFoundError('User');

  await prisma.user.update({
    where: { id: userId },
    data: { fullName: input.fullName, mobileNumber: input.mobileNumber, timezone: input.timezone },
  });

  await logAction({
    ...audit,
    actorId: userId,
    severity: 'INFO',
    entity: 'profile',
    action: 'profile.updated',
    resourceId: userId,
    previousValue: current,
    newValue: input,
  });
  return loadContractUser(userId);
}

export async function listOwnActivity(
  userId: string,
  query: PaginationQuery
): Promise<{
  events: Array<{
    id: string;
    action: string;
    createdAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }>;
  meta: ReturnType<typeof buildPaginationMeta>;
}> {
  const where: Prisma.AuditLogWhereInput = {
    actorId: userId,
    action: { in: [...SECURITY_ACTIONS] },
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    events: rows.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      ...(row.ipAddress && { ipAddress: row.ipAddress }),
      ...(row.userAgent && { userAgent: row.userAgent.slice(0, 512) }),
    })),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}
