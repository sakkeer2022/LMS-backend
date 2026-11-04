import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { config } from '@config/index';
import { BadGatewayError, ConflictError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import type { InviteFacultyInput } from './faculty.dto.js';
import { buildInviteUrl, generateInviteToken, inviteExpiry } from './faculty.tokens.js';
import { buildInvitationEmail } from './faculty.invite-email.js';

export interface InvitationView {
  id: string;
  email: string;
  /** pending: outstanding; revoked: the email could not be delivered, so the invitation was withdrawn. */
  status: 'pending' | 'revoked';
  deliveryMethod: 'email' | 'link';
  /** Whether the email was accepted by the provider; null for link invitations. */
  delivered: boolean | null;
  sentAt: Date | null;
  expiresAt: Date;
}

export interface InviteResult {
  invitations: InvitationView[];
  /** The onboarding link, for delivery=link only. Shown once; only its hash is stored. */
  inviteUrl: string | null;
}

/** Why an address cannot be invited, or null when it can. */
export type InviteConflict = 'ALREADY_REGISTERED' | 'ALREADY_INVITED';

const CONFLICT_MESSAGES: Record<InviteConflict, string> = {
  ALREADY_REGISTERED: 'already has an Amentorz account',
  ALREADY_INVITED: 'already has a pending invitation',
};

/** Per-email conflicts as the `errors` map returned with a 409. */
export function conflictErrors(conflicts: Map<string, InviteConflict>): Record<string, string[]> {
  return {
    emails: [...conflicts].map(([email, reason]) => `${email} ${CONFLICT_MESSAGES[reason]}`),
  };
}

function conflictError(conflicts: Map<string, InviteConflict>): ConflictError {
  const count = conflicts.size;
  return new ConflictError(
    count === 1
      ? `${[...conflicts.keys()][0]} ${CONFLICT_MESSAGES[[...conflicts.values()][0] as InviteConflict]}`
      : `${count} of these email addresses cannot be invited`,
    { code: 'FACULTY_INVITE_CONFLICT', fieldErrors: conflictErrors(conflicts) }
  );
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Invites tutors by email (LMS-79). One transaction checks every address and creates
 * the invitations, so either all are created or none:
 * - an address with any user account (any role) is refused: 409 ALREADY_REGISTERED;
 * - an address with an unexpired PENDING invitation is refused: 409 ALREADY_INVITED;
 *   expired PENDING invitations are marked EXPIRED first, so the address can be re-invited.
 * A partial unique index keeps one PENDING invitation per email under concurrency.
 *
 * delivery=email sends each email after the commit. An invitation whose email the
 * provider refuses is revoked (DELIVERY_FAILED) so it can be sent again; if none could
 * be delivered the request fails with 502. delivery=link sends nothing and returns the
 * onboarding link once.
 */
export async function inviteFaculty(
  dto: InviteFacultyInput,
  audit: AuditContext
): Promise<InviteResult> {
  const now = new Date();
  const { ttlHours } = config.facultyInvitations;
  const expiresAt = inviteExpiry(now, ttlHours);
  const deliveryMethod = dto.delivery === 'link' ? 'LINK' : 'EMAIL';
  const prepared = dto.emails.map((email) => ({ email, ...generateInviteToken() }));

  let created: { id: string; email: string; expiresAt: Date }[];
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.facultyInvitation.updateMany({
        where: { email: { in: dto.emails }, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });

      const [registered, invited] = await Promise.all([
        tx.$queryRaw<{ email: string }[]>`
          SELECT lower(email) AS email FROM users WHERE lower(email) = ANY(${dto.emails}::text[])`,
        tx.facultyInvitation.findMany({
          where: { email: { in: dto.emails }, status: 'PENDING' },
          select: { email: true },
        }),
      ]);

      const conflicts = new Map<string, InviteConflict>();
      for (const { email } of registered) conflicts.set(email, 'ALREADY_REGISTERED');
      for (const { email } of invited) {
        if (!conflicts.has(email)) conflicts.set(email, 'ALREADY_INVITED');
      }
      if (conflicts.size > 0) {
        // Keep request order in the error list
        const ordered = new Map(
          dto.emails
            .filter((e) => conflicts.has(e))
            .map((e) => [e, conflicts.get(e) as InviteConflict])
        );
        throw conflictError(ordered);
      }

      return tx.facultyInvitation.createManyAndReturn({
        data: prepared.map(({ email, tokenHash }) => ({
          email,
          tokenHash,
          deliveryMethod,
          expiresAt,
          invitedById: audit.actorId ?? null,
        })),
        select: { id: true, email: true, expiresAt: true },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Another admin invited one of these addresses at the same moment
      throw new ConflictError('One of these email addresses was just invited by someone else', {
        code: 'FACULTY_INVITE_CONFLICT',
      });
    }
    throw err;
  }

  const tokenByEmail = new Map(prepared.map((p) => [p.email, p.token]));
  logger.info(
    {
      type: 'faculty',
      count: created.length,
      deliveryMethod,
      invitationIds: created.map((c) => c.id),
    },
    'Faculty invitations created'
  );

  for (const invitation of created) {
    await audited(audit, {
      action: 'faculty.invitation_created',
      resourceId: invitation.id,
      newValue: {
        email: invitation.email,
        deliveryMethod,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
  }

  if (deliveryMethod === 'LINK') {
    const invitation = created[0] as (typeof created)[number];
    return {
      invitations: [toView(invitation, 'pending', 'link', null, null)],
      inviteUrl: buildInviteUrl(config.facultyAppUrl, tokenByEmail.get(invitation.email) as string),
    };
  }

  const views: InvitationView[] = [];
  for (const invitation of created) {
    const inviteUrl = buildInviteUrl(
      config.facultyAppUrl,
      tokenByEmail.get(invitation.email) as string
    );
    views.push(await deliver(invitation, inviteUrl, ttlHours, audit));
  }

  const failed = views.filter((v) => !v.delivered);
  if (failed.length === views.length) {
    throw new BadGatewayError(
      failed.length === 1
        ? 'The invitation email could not be sent. Please try again.'
        : 'None of the invitation emails could be sent. Please try again.',
      {
        code: 'EMAIL_DELIVERY_FAILED',
        fieldErrors: {
          emails: failed.map((v) => `${v.email}: the invitation email could not be sent`),
        },
      }
    );
  }
  return { invitations: views, inviteUrl: null };
}

async function deliver(
  invitation: { id: string; email: string; expiresAt: Date },
  inviteUrl: string,
  ttlHours: number,
  audit: AuditContext
): Promise<InvitationView> {
  const provider = getEmailProvider();
  try {
    const result = await provider.send(
      buildInvitationEmail({
        to: invitation.email,
        inviteUrl,
        expiresAt: invitation.expiresAt,
        ttlHours,
      })
    );
    const sentAt = new Date();
    await prisma.facultyInvitation.update({ where: { id: invitation.id }, data: { sentAt } });
    logger.info(
      {
        type: 'faculty',
        invitationId: invitation.id,
        provider: provider.name,
        messageId: result.messageId,
      },
      'Faculty invitation email sent'
    );
    return toView(invitation, 'pending', 'email', true, sentAt);
  } catch (err) {
    const reason = (err as Error).message.slice(0, 255);
    await prisma.facultyInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: 'DELIVERY_FAILED',
        deliveryError: reason,
      },
    });
    logger.warn(
      {
        type: 'faculty',
        invitationId: invitation.id,
        provider: provider.name,
        err: { message: reason },
      },
      'Faculty invitation email failed; invitation revoked'
    );
    await audited(audit, {
      action: 'faculty.invitation_delivery_failed',
      resourceId: invitation.id,
      severity: 'WARN',
      newValue: { email: invitation.email, provider: provider.name, reason },
    });
    return toView(invitation, 'revoked', 'email', false, null);
  }
}

function toView(
  invitation: { id: string; email: string; expiresAt: Date },
  status: InvitationView['status'],
  deliveryMethod: InvitationView['deliveryMethod'],
  delivered: boolean | null,
  sentAt: Date | null
): InvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    status,
    deliveryMethod,
    delivered,
    sentAt,
    expiresAt: invitation.expiresAt,
  };
}

/** Audit write that never fails the request (the invitation already exists). */
async function audited(
  audit: AuditContext,
  entry: {
    action: string;
    resourceId: string;
    newValue: Record<string, unknown>;
    severity?: 'INFO' | 'WARN';
  }
): Promise<void> {
  try {
    await logAction({
      ...audit,
      severity: entry.severity ?? 'INFO',
      entity: 'faculty_invitation',
      ...entry,
    });
  } catch (err) {
    logger.error(
      { err, invitationId: entry.resourceId },
      'Failed to write faculty invitation audit log'
    );
  }
}
