import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTRY_ROWS } from '../../prisma/reference-data/countries.js';

describe('country reference data', () => {
  it('matches the rows inserted by the countries migration', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../prisma/migrations/20261103090000_countries/migration.sql'),
      'utf8'
    );
    for (const row of COUNTRY_ROWS) {
      const expected = `('${row.code}', '${row.name}', '${row.dialCode}', '${row.mobilePattern}', '${row.defaultTimezone}', ${row.guardianConsentAge}, ${row.displayOrder}, CURRENT_TIMESTAMP)`;
      expect(sql).toContain(expected);
    }
  });
});
