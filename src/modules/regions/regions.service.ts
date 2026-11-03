import type { Country } from '@prisma/client';
import { prisma } from '@infrastructure/database/index.js';
import { ValidationError } from '@core/errors/index';
import { matchCountry, matchesCountryPattern, isE164 } from '@shared/regions/index.js';

// Country rows change rarely; reading them once a minute keeps every registration off the table.
const CACHE_MS = 60_000;
let cache: { at: number; rows: Country[] } | undefined;

/** Forgets the cached rows (after an admin changes a country, and between tests). */
export function clearRegionCache(): void {
  cache = undefined;
}

/** Active countries in display order. */
export async function listCountries(): Promise<Country[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const rows = await prisma.country.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    });
    cache = { at: Date.now(), rows };
  }
  return cache.rows;
}

export async function getCountry(code: string): Promise<Country | undefined> {
  return (await listCountries()).find((country) => country.code === code);
}

/** The active country whose dialling code starts this E.164 number, if any. */
export async function countryFromMobile(e164: string): Promise<Country | undefined> {
  return matchCountry(e164, await listCountries());
}

/**
 * True when the number is valid E.164 and, for the given country (or the one its dialling code names),
 * its national part matches that country's mobile pattern.
 */
export async function isValidMobile(e164: string, countryCode?: string): Promise<boolean> {
  if (!isE164(e164)) return false;
  const country = countryCode ? await getCountry(countryCode) : await countryFromMobile(e164);
  return country !== undefined && matchesCountryPattern(e164, country);
}

export async function defaultTimezone(countryCode: string): Promise<string> {
  return (await requireCountry(countryCode)).defaultTimezone;
}

/** Age below which a guardian must consent, read from the country (never hard-coded). */
export async function guardianConsentAge(countryCode: string): Promise<number> {
  return (await requireCountry(countryCode)).guardianConsentAge;
}

async function requireCountry(code: string): Promise<Country> {
  const country = await getCountry(code);
  if (!country) throw new ValidationError('This country is not supported yet.');
  return country;
}
