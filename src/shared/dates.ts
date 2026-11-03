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
