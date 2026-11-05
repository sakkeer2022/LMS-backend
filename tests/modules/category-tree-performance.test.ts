import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import { setFlag } from '../helpers/category-tree.js';
import { prisma } from '@infrastructure/database/index.js';
import { loadAdminTree } from '@modules/category-tree/category-tree.reads';

/**
 * Performance target (ADR-0005): the admin tree loads in under 200 ms (p95, uncached,
 * server side) for 5,000 nodes. Also reports the learner reads and a large move.
 * Override with CATEGORY_TREE_BENCH_NODES / CATEGORY_TREE_BENCH_MS.
 */
const TARGET_MS = Number(process.env.CATEGORY_TREE_BENCH_MS ?? 200);
const ROOTS = 4;
const TIERS = 20;
const LEAVES = Math.max(
  1,
  Math.ceil(
    (Number(process.env.CATEGORY_TREE_BENCH_NODES ?? 5000) - ROOTS - ROOTS * TIERS) /
      (ROOTS * TIERS)
  )
);

async function time<T>(fn: () => Promise<T>): Promise<number> {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

describe('Category tree performance', () => {
  let total = 0;

  beforeEach(async () => {
    // One statement per level keeps every row consistent for the deferred tree trigger
    await prisma.$executeRaw`
      INSERT INTO categories (code, name, path, depth, display_order, updated_at, requires_level)
      SELECT 'r' || r, 'Root ' || r, 'r' || r, 0, r, now(), false FROM generate_series(1, ${ROOTS}) r`;
    await prisma.$executeRaw`
      INSERT INTO categories (parent_id, code, name, path, depth, display_order, updated_at, requires_level)
      SELECT p.id, 't' || t, 'Tier ' || t, p.path || '/t' || t, 1, t, now(), false
      FROM categories p CROSS JOIN generate_series(1, ${TIERS}) t WHERE p.depth = 0`;
    await prisma.$executeRaw`
      INSERT INTO categories (parent_id, code, name, path, depth, display_order, updated_at, is_bookable, requires_level)
      SELECT p.id, 'l' || l, 'Leaf ' || l, p.path || '/l' || l, 2, l, now(), true, false
      FROM categories p CROSS JOIN generate_series(1, ${LEAVES}) l WHERE p.depth = 1`;
    const subject = await prisma.subject.create({
      data: { code: 'bench-subject', name: 'Bench subject' },
    });
    // One offering on every third leaf
    await prisma.$executeRaw`
      INSERT INTO curricula (category_id, subject_id, updated_at)
      SELECT id, ${subject.id}::uuid, now() FROM categories WHERE is_bookable AND display_order % 3 = 0`;
    await prisma.$executeRaw`ANALYZE categories`;
    await prisma.$executeRaw`ANALYZE curricula`;
    total = await prisma.category.count();
  }, 120_000);

  it(`loads the whole admin tree in under ${TARGET_MS} ms (p95, uncached)`, async () => {
    expect(total).toBeGreaterThanOrEqual(Number(process.env.CATEGORY_TREE_BENCH_NODES ?? 5000));
    await loadAdminTree(); // warm up the connection and plan
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) samples.push(await time(() => loadAdminTree()));
    const result = p95(samples);
    console.info(
      `[bench] admin tree, ${total} nodes: p95 ${result.toFixed(1)} ms, min ${Math.min(...samples).toFixed(1)} ms`
    );
    expect(result).toBeLessThan(TARGET_MS);

    const tree = await loadAdminTree();
    expect(tree.nodes).toHaveLength(total);
    expect(tree.stats.bookableLeaves).toBe(ROOTS * TIERS * LEAVES);
  }, 60_000);

  it('serves the cached tree and the learner reads quickly', async () => {
    const admin = await createUserWithPermissions(['catalogue.read']);
    await request(app)
      .get('/api/v1/admin/category-tree')
      .set('Authorization', `Bearer ${admin.token}`);
    const cached = await time(() =>
      request(app).get('/api/v1/admin/category-tree').set('Authorization', `Bearer ${admin.token}`)
    );
    await setFlag('catalogue.category_tree', true);
    const tier = await prisma.category.findFirstOrThrow({ where: { depth: 1 } });
    const children = await time(() =>
      request(app).get(`/api/v1/catalogue/category-tree/children?parentId=${tier.id}`)
    );
    const leaves = await time(() =>
      request(app).get('/api/v1/catalogue/category-tree/leaves?limit=50&page=10')
    );
    console.info(
      `[bench] cached admin tree ${cached.toFixed(1)} ms, learner children ${children.toFixed(1)} ms, learner leaves page ${leaves.toFixed(1)} ms`
    );
    expect(Math.max(children, leaves)).toBeLessThan(TARGET_MS * 2);
  }, 60_000);

  it('moves a branch of over a thousand nodes in one transaction', async () => {
    const csrf = await getCsrfData();
    const admin = await createUserWithPermissions(['catalogue.read', 'catalogue.manage']);
    const branch = await prisma.category.findFirstOrThrow({ where: { path: 'r1' } });
    const r2 = await prisma.category.findFirstOrThrow({ where: { path: 'r2' } });
    const ms = await time(async () => {
      const res = await request(app)
        .put(`/api/v1/admin/category-tree/${branch.id}/move`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Cookie', csrf.csrfCookie)
        .set('x-csrf-token', csrf.csrfToken)
        .send({ version: branch.version, parentId: r2.id });
      expect(res.status).toBe(200);
    });
    const moved = await prisma.category.count({ where: { path: { startsWith: 'r2/r1/' } } });
    console.info(`[bench] moved ${moved + 1} nodes in ${ms.toFixed(1)} ms`);
    expect(moved).toBe(TIERS + TIERS * LEAVES);
    const failures = await prisma.$queryRaw<
      { failures: bigint }[]
    >`SELECT failures FROM category_tree_verify() WHERE failures > 0`;
    expect(failures).toEqual([]);
  }, 60_000);
});
