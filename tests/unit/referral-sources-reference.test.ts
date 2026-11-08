import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFERRAL_SOURCE_ROWS } from '../../prisma/reference-data/referral-sources.js';

describe('referral source reference data', () => {
  it('matches the rows inserted by the migration', () => {
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../prisma/migrations/20261107090000_student_referral_and_education/migration.sql'
      ),
      'utf8'
    );
    for (const row of REFERRAL_SOURCE_ROWS) {
      expect(sql).toContain(
        `('${row.code}', '${row.name}', ${row.displayOrder}, CURRENT_TIMESTAMP)`
      );
    }
  });
});
