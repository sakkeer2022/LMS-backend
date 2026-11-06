import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import type { Router } from 'express';
import { router, featureRouters } from '../../src/routes/index.js';

/**
 * Route/contract drift check (LMS-93). Every route the API serves must be in
 * docs/openapi.yaml, or listed below as a known undocumented route with a reason.
 * Only method and path are compared; parameter names are ignored.
 */

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

// Template routes that predate the Sprint 1 contract. The decision on keeping,
// documenting or removing them is still open ("legacy routes: leave for now").
// Remove an entry when its route is removed or added to the contract; the
// tests below fail if an entry goes stale.
const KNOWN_UNDOCUMENTED: Record<string, string> = {
  'GET /': 'API info route',

  'GET /roles': 'Template RBAC administration',
  'GET /roles/{}': 'Template RBAC administration',
  'POST /roles': 'Template RBAC administration',
  'PATCH /roles/{}': 'Template RBAC administration',
  'DELETE /roles/{}': 'Template RBAC administration',
  'POST /roles/{}/permissions': 'Template RBAC administration',
  'PUT /roles/{}/permissions': 'Template RBAC administration',
  'DELETE /roles/{}/permissions': 'Template RBAC administration',
  'GET /permissions': 'Template RBAC administration',
  'GET /permissions/{}': 'Template RBAC administration',
  'POST /permissions': 'Template RBAC administration',
  'PATCH /permissions/{}': 'Template RBAC administration',
  'DELETE /permissions/{}': 'Template RBAC administration',
  'GET /users': 'Template user administration',
  'GET /users/{}': 'Template user administration',
  'POST /users': 'Template user administration',
  'PATCH /users/{}': 'Template user administration',
  'DELETE /users/{}': 'Template user administration',
  'POST /users/{}/roles': 'Template user administration',
  'PUT /users/{}/roles': 'Template user administration',
  'DELETE /users/{}/roles': 'Template user administration',

  'GET /feature-flags': 'Template feature flags',
  'GET /feature-flags/{}': 'Template feature flags',
  'POST /feature-flags': 'Template feature flags',
  'PATCH /feature-flags/{}': 'Template feature flags',
  'DELETE /feature-flags/{}': 'Template feature flags',

  'GET /notifications': 'Template notifications (M13, later sprint)',
  'GET /notifications/{}': 'Template notifications (M13, later sprint)',
  'POST /notifications': 'Template notifications (M13, later sprint)',
  'PATCH /notifications/{}': 'Template notifications (M13, later sprint)',
  'DELETE /notifications/{}': 'Template notifications (M13, later sprint)',

  'GET /admin/stats': 'Template admin dashboard',
  'GET /admin/health': 'Template admin dashboard',
  'POST /admin/users/{}/unlock': 'Template admin account actions',
  'PUT /admin/users/{}/active': 'Template admin account actions',

  'POST /uploads': 'Template quarantine upload; library uploads (LMS-60) replace it',
};

/** `/users/:id` and `/users/{userId}` both become `/users/{}`. */
function normalise(routePath: string): string {
  const withParams = routePath.replace(/:[A-Za-z0-9_]+/g, '{}').replace(/\{[^}]+\}/g, '{}');
  return withParams.length > 1 ? withParams.replace(/\/$/, '') : withParams;
}

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function routesOf(mountPath: string, expressRouter: Router): string[] {
  const routes: string[] = [];
  for (const layer of expressRouter.stack as unknown as RouteLayer[]) {
    if (!layer.route) continue;
    const fullPath = layer.route.path === '/' ? mountPath || '/' : mountPath + layer.route.path;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push(`${method.toUpperCase()} ${normalise(fullPath)}`);
    }
  }
  return routes;
}

function implementedRoutes(): string[] {
  const routes = [
    ...routesOf('', router),
    ...featureRouters.flatMap(([mountPath, featureRouter]) => routesOf(mountPath, featureRouter)),
  ];
  return [...new Set(routes)].sort();
}

function contractRoutes(): Set<string> {
  const contractPath = path.resolve(__dirname, '../../docs/openapi.yaml');
  const spec = YAML.parse(fs.readFileSync(contractPath, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const routes = new Set<string>();
  for (const [routePath, operations] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (operations[method]) routes.add(`${method.toUpperCase()} ${normalise(routePath)}`);
    }
  }
  return routes;
}

describe('API routes match the contract (docs/openapi.yaml)', () => {
  const implemented = implementedRoutes();
  const contract = contractRoutes();

  it('finds the implemented routes', () => {
    expect(implemented.length).toBeGreaterThan(20);
    expect(implemented).toContain('GET /auth/me');
  });

  it('documents every implemented route, or lists it as known undocumented', () => {
    const undocumented = implemented.filter(
      (route) => !contract.has(route) && !(route in KNOWN_UNDOCUMENTED)
    );
    // Add the route to docs/build-contract-draft.py and regenerate the contract.
    expect(undocumented).toEqual([]);
  });

  it('keeps the known-undocumented list current', () => {
    const removed = Object.keys(KNOWN_UNDOCUMENTED).filter((route) => !implemented.includes(route));
    const nowDocumented = Object.keys(KNOWN_UNDOCUMENTED).filter((route) => contract.has(route));
    // Delete these entries from KNOWN_UNDOCUMENTED.
    expect({ removed, nowDocumented }).toEqual({ removed: [], nowDocumented: [] });
  });
});
