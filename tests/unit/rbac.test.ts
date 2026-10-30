import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  GLOBAL_WILDCARD,
  PERMISSIONS,
  SYSTEM_ROLES,
  hasPermission,
  permissionSatisfies,
} from '../../src/core/security/rbac.js';

const MODULES_DIR = path.resolve(__dirname, '../../src/modules');

/** Every literal `requirePermission('…')` name in the route files. */
function guardPermissions(): string[] {
  const names = new Set<string>();
  for (const moduleName of fs.readdirSync(MODULES_DIR)) {
    const dir = path.join(MODULES_DIR, moduleName);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.routes.ts'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of source.matchAll(/requirePermission\(\s*'([^']+)'/g)) {
        names.add(match[1] as string);
      }
    }
  }
  return [...names].sort();
}

function grantsOf(roleName: string): readonly string[] {
  const role = SYSTEM_ROLES.find((r) => r.name === roleName);
  if (!role) throw new Error(`Unknown role ${roleName}`);
  return role.permissions;
}

describe('permissionSatisfies', () => {
  it.each([
    ['user.read', 'user.read', true],
    ['user.read', 'user.update', false],
    ['user.*', 'user.delete', true],
    ['user.manage', 'user.delete', true],
    ['users.manage', 'user.read', false],
    ['role.*', 'user.read', false],
    [GLOBAL_WILDCARD, 'feature_flags.delete', true],
    ['admin.*', 'user.read', true],
    ['uploads:create', 'uploads.create', false],
    ['uploads:manage', 'uploads.create', true],
  ])('%s satisfies %s: %s', (granted, required, expected) => {
    expect(permissionSatisfies(granted, required)).toBe(expected);
  });
});

describe('Permission catalogue', () => {
  const catalogue = PERMISSIONS.map((p) => p.name);

  it('uses resource.action names only', () => {
    for (const name of catalogue) {
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(catalogue).size).toBe(catalogue.length);
  });

  it('lists every permission used by a route guard', () => {
    const guards = guardPermissions();
    expect(guards.length).toBeGreaterThan(0);
    expect(guards.filter((name) => !catalogue.includes(name))).toEqual([]);
  });

  it('only grants catalogued permissions to roles', () => {
    for (const role of SYSTEM_ROLES) {
      for (const name of role.permissions) {
        expect([...catalogue, GLOBAL_WILDCARD]).toContain(name);
      }
    }
  });
});

describe('Seeded system roles', () => {
  const guards = guardPermissions();

  it('lets super_admin pass every guard', () => {
    expect(guards.filter((g) => !hasPermission(grantsOf('super_admin'), g))).toEqual([]);
  });

  it('lets admin pass every guard except feature flags', () => {
    const denied = guards.filter((g) => !hasPermission(grantsOf('admin'), g));
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.every((g) => g.startsWith('feature_flags.'))).toBe(true);
  });

  it.each(['student', 'faculty'])('gives %s no admin permissions', (role) => {
    expect(guards.filter((g) => hasPermission(grantsOf(role), g))).toEqual([]);
  });

  it('never seeds the admin.* global wildcard', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role.permissions).not.toContain('admin.*');
    }
  });
});
