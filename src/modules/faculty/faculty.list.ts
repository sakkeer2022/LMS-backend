import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { ValidationError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import { ONBOARDING_DOCUMENTS } from './faculty.documents.js';
import {
  consentStatuses,
  decideAccess,
  priceSnapshotHash,
  pricedSubjects,
  pricingStatusOf,
  type PricingStatus,
} from './faculty.access.js';
import type {
  FacultyCountsQuery,
  FacultySort,
  FacultyTab,
  ListFacultyQuery,
} from './faculty.dto.js';

/**
 * The admin Faculty roster (LMS-78): faculty profiles plus outstanding invitations,
 * one row each, with a single derived status.
 *
 * Status of a profile, first match wins:
 *   suspended  profile inactive, or the user account inactive or suspended
 *   published  approved and published
 *   verified   approved, not yet published
 *   rejected   rejected (shown under "All" only)
 *   pending    every other approval state (pending, changes requested)
 * Status of a PENDING invitation: invited, or expired once its expiry has passed
 * (expired invitations are shown under "All" only). Accepted and revoked
 * invitations are not listed: an accepted one is represented by its profile.
 */
export type FacultyRowStatus =
  | 'invited'
  | 'expired'
  | 'pending'
  | 'verified'
  | 'published'
  | 'rejected'
  | 'suspended';

export type FacultyRowKind = 'invitation' | 'profile';

/** Statuses shown under each tab. */
export const TAB_STATUSES: Record<Exclude<FacultyTab, 'all'>, readonly FacultyRowStatus[]> = {
  pending: ['invited', 'pending'],
  verified: ['verified'],
  published: ['published'],
  suspended: ['suspended'],
};

/**
 * Verification documents expected from every tutor (screen 27b shows four). The
 * exact checklist is a pending product decision (docs/PENDING_DECISIONS.md, F2).
 */
export const REQUIRED_VERIFICATION_DOCUMENTS = ONBOARDING_DOCUMENTS.length;

export interface FacultyListItem {
  id: string;
  kind: FacultyRowKind;
  fullName: string | null;
  email: string;
  status: FacultyRowStatus;
  /** Distinct subject names from active catalogue assignments. */
  subjects: string[];
  /** Most recent qualification, e.g. "Ph.D. · IIT Bombay". */
  qualification: string | null;
  documents: { uploaded: number; required: number } | null;
  /** Pricing after approval (screen 29); `none` for invitations and unapproved tutors. */
  pricing: PricingStatus;
  /** Profile creation, or invitation creation for invitation rows. */
  appliedAt: Date;
  invitation: { sentAt: Date | null; expiresAt: Date; deliveryMethod: 'email' | 'link' } | null;
}

export type FacultyStatusCounts = Record<FacultyTab, number>;

interface RosterRow {
  kind: FacultyRowKind;
  id: string;
  full_name: string | null;
  email: string;
  status: FacultyRowStatus;
  applied_at: Date;
  sent_at: Date | null;
  expires_at: Date | null;
  delivery_method: 'EMAIL' | 'LINK' | null;
}

const PROFILE_STATUS = Prisma.sql`CASE
    WHEN NOT fp.is_active OR NOT u.is_active OR u.status IN ('SUSPENDED', 'INACTIVE') THEN 'suspended'
    WHEN fp.approval_status = 'APPROVED' AND fp.is_published THEN 'published'
    WHEN fp.approval_status = 'APPROVED' THEN 'verified'
    WHEN fp.approval_status = 'REJECTED' THEN 'rejected'
    ELSE 'pending'
  END`;

// Fixed SQL only: the sort key is chosen from this map, never from input.
const ORDER_BY: Record<FacultySort, Prisma.Sql> = {
  recent: Prisma.sql`applied_at DESC, id DESC`,
  oldest: Prisma.sql`applied_at ASC, id ASC`,
  name: Prisma.sql`lower(COALESCE(full_name, email)) ASC, id ASC`,
};

/** Escapes LIKE wildcards so user input matches literally (used with ESCAPE '\\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function categoryPath(categoryId: string): Promise<string> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { path: true },
  });
  if (!category) throw new ValidationError('Unknown category', { code: 'UNKNOWN_CATEGORY' });
  return category.path;
}

/** The roster as a CTE named `roster`, narrowed by search and category. */
async function rosterCte(filters: FacultyCountsQuery): Promise<Prisma.Sql> {
  let profileCategory = Prisma.empty;
  // Invitations carry no catalogue assignment, so a category filter hides them
  let invitationCategory = Prisma.empty;
  if (filters.categoryId) {
    const path = await categoryPath(filters.categoryId);
    profileCategory = Prisma.sql`AND EXISTS (
      SELECT 1 FROM faculty_assignments fa
      JOIN curricula cu ON cu.id = fa.curriculum_id
      JOIN categories c ON c.id = cu.category_id
      WHERE fa.faculty_id = fp.id AND fa.is_active
        AND (c.path = ${path} OR c.path LIKE ${`${escapeLike(path)}/%`} ESCAPE '\\'))`;
    invitationCategory = Prisma.sql`AND FALSE`;
  }

  return Prisma.sql`WITH roster AS (
    SELECT 'invitation'::text AS kind, i.id, NULL::text AS full_name, i.email,
      CASE WHEN i.expires_at <= now() THEN 'expired' ELSE 'invited' END AS status,
      i.created_at AS applied_at, i.sent_at, i.expires_at, i.delivery_method::text AS delivery_method
    FROM faculty_invitations i
    WHERE i.status = 'PENDING' ${invitationCategory}
    UNION ALL
    SELECT 'profile'::text, fp.id, u.full_name, u.email, ${PROFILE_STATUS},
      fp.created_at, NULL::timestamp, NULL::timestamp, NULL::text
    FROM faculty_profiles fp
    JOIN users u ON u.id = fp.user_id
    WHERE u.deleted_at IS NULL ${profileCategory}
  )`;
}

function searchCondition(search: string | undefined): Prisma.Sql {
  if (!search) return Prisma.sql`TRUE`;
  const pattern = `%${escapeLike(search)}%`;
  return Prisma.sql`(full_name ILIKE ${pattern} ESCAPE '\\' OR email ILIKE ${pattern} ESCAPE '\\')`;
}

function tabCondition(tab: FacultyTab): Prisma.Sql {
  if (tab === 'all') return Prisma.sql`TRUE`;
  return Prisma.sql`status IN (${Prisma.join([...TAB_STATUSES[tab]])})`;
}

/** Tab badge counts from per-status counts. */
export function countsByTab(
  perStatus: Partial<Record<FacultyRowStatus, number>>
): FacultyStatusCounts {
  const total = Object.values(perStatus).reduce((sum, n) => sum + (n ?? 0), 0);
  const sum = (statuses: readonly FacultyRowStatus[]): number =>
    statuses.reduce((acc, s) => acc + (perStatus[s] ?? 0), 0);
  return {
    all: total,
    pending: sum(TAB_STATUSES.pending),
    verified: sum(TAB_STATUSES.verified),
    published: sum(TAB_STATUSES.published),
    suspended: sum(TAB_STATUSES.suspended),
  };
}

/** "Ph.D. · IIT Bombay". */
export function formatQualification(q: { degree: string; institution: string }): string {
  return `${q.degree.trim()} · ${q.institution.trim()}`;
}

export async function getFacultyStatusCounts(
  filters: FacultyCountsQuery
): Promise<FacultyStatusCounts> {
  const cte = await rosterCte(filters);
  const rows = await prisma.$queryRaw<{ status: FacultyRowStatus; count: bigint }[]>`
    ${cte}
    SELECT status, COUNT(*) AS count FROM roster
    WHERE ${searchCondition(filters.search)}
    GROUP BY status`;
  return countsByTab(Object.fromEntries(rows.map((r) => [r.status, Number(r.count)])));
}

export async function listFaculty(
  query: ListFacultyQuery
): Promise<PaginatedResult<FacultyListItem>> {
  const cte = await rosterCte(query);
  const where = Prisma.sql`${searchCondition(query.search)} AND ${tabCondition(query.status)}`;
  const offset = (query.page - 1) * query.limit;

  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<RosterRow[]>`
      ${cte}
      SELECT * FROM roster WHERE ${where}
      ORDER BY ${ORDER_BY[query.sort]}
      LIMIT ${query.limit} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: bigint }[]>`
      ${cte}
      SELECT COUNT(*) AS total FROM roster WHERE ${where}`,
  ]);

  const profileIds = rows.filter((r) => r.kind === 'profile').map((r) => r.id);
  const details = profileIds.length
    ? await prisma.facultyProfile.findMany({
        where: { id: { in: profileIds } },
        select: {
          id: true,
          isActive: true,
          approvalStatus: true,
          highestQualification: true,
          studiedAt: true,
          user: { select: { isActive: true, status: true } },
          qualifications: {
            select: { degree: true, institution: true },
            orderBy: [{ yearOfPassing: 'desc' }, { createdAt: 'desc' }],
            take: 1,
          },
          _count: { select: { documents: true } },
          assignments: {
            where: { isActive: true },
            select: {
              curriculum: {
                select: {
                  subject: { select: { name: true, sortOrder: true } },
                  category: { select: { name: true, displayOrder: true } },
                },
              },
            },
          },
        },
      })
    : [];
  const byId = new Map(details.map((d) => [d.id, d]));

  // Pricing state for approved tutors on this page (batched)
  const approvedIds = details.filter((d) => d.approvalStatus === 'APPROVED').map((d) => d.id);
  const subjectsById = await pricedSubjects(approvedIds);
  const readyHashes = new Map<string, string>();
  const stateById = new Map<string, ReturnType<typeof decideAccess>>();
  for (const d of details.filter((x) => x.approvalStatus === 'APPROVED')) {
    const subjects = subjectsById.get(d.id) ?? [];
    const state = decideAccess(d, subjects);
    stateById.set(d.id, state);
    if (state === 'READY') readyHashes.set(d.id, priceSnapshotHash(subjects));
  }
  const consents = await consentStatuses([...readyHashes.keys()], readyHashes);
  const pricingOf = (id: string): PricingStatus => {
    const state = stateById.get(id);
    return state ? pricingStatusOf({ state, consent: consents.get(id)?.status ?? null }) : 'none';
  };

  const items = rows.map((row): FacultyListItem => {
    if (row.kind === 'invitation') {
      return {
        id: row.id,
        kind: 'invitation',
        fullName: null,
        email: row.email,
        status: row.status,
        subjects: [],
        qualification: null,
        documents: null,
        pricing: 'none',
        appliedAt: row.applied_at,
        invitation: {
          sentAt: row.sent_at,
          expiresAt: row.expires_at as Date,
          deliveryMethod: row.delivery_method === 'LINK' ? 'link' : 'email',
        },
      };
    }
    const detail = byId.get(row.id);
    const subjects = [
      ...new Map(
        (detail?.assignments ?? [])
          // A category curriculum is named by its leaf (Class 11)
          .map(
            (a) =>
              a.curriculum.subject ?? {
                name: a.curriculum.category.name,
                sortOrder: a.curriculum.category.displayOrder,
              }
          )
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((s) => [s.name, s.name])
      ).values(),
    ];
    // Onboarding answers first ("M.Sc. Physics · Delhi University"), then the qualification records
    const recorded = detail?.qualifications[0];
    const onboarding = detail?.highestQualification
      ? [detail.highestQualification, detail.studiedAt].filter(Boolean).join(' · ')
      : null;
    return {
      id: row.id,
      kind: 'profile',
      fullName: row.full_name,
      email: row.email,
      status: row.status,
      subjects,
      qualification: onboarding ?? (recorded ? formatQualification(recorded) : null),
      documents: {
        uploaded: detail?._count.documents ?? 0,
        required: REQUIRED_VERIFICATION_DOCUMENTS,
      },
      pricing: pricingOf(row.id),
      appliedAt: row.applied_at,
      invitation: null,
    };
  });

  return {
    items,
    meta: buildPaginationMeta(Number(totals[0]?.total ?? 0), query.page, query.limit),
  };
}
