import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@infrastructure/database/index.js';
import {
  clearRegionCache,
  countryFromMobile,
  defaultTimezone,
  getCountry,
  guardianConsentAge,
  isValidMobile,
  listCountries,
} from '@modules/regions/index.js';
import { seedCountries } from '../helpers/regions.js';

describe('regions', () => {
  beforeEach(seedCountries);

  it('lists India and the UAE in display order', async () => {
    expect((await listCountries()).map((c) => c.code)).toEqual(['IN', 'AE']);
  });

  it('derives the country from the mobile number', async () => {
    expect((await countryFromMobile('+919876543210'))?.code).toBe('IN');
    expect((await countryFromMobile('+971501234567'))?.code).toBe('AE');
    expect(await countryFromMobile('+14155550123')).toBeUndefined();
  });

  it('validates a mobile number for its own country', async () => {
    expect(await isValidMobile('+919876543210')).toBe(true);
    expect(await isValidMobile('+971501234567')).toBe(true);
    expect(await isValidMobile('+915876543210')).toBe(false);
    expect(await isValidMobile('+971601234567')).toBe(false);
    expect(await isValidMobile('+971501234567', 'IN')).toBe(false);
    expect(await isValidMobile('+14155550123')).toBe(false);
  });

  it('reads the default time zone and guardian consent age from the country', async () => {
    expect(await defaultTimezone('IN')).toBe('Asia/Kolkata');
    expect(await defaultTimezone('AE')).toBe('Asia/Dubai');
    expect(await guardianConsentAge('IN')).toBe(18);
    expect(await guardianConsentAge('AE')).toBe(18);
    await expect(guardianConsentAge('US')).rejects.toThrow();
  });

  it('adds a country with a row, not a code change', async () => {
    await prisma.country.create({
      data: {
        code: 'SG',
        name: 'Singapore',
        dialCode: '+65',
        mobilePattern: '^[89][0-9]{7}$',
        defaultTimezone: 'Asia/Singapore',
        guardianConsentAge: 21,
        displayOrder: 3,
      },
    });
    clearRegionCache();
    expect((await countryFromMobile('+6591234567'))?.code).toBe('SG');
    expect(await guardianConsentAge('SG')).toBe(21);
  });

  it('ignores a country that is switched off', async () => {
    await prisma.country.update({ where: { code: 'AE' }, data: { isActive: false } });
    clearRegionCache();
    expect(await getCountry('AE')).toBeUndefined();
    expect(await isValidMobile('+971501234567')).toBe(false);
  });
});
