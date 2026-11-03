import { z } from 'zod';
import { paginationQuerySchema } from '@shared/validation/index';

// ── Email address rule ───────────────────────────────────────────

/** RFC 5321 limits: 64 octets for the local part, 254 for the whole path. */
export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

/**
 * RFC 5322 `addr-spec` in its dot-atom form: atext characters in dot-separated
 * atoms, then a domain of dot-separated labels (letters, digits, inner hyphens)
 * ending in an alphabetic TLD of two or more letters. Quoted local parts, comments
 * and IP-literal domains are valid in RFC 5322 but deliberately rejected: mail
 * providers refuse them and they are not real tutor addresses. The admin frontend
 * uses the same expression.
 */
// Not exposed to backtracking blow-up: every repeated group is anchored on a literal
// '.', and isValidEmail checks the 254-character limit before running it.

export const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Whether `value` (already trimmed) is an acceptable email address. */
export function isValidEmail(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  const at = value.lastIndexOf('@');
  if (at < 1 || at > MAX_LOCAL_PART_LENGTH) return false;
  return EMAIL_PATTERN.test(value);
}

/** Trims and lowercases, then applies the email rule. */
export const invitationEmailSchema = z
  .string({ error: 'Email address is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email address is required')
  .max(MAX_EMAIL_LENGTH, `Email address must be at most ${MAX_EMAIL_LENGTH} characters`)
  .refine(isValidEmail, 'Enter a valid email address');

// ── Invitations ──────────────────────────────────────────────────

export const MAX_INVITES_PER_REQUEST = 20;

export const InviteFacultyDto = z
  .strictObject({
    emails: z
      .array(invitationEmailSchema)
      .min(1, 'Enter at least one email address')
      .max(MAX_INVITES_PER_REQUEST, `Invite at most ${MAX_INVITES_PER_REQUEST} tutors at once`),
    // email: send the invitation; link: create it and return the link to share (one email only)
    delivery: z.enum(['email', 'link']).default('email'),
  })
  // The same address twice in one request is a typo, not two invitations
  .transform((dto) => ({ ...dto, emails: [...new Set(dto.emails)] }))
  .superRefine((dto, ctx) => {
    if (dto.delivery === 'link' && dto.emails.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['emails'],
        message: 'Copy link creates one invitation at a time; enter exactly one email address',
      });
    }
  });

export type InviteFacultyInput = z.output<typeof InviteFacultyDto>;

// ── Listing ──────────────────────────────────────────────────────

/** Tabs on the admin Faculty screen; `all` keeps every row, including rejected and expired. */
export const FACULTY_TABS = ['all', 'pending', 'verified', 'published', 'suspended'] as const;
export type FacultyTab = (typeof FACULTY_TABS)[number];

export const FACULTY_SORTS = ['recent', 'oldest', 'name'] as const;
export type FacultySort = (typeof FACULTY_SORTS)[number];

const searchSchema = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value ? value : undefined));

const rosterFilters = {
  search: searchSchema,
  categoryId: z.uuid().optional(),
};

export const ListFacultyQueryDto = z.strictObject({
  ...paginationQuerySchema.shape,
  ...rosterFilters,
  status: z.enum(FACULTY_TABS).default('all'),
  sort: z.enum(FACULTY_SORTS).default('recent'),
});

export const FacultyCountsQueryDto = z.strictObject(rosterFilters);

export type ListFacultyQuery = z.output<typeof ListFacultyQueryDto>;
export type FacultyCountsQuery = z.output<typeof FacultyCountsQueryDto>;
