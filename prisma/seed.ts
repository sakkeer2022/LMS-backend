import { prisma } from '../src/infrastructure/database/connection.js';
import { v4 as uuidv4 } from 'uuid';

const RESOURCES = ['users', 'roles', 'permissions', 'audit_logs', 'feature_flags'];
const ACTIONS = ['create', 'read', 'update', 'delete'];

async function main() {
  console.log('🌱 Start seeding...');

  // Generate permissions for every resource × action combo
  const permissionsData = RESOURCES.flatMap((resource) =>
    ACTIONS.map((action) => ({
      id: uuidv4(),
      name: `${resource}:${action}`,
      resource,
      action,
      description: `Can ${action} ${resource}`,
    }))
  );

  // Wildcard manage permission per resource
  const managePermissionsData = RESOURCES.map((resource) => ({
    id: uuidv4(),
    name: `${resource}:manage`,
    resource,
    action: 'manage',
    description: `Full access to ${resource}`,
  }));

  const allPermissionsData = [...permissionsData, ...managePermissionsData];

  console.log(`Creating ${allPermissionsData.length} permissions...`);
  // Insert permissions
  await prisma.permission.createMany({
    data: allPermissionsData,
    skipDuplicates: true,
  });

  // Query permissions back to map them correctly in memory
  const dbPermissions = await prisma.permission.findMany();

  const rolesData = [
    {
      id: uuidv4(),
      name: 'super_admin',
      description: 'Full system access',
      isSystem: true,
      isActive: true,
    },
    {
      id: uuidv4(),
      name: 'admin',
      description: 'Administrative access (no feature-flag management)',
      isSystem: true,
      isActive: true,
    },
    {
      id: uuidv4(),
      name: 'viewer',
      description: 'Read-only access',
      isSystem: true,
      isActive: true,
    },
  ];

  console.log('Creating roles...');
  await prisma.role.createMany({
    data: rolesData,
    skipDuplicates: true,
  });

  const dbRoles = await prisma.role.findMany();
  const superAdmin = dbRoles.find((r) => r.name === 'super_admin')!;
  const admin = dbRoles.find((r) => r.name === 'admin')!;
  const viewer = dbRoles.find((r) => r.name === 'viewer')!;

  // Map permissions to roles
  // 1. super_admin gets all manage permissions
  const superAdminRolePerms = dbPermissions
    .filter((p) => p.action === 'manage')
    .map((p) => ({
      roleId: superAdmin.id,
      permissionId: p.id,
    }));

  // 2. admin gets all non-feature_flags manage + all CRUD on users/roles/permissions/audit_logs
  const adminRolePerms = dbPermissions
    .filter(
      (p) =>
        (p.action !== 'manage' && ['users', 'roles', 'permissions', 'audit_logs'].includes(p.resource)) ||
        (p.action === 'manage' && p.resource !== 'feature_flags')
    )
    .map((p) => ({
      roleId: admin.id,
      permissionId: p.id,
    }));

  // 3. viewer gets only read permissions
  const viewerRolePerms = dbPermissions
    .filter((p) => p.action === 'read')
    .map((p) => ({
      roleId: viewer.id,
      permissionId: p.id,
    }));

  const allRolePerms = [...superAdminRolePerms, ...adminRolePerms, ...viewerRolePerms];

  console.log(`Creating ${allRolePerms.length} role-permission mappings...`);
  await prisma.rolePermission.createMany({
    data: allRolePerms,
    skipDuplicates: true,
  });

  console.log('🌱 Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
