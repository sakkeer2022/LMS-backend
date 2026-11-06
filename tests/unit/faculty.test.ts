import { describe, it, expect } from 'vitest';
import {
  EMAIL_PATTERN,
  FacultyCountsQueryDto,
  InviteFacultyDto,
  ListFacultyQueryDto,
  MAX_INVITES_PER_REQUEST,
  invitationEmailSchema,
  isValidEmail,
} from '../../src/modules/faculty/faculty.dto.js';
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiry } from '../../src/modules/faculty/faculty.tokens.js';
import { buildInvitationEmail, describeValidity, escapeHtml } from '../../src/modules/faculty/faculty.invite-email.js';
import { TAB_STATUSES, countsByTab, escapeLike, formatQualification } from '../../src/modules/faculty/faculty.list.js';
import { conflictErrors } from '../../src/modules/faculty/faculty.service.js';

describe('isValidEmail (RFC 5322 dot-atom)', () => {
  it.each([
    'tutor@example.org',
    'anjali.deshpande@gmail.com',
    'r.menon+tutor@outlook.com',
    "o'brien@example.co.in",
    'first_last-1@sub.domain.example.ae',
    'x@ab.io',
    `${'a'.repeat(64)}@example.com`,
  ])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    '',
    'plainaddress',
    '@example.com',
    'tutor@',
    'tutor@example',
    'tutor@example.c',
    'tutor@@example.com',
    'tu tor@example.com',
    '.tutor@example.com',
    'tutor.@example.com',
    'tu..tor@example.com',
    'tutor@-example.com',
    'tutor@example-.com',
    'tutor@example..com',
    'tutor@exa_mple.com',
    'tutor@example.123',
    '"quoted"@example.com',
    'tutor@[192.168.0.1]',
    'tutor@example.com.',
    `${'a'.repeat(65)}@example.com`,
    `a@${'b'.repeat(250)}.com`,
    'tutor@exam ple.com',
    'tutor@example.com\n',
  ])('rejects %j', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('rejects a 63+ character label', () => {
    expect(isValidEmail(`tutor@${'a'.repeat(64)}.com`)).toBe(false);
    expect(isValidEmail(`tutor@${'a'.repeat(63)}.com`)).toBe(true);
  });

  it('stays fast on adversarial input', () => {
    const started = performance.now();
    EMAIL_PATTERN.test(`${'a.'.repeat(5000)}@`);
    isValidEmail(`${'a.'.repeat(5000)}@`);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('invitationEmailSchema', () => {
  it('trims and lowercases', () => {
    expect(invitationEmailSchema.parse('  Anjali.Deshpande@Gmail.COM ')).toBe('anjali.deshpande@gmail.com');
  });

  it('explains missing and invalid values', () => {
    expect(invitationEmailSchema.safeParse('   ').error?.issues[0]?.message).toBe('Email address is required');
    expect(invitationEmailSchema.safeParse('nope').error?.issues.map((i) => i.message)).toContain(
      'Enter a valid email address'
    );
    expect(invitationEmailSchema.safeParse(42).success).toBe(false);
  });
});

describe('InviteFacultyDto', () => {
  it('defaults delivery to email and removes duplicates after normalising', () => {
    expect(InviteFacultyDto.parse({ emails: ['A@x.com', 'a@x.com ', 'b@x.com'] })).toEqual({
      emails: ['a@x.com', 'b@x.com'],
      delivery: 'email',
    });
  });

  it.each([
    [{}, 'missing emails'],
    [{ emails: [] }, 'empty list'],
    [{ emails: 'a@x.com' }, 'not an array'],
    [{ emails: ['a@x.com', 'bad'] }, 'one invalid address'],
    [{ emails: Array.from({ length: MAX_INVITES_PER_REQUEST + 1 }, (_, i) => `t${i}@x.com`) }, 'too many'],
    [{ emails: ['a@x.com'], delivery: 'sms' }, 'unknown delivery'],
    [{ emails: ['a@x.com'], role: 'admin' }, 'unknown field'],
    [{ emails: ['a@x.com', 'b@x.com'], delivery: 'link' }, 'link with two emails'],
  ] as [unknown, string][])('rejects %j (%s)', (body) => {
    expect(InviteFacultyDto.safeParse(body).success).toBe(false);
  });

  it('accepts link delivery for one email, even when it was typed twice', () => {
    expect(InviteFacultyDto.parse({ emails: ['a@x.com', 'A@X.com'], delivery: 'link' })).toEqual({
      emails: ['a@x.com'],
      delivery: 'link',
    });
  });

  it('accepts the maximum batch', () => {
    const emails = Array.from({ length: MAX_INVITES_PER_REQUEST }, (_, i) => `t${i}@x.com`);
    expect(InviteFacultyDto.parse({ emails }).emails).toHaveLength(MAX_INVITES_PER_REQUEST);
  });
});

describe('ListFacultyQueryDto', () => {
  it('applies defaults', () => {
    expect(ListFacultyQueryDto.parse({})).toEqual({ page: 1, limit: 20, status: 'all', sort: 'recent' });
  });

  it('coerces paging, trims search and drops an empty search', () => {
    expect(ListFacultyQueryDto.parse({ page: '2', limit: '7', search: '  rao ', status: 'pending' })).toMatchObject({
      page: 2,
      limit: 7,
      search: 'rao',
      status: 'pending',
    });
    expect(ListFacultyQueryDto.parse({ search: '   ' }).search).toBeUndefined();
  });

  it.each([
    { status: 'archived' },
    { sort: 'random' },
    { limit: '500' },
    { page: '0' },
    { categoryId: 'not-a-uuid' },
    { search: 'x'.repeat(101) },
    { approvalStatus: 'pending' },
  ])('rejects %j', (query) => {
    expect(ListFacultyQueryDto.safeParse(query).success).toBe(false);
  });

  it('counts accept only search and categoryId', () => {
    expect(FacultyCountsQueryDto.safeParse({ search: 'a' }).success).toBe(true);
    expect(FacultyCountsQueryDto.safeParse({ status: 'pending' }).success).toBe(false);
  });
});

describe('invitation tokens', () => {
  it('generates 43-character base64url tokens with a SHA-256 hex hash', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toContain(token);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInviteToken().token));
    expect(tokens.size).toBe(200);
  });

  it('builds the onboarding link', () => {
    expect(buildInviteUrl('https://app.amentorz.com', 'abc-_123')).toBe(
      'https://app.amentorz.com/faculty/onboarding?token=abc-_123'
    );
    expect(buildInviteUrl('http://localhost:3001/', 'tok')).toBe('http://localhost:3001/faculty/onboarding?token=tok');
  });

  it('adds the TTL to the creation time', () => {
    const now = new Date('2026-11-03T00:00:00Z');
    expect(inviteExpiry(now, 72).toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });
});

describe('invitation email', () => {
  const email = buildInvitationEmail({
    to: 'tutor@example.org',
    inviteUrl: 'https://app.amentorz.com/faculty/onboarding?token=abc&x=1',
    expiresAt: new Date('2026-11-06T00:00:00Z'),
    ttlHours: 72,
  });

  it('addresses the invitee with one call to action', () => {
    expect(email.to).toBe('tutor@example.org');
    expect(email.category).toBe('faculty-invitation');
    expect(email.subject).toBe('You are invited to teach on Amentorz');
    expect(email.html).toContain('Complete your profile');
    expect(email.html).toContain('href="https://app.amentorz.com/faculty/onboarding?token=abc&amp;x=1"');
    expect(email.html).toContain('expires in 3 days');
    expect(email.text).toContain('https://app.amentorz.com/faculty/onboarding?token=abc&x=1');
    expect(email.text).toContain('expires in 3 days (2026-11-06T00:00:00.000Z)');
  });

  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const hostile = buildInvitationEmail({
      to: 'a@x.com',
      inviteUrl: 'https://x.com/?token="><script>alert(1)</script>',
      expiresAt: new Date(),
      ttlHours: 1,
    });
    expect(hostile.html).not.toContain('<script>');
  });

  it.each([
    [1, '1 hour'],
    [36, '36 hours'],
    [24, '1 day'],
    [72, '3 days'],
  ])('describes %s hours as %s', (hours, text) => {
    expect(describeValidity(hours)).toBe(text);
  });
});

describe('roster helpers', () => {
  it('pending tab holds invited and pending rows', () => {
    expect(TAB_STATUSES.pending).toEqual(['invited', 'pending']);
  });

  it('counts per tab; all includes rejected and expired', () => {
    expect(countsByTab({ invited: 2, pending: 5, verified: 12, published: 96, suspended: 3, rejected: 1, expired: 4 })).toEqual({
      all: 123,
      pending: 7,
      verified: 12,
      published: 96,
      suspended: 3,
    });
    expect(countsByTab({})).toEqual({ all: 0, pending: 0, verified: 0, published: 0, suspended: 0 });
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike('school/k12')).toBe('school/k12');
  });

  it('formats a qualification', () => {
    expect(formatQualification({ degree: ' Ph.D. ', institution: 'IIT Bombay ' })).toBe('Ph.D. · IIT Bombay');
  });

  it('lists each conflicting email with its reason', () => {
    expect(
      conflictErrors(new Map([['a@x.com', 'ALREADY_REGISTERED'], ['b@x.com', 'ALREADY_INVITED']] as const))
    ).toEqual({
      emails: ['a@x.com already has an Amentorz account', 'b@x.com already has a pending invitation'],
    });
  });
});
