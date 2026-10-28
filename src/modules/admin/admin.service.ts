import { prisma } from '@infrastructure/database/index';
import { redisClient } from '@infrastructure/redis/connection';
import { NotFoundError } from '@core/errors/index';
import { logAction } from '@modules/audit/audit.service';

export interface AdminStats {
  users: {
    total: number;
    active: number;
  };
  roles: {
    total: number;
  };
  featureFlags: {
    total: number;
    enabled: number;
  };
  notifications: {
    total: number;
  };
  auditLogs: {
    total: number;
    recent: Array<{
      id: string;
      action: string;
      resource: string;
      status: string;
      createdAt: Date;
      userEmail: string | null;
    }>;
  };
}

export interface SystemHealth {
  status: 'UP' | 'DOWN';
  uptime: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
  database: {
    status: 'UP' | 'DOWN';
  };
  redis: {
    status: 'UP' | 'DOWN' | 'DISABLED';
  };
}

export async function getAdminStats(): Promise<AdminStats> {
  const [
    totalUsers,
    activeUsers,
    totalRoles,
    totalFlags,
    enabledFlags,
    totalNotifications,
    totalAuditLogs,
    recentAuditLogs,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { isActive: true, deletedAt: null } }),
    prisma.role.count({ where: { deletedAt: null } }),
    prisma.featureFlag.count(),
    prisma.featureFlag.count({ where: { isEnabled: true } }),
    prisma.notification.count(),
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
    }),
  ]);

  return {
    users: {
      total: totalUsers,
      active: activeUsers,
    },
    roles: {
      total: totalRoles,
    },
    featureFlags: {
      total: totalFlags,
      enabled: enabledFlags,
    },
    notifications: {
      total: totalNotifications,
    },
    auditLogs: {
      total: totalAuditLogs,
      recent: recentAuditLogs.map((log) => ({
        id: log.id,
        action: log.action,
        resource: log.entity,
        status: log.severity === 'CRITICAL' || log.severity === 'SECURITY' ? 'warning' : 'success',
        createdAt: log.createdAt,
        userEmail: log.user?.email ?? null,
      })),
    },
  };
}

export async function unlockUserAccount(
  userId: string,
  actorId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // Log the action to the audit logs
  await logAction({
    actorId: actorId ?? null,
    action: 'user.unlock',
    entity: 'user',
    resourceId: userId,
    newValue: { email: user.email },
    severity: 'SECURITY',
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });
}

export async function toggleUserActiveState(
  userId: string,
  isActive: boolean,
  actorId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isActive },
  });

  // Log the action to the audit logs
  await logAction({
    actorId: actorId ?? null,
    action: isActive ? 'user.activate' : 'user.deactivate',
    entity: 'user',
    resourceId: userId,
    previousValue: { email: user.email, isActive: !isActive },
    newValue: { email: user.email, isActive },
    severity: 'SECURITY',
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });
}

export async function getSystemHealth(): Promise<SystemHealth> {
  let dbStatus: 'UP' | 'DOWN' = 'UP';
  let redisStatus: 'UP' | 'DOWN' | 'DISABLED' = 'DISABLED';

  try {
    // Ping DB
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'DOWN';
  }

  if (redisClient) {
    try {
      const pong = await redisClient.ping();
      redisStatus = pong === 'PONG' ? 'UP' : 'DOWN';
    } catch {
      redisStatus = 'DOWN';
    }
  }

  const overallStatus = dbStatus === 'UP' && redisStatus !== 'DOWN' ? 'UP' : 'DOWN';

  return {
    status: overallStatus,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    database: {
      status: dbStatus,
    },
    redis: {
      status: redisStatus,
    },
  };
}
