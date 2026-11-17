import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { NotFoundError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import { toPrismaPagination } from '@shared/validation/index';
import type { StudentLibraryQuery } from './library.dto.js';
import { readStoredFile } from './library.faculty.js';
import { contentOf, type FileInfo } from './library.views.js';

/**
 * Student Library: the live (approved) resources of active, published faculty. Only the approved
 * version is ever shown; a pending edit, a rejected or withdrawn resource never reaches a student.
 * Scan status is not part of the filter: library files are not scanned yet (F4), so requiring a
 * clean scan would hide everything.
 */

export type ResourceType = 'pdf' | 'image' | 'document' | 'slides' | 'note';

export interface StudentResource {
  id: string;
  title: string;
  description: string | null;
  type: ResourceType;
  /** File size in bytes; null for a note */
  sizeBytes: number | null;
  /** Estimated reading time of a note; null for a file */
  readMinutes: number | null;
  facultyName: string;
  subject: { id: string; name: string };
  board: string | null;
  level: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentResourceDetail extends StudentResource {
  /** Note text */
  body: string | null;
  file: FileInfo | null;
  /** Other resources of the same subject, newest first */
  related: StudentResource[];
}

export interface LibrarySubject {
  id: string;
  name: string;
  count: number;
}

const visible: Prisma.LibraryMaterialWhereInput = {
  status: 'APPROVED',
  audience: { in: ['STUDENT', 'ALL'] },
  kind: { in: ['DOCUMENT', 'NOTE'] },
  curriculum: { isActive: true, subject: { isActive: true } },
  faculty: { isActive: true, isPublished: true, approvalStatus: 'APPROVED' },
};

const include = {
  curriculum: {
    select: {
      subject: { select: { id: true, name: true } },
      board: { select: { name: true } },
      level: { select: { name: true } },
    },
  },
  faculty: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.LibraryMaterialInclude;

type Row = Prisma.LibraryMaterialGetPayload<{ include: typeof include }>;

function typeOf(row: Pick<Row, 'kind' | 'mimeType'>): ResourceType {
  const mime = row.mimeType ?? '';
  if (row.kind === 'NOTE') return 'note';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slides';
  return 'document';
}

function toResource(row: Row): StudentResource {
  const words =
    row.kind === 'NOTE' ? (row.body ?? '').trim().split(/\s+/).filter(Boolean).length : 0;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: typeOf(row),
    sizeBytes: row.kind === 'DOCUMENT' ? (row.fileSize ?? null) : null,
    readMinutes: row.kind === 'NOTE' ? Math.max(1, Math.ceil(words / 200)) : null,
    facultyName: row.faculty?.user.fullName ?? 'Faculty',
    subject: row.curriculum?.subject ?? { id: '', name: 'Library' },
    board: row.curriculum?.board?.name ?? null,
    level: row.curriculum?.level?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ORDER: Record<StudentLibraryQuery['sort'], Prisma.LibraryMaterialOrderByWithRelationInput[]> =
  {
    recent: [{ createdAt: 'desc' }, { id: 'asc' }],
    updated: [{ updatedAt: 'desc' }, { id: 'asc' }],
    title: [{ title: 'asc' }, { id: 'asc' }],
  };

/** GET /library */
export async function listResources(
  query: StudentLibraryQuery
): Promise<PaginatedResult<StudentResource>> {
  const where: Prisma.LibraryMaterialWhereInput = {
    AND: [
      visible,
      query.subjectId ? { curriculum: { subjectId: query.subjectId } } : {},
      query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { faculty: { user: { fullName: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.libraryMaterial.findMany({
      where,
      include,
      orderBy: ORDER[query.sort],
      ...toPrismaPagination(query),
    }),
    prisma.libraryMaterial.count({ where }),
  ]);
  return { items: rows.map(toResource), meta: buildPaginationMeta(total, query.page, query.limit) };
}

/** GET /library/subjects: the filter tabs, with how many resources each holds. */
export async function listSubjects(): Promise<LibrarySubject[]> {
  const perCard = await prisma.libraryMaterial.groupBy({
    by: ['curriculumId'],
    where: visible,
    _count: { _all: true },
  });
  const ids = perCard.flatMap((g) => (g.curriculumId ? [g.curriculumId] : []));
  const curricula = await prisma.curriculum.findMany({
    where: { id: { in: ids } },
    select: { id: true, subject: { select: { id: true, name: true } } },
  });
  const subjectOf = new Map(curricula.map((c) => [c.id, c.subject]));
  const bySubject = new Map<string, LibrarySubject>();
  for (const g of perCard) {
    const subject = g.curriculumId ? subjectOf.get(g.curriculumId) : undefined;
    if (!subject) continue;
    const entry = bySubject.get(subject.id) ?? { id: subject.id, name: subject.name, count: 0 };
    entry.count += g._count._all;
    bySubject.set(subject.id, entry);
  }
  return [...bySubject.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function liveRow(id: string, extra: Prisma.LibraryMaterialWhereInput = {}): Promise<Row> {
  const row = await prisma.libraryMaterial.findFirst({
    where: { AND: [{ id }, visible, extra] },
    include,
  });
  if (!row) throw new NotFoundError('Resource');
  return row;
}

/** GET /library/:id */
export async function getResource(id: string): Promise<StudentResourceDetail> {
  const row = await liveRow(id);
  const related = await prisma.libraryMaterial.findMany({
    where: {
      AND: [
        visible,
        { id: { not: id } },
        { curriculum: { subjectId: row.curriculum?.subject.id } },
      ],
    },
    include,
    orderBy: ORDER.updated,
    take: 3,
  });
  const { body, file } = contentOf(row);
  return { ...toResource(row), body, file, related: related.map(toResource) };
}

/** GET /library/:id/file: the live file; never a pending edit. */
export async function getResourceFile(
  id: string
): Promise<Awaited<ReturnType<typeof readStoredFile>>> {
  return readStoredFile(await liveRow(id, { kind: 'DOCUMENT' }));
}
