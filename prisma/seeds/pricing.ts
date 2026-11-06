import type { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

/** Pricing permissions (LMS-58), resource.action names. Safe to re-run. */
export const PRICING_PERMISSIONS = [
  { name: 'pricing.read', resource: 'pricing', action: 'read', description: 'Can read price rules' },
  { name: 'pricing.manage', resource: 'pricing', action: 'manage', description: 'Full access to price rules' },
];

export async function seedPricingPermissions(prisma: PrismaClient): Promise<void> {
  await prisma.permission.createMany({
    data: PRICING_PERMISSIONS.map((p) => ({ id: uuidv4(), ...p })),
    skipDuplicates: true,
  });
}
