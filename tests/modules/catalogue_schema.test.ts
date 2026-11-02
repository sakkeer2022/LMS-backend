import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@infrastructure/database/index';
import type { PrismaClient } from '@prisma/client';
import { seedCatalogue, seedCataloguePermissions } from '../../prisma/seeds/catalogue';
import {
  createBoard,
  allowLevel,
  createCategory,
  createChildNode,
  createLevel,
  createRootNode,
  createSubject,
} from '../helpers/catalogue';

// LMS-53: catalogue tree schema (ADR 0003) and reference seed
describe('Catalogue schema', () => {
  describe('constraints', () => {
    let category: Awaited<ReturnType<typeof createCategory>>;
    let root: Awaited<ReturnType<typeof createRootNode>>;

    beforeEach(async () => {
      category = await createCategory({ requiresBoard: true });
      root = await createRootNode(category.id);
    });

    it('builds a full path down to a LEVEL leaf that owns one curriculum', async () => {
      const board = await createBoard();
      const subject = await createSubject();
      const level = await createLevel({ categoryId: category.id });
      await allowLevel(category.id, level.id);

      const sub = await createChildNode(root, { type: 'SUBSECTION' });
      const boardNode = await createChildNode(sub, { type: 'BOARD', boardId: board.id });
      const subjectNode = await createChildNode(boardNode, { type: 'SUBJECT', subjectId: subject.id });
      const leaf = await createChildNode(subjectNode, { type: 'LEVEL', levelId: level.id });

      const curriculum = await prisma.curriculum.create({
        data: { categoryId: category.id, boardId: board.id, subjectId: subject.id, levelId: level.id, nodeId: leaf.id },
      });
      expect(curriculum.nodeId).toBe(leaf.id);
      expect(leaf.rootId).toBe(root.id);

      // A leaf owns at most one curriculum
      const otherLevel = await createLevel();
      await allowLevel(category.id, otherLevel.id);
      await expect(
        prisma.curriculum.create({
          data: { categoryId: category.id, boardId: board.id, subjectId: subject.id, levelId: otherLevel.id, nodeId: leaf.id },
        })
      ).rejects.toThrow();
    });

    it('rejects a CATEGORY node without its category reference', async () => {
      const id = crypto.randomUUID();
      await expect(
        prisma.catalogueNode.create({ data: { id, rootId: id, type: 'CATEGORY', name: 'x', slug: 'x' } })
      ).rejects.toThrow(/catalogue_nodes_master_ref_check/);
    });

    it('rejects a non-CATEGORY node without a parent', async () => {
      await expect(
        prisma.catalogueNode.create({ data: { rootId: root.id, type: 'SUBSECTION', name: 'x', slug: 'x' } })
      ).rejects.toThrow(/catalogue_nodes_parent_check/);
    });

    it('rejects a node carrying another type’s master reference', async () => {
      const subject = await createSubject();
      await expect(createChildNode(root, { type: 'BOARD', subjectId: subject.id })).rejects.toThrow(
        /catalogue_nodes_master_ref_check/
      );
      await expect(createChildNode(root, { type: 'LEVEL' })).rejects.toThrow(/catalogue_nodes_master_ref_check/);
    });

    it('allows one node per master value and per slug among siblings', async () => {
      const subject = await createSubject();
      await createChildNode(root, { type: 'SUBJECT', subjectId: subject.id, slug: 'physics' });

      await expect(createChildNode(root, { type: 'SUBJECT', subjectId: subject.id })).rejects.toThrow();
      const other = await createSubject();
      await expect(createChildNode(root, { type: 'SUBJECT', subjectId: other.id, slug: 'physics' })).rejects.toThrow();

      // The same subject under a different parent is fine
      const sub = await createChildNode(root, { type: 'SUBSECTION' });
      await expect(createChildNode(sub, { type: 'SUBJECT', subjectId: subject.id, slug: 'physics' })).resolves.toBeTruthy();
    });

    it('makes orphan nodes impossible', async () => {
      const sub = await createChildNode(root, { type: 'SUBSECTION' });
      await createChildNode(sub, { type: 'SUBSECTION' });

      await expect(prisma.catalogueNode.delete({ where: { id: sub.id } })).rejects.toThrow();
      await expect(
        createChildNode({ id: crypto.randomUUID(), rootId: root.id }, { type: 'SUBSECTION' })
      ).rejects.toThrow();
    });

    it('allows one CATEGORY node per category', async () => {
      await expect(createRootNode(category.id)).rejects.toThrow();
    });

    it('rejects a negative sort order', async () => {
      await expect(createChildNode(root, { type: 'SUBSECTION', sortOrder: -1 })).rejects.toThrow(
        /catalogue_nodes_sort_order_check/
      );
    });
  });

  describe('reference seed', () => {
    const client = prisma as unknown as PrismaClient;

    it('creates the category tree, the legacy roots and the K-12 subsection', async () => {
      await seedCatalogue(client);

      const tree = await prisma.category.findMany({ orderBy: { path: 'asc' } });
      expect(tree.map((c) => [c.path, c.isBookable])).toEqual([
        ['academic', false],
        ['academic/jee-neet', true],
        ['academic/school', false],
        ['academic/school/k-12', true],
        ['academic/university', true],
        ['non-academic', false],
        ['non-academic/research-skill', true],
      ]);
      const categories = await prisma.category.findMany({ where: { depth: 1 }, orderBy: { displayOrder: 'asc' } });
      expect(categories.map((c) => c.code)).toEqual(['school', 'university', 'jee-neet', 'research-skill']);
      expect(categories.find((c) => c.code === 'school')?.requiresBoard).toBe(true);

      const roots = await prisma.catalogueNode.findMany({ where: { type: 'CATEGORY' } });
      expect(roots).toHaveLength(4);
      for (const r of roots) {
        expect(r.rootId).toBe(r.id);
        expect(r.status).toBe('PUBLISHED');
      }

      const school = categories.find((c) => c.code === 'school')!;
      const schoolRoot = roots.find((r) => r.categoryId === school.id)!;
      const k12 = await prisma.catalogueNode.findFirst({ where: { parentId: schoolRoot.id, slug: 'k-12' } });
      expect(k12?.type).toBe('SUBSECTION');
      // The legacy sub-section node and the category-tree leaf share their id
      expect(tree.find((c) => c.path === 'academic/school/k-12')?.id).toBe(k12?.id);
      expect(await prisma.categoryLevel.count({ where: { categoryId: k12?.id } })).toBe(12);

      const schoolLevels = await prisma.level.findMany({ where: { categoryId: school.id }, orderBy: { sortOrder: 'asc' } });
      expect(schoolLevels).toHaveLength(12);
      expect(schoolLevels[1].name).toBe('Class 2');
      expect(schoolLevels[9].name).toBe('Class 10');
    });

    it('is idempotent and never overwrites existing rows', async () => {
      await seedCatalogue(client);
      await prisma.subject.update({ where: { code: 'physics' }, data: { name: 'Physics (edited)' } });

      const counts = async () => ({
        categories: await prisma.category.count(),
        boards: await prisma.board.count(),
        subjects: await prisma.subject.count(),
        levels: await prisma.level.count(),
        nodes: await prisma.catalogueNode.count(),
      });
      const first = await counts();
      await seedCatalogue(client);
      expect(await counts()).toEqual(first);
      expect(first).toEqual({ categories: 7, boards: 4, subjects: 11, levels: 22, nodes: 5 });

      const physics = await prisma.subject.findUnique({ where: { code: 'physics' } });
      expect(physics?.name).toBe('Physics (edited)');
    });

    it('creates the catalogue permissions once', async () => {
      await seedCataloguePermissions(client);
      await seedCataloguePermissions(client);
      const perms = await prisma.permission.findMany({ where: { resource: 'catalogue' }, orderBy: { name: 'asc' } });
      expect(perms.map((p) => p.name)).toEqual(['catalogue.manage', 'catalogue.read']);
    });
  });
});
