import { prisma } from '@infrastructure/database/index';
import { ValidationError } from '@core/errors/index';

/**
 * "Preferred mode of teaching" (onboarding step 1): reference rows in teaching_modes, seeded by the
 * migration (online, offline, hybrid). New modes are rows, not code. `offersOffline` keeps the older
 * faculty_profiles.offers_offline_classes flag (used by discovery) in step with the chosen mode.
 */

export interface TeachingModeOption {
  code: string;
  name: string;
  offersOffline: boolean;
}

/** Active modes in display order (public: the onboarding form's dropdown). */
export function listTeachingModes(): Promise<TeachingModeOption[]> {
  return prisma.teachingMode.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    select: { code: true, name: true, offersOffline: true },
  });
}

/** The active mode for a code, or a field error naming `teachingMode`. */
export async function requireTeachingMode(code: string): Promise<TeachingModeOption> {
  const mode = await prisma.teachingMode.findFirst({
    where: { code, isActive: true },
    select: { code: true, name: true, offersOffline: true },
  });
  if (!mode) {
    const message = 'Select your preferred mode of teaching';
    throw new ValidationError(message, { fieldErrors: { teachingMode: [message] } });
  }
  return mode;
}

/** Label for a stored code, for the admin drawer ("Hybrid (Both Online & Offline)"). */
export async function teachingModeLabel(code: string | null): Promise<string | null> {
  if (!code) return null;
  const mode = await prisma.teachingMode.findUnique({ where: { code }, select: { name: true } });
  return mode?.name ?? code;
}
