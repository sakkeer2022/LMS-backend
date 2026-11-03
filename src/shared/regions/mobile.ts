// Pure E.164 helpers. They know nothing about specific countries: the country rows are passed in
// (src/modules/regions reads them from the database), so a new country needs no change here.

export interface DiallingRule {
  code: string;
  dialCode: string;
  /** National number after the dialling code, as a regular expression source */
  mobilePattern: string;
}

/** E.164: a plus sign, then 8 to 15 digits, not starting with 0. */
export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** The country whose dialling code starts the number; the longest code wins (+971 before +9). */
export function matchCountry<T extends DiallingRule>(
  e164: string,
  countries: readonly T[]
): T | undefined {
  if (!isE164(e164)) return undefined;
  return [...countries]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((country) => e164.startsWith(country.dialCode));
}

/** True when the number is E.164 and its national part matches the country's pattern. */
export function matchesCountryPattern(e164: string, country: DiallingRule): boolean {
  if (!isE164(e164) || !e164.startsWith(country.dialCode)) return false;
  return new RegExp(country.mobilePattern).test(e164.slice(country.dialCode.length));
}
