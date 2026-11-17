import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OnboardingApplicationDto,
  ReuploadApplicationDto,
  ReuploadSessionDto,
  mobileNumberSchema,
} from '../../src/modules/faculty/faculty.onboarding.dto.js';
import {
  FacultyActiveDto,
  PriceConsentDecisionDto,
  ReviewFacultyDto,
} from '../../src/modules/faculty/faculty.review.dto.js';
import {
  ADDITIONAL_DOCUMENTS,
  DOCUMENT_UPLOAD_FIELDS,
  MAX_UPLOAD_FILES,
  REQUIRED_DOCUMENT_TYPES,
} from '../../src/modules/faculty/faculty.documents.js';
import {
  buildReuploadUrl,
  generateInviteToken,
  hashInviteToken,
} from '../../src/modules/faculty/faculty.tokens.js';
import {
  buildInvitationEmail,
  formatExpiry,
} from '../../src/modules/faculty/faculty.invite-email.js';
import {
  reuploadReceivedEmail,
  reuploadRequestedEmail,
} from '../../src/modules/faculty/faculty.emails.js';
import { countDocuments, verificationStatus } from '../../src/modules/faculty/faculty.list.js';
import { checkUploadedDocuments } from '../../src/modules/faculty/faculty.onboarding.js';
import {
  checkConsentSignature,
  signatureStorageKey,
} from '../../src/modules/faculty/faculty.consent.js';
import { TEACHING_MODE_ROWS } from '../../prisma/reference-data/teaching-modes.js';

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const upload = (buffer: Buffer, originalname: string) =>
  ({ buffer, originalname, size: buffer.length }) as Express.Multer.File;
const CURRICULUM = '8c121988-8afa-4fb7-b6eb-9b0dcb94f730';

// ── Task 1: re-upload request, statuses, link expiry, activate/deactivate ──

describe('review decisions', () => {
  it('accepts request_reupload and requires a reason for it', () => {
    expect(
      ReviewFacultyDto.safeParse({ decision: 'request_reupload', expectedRevision: 1 }).success
    ).toBe(false);
    const missing = ReviewFacultyDto.safeParse({
      decision: 'request_reupload',
      reason: '  ',
      expectedRevision: 1,
    });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.message).toBe('Tell the tutor what to correct or re-upload');
    expect(
      ReviewFacultyDto.parse({
        decision: 'request_reupload',
        reason: ' PAN card is blurred ',
        expectedRevision: 3,
      })
    ).toMatchObject({
      decision: 'request_reupload',
      reason: 'PAN card is blurred',
      publish: false,
    });
  });

  it('still requires a reason to reject, and none to approve', () => {
    expect(ReviewFacultyDto.safeParse({ decision: 'reject', expectedRevision: 1 }).success).toBe(
      false
    );
    expect(ReviewFacultyDto.safeParse({ decision: 'approve', expectedRevision: 1 }).success).toBe(
      true
    );
    expect(ReviewFacultyDto.safeParse({ decision: 'hold', expectedRevision: 1 }).success).toBe(
      false
    );
  });

  it('takes a strict activate/deactivate body', () => {
    expect(FacultyActiveDto.parse({ isActive: false })).toEqual({ isActive: false });
    expect(FacultyActiveDto.safeParse({ isActive: 'no' }).success).toBe(false);
    expect(FacultyActiveDto.safeParse({ isActive: true, extra: 1 }).success).toBe(false);
  });
});

describe('verification status', () => {
  it.each([
    ['PENDING', 'new'],
    ['APPROVED', 'approved'],
    ['REJECTED', 'rejected'],
    ['CHANGES_REQUESTED', 'reupload_requested'],
  ])('%s is shown as %s', (approval, shown) => {
    expect(verificationStatus(approval)).toBe(shown);
  });
});

describe('re-upload link', () => {
  it('points at the faculty app with a URL-safe single-use token', () => {
    const { token, tokenHash } = generateInviteToken();
    const url = new URL(buildReuploadUrl('https://faculty.example.org/', token));
    expect(url.origin + url.pathname).toBe('https://faculty.example.org/onboarding/reupload');
    expect(url.searchParams.get('token')).toBe(token);
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(ReuploadSessionDto.safeParse({ token }).success).toBe(true);
    expect(ReuploadSessionDto.safeParse({ token: 'short' }).success).toBe(false);
  });
});

describe('expiry wording in emails', () => {
  it('states the exact date and time, in the recipient zone when known', () => {
    const at = new Date('2026-11-06T00:00:00Z');
    expect(formatExpiry(at)).toBe('Friday, 6 November 2026, 12:00 AM UTC');
    expect(formatExpiry(at, 'Asia/Dubai')).toBe('Friday, 6 November 2026, 4:00 AM GST');
    expect(formatExpiry(at, 'Not/AZone')).toBe('Friday, 6 November 2026, 12:00 AM UTC');
  });

  it('puts the expiry date in the invitation email', () => {
    const email = buildInvitationEmail({
      to: 'tutor@example.org',
      inviteUrl: 'https://faculty.example.org/onboarding?token=abc',
      expiresAt: new Date('2026-11-06T00:00:00Z'),
      ttlHours: 72,
    });
    expect(email.html).toContain('Link expires on Friday, 6 November 2026, 12:00 AM UTC');
    expect(email.text).toContain(
      'expires on Friday, 6 November 2026, 12:00 AM UTC (3 days after it was sent)'
    );
  });

  it('sends the reason, the link and its expiry in the re-upload email', () => {
    const email = reuploadRequestedEmail({
      to: 'tutor@example.org',
      fullName: 'Anil Verma',
      reason: 'The PAN card photo is blurred <please re-scan>',
      reuploadUrl: 'https://faculty.example.org/onboarding/reupload?token=abc&x=1',
      expiresAt: new Date('2026-11-06T00:00:00Z'),
      ttlHours: 48,
      timeZone: 'Asia/Dubai',
    });
    expect(email.category).toBe('faculty-reupload');
    expect(email.subject).toBe('Action needed: update your Amentorz application');
    expect(email.text).toContain('The PAN card photo is blurred <please re-scan>');
    expect(email.html).toContain('The PAN card photo is blurred &lt;please re-scan&gt;');
    expect(email.html).not.toContain('<please');
    expect(email.html).toContain(
      'href="https://faculty.example.org/onboarding/reupload?token=abc&amp;x=1"'
    );
    expect(email.text).toContain(
      'This link expires on Friday, 6 November 2026, 4:00 AM GST (2 days after it was sent)'
    );
  });

  it('confirms a re-submission', () => {
    const email = reuploadReceivedEmail({
      to: 'a@x.com',
      fullName: 'Anil',
      reference: 'AMZ-T-1001',
    });
    expect(email.subject).toBe('Updated application received (AMZ-T-1001)');
  });
});

describe('re-upload body', () => {
  const base = {
    token: 'A'.repeat(43),
    fullName: 'Anil Verma',
    mobileNumber: '+91 98765 43210',
    highestQualification: 'M.Sc. Physics',
    teachingExperience: '5-10',
    teachingMode: 'hybrid',
    curriculumIds: JSON.stringify([CURRICULUM]),
    declarationAccepted: 'true',
  };

  it('needs no password and normalises the phone number', () => {
    expect(ReuploadApplicationDto.parse(base)).toMatchObject({
      mobileNumber: '+919876543210',
      teachingMode: 'hybrid',
      removeDocumentIds: [],
    });
  });

  it('parses the documents to remove', () => {
    expect(
      ReuploadApplicationDto.parse({
        ...base,
        removeDocumentIds: JSON.stringify([CURRICULUM, CURRICULUM]),
      }).removeDocumentIds
    ).toEqual([CURRICULUM]);
    expect(ReuploadApplicationDto.safeParse({ ...base, removeDocumentIds: 'nope' }).success).toBe(
      false
    );
    expect(ReuploadApplicationDto.safeParse({ ...base, removeDocumentIds: '["x"]' }).success).toBe(
      false
    );
  });

  it('refuses a password field (strict body)', () => {
    expect(ReuploadApplicationDto.safeParse({ ...base, password: 'Tutor12345' }).success).toBe(
      false
    );
  });
});

// ── Task 2: additional documents ──

describe('additional documents', () => {
  it('accepts up to five extra files besides the three required ones', () => {
    expect(ADDITIONAL_DOCUMENTS).toMatchObject({
      field: 'additionalDocuments',
      type: 'OTHER',
      max: 5,
    });
    expect(DOCUMENT_UPLOAD_FIELDS).toContainEqual({ name: 'additionalDocuments', maxCount: 5 });
    expect(MAX_UPLOAD_FILES).toBe(8);
    expect(REQUIRED_DOCUMENT_TYPES).toEqual(['GOVERNMENT_ID', 'DEGREE_CERTIFICATE', 'PAN_CARD']);
  });

  it('checks required and additional files together', async () => {
    const docs = await checkUploadedDocuments({
      photoId: [upload(PDF, 'id.pdf')],
      degreeCertificate: [upload(PNG, 'degree.png')],
      panCard: [upload(PDF, 'pan.pdf')],
      additionalDocuments: [upload(PDF, 'experience.pdf'), upload(PNG, 'award.png')],
    });
    expect(docs.map((d) => d.type)).toEqual([
      'GOVERNMENT_ID',
      'DEGREE_CERTIFICATE',
      'PAN_CARD',
      'OTHER',
      'OTHER',
    ]);
  });

  it('names every bad file, including an additional one', async () => {
    const err = await checkUploadedDocuments({
      photoId: [upload(PDF, 'id.pdf')],
      additionalDocuments: [upload(Buffer.from('MZ binary'), 'tool.pdf')],
    }).then(
      () => ({}) as { code?: string; fieldErrors?: Record<string, string[]> },
      (e: unknown) => e as { code?: string; fieldErrors?: Record<string, string[]> }
    );
    expect(err).toMatchObject({ code: 'DOCUMENT_INVALID' });
    expect(Object.keys(err.fieldErrors ?? {}).sort()).toEqual([
      'additionalDocuments.0',
      'degreeCertificate',
      'panCard',
    ]);
  });

  it('lets a re-upload keep required documents already on file', async () => {
    const docs = await checkUploadedDocuments(
      { panCard: [upload(PDF, 'pan.pdf')] },
      new Set(['GOVERNMENT_ID', 'DEGREE_CERTIFICATE', 'PAN_CARD'])
    );
    expect(docs.map((d) => d.field)).toEqual(['panCard']);
  });

  it('counts required documents once and additional documents apart', () => {
    expect(
      countDocuments([
        { documentType: 'GOVERNMENT_ID' },
        { documentType: 'PAN_CARD' },
        { documentType: 'OTHER' },
        { documentType: 'OTHER' },
      ])
    ).toEqual({ uploaded: 2, required: 3, additional: 2 });
  });
});

// ── Task 3: signed price consent ──

describe('consent signature', () => {
  it('requires a PNG signature to accept', () => {
    expect(() => checkConsentSignature('accept', undefined)).toThrow(/Sign in the box/);
    expect(() => checkConsentSignature('accept', PDF)).toThrow(/Sign in the box/);
    expect(() => checkConsentSignature('accept', PNG)).not.toThrow();
    expect(() => checkConsentSignature('reject', undefined)).not.toThrow();
  });

  it('stores signatures under server-generated keys', () => {
    expect(signatureStorageKey()).toMatch(/^faculty-consent-signatures\/[0-9a-f-]{36}\.png$/);
  });

  it('keeps the decision body strict', () => {
    expect(
      PriceConsentDecisionDto.safeParse({ decision: 'accept', snapshotHash: 'a'.repeat(64) })
        .success
    ).toBe(true);
  });
});

// ── Task 4: phone numbers with a separate country code ──

describe('phone number', () => {
  it.each(['+91 98765 43210', '+919876543210', '+971 50 123 4567', ' +91-98765-43210 '])(
    'accepts %s',
    (value) => {
      expect(mobileNumberSchema.parse(value)).toMatch(/^\+[1-9][0-9]{7,14}$/);
    }
  );
  it.each(['9876543210', '+0 123456789', '+91'])('rejects %s', (value) => {
    expect(mobileNumberSchema.safeParse(value).success).toBe(false);
  });
});

// ── Task 5: preferred mode of teaching ──

describe('teaching mode', () => {
  const base = {
    token: 'A'.repeat(43),
    fullName: 'Anil Verma',
    password: 'Tutor12345',
    confirmPassword: 'Tutor12345',
    mobileNumber: '+919876543210',
    highestQualification: 'M.Sc. Physics',
    teachingExperience: '5-10',
    curriculumIds: JSON.stringify([CURRICULUM]),
    declarationAccepted: 'true',
  };

  it('is required on the application', () => {
    const result = OnboardingApplicationDto.safeParse(base);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === 'teachingMode')).toBe(true);
    expect(OnboardingApplicationDto.parse({ ...base, teachingMode: ' Hybrid ' }).teachingMode).toBe(
      'hybrid'
    );
  });

  it('seeds the three options in the migration and the reference list', () => {
    expect(TEACHING_MODE_ROWS.map((r) => r.code)).toEqual(['online', 'offline', 'hybrid']);
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../prisma/migrations/20261111090000_faculty_reupload_mode_signature/migration.sql'
      ),
      'utf8'
    );
    for (const row of TEACHING_MODE_ROWS) {
      expect(sql).toContain(
        `('${row.code}', '${row.name}', ${row.offersOffline}, ${row.displayOrder}, CURRENT_TIMESTAMP)`
      );
    }
  });
});
