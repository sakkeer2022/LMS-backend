// The countries seeded by prisma/migrations/20261103090000_countries. Tests insert these rows because the
// test setup empties every table; tests/unit/countries-reference.test.ts keeps this list and the migration equal.
export const COUNTRY_ROWS = [
  {
    code: 'IN',
    name: 'India',
    dialCode: '+91',
    mobilePattern: '^[6-9][0-9]{9}$',
    defaultTimezone: 'Asia/Kolkata',
    guardianConsentAge: 18,
    displayOrder: 1,
  },
  {
    code: 'AE',
    name: 'United Arab Emirates',
    dialCode: '+971',
    mobilePattern: '^5[0-9]{8}$',
    defaultTimezone: 'Asia/Dubai',
    guardianConsentAge: 18,
    displayOrder: 2,
  },
] as const;
