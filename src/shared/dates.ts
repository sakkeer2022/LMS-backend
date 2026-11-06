/** A calendar date as `YYYY-MM-DD`, parsed without any time zone. Returns null for an impossible date. */
export function parseCalendarDate(
  value: string
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const valid =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  return valid ? { year, month, day } : null;
}

/** Whole years completed on `on` by someone born on `dateOfBirth` (both calendar dates, UTC). */
export function completedYears(dateOfBirth: string, on: Date): number | null {
  const born = parseCalendarDate(dateOfBirth);
  if (!born) return null;
  let years = on.getUTCFullYear() - born.year;
  const monthDiff = on.getUTCMonth() + 1 - born.month;
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < born.day)) years -= 1;
  return years;
}

/**
 * The latest date of birth that has completed `age` years on `on`: the same month and day `age` years
 * earlier, or that month's last day when it does not exist (29 February). Someone born after it is younger
 * than `age`; it is the cut-off a database filter needs, and it agrees with `completedYears` on every day.
 */
export function latestBirthDateForAge(age: number, on: Date): string {
  const year = on.getUTCFullYear() - age;
  const month = on.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(on.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}
