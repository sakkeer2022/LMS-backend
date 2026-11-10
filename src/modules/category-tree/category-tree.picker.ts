import { prisma } from '@infrastructure/database/index';
import { selectableLeaf, visibleTo } from './category-tree.offerings.js';
import { ancestorPaths } from './category-tree.rules.js';

/**
 * The category tree as the column picker on faculty onboarding shows it (screen 43c),
 * and the same path labels used wherever a tutor's choice is named (admin drawer,
 * pricing, price consent). A tutor picks a subject of a leaf (a category without
 * sub-categories): one curriculum per leaf and subject, so a choice is a curriculumId. Only visible branches that lead to a leaf are included. Two
 * queries, whole tree; the tree is small (ADR-0005).
 */

export interface PickerNode {
  id: string;
  parentId: string | null;
  name: string;
  isLeaf: boolean;
}

/** One choosable subject of a leaf. Board and level are always null (step 2 adds them). */
export interface PickerOffering {
  curriculumId: string;
  categoryId: string;
  board: { id: string; name: string } | null;
  level: { id: string; name: string } | null;
  subject: { id: string; name: string };
}

export interface OfferingTree {
  nodes: PickerNode[];
  offerings: PickerOffering[];
}

interface NodeRow {
  id: string;
  parent_id: string | null;
  name: string;
  is_bookable: boolean;
}

interface OfferingRow {
  curriculum_id: string;
  category_id: string;
  subject_id: string;
  subject_name: string;
}

export async function getOfferingTree(): Promise<OfferingTree> {
  const [nodes, offerings] = await Promise.all([
    prisma.$queryRaw<NodeRow[]>`
      SELECT c.id, c.parent_id, c.name, c.is_bookable
      FROM categories c
      WHERE ${visibleTo('c')}
        AND (
          (${selectableLeaf('c')})
          OR EXISTS (
            SELECT 1 FROM categories l
            WHERE left(l.path, length(c.path) + 1) = c.path || '/' AND ${selectableLeaf('l')}
          )
        )
      ORDER BY c.depth, c.display_order, c.name, c.id`,
    prisma.$queryRaw<OfferingRow[]>`
      SELECT cu.id AS curriculum_id, c.id AS category_id, s.id AS subject_id, s.name AS subject_name
      FROM curricula cu
      JOIN categories c ON c.id = cu.category_id
      JOIN subjects s ON s.id = cu.subject_id
      WHERE cu.is_active AND s.is_active AND cu.board_id IS NULL AND cu.level_id IS NULL
        AND ${selectableLeaf('c')}
      ORDER BY c.depth, c.display_order, c.name, c.id, s.sort_order, s.name`,
  ]);
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      parentId: n.parent_id,
      name: n.name,
      isLeaf: n.is_bookable,
    })),
    offerings: offerings.map((o) => ({
      curriculumId: o.curriculum_id,
      categoryId: o.category_id,
      board: null,
      level: null,
      subject: { id: o.subject_id, name: o.subject_name },
    })),
  };
}

export interface OfferingLabel {
  curriculumId: string;
  /** Category names from the root to the leaf, e.g. ["School", "K-12", "CBSE", "Physics", "Class 11"]. */
  categoryPath: string[];
  board: string | null;
  level: string | null;
  /** The card title: the subject. */
  subject: string;
  /** Everything above the title: "School › K-12 › CBSE › Physics". */
  pathLabel: string;
  /** The choice is active on a visible leaf, so it can still be chosen. */
  selectable: boolean;
}

/** Labels for curricula, in the order of `ids`; unknown ids are left out. */
export async function describeOfferings(ids: readonly string[]): Promise<OfferingLabel[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await prisma.$queryRaw<
    {
      id: string;
      path: string;
      category_name: string;
      board: string | null;
      level: string | null;
      subject: string;
      selectable: boolean;
    }[]
  >`
    SELECT cu.id, c.path, c.name AS category_name, b.name AS board, lv.name AS level, s.name AS subject,
           (cu.is_active AND s.is_active AND (b.id IS NULL OR b.is_active)
             AND (lv.id IS NULL OR lv.is_active) AND c.is_bookable AND ${visibleTo('c')}) AS selectable
    FROM curricula cu
    JOIN categories c ON c.id = cu.category_id
    JOIN subjects s ON s.id = cu.subject_id
    LEFT JOIN boards b ON b.id = cu.board_id
    LEFT JOIN levels lv ON lv.id = cu.level_id
    WHERE cu.id = ANY(${unique}::uuid[])`;
  const ancestors = [...new Set(rows.flatMap((r) => ancestorPaths(r.path)))];
  const names = new Map(
    (ancestors.length
      ? await prisma.category.findMany({
          where: { path: { in: ancestors } },
          select: { path: true, name: true },
        })
      : []
    ).map((c) => [c.path, c.name])
  );
  const byId = new Map(
    rows.map((r): [string, OfferingLabel] => {
      const categoryPath = [
        ...ancestorPaths(r.path).map((p) => names.get(p) ?? ''),
        r.category_name,
      ].filter(Boolean);
      return [
        r.id,
        {
          curriculumId: r.id,
          categoryPath,
          board: r.board,
          level: r.level,
          subject: r.subject,
          pathLabel: [...categoryPath, r.board, r.level]
            .filter(Boolean)
            .join(' › '),
          selectable: r.selectable,
        },
      ];
    })
  );
  return ids.flatMap((id, i) =>
    ids.indexOf(id) === i && byId.has(id) ? [byId.get(id) as OfferingLabel] : []
  );
}
