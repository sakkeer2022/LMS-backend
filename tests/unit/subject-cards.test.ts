import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  MAX_SUBJECT_CARDS,
  remainingSlots,
  usedSlots,
} from '../../src/modules/faculty/faculty.subject-cards.rules.js';
import { OnboardingApplicationDto } from '../../src/modules/faculty/faculty.onboarding.dto.js';
import { ReviewSubjectCardDto } from '../../src/modules/faculty/faculty.subject-cards.dto.js';
import { CreateResourceDto, ReviewSubmissionDto } from '../../src/modules/library/library.dto.js';
import { toResourceView } from '../../src/modules/library/library.views.js';

const card = (status: string, isActive = true) => ({ status, isActive });

describe('Subject card limit (decided 2026-11-12)', () => {
  it('is five cards', () => {
    expect(MAX_SUBJECT_CARDS).toBe(5);
  });

  it('counts pending and approved active cards only', () => {
    const cards = [card('APPROVED'), card('PENDING'), card('REJECTED'), card('APPROVED', false)];
    expect(usedSlots(cards)).toBe(2);
    expect(remainingSlots(cards)).toBe(3);
  });

  it('never goes negative for tutors who hold more than the limit', () => {
    expect(remainingSlots(Array.from({ length: 7 }, () => card('APPROVED')))).toBe(0);
  });

  it('caps onboarding at five distinct subjects', () => {
    const base = {
      token: 'a'.repeat(43),
      password: 'Tutor12345',
      confirmPassword: 'Tutor12345',
      fullName: 'Anil Verma',
      mobileNumber: '+919876543210',
      highestQualification: 'M.Sc.',
      teachingExperience: '1-3',
      teachingMode: 'online',
      declarationAccepted: 'true',
    };
    const ids = Array.from({ length: 6 }, () => randomUUID());
    expect(
      OnboardingApplicationDto.safeParse({ ...base, curriculumIds: JSON.stringify(ids) }).success
    ).toBe(false);
    const five = OnboardingApplicationDto.safeParse({
      ...base,
      curriculumIds: JSON.stringify(ids.slice(0, 5)),
    });
    expect(five.success).toBe(true);
    // Duplicates are ignored before the limit
    const repeated = [...ids.slice(0, 5), ids[0]];
    expect(
      OnboardingApplicationDto.safeParse({ ...base, curriculumIds: JSON.stringify(repeated) })
        .success
    ).toBe(true);
  });

  it('needs a reason to reject a card or a library submission', () => {
    expect(ReviewSubjectCardDto.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(ReviewSubjectCardDto.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(ReviewSubmissionDto.safeParse({ status: 'rejected' }).success).toBe(false);
    expect(ReviewSubmissionDto.safeParse({ status: 'approved' }).success).toBe(true);
  });

  it('needs a body for a note', () => {
    const base = { curriculumId: randomUUID(), title: 'Formulae' };
    expect(CreateResourceDto.safeParse({ ...base, kind: 'note', body: '   ' }).success).toBe(false);
    expect(CreateResourceDto.safeParse({ ...base, kind: 'note', body: 'v = u + at' }).success).toBe(
      true
    );
    expect(CreateResourceDto.safeParse({ ...base, kind: 'file' }).success).toBe(true);
  });
});

describe('Library review state', () => {
  const now = new Date();
  const material = (status: 'PENDING' | 'APPROVED' | 'REJECTED') =>
    ({
      id: randomUUID(),
      curriculumId: randomUUID(),
      status,
      kind: 'NOTE',
      title: 'Live',
      description: null,
      body: 'text',
      storageKey: null,
      originalFileName: null,
      fileSize: null,
      mimeType: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }) as unknown as Parameters<typeof toResourceView>[0];
  const revision = (n: number, status: string) =>
    ({
      revision: n,
      status,
      kind: 'NOTE',
      title: `Rev ${n}`,
      description: null,
      body: 'b',
      storageKey: null,
      originalFileName: null,
      fileSize: null,
      mimeType: null,
      submittedAt: now,
      reviewedAt: status === 'PENDING' ? null : now,
      reviewNotes: status === 'REJECTED' ? 'No' : null,
    }) as unknown as Parameters<typeof toResourceView>[1][number];

  it.each([
    ['PENDING', [revision(1, 'PENDING')], 'pending'],
    ['REJECTED', [revision(1, 'REJECTED')], 'rejected'],
    ['APPROVED', [revision(1, 'APPROVED')], 'approved'],
    ['APPROVED', [revision(2, 'PENDING'), revision(1, 'APPROVED')], 'edit_pending'],
    ['APPROVED', [revision(2, 'REJECTED'), revision(1, 'APPROVED')], 'edit_rejected'],
  ] as const)('%s material with %j is %s', (status, revisions, expected) => {
    const view = toResourceView(material(status), [...revisions]);
    expect(view.reviewState).toBe(expected);
    if (expected === 'edit_pending') expect(view.pendingEdit?.title).toBe('Rev 2');
    if (expected === 'edit_rejected')
      expect(view.lastDecision).toMatchObject({ decision: 'rejected', notes: 'No' });
  });
});
