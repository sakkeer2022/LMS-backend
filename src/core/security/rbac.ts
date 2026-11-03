/**
 * Single source of truth for permission names and the seeded system roles.
 *
 * Naming convention: `resource.action` (see src/docs/RBAC_RULES.md). Every
 * `requirePermission('…')` guard must use a name listed here; a unit test
 * (tests/unit/rbac.test.ts) fails when a guard and this list drift apart.
 */

export interface PermissionDefinition {
  name: string;
  resource: string;
  action: string;
  description: string;
}

function permission(name: string, description: string): PermissionDefinition {
  const [resource, action] = name.split('.') as [string, string];
  return { name, resource, action, description };
}

/** Grants every permission. Only the super_admin role holds it. */
export const GLOBAL_WILDCARD = '*';

export const PERMISSIONS: readonly PermissionDefinition[] = [
  permission('admin.read', 'View admin dashboard statistics and system health'),
  permission('admin.write', 'Unlock accounts and activate or deactivate users'),
  permission('audit.read', 'Read audit log entries'),
  permission('catalogue.read', 'Read the course catalogue tree'),
  permission('catalogue.manage', 'Create, edit and publish catalogue nodes'),
  permission('configuration.read', 'Read platform settings'),
  permission('configuration.manage', 'Change platform settings'),
  permission('faculty.create', 'Invite tutors and create faculty accounts'),
  permission('faculty.read', 'Read private faculty profiles and invitations'),
  permission('feature_flags.create', 'Create feature flags'),
  permission('feature_flags.read', 'Read feature flags'),
  permission('feature_flags.update', 'Update feature flags'),
  permission('feature_flags.delete', 'Delete feature flags'),
  permission('notifications.create', 'Create notifications'),
  permission('notifications.read', 'Read notifications'),
  permission('notifications.update', 'Update notifications'),
  permission('notifications.delete', 'Delete notifications'),
  permission('permission.create', 'Create permissions'),
  permission('permission.read', 'Read permissions'),
  permission('permission.update', 'Update permissions'),
  permission('permission.delete', 'Delete permissions'),
  permission('pricing.read', 'Read price rules'),
  permission('pricing.manage', 'Create and edit price rules'),
  permission('role.create', 'Create roles'),
  permission('role.read', 'Read roles'),
  permission('role.update', 'Update roles'),
  permission('role.delete', 'Delete roles'),
  permission('role.assign_permission', 'Grant and revoke role permissions'),
  permission('uploads.create', 'Upload files to quarantine for scanning'),
  permission('user.create', 'Create users'),
  permission('user.read', 'Read users'),
  permission('user.update', 'Update users'),
  permission('user.delete', 'Delete users'),
  permission('user.assign_role', 'Assign and remove user roles'),
];

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: readonly string[];
}

const ADMIN_EXCLUDED_RESOURCES = ['feature_flags'];

/**
 * Portal and system roles. Student and faculty start with no permissions; each
 * epic adds the permissions its endpoints need.
 */
export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    name: 'super_admin',
    description: 'Full system access',
    permissions: [GLOBAL_WILDCARD],
  },
  {
    name: 'admin',
    description: 'Admin portal: platform administration (no feature-flag management)',
    permissions: PERMISSIONS.filter((p) => !ADMIN_EXCLUDED_RESOURCES.includes(p.resource)).map(
      (p) => p.name
    ),
  },
  {
    name: 'faculty',
    description: 'Faculty portal',
    permissions: [],
  },
  {
    name: 'student',
    description: 'Student portal',
    permissions: [],
  },
];

/**
 * Whether one granted permission satisfies a required one. Accepts:
 * - `*` or `admin.*`: everything (global wildcards)
 * - an exact match
 * - `resource.*` or `resource.manage`: every action on that resource
 * `:` is accepted as a legacy separator in either name.
 */
export function permissionSatisfies(granted: string, required: string): boolean {
  if (granted === GLOBAL_WILDCARD || granted === 'admin.*') return true;
  if (granted === required) return true;

  const [requiredResource] = required.split(/[.:]/);
  const [grantedResource, grantedAction] = granted.split(/[.:]/);
  return (
    grantedResource === requiredResource && (grantedAction === '*' || grantedAction === 'manage')
  );
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.some((perm) => permissionSatisfies(perm, required));
}
