// The "Preferred mode of teaching" options seeded by
// prisma/migrations/20261111090000_faculty_reupload_mode_signature. Tests insert these rows because the test
// setup empties every table; tests/unit/teaching-modes-reference.test.ts keeps this list and the migration equal.
export const TEACHING_MODE_ROWS = [
  { code: 'online', name: 'Online', offersOffline: false, displayOrder: 1 },
  { code: 'offline', name: 'Offline / In-Person', offersOffline: true, displayOrder: 2 },
  { code: 'hybrid', name: 'Hybrid (Both Online & Offline)', offersOffline: true, displayOrder: 3 },
] as const;
