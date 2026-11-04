import { describe, expect, it } from 'vitest';
import { completedYears, latestBirthDateForAge, parseCalendarDate } from '@shared/dates';

const on = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

describe('calendar dates', () => {
  it('rejects impossible and malformed dates', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull();
    expect(parseCalendarDate('2025-02-29')).toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
    expect(parseCalendarDate('12/04/2010')).toBeNull();
    expect(parseCalendarDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('counts whole years, turning a year older on the birthday and not the day before', () => {
    expect(completedYears('2008-11-03', on('2026-11-02'))).toBe(17);
    expect(completedYears('2008-11-03', on('2026-11-03'))).toBe(18);
    expect(completedYears('2008-11-03', on('2026-11-04'))).toBe(18);
    expect(completedYears('2026-11-03', on('2026-11-03'))).toBe(0);
  });

  it('handles a 29 February birthday in a non-leap year (a year older on 1 March)', () => {
    expect(completedYears('2008-02-29', on('2026-02-28'))).toBe(17);
    expect(completedYears('2008-02-29', on('2026-03-01'))).toBe(18);
  });

  it('is null for an invalid date of birth', () => {
    expect(completedYears('2026-02-30', new Date())).toBeNull();
  });
});

describe('birth date cut-off for an age', () => {
  it('is the same day years earlier, and the last day of the month for 29 February', () => {
    expect(latestBirthDateForAge(18, on('2026-11-03'))).toBe('2008-11-03');
    expect(latestBirthDateForAge(18, on('2028-02-29'))).toBe('2010-02-28');
    expect(latestBirthDateForAge(21, on('2026-02-28'))).toBe('2005-02-28');
  });

  it('agrees with completedYears for every day of a leap year and its neighbours', () => {
    for (const age of [18, 21]) {
      for (let offset = 0; offset < 366 * 3; offset++) {
        const today = new Date(Date.UTC(2027, 11, 20 + offset, 12));
        const cutoff = latestBirthDateForAge(age, today);
        const born = (days: number): string => {
          const [y, m, d] = cutoff.split('-').map(Number) as [number, number, number];
          return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
        };
        expect(completedYears(cutoff, today)).toBeGreaterThanOrEqual(age);
        expect(completedYears(born(1), today)).toBeLessThan(age);
      }
    }
  });
});
