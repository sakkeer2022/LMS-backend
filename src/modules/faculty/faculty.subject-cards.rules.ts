/**
 * Subject card rules (decided 2026-11-12). A tutor holds at most MAX_SUBJECT_CARDS cards that are
 * still chosen and not rejected: onboarding picks, approved cards and pending requests all count,
 * so several requests sent at once cannot pass the limit. Rejected cards free their slot.
 * Pure; shared by the onboarding/re-upload DTOs and the profile request service.
 */

export const MAX_SUBJECT_CARDS = 5;

/** Card states that hold one of the MAX_SUBJECT_CARDS slots. */
export const SLOT_HOLDING_STATUSES = ['PENDING', 'APPROVED'] as const;

export const SUBJECT_CARD_LIMIT_MESSAGE = `You can have at most ${MAX_SUBJECT_CARDS} subject cards`;

export interface CardForCount {
  isActive: boolean;
  status: string;
}

/** Cards that use a slot. */
export function usedSlots(cards: readonly CardForCount[]): number {
  return cards.filter(
    (c) => c.isActive && (SLOT_HOLDING_STATUSES as readonly string[]).includes(c.status)
  ).length;
}

/** How many more cards the tutor may request (never negative: older tutors may hold more). */
export function remainingSlots(cards: readonly CardForCount[]): number {
  return Math.max(0, MAX_SUBJECT_CARDS - usedSlots(cards));
}
