import { COUNTRY_ROWS } from '../../prisma/reference-data/countries.js';
import { prisma } from '@infrastructure/database/index.js';
import { clearRegionCache } from '@modules/regions/index.js';

/** Inserts the India and UAE rows (the test setup empties every table, including the migration's rows). */
export async function seedCountries(): Promise<void> {
  await prisma.country.createMany({
    data: COUNTRY_ROWS.map((row) => ({ ...row })),
    skipDuplicates: true,
  });
  clearRegionCache();
}
