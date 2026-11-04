import { prisma } from '@infrastructure/database/index';
import { bookableLeaf, visibleTo } from './category-tree.offerings.js';
import { ancestorPaths } from './category-tree.rules.js';

/**
 * The category tree as the column picker on faculty onboarding shows it (screen 43c),
 * and the same path labels used wherever a tutor's offering is named (admin drawer,
 * pricing, price consent). Only visible branches that lead to a bookable leaf with an
 * active offering are included. Two queries, whole tree; the tree is small (ADR-0005).
 */

export interface PickerNode {
  id: string;
  parentId: string | null;
  name: string;
  isLeaf: boolean;
}

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
  board_id: string | null;
  board_name: string | null;
  level_id: string | null;
  level_name: string | null;
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
          (${bookableLeaf('c')})
          OR EXISTS (
            SELECT 1 FROM categories l
            WHERE left(l.path, length(c.path) + 1) = c.path || '/' AND ${bookableLeaf('l')}
          )
        )
      ORDER BY c.depth, c.display_order, c.name, c.id`,
    prisma.$queryRaw<OfferingRow[]>`
      SELECT cu.id AS curriculum_id, cu.category_id,
             b.id AS board_id, b.name AS board_name,
             lv.id AS level_id, lv.name AS level_name,
             s.id AS subject_id, s.name AS subject_name
      FROM curricula cu
      JOIN categories c ON c.id = cu.category_id
      JOIN subjects s ON s.id = cu.subject_id AND s.is_active
      LEFT JOIN boards b ON b.id = cu.board_id
      LEFT JOIN levels lv ON lv.id = cu.level_id
      WHERE cu.is_active
        AND ${bookableLeaf('c')}
        AND (cu.board_id IS NULL OR b.is_active)
        AND (cu.level_id IS NULL OR lv.is_active)
      ORDER BY b.sort_order NULLS FIRST, b.name, lv.sort_order NULLS FIRST, lv.name, s.sort_order, s.name`,
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
      board: o.board_id ? { id: o.board_id, name: o.board_name as string } : null,
      level: o.level_id ? { id: o.level_id, name: o.level_name as string } : null,
      subject: { id: o.subject_id, name: o.subject_name },
    })),
  };
}

export interface OfferingLabel {
  curriculumId: string;
  /** Category names from the root to the leaf, e.g. ["Academic", "School", "K-12"]. */
  categoryPath: string[];
  board: string | null;
  level: string | null;
  subject: string;
  /** "Academic › School › K-12 › CBSE › Class 11" (everything but the subject). */
  pathLabel: string;
  /** The offering is active on a visible bookable leaf, so it can still be chosen. */
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
           (cu.is_active AND s.is_active AND (b.id IS NULL OR b.is_active) AND (lv.id IS NULL OR lv.is_active)
             AND ${bookableLeaf('c')}) AS selectable
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
          pathLabel: [...categoryPath, r.board, r.level].filter(Boolean).join(' › '),
          selectable: r.selectable,
        },
      ];
    })
  );
  return ids.flatMap((id, i) =>
    ids.indexOf(id) === i && byId.has(id) ? [byId.get(id) as OfferingLabel] : []
  );
}
