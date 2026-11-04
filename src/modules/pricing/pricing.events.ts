import { logger } from '@core/logger/index';

/**
 * Tells interested modules (faculty access, LMS-39) that a tutor's prices changed, without
 * pricing importing them. Listeners run after the change is committed; a failing listener
 * never fails the price change.
 */
type TutorPriceListener = (facultyId: string) => Promise<void>;

const listeners: TutorPriceListener[] = [];

export function registerTutorPriceListener(listener: TutorPriceListener): void {
  if (!listeners.includes(listener)) listeners.push(listener);
}

export async function notifyTutorPricesChanged(
  facultyIds: readonly (string | null)[]
): Promise<void> {
  const ids = [...new Set(facultyIds.filter((id): id is string => Boolean(id)))];
  for (const id of ids) {
    for (const listener of listeners) {
      try {
        await listener(id);
      } catch (err) {
        logger.warn(
          { err: { message: (err as Error).message }, facultyId: id },
          'Tutor price listener failed'
        );
      }
    }
  }
}
