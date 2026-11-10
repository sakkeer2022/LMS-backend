import { prisma } from '@infrastructure/database/index';
import { treeError } from './category-tree.errors.js';
import {
  audit,
  lockOne,
  write,
  type Actor,
  type LockedRow,
  type Tx,
} from './category-tree.tx.js';
import type { AttachSubjectInput, UpdateSubjectInput } from './category-tree.dto.js';

/**
 * Subjects of a leaf (migration 20261110090000_leaf_subject_offerings). An offering is one
 * curriculum per leaf and subject (no board or level yet). The leaf rule is checked here,
 * inside the transaction, with the leaf row locked: createCategory locks its parent, so a
 * concurrent "add sub-category" and "add subject" cannot both succeed.
 */

export interface LeafSubject {
  curriculumId: string;
  subjectId: string;
  name: string;
  isActive: boolean;
  /** The subject itself is switched off for every leaf */
  subjectActive: boolean;
  tutors: number;
  prices: number;
  learners: number;
}

const MAX_CODE_LENGTH = 50;

function codeOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_CODE_LENGTH);
  return slug || 'subject';
}

async function lockLeaf(tx: Tx, categoryId: string): Promise<LockedRow> {
  const leaf = await lockOne(tx, categoryId);
  const children = await tx.category.count({ where: { parentId: categoryId } });
  if (children > 0) throw treeError('NOT_A_LEAF');
  return leaf;
}

export async function listLeafSubjects(categoryId: string): Promise<LeafSubject[]> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) throw treeError('CATEGORY_NOT_FOUND');
  const rows = await prisma.curriculum.findMany({
    where: { categoryId, boardId: null, levelId: null },
    include: {
      subject: { select: { name: true, isActive: true, sortOrder: true } },
      _count: { select: { assignments: true, priceRules: true, students: true } },
    },
  });
  return rows
    .sort(
      (a, b) => a.subject.sortOrder - b.subject.sortOrder || a.subject.name.localeCompare(b.subject.name)
    )
    .map((r) => ({
      curriculumId: r.id,
      subjectId: r.subjectId,
      name: r.subject.name,
      isActive: r.isActive,
      subjectActive: r.subject.isActive,
      tutors: r._count.assignments,
      prices: r._count.priceRules,
      learners: r._count.students,
    }));
}

/** Attaches a subject to a leaf (reactivating it if it was switched off), creating the subject by name when needed. */
export async function attachSubject(
  categoryId: string,
  input: AttachSubjectInput,
  actor: Actor
): Promise<{ curriculumId: string; subjectId: string; created: boolean }> {
  const result = await write('category.subject_attach', categoryId, async (tx) => {
    const leaf = await lockLeaf(tx, categoryId);
    let subject;
    if ('subjectId' in input) {
      subject = await tx.subject.findUnique({ where: { id: input.subjectId } });
      if (!subject?.isActive) throw treeError('UNKNOWN_SUBJECT');
    } else {
      // Same name, same subject: the code is the name's slug
      subject = await tx.subject.upsert({
        where: { code: codeOf(input.name) },
        create: { code: codeOf(input.name), name: input.name },
        update: {},
      });
      if (!subject.isActive) throw treeError('UNKNOWN_SUBJECT');
    }
    const existing = await tx.curriculum.findFirst({
      where: { categoryId, subjectId: subject.id, boardId: null, levelId: null },
    });
    const curriculum = existing
      ? await tx.curriculum.update({ where: { id: existing.id }, data: { isActive: true } })
      : await tx.curriculum.create({ data: { categoryId, subjectId: subject.id } });
    return {
      curriculumId: curriculum.id,
      subjectId: subject.id,
      created: !existing,
      newValue: { leaf: leaf.name, subject: subject.name },
    };
  });
  await audit(actor, 'category.subject_attach', categoryId, null, result.newValue);
  return { curriculumId: result.curriculumId, subjectId: result.subjectId, created: result.created };
}

async function findOffering(tx: Tx, categoryId: string, subjectId: string) {
  const row = await tx.curriculum.findFirst({
    where: { categoryId, subjectId, boardId: null, levelId: null },
    include: {
      subject: { select: { name: true } },
      _count: { select: { assignments: true, priceRules: true, students: true, materials: true } },
    },
  });
  if (!row) throw treeError('OFFERING_NOT_FOUND');
  return row;
}

/** Switches a leaf's subject on or off; tutors and prices keep pointing at it. */
export async function setOfferingActive(
  categoryId: string,
  subjectId: string,
  isActive: boolean,
  actor: Actor
): Promise<void> {
  const name = await write('category.subject_toggle', categoryId, async (tx) => {
    await lockLeaf(tx, categoryId);
    const row = await findOffering(tx, categoryId, subjectId);
    await tx.curriculum.update({ where: { id: row.id }, data: { isActive } });
    return row.subject.name;
  });
  await audit(actor, 'category.subject_toggle', categoryId, null, { subject: name, isActive });
}

/** Removes a subject from a leaf. Only an unused offering can go; otherwise deactivate it. */
export async function detachSubject(
  categoryId: string,
  subjectId: string,
  actor: Actor
): Promise<void> {
  const name = await write('category.subject_detach', categoryId, async (tx) => {
    await lockLeaf(tx, categoryId);
    const row = await findOffering(tx, categoryId, subjectId);
    const { assignments, priceRules, students, materials } = row._count;
    if (assignments + priceRules + students + materials > 0) {
      throw treeError('OFFERING_IN_USE', undefined, {
        tutors: assignments,
        prices: priceRules,
        learners: students,
        materials,
      });
    }
    await tx.curriculum.delete({ where: { id: row.id } });
    return row.subject.name;
  });
  await audit(actor, 'category.subject_detach', categoryId, { subject: name }, null);
}

/** Renames a subject or switches it off for every leaf. */
export async function updateSubject(
  subjectId: string,
  input: UpdateSubjectInput,
  actor: Actor
): Promise<{ id: string; name: string; isActive: boolean }> {
  const before = await prisma.subject.findUnique({ where: { id: subjectId } });
  if (!before) throw treeError('UNKNOWN_SUBJECT');
  const after = await prisma.subject.update({ where: { id: subjectId }, data: input });
  await audit(
    actor,
    'subject.update',
    subjectId,
    { name: before.name, isActive: before.isActive },
    { name: after.name, isActive: after.isActive }
  );
  return { id: after.id, name: after.name, isActive: after.isActive };
}
