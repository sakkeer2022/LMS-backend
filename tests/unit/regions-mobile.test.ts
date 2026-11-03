import { describe, expect, it } from 'vitest';
import { COUNTRY_ROWS } from '../../prisma/reference-data/countries.js';
import { isE164, matchCountry, matchesCountryPattern } from '@shared/regions/index.js';

const countries = COUNTRY_ROWS.map((row) => ({ ...row }));

describe('E.164 helpers', () => {
  it('accepts international numbers and rejects national or malformed ones', () => {
    expect(isE164('+919876543210')).toBe(true);
    expect(isE164('+971501234567')).toBe(true);
    expect(isE164('9876543210')).toBe(false);
    expect(isE164('+0123456789')).toBe(false);
    expect(isE164('+91 98765 43210')).toBe(false);
    expect(isE164('+9198')).toBe(false);
  });

  it('finds the country from the dialling code', () => {
    expect(matchCountry('+919876543210', countries)?.code).toBe('IN');
    expect(matchCountry('+971501234567', countries)?.code).toBe('AE');
    expect(matchCountry('+14155550123', countries)).toBeUndefined();
    expect(matchCountry('not a number', countries)).toBeUndefined();
  });

  it('prefers the longest dialling code', () => {
    const rows = [
      { code: 'X', dialCode: '+9', mobilePattern: '^.*$' },
      { code: 'AE', dialCode: '+971', mobilePattern: '^5[0-9]{8}$' },
    ];
    expect(matchCountry('+971501234567', rows)?.code).toBe('AE');
  });

  it('checks the national number against the country pattern', () => {
    const india = countries[0]!;
    const uae = countries[1]!;
    expect(matchesCountryPattern('+919876543210', india)).toBe(true);
    expect(matchesCountryPattern('+915876543210', india)).toBe(false); // must start 6-9
    expect(matchesCountryPattern('+91987654321', india)).toBe(false); // 9 digits
    expect(matchesCountryPattern('+971501234567', uae)).toBe(true);
    expect(matchesCountryPattern('+97150123456', uae)).toBe(false); // 8 digits
    expect(matchesCountryPattern('+971601234567', uae)).toBe(false); // must start 5
    expect(matchesCountryPattern('+919876543210', uae)).toBe(false); // wrong country
  });
});
