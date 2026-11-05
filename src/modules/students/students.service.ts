import type { Prisma, StudentProfile, User } from '@prisma/client';
import { prisma } from '@infrastructure/database/index.js';
import { NotFoundError } from '@core/errors/index';
import { buildPaginationMeta } from '@shared/types/pagination.js';
import { completedYears, latestBirthDateForAge } from '@shared/dates';
import { toPrismaPagination } from '@shared/validation/index';
import { findConsentSummary, type ConsentSummary } from '@modules/consent/index.js';
import type { ListStudentsQuery } from './students.dto.js';

export type ConsentStatus = 'signed' | 'missing' | 'not_required';

export interface GuardianView {
  fullName: string;
  relationship: string;
  mobileNumber: string;
  email: string;
  receivesReportsAndReceipts: boolean;
}

export interface StudentView {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  mobileNumber: string | null;
  isActive: boolean;
  country: string;
  dateOfBirth: string;
  age: number;
  isMinor: boolean;
  consentStatus: ConsentStatus;
  guardian: GuardianView | null;
  registeredAt: Date;
}

export interface StudentDetailView extends StudentView {
  learningProfile: {
    teachingLanguage: string | null;
    /** What the student wants to learn: one entry per chosen offering, any mix of branches */
    interests: {
      category: string;
      board: string | null;
      level: string | null;
      subject: string;
    }[];
  };
  consent: ConsentSummary | null;
}

type ProfileWithUser = StudentProfile & { user: User; guardianConsents: { id: string }[] };

/** The consent age of every country, read from the country table (never fixed in code). */
async function consentAges(): Promise<Map<string, number>> {
  const countries = await prisma.country.findMany({
    select: { code: true, guardianConsentAge: true },
  });
  return new Map(countries.map((country) => [country.code, country.guardianConsentAge]));
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

function toView(profile: ProfileWithUser, ages: Map<string, number>, today: Date): StudentView {
  const dateOfBirth = isoDate(profile.dateOfBirth);
  const age = completedYears(dateOfBirth, today) ?? 0;
  const consentAge = ages.get(profile.country);
  const isMinor = consentAge !== undefined && age < consentAge;
  const signed = profile.guardianConsents.length > 0;
  return {
    id: profile.id,
    userId: profile.userId,
    fullName: profile.user.fullName,
    email: profile.user.email,
    mobileNumber: profile.user.mobileNumber,
    isActive: profile.user.isActive,
    country: profile.country,
    dateOfBirth,
    age,
    isMinor,
    consentStatus: signed ? 'signed' : isMinor ? 'missing' : 'not_required',
    guardian:
      profile.guardianName &&
      profile.guardianRelationship &&
      profile.guardianMobileNumber &&
      profile.guardianEmail
        ? {
            fullName: profile.guardianName,
            relationship: profile.guardianRelationship.toLowerCase(),
            mobileNumber: profile.guardianMobileNumber,
            email: profile.guardianEmail,
            receivesReportsAndReceipts: profile.guardianReceivesReports,
          }
        : null,
    registeredAt: profile.createdAt,
  };
}

/** A student is a minor when born after the cut-off of their country's consent age. */
async function minorCondition(today: Date): Promise<Prisma.StudentProfileWhereInput> {
  const countries = await prisma.country.findMany({
    select: { code: true, guardianConsentAge: true },
  });
  return {
    OR: countries.map((country) => ({
      country: country.code,
      dateOfBirth: {
        gt: new Date(`${latestBirthDateForAge(country.guardianConsentAge, today)}T00:00:00Z`),
      },
    })),
  };
}

const linkedConsent: Prisma.GuardianConsentWhereInput = { linkedAt: { not: null } };

export async function listStudents(query: ListStudentsQuery): Promise<{
  items: StudentView[];
  meta: ReturnType<typeof buildPaginationMeta>;
}> {
  const today = new Date();
  const minor = await minorCondition(today);
  const and: Prisma.StudentProfileWhereInput[] = [];

  if (query.q) {
    and.push({
      user: {
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { mobileNumber: { contains: query.q } },
        ],
      },
    });
  }
  if (query.country) and.push({ country: query.country });
  if (query.minor === true) and.push(minor);
  if (query.minor === false) and.push({ NOT: minor });
  if (query.consent === 'signed') and.push({ guardianConsents: { some: linkedConsent } });
  if (query.consent === 'missing') and.push(minor, { guardianConsents: { none: linkedConsent } });
  if (query.consent === 'not_required') and.push({ NOT: minor });

  const where: Prisma.StudentProfileWhereInput = and.length ? { AND: and } : {};
  const [total, rows, ages] = await Promise.all([
    prisma.studentProfile.count({ where }),
    prisma.studentProfile.findMany({
      where,
      include: {
        user: true,
        guardianConsents: { where: linkedConsent, select: { id: true }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toPrismaPagination(query),
    }),
    consentAges(),
  ]);
  return {
    items: rows.map((row) => toView(row, ages, today)),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

/** Display names for every category on the way down to the given leaf paths, keyed by path. */
async function categoryNames(leafPaths: string[]): Promise<Map<string, string>> {
  const wanted = new Set(
    leafPaths.flatMap((path) =>
      path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))
    )
  );
  const rows = await prisma.category.findMany({
    where: { path: { in: [...wanted] } },
    select: { path: true, name: true },
  });
  return new Map(rows.map((row) => [row.path, row.name]));
}

export async function getStudent(studentId: string): Promise<StudentDetailView> {
  const profile = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    include: {
      user: true,
      guardianConsents: { where: linkedConsent, select: { id: true }, take: 1 },
      teachingLanguage: true,
      subjects: {
        include: {
          curriculum: { include: { category: true, board: true, level: true, subject: true } },
        },
      },
    },
  });
  if (!profile) throw new NotFoundError('Student');
  const view = toView(profile, await consentAges(), new Date());
  const names = await categoryNames(profile.subjects.map((item) => item.curriculum.category.path));
  return {
    ...view,
    learningProfile: {
      teachingLanguage: profile.teachingLanguage?.name ?? null,
      interests: profile.subjects
        .map(({ curriculum: c }) => ({
          category: c.category.path
            .split('/')
            .map((_, i, parts) => names.get(parts.slice(0, i + 1).join('/')) ?? '')
            .join(' › '),
          board: c.board?.name ?? null,
          level: c.level?.name ?? null,
          subject: c.subject.name,
        }))
        .sort((a, b) =>
          `${a.category} ${a.level} ${a.subject}`.localeCompare(
            `${b.category} ${b.level} ${b.subject}`
          )
        ),
    },
    consent: await findConsentSummary(studentId),
  };
}
