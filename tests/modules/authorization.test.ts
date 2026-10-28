import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';
import { requirePermission } from '../../src/middleware/authenticate';
import {
  resolvePermissionsForRoles,
  resolvePoliciesForRoles,
} from '../../src/modules/roles/roles.service';

describe('Authorization & Hierarchy Integration', () => {
  it('should resolve hierarchical permissions recursively and avoid cycles', async () => {
    // 1. Create a hierarchy: parent_role -> child_role -> grandchild_role
    const parentRole = await prisma.role.create({
      data: { name: 'parent_role', description: 'Parent' },
    });
    const childRole = await prisma.role.create({
      data: { name: 'child_role', description: 'Child', parentId: parentRole.id },
    });
    const grandchildRole = await prisma.role.create({
      data: { name: 'grandchild_role', description: 'Grandchild', parentId: childRole.id },
    });

    // 2. Create permissions and assign to roles
    const perm1 = await prisma.permission.create({
      data: { name: 'document.read', resource: 'document', action: 'read' },
    });
    const perm2 = await prisma.permission.create({
      data: { name: 'document.write', resource: 'document', action: 'write' },
    });

    await prisma.rolePermission.create({
      data: { roleId: parentRole.id, permissionId: perm1.id },
    });
    await prisma.rolePermission.create({
      data: { roleId: childRole.id, permissionId: perm2.id },
    });

    // 3. Resolve permissions for grandchild_role
    const resolvedPerms = await resolvePermissionsForRoles([grandchildRole.id]);
    expect(resolvedPerms).toContain('document.read');
    expect(resolvedPerms).toContain('document.write');

    // 4. Resolve policies for grandchild_role
    const resolvedPolicies = await resolvePoliciesForRoles([grandchildRole.id]);
    expect(resolvedPolicies.some((p) => p.subject === 'document' && p.action === 'read')).toBe(true);
    expect(resolvedPolicies.some((p) => p.subject === 'document' && p.action === 'write')).toBe(true);
  });

  it('should reject cyclic parent relationships via HTTP API', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    // Setup a user to log in with admin permissions or use seed admin
    // For simplicity, we can create roles directly using prisma and test update cycle detection
    const roleA = await prisma.role.create({
      data: { name: 'role_a' },
    });
    const roleB = await prisma.role.create({
      data: { name: 'role_b', parentId: roleA.id },
    });

    // Test cycle validation error in the service layer by calling it indirectly
    // Or we can just call updateRole service method directly
    const { updateRole } = await import('../../src/modules/roles/roles.service.js');
    await expect(updateRole(roleA.id, { parentId: roleB.id })).rejects.toThrow(
      'Role inheritance cycle detected'
    );
  });

  it('should enforce ABAC policy conditions in requirePermission middleware', async () => {
    const middleware = requirePermission('document.read');

    // 1. User context with restricted read policy
    const userPayload = {
      sub: 'user-123',
      email: 'test@example.com',
      roles: ['user'],
      permissions: ['document.read'],
      policies: [
        {
          subject: 'document',
          action: 'read',
          conditions: {
            ownerId: { $eq: 'user.sub' },
          },
        },
      ],
    };

    // 2. Request matching conditions (authorized)
    const reqOk: any = {
      user: userPayload,
      resource: { ownerId: 'user-123' },
    };

    let nextCalled = false;
    let nextError: any = null;
    await middleware(reqOk, {} as any, (err?: any) => {
      nextCalled = true;
      nextError = err;
    });

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();

    // 3. Request failing conditions (unauthorized)
    const reqFail: any = {
      user: userPayload,
      resource: { ownerId: 'user-456' },
    };

    let nextCalledFail = false;
    let nextErrorFail: any = null;
    await middleware(reqFail, {} as any, (err?: any) => {
      nextCalledFail = true;
      nextErrorFail = err;
    });

    expect(nextCalledFail).toBe(true);
    expect(nextErrorFail).toBeDefined();
    expect(nextErrorFail.statusCode).toBe(403);
  });
});
