import { describe, it, expect } from 'vitest';
import type { Router } from 'express';
import { featureRouters } from '../../src/routes/index.js';
import { requireAdminPortalUser } from '../../src/middleware/authenticate.js';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle: unknown;
};

const isGuard = (h: unknown) =>
  typeof (h as { permissionKey?: string }).permissionKey === 'string' ||
  h === requireAdminPortalUser;

/** Routes that are public or act only on the caller's own account, by design. Anything else needs a permission guard. */
const SELF_OR_PUBLIC = [
  /^\/auth\//,
  /^\/regions/,
  /^\/policies/, // learner-facing read of the current policy
  /^\/consent/,
  /^\/students\/me/,
  /^\/faculty\/onboarding/,
  /^\/catalogue/,
  /^\/prices/,
  /^\/admin\/category-tree\/.*learner/,
];

function unguarded(): string[] {
  const out: string[] = [];
  for (const [mount, router] of featureRouters) {
    let guardedByUse = false;
    for (const layer of (router as Router & { stack: Layer[] }).stack) {
      if (!layer.route) {
        if (isGuard(layer.handle)) guardedByUse = true;
        continue;
      }
      const guarded = guardedByUse || layer.route.stack.some((l) => isGuard(l.handle));
      if (!guarded) {
        const method = Object.keys(layer.route.methods)[0]!.toUpperCase();
        out.push(`${method} ${mount}${layer.route.path === '/' ? '' : layer.route.path}`);
      }
    }
  }
  return out.filter((r) => !SELF_OR_PUBLIC.some((re) => re.test(r.split(' ')[1]!)));
}

describe('route guards', () => {
  it('every route is public by design, self-only, or behind a permission guard', () => {
    // faculty and student self routes are checked by their own permission or role guards (see their tests)
    const allowed = [/^\/faculty\/me/, /^\/admin\/me\//];
    const offenders = unguarded().filter((r) => !allowed.some((re) => re.test(r.split(' ')[1]!)));
    expect(offenders).toEqual([]);
  });
});
