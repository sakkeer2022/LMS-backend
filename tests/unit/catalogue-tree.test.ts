import { describe, it, expect } from 'vitest';
import type { CatalogueNodeStatus, CatalogueNodeType } from '@prisma/client';
import {
  NodeIndex,
  buildTree,
  checkPlacement,
  slugify,
  type TreeNodeRow,
} from '../../src/modules/catalogue/catalogue.tree';

function node(
  id: string,
  parentId: string | null,
  type: CatalogueNodeType,
  extra: Partial<TreeNodeRow> & { status?: CatalogueNodeStatus } = {}
): TreeNodeRow {
  return {
    id,
    parentId,
    rootId: 'root',
    type,
    name: id,
    slug: id,
    status: 'PUBLISHED',
    sortOrder: 0,
    categoryId: type === 'CATEGORY' ? 'cat-school' : null,
    boardId: type === 'BOARD' ? `b-${id}` : null,
    subjectId: type === 'SUBJECT' ? `s-${id}` : null,
    levelId: type === 'LEVEL' ? `l-${id}` : null,
    bookingEnabled: true,
    ...extra,
  };
}

// School › K-12 › CBSE › Physics › Class 11 / Class 12, plus a draft Chemistry branch
const rows: TreeNodeRow[] = [
  node('root', null, 'CATEGORY', { name: 'School' }),
  node('k12', 'root', 'SUBSECTION', { name: 'K-12' }),
  node('cbse', 'k12', 'BOARD', { name: 'CBSE' }),
  node('physics', 'cbse', 'SUBJECT', { name: 'Physics', sortOrder: 2 }),
  node('class11', 'physics', 'LEVEL', { name: 'Class 11' }),
  node('class12', 'physics', 'LEVEL', { name: 'Class 12', status: 'DRAFT' }),
  node('chemistry', 'cbse', 'SUBJECT', { name: 'Chemistry', sortOrder: 1, status: 'DRAFT' }),
  node('chem11', 'chemistry', 'LEVEL', { name: 'Class 11' }),
];

describe('checkPlacement', () => {
  it.each([
    // type, parent, requiresBoard, expected
    ['SUBSECTION', 'CATEGORY', true, null],
    ['BOARD', 'SUBSECTION', true, null],
    ['BOARD', 'CATEGORY', true, null],
    ['SUBJECT', 'BOARD', true, null],
    ['LEVEL', 'SUBJECT', true, null],
    ['SUBJECT', 'CATEGORY', false, null],
    ['SUBJECT', 'SUBSECTION', false, null],
    ['CATEGORY', 'CATEGORY', false, 'CATEGORY_NOT_ALLOWED'],
    ['SUBSECTION', 'BOARD', true, 'INVALID_PARENT_TYPE'],
    ['SUBJECT', 'SUBJECT', false, 'INVALID_PARENT_TYPE'],
    ['BOARD', 'LEVEL', true, 'INVALID_PARENT_TYPE'],
    ['BOARD', 'CATEGORY', false, 'BOARD_NOT_ALLOWED'],
    ['SUBJECT', 'SUBSECTION', true, 'BOARD_REQUIRED'],
    ['LEVEL', 'BOARD', true, 'LEVEL_PARENT_MUST_BE_SUBJECT'],
    ['LEVEL', 'CATEGORY', false, 'LEVEL_PARENT_MUST_BE_SUBJECT'],
  ] as const)('%s under %s (requiresBoard=%s) -> %s', (type, parent, requiresBoard, expected) => {
    expect(checkPlacement(type, parent, requiresBoard)).toBe(expected);
  });
});

describe('NodeIndex', () => {
  const index = new NodeIndex(rows);

  it('returns ancestors from the root down and the whole subtree', () => {
    expect(index.ancestors('class11').map((n) => n.id)).toEqual(['root', 'k12', 'cbse', 'physics']);
    expect(index.subtree('cbse').map((n) => n.id).sort()).toEqual(
      ['cbse', 'chem11', 'chemistry', 'class11', 'class12', 'physics'].sort()
    );
  });

  it('orders siblings by sortOrder then name', () => {
    expect(index.childrenOf('cbse').map((n) => n.id)).toEqual(['chemistry', 'physics']);
  });

  it('detects moves that would create a cycle', () => {
    expect(index.isSelfOrDescendant('cbse', 'physics')).toBe(true);
    expect(index.isSelfOrDescendant('cbse', 'cbse')).toBe(true);
    expect(index.isSelfOrDescendant('physics', 'cbse')).toBe(false);
  });

  it('treats a node as published only when every ancestor is published', () => {
    expect(index.isEffectivelyPublished('class11')).toBe(true);
    expect(index.isEffectivelyPublished('class12')).toBe(false);
    // Published leaf under a draft subject
    expect(index.isEffectivelyPublished('chem11')).toBe(false);
  });

  it('derives the offering tuple from the leaf ancestors', () => {
    expect(index.offeringOf('class11')).toEqual({
      categoryId: 'cat-school',
      boardId: 'b-cbse',
      subjectId: 's-physics',
      levelId: 'l-class11',
    });
    expect(index.offeringOf('physics')).toBeNull();
  });
});

describe('buildTree', () => {
  const index = new NodeIndex(rows);

  it('counts direct children and descendants by type', () => {
    const tree = buildTree(index, 'root');
    expect(tree?.childCount).toBe(1);
    expect(tree?.counts).toEqual({ subsections: 1, boards: 1, subjects: 2, levels: 3 });
  });

  it('keeps only effectively published nodes in the public tree', () => {
    const tree = buildTree(index, 'root', { publishedOnly: true });
    const cbse = tree?.children[0].children[0];
    expect(cbse?.children.map((n) => n.id)).toEqual(['physics']);
    expect(cbse?.children[0].children.map((n) => n.id)).toEqual(['class11']);
    expect(tree?.counts.levels).toBe(1);
  });

  it('keeps search matches with their ancestors and subtree', () => {
    const tree = buildTree(index, 'root', { q: 'chem' });
    const cbse = tree?.children[0].children[0];
    expect(cbse?.children.map((n) => n.id)).toEqual(['chemistry']);
    expect(cbse?.children[0].children.map((n) => n.id)).toEqual(['chem11']);
  });

  it('returns null when nothing matches the search', () => {
    expect(buildTree(index, 'root', { q: 'zoology' })).toBeNull();
  });

  it('attaches curriculum ids to leaves', () => {
    const tree = buildTree(index, 'root', { curriculumByNode: new Map([['class11', 'cur-1']]) });
    const physics = tree?.children[0].children[0].children.find((n) => n.id === 'physics');
    expect(physics?.children.find((n) => n.id === 'class11')?.curriculumId).toBe('cur-1');
  });
});

describe('slugify', () => {
  it.each([
    ['Research & Skill Learning', 'research-and-skill-learning'],
    ['K-12', 'k-12'],
    ['  Class 11  ', 'class-11'],
    ['12th Grade', 'n-12th-grade'],
    ['Économie', 'economie'],
    ['!!!', 'node'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
