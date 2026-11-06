import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  checkDocument,
  documentStorageKey,
  extensionOf,
  isPreviewableMime,
  safeFileName,
} from '../../src/modules/faculty/faculty.documents.js';
import { OnboardingApplicationDto, TEACHING_EXPERIENCE } from '../../src/modules/faculty/faculty.onboarding.dto.js';
import { PriceConsentDecisionDto, ReviewFacultyDto } from '../../src/modules/faculty/faculty.review.dto.js';
import {
  decideAccess,
  priceSnapshotHash,
  pricingStatusOf,
  type PricedSubject,
} from '../../src/modules/faculty/faculty.access.js';
import { profileStatus } from '../../src/modules/faculty/faculty.review.js';
import { accountReadyEmail, applicationRejectedEmail } from '../../src/modules/faculty/faculty.emails.js';

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const OLE = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(512)]);
const file = (buffer: Buffer, originalname: string) => ({ buffer, originalname, size: buffer.length });

describe('checkDocument', () => {
  it.each([
    [PDF, 'degree.pdf', 'application/pdf'],
    [PNG, 'id.PNG', 'image/png'],
    [JPG, 'id.jpeg', 'image/jpeg'],
    [OLE, 'pan.doc', 'application/msword'],
    [OLE, 'pan.ppt', 'application/vnd.ms-powerpoint'],
  ])('accepts %s named %s as %s', async (buffer, name, mime) => {
    expect(await checkDocument(file(buffer, name))).toMatchObject({ ok: true, mime });
  });

  it.each([
    [Buffer.from('MZ\x90\x00 executable'), 'id.png'],
    [PDF, 'degree.png'],
    [PNG, 'id.pdf'],
    [OLE, 'macro.xls'],
    [Buffer.from('<html><script>'), 'id.html'],
    [Buffer.alloc(0), 'empty.pdf'],
  ])('rejects %#', async (buffer, name) => {
    expect((await checkDocument(file(buffer, name))).ok).toBe(false);
  });

  it('rejects a file over the limit', async () => {
    const big = { buffer: PDF, originalname: 'x.pdf', size: 11 * 1024 * 1024 };
    expect(await checkDocument(big)).toMatchObject({ ok: false });
  });

  it('marks only PDF and images as previewable', () => {
    expect(isPreviewableMime('application/pdf')).toBe(true);
    expect(isPreviewableMime('image/png')).toBe(true);
    expect(isPreviewableMime('application/msword')).toBe(false);
  });

  it('cleans file names and generates opaque keys', () => {
    expect(safeFileName('C:\\Users\\me\\Degree "final".pdf')).toBe('Degree final.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('')).toBe('document');
    expect(extensionOf('a.b.PDF')).toBe('pdf');
    expect(documentStorageKey()).toMatch(/^faculty-documents\/[0-9a-f-]{36}$/);
  });
});

describe('OnboardingApplicationDto', () => {
  const base = {
    token: 'A'.repeat(43),
    fullName: ' Anil Verma ',
    password: 'Tutor12345',
    confirmPassword: 'Tutor12345',
    mobileNumber: '+919876543210',
    highestQualification: 'M.Sc. Physics',
    teachingExperience: '5-10',
    curriculumIds: JSON.stringify(['8c121988-8afa-4fb7-b6eb-9b0dcb94f730', '8c121988-8afa-4fb7-b6eb-9b0dcb94f730']),
    declarationAccepted: 'true',
  };

  it('trims, deduplicates subjects and defaults optional fields', () => {
    expect(OnboardingApplicationDto.parse(base)).toMatchObject({
      fullName: 'Anil Verma',
      city: null,
      studiedAt: null,
      offersOfflineClasses: false,
      curriculumIds: ['8c121988-8afa-4fb7-b6eb-9b0dcb94f730'],
    });
  });

  it('lists the years-of-teaching codes', () => {
    expect(TEACHING_EXPERIENCE).toEqual(['0-1', '1-3', '3-5', '5-10', '10+']);
  });

  it.each([
    [{ confirmPassword: 'Other12345' }, 'confirmPassword'],
    [{ password: 'abcdefgh', confirmPassword: 'abcdefgh' }, 'password'],
    [{ mobileNumber: '9876543210' }, 'mobileNumber'],
    [{ curriculumIds: '["x"]' }, 'curriculumIds'],
    [{ curriculumIds: JSON.stringify(Array.from({ length: 31 }, (_, i) => `8c121988-8afa-4fb7-b6eb-${String(i).padStart(12, '0')}`)) }, 'curriculumIds'],
    [{ declarationAccepted: 'false' }, 'declarationAccepted'],
    [{ offersOfflineClasses: 'yes' }, 'offersOfflineClasses'],
    [{ token: 'short' }, 'token'],
  ])('rejects %j', (override, field) => {
    const result = OnboardingApplicationDto.safeParse({ ...base, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.').startsWith(field))).toBe(true);
  });
});

describe('review and consent bodies', () => {
  it('requires a reason to reject', () => {
    expect(ReviewFacultyDto.safeParse({ decision: 'reject', expectedRevision: 1 }).success).toBe(false);
    expect(ReviewFacultyDto.parse({ decision: 'approve', expectedRevision: 1 })).toMatchObject({ publish: false });
  });
  it('requires a sha-256 snapshot hash', () => {
    expect(PriceConsentDecisionDto.safeParse({ decision: 'accept', snapshotHash: 'abc' }).success).toBe(false);
  });
});

const subject = (curriculumId: string, price: number | null, ruleId = `r-${curriculumId}`): PricedSubject => ({
  assignmentId: `a-${curriculumId}`,
  curriculumId,
  subject: 'Physics',
  pathLabel: 'Academic › School',
  price: price === null ? null : ({ sessionPricePaise: price, ruleId, revision: 1 } as PricedSubject['price']),
});

describe('decideAccess', () => {
  const profile = (over: Partial<{ isActive: boolean; approvalStatus: string; user: { isActive: boolean; status: string } }> = {}) => ({
    id: 'f',
    isActive: true,
    approvalStatus: 'APPROVED',
    user: { isActive: true, status: 'ACTIVE' },
    ...over,
  });

  it.each([
    [null, [], 'NO_PROFILE'],
    [profile({ isActive: false }), [subject('c1', 1)], 'SUSPENDED'],
    [profile({ user: { isActive: true, status: 'SUSPENDED' } }), [subject('c1', 1)], 'SUSPENDED'],
    [profile({ approvalStatus: 'REJECTED' }), [subject('c1', 1)], 'REJECTED'],
    [profile({ approvalStatus: 'PENDING' }), [subject('c1', 1)], 'PENDING_REVIEW'],
    [profile({ approvalStatus: 'CHANGES_REQUESTED' }), [], 'PENDING_REVIEW'],
    [profile(), [], 'PENDING_PRICING'],
    [profile(), [subject('c1', 1), subject('c2', null)], 'PENDING_PRICING'],
    [profile(), [subject('c1', 1), subject('c2', 2)], 'READY'],
  ] as const)('%#: %s', (p, subjects, state) => {
    expect(decideAccess(p, subjects)).toBe(state);
  });

  it('maps states to the pricing badge', () => {
    expect(pricingStatusOf({ state: 'PENDING_REVIEW', consent: null })).toBe('none');
    expect(pricingStatusOf({ state: 'PENDING_PRICING', consent: null })).toBe('awaiting_price');
    expect(pricingStatusOf({ state: 'READY', consent: 'required' })).toBe('awaiting_consent');
    expect(pricingStatusOf({ state: 'READY', consent: 'accepted' })).toBe('accepted');
    expect(pricingStatusOf({ state: 'READY', consent: 'rejected' })).toBe('declined');
  });
});

describe('priceSnapshotHash', () => {
  it('ignores order and changes with any price or rule', () => {
    const a = [subject('c1', 100), subject('c2', 200)];
    expect(priceSnapshotHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(priceSnapshotHash([...a].reverse())).toBe(priceSnapshotHash(a));
    expect(priceSnapshotHash([subject('c1', 101), subject('c2', 200)])).not.toBe(priceSnapshotHash(a));
    expect(priceSnapshotHash([subject('c1', 100, 'other'), subject('c2', 200)])).not.toBe(priceSnapshotHash(a));
  });
});

describe('profileStatus', () => {
  const p = (approvalStatus: string, isPublished = false, isActive = true) => ({
    isActive,
    approvalStatus,
    isPublished,
    user: { isActive: true, status: 'ACTIVE' },
  });
  it('matches the roster rule', () => {
    expect(profileStatus(p('PENDING'))).toBe('pending');
    expect(profileStatus(p('APPROVED'))).toBe('verified');
    expect(profileStatus(p('APPROVED', true))).toBe('published');
    expect(profileStatus(p('REJECTED'))).toBe('rejected');
    expect(profileStatus(p('APPROVED', true, false))).toBe('suspended');
  });
});

describe('lifecycle emails', () => {
  it('escapes interpolated text and includes the sign-in link', () => {
    const rejected = applicationRejectedEmail({ to: 'a@x.com', fullName: '<b>Anil</b>', reason: 'ID <unreadable>' });
    expect(rejected.html).not.toContain('<b>Anil</b>');
    expect(rejected.html).toContain('&lt;unreadable&gt;');
    expect(rejected.text).toContain('ID <unreadable>');
    const ready = accountReadyEmail({ to: 'a@x.com', fullName: 'Anil', loginUrl: 'https://tutors.amentorz.com/login' });
    expect(ready.html).toContain('href="https://tutors.amentorz.com/login"');
  });
});
