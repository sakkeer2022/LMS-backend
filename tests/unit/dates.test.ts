import { describe, expect, it } from 'vitest';
import { completedYears, parseCalendarDate } from '@shared/dates';

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
