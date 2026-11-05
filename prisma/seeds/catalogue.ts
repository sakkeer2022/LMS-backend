import type { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

/**
 * Catalogue reference data (LMS-53, ADR 0003). Safe in every environment:
 * rows are created only when their code is missing, nothing is deleted, and a
 * row that already exists is never overwritten, so admin edits survive re-runs.
 *
 * Values are PROPOSED starter data pending Product sign-off.
 */

export const CATALOGUE_PERMISSIONS = [
  {
    name: 'catalogue.read',
    resource: 'catalogue',
    action: 'read',
    description: 'Can read the catalogue, including drafts',
  },
  {
    name: 'catalogue.manage',
    resource: 'catalogue',
    action: 'manage',
    description: 'Full access to the catalogue',
  },
];

// Category tree (ADR-0005): two roots, the frontline tabs below them. Whether a category
// is a leaf, and its category curriculum, are derived by the categories_leaf_sync trigger.
const ROOTS = [
  { code: 'academic', name: 'Academic' },
  { code: 'non-academic', name: 'Non-academic' },
];

const CATEGORIES = [
  { code: 'school', name: 'School', requiresBoard: true, root: 'academic' },
  { code: 'university', name: 'University', requiresBoard: false, root: 'academic' },
  { code: 'jee-neet', name: 'JEE / NEET', requiresBoard: false, root: 'academic' },
  {
    code: 'research-skill',
    name: 'Research & Skill Learning',
    requiresBoard: false,
    root: 'non-academic',
  },
];

// Boards exist only under categories with requiresBoard (School)
const BOARDS = [
  { code: 'cbse', name: 'CBSE' },
  { code: 'ncert', name: 'NCERT' },
  { code: 'icse', name: 'ICSE' },
  { code: 'state-board', name: 'State Board' },
];

const SUBJECTS = [
  { code: 'physics', name: 'Physics' },
  { code: 'chemistry', name: 'Chemistry' },
  { code: 'mathematics', name: 'Mathematics' },
  { code: 'biology', name: 'Biology' },
  { code: 'english', name: 'English' },
  { code: 'computer-science', name: 'Computer Science' },
  { code: 'economics', name: 'Economics' },
  { code: 'accountancy', name: 'Accountancy' },
  { code: 'business-studies', name: 'Business Studies' },
  { code: 'hindi', name: 'Hindi' },
  { code: 'social-science', name: 'Social Science' },
];

const LEVELS: Record<string, { code: string; name: string }[]> = {
  school: Array.from({ length: 12 }, (_, i) => ({
    code: `class-${i + 1}`,
    name: `Class ${i + 1}`,
  })),
  university: Array.from({ length: 4 }, (_, i) => ({
    code: `year-${i + 1}`,
    name: `Year ${i + 1}`,
  })),
  'jee-neet': [
    { code: 'jee-main', name: 'JEE Main' },
    { code: 'jee-advanced', name: 'JEE Advanced' },
    { code: 'neet', name: 'NEET' },
  ],
  'research-skill': [
    { code: 'beginner', name: 'Beginner' },
    { code: 'intermediate', name: 'Intermediate' },
    { code: 'advanced', name: 'Advanced' },
  ],
};

// Subsections created under a category root. "Competitive" waits for decision D11.
const SUBSECTIONS: Record<string, { slug: string; name: string }[]> = {
  school: [{ slug: 'k-12', name: 'K-12' }],
};

export async function seedCataloguePermissions(prisma: PrismaClient): Promise<void> {
  await prisma.permission.createMany({
    data: CATALOGUE_PERMISSIONS.map((p) => ({ id: uuidv4(), ...p })),
    skipDuplicates: true,
  });
}

export async function seedCatalogue(prisma: PrismaClient): Promise<void> {
  // Roots, then the tabs under them. Paths are unique, so they are the upsert key; an
  // existing row is never overwritten, so admin edits survive re-runs.
  const rootIds = new Map<string, string>();
  for (const [index, r] of ROOTS.entries()) {
    const row = await prisma.category.upsert({
      where: { path: r.code },
      create: {
        code: r.code,
        name: r.name,
        path: r.code,
        depth: 0,
        displayOrder: index + 1,
      },
      update: {},
    });
    rootIds.set(r.code, row.id);
  }

  const categoryIds = new Map<string, string>();
  for (const [index, c] of CATEGORIES.entries()) {
    const path = `${c.root}/${c.code}`;
    const row = await prisma.category.upsert({
      where: { path },
      create: {
        code: c.code,
        name: c.name,
        parentId: rootIds.get(c.root)!,
        path,
        depth: 1,
        displayOrder: index + 1,
      },
      update: {},
    });
    categoryIds.set(c.code, row.id);
  }

  for (const [index, b] of BOARDS.entries()) {
    await prisma.board.upsert({
      where: { code: b.code },
      create: { ...b, sortOrder: index + 1 },
      update: {},
    });
  }

  for (const [index, s] of SUBJECTS.entries()) {
    await prisma.subject.upsert({
      where: { code: s.code },
      create: { ...s, sortOrder: index + 1 },
      update: {},
    });
  }

  for (const [categoryCode, levels] of Object.entries(LEVELS)) {
    const categoryId = categoryIds.get(categoryCode)!;
    for (const [index, l] of levels.entries()) {
      await prisma.level.upsert({
        where: { code: l.code },
        create: { ...l, categoryId, sortOrder: index + 1 },
        update: {},
      });
    }
  }

  // Legacy catalogue_nodes (ADR-0003). The tree is frozen, but its read endpoints stay
  // until it is removed; a sub-section node shares its id with the category it became.
  for (const [index, c] of CATEGORIES.entries()) {
    const categoryId = categoryIds.get(c.code)!;
    let root = await prisma.catalogueNode.findUnique({ where: { categoryId } });
    if (!root) {
      const id = uuidv4();
      root = await prisma.catalogueNode.create({
        data: {
          id,
          rootId: id,
          type: 'CATEGORY',
          name: c.name,
          slug: c.code,
          status: 'PUBLISHED',
          sortOrder: index + 1,
          categoryId,
        },
      });
    }

    for (const [subIndex, sub] of (SUBSECTIONS[c.code] ?? []).entries()) {
      let node = await prisma.catalogueNode.findFirst({
        where: { parentId: root.id, slug: sub.slug },
      });
      if (!node) {
        node = await prisma.catalogueNode.create({
          data: {
            parentId: root.id,
            rootId: root.id,
            type: 'SUBSECTION',
            name: sub.name,
            slug: sub.slug,
            status: 'PUBLISHED',
            sortOrder: subIndex + 1,
          },
        });
      }
      // The sub-section as a category of the tree
      const path = `${CATEGORIES[index].root}/${c.code}/${sub.slug}`;
      await prisma.category.upsert({
        where: { path },
        create: {
          id: node.id,
          code: sub.slug,
          name: sub.name,
          parentId: categoryId,
          path,
          depth: 2,
          displayOrder: subIndex + 1,
        },
        update: {},
      });
    }
  }
}
