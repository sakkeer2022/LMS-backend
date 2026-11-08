import { COUNTRY_ROWS } from '../../prisma/reference-data/countries.js';
import { REFERRAL_SOURCE_ROWS } from '../../prisma/reference-data/referral-sources.js';
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

/** Inserts the "how did you hear about us" options (the test setup empties every table). */
export async function seedReferralSources(): Promise<void> {
  await prisma.referralSource.createMany({
    data: REFERRAL_SOURCE_ROWS.map((row) => ({ ...row })),
    skipDuplicates: true,
  });
}
