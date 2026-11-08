// The options seeded by prisma/migrations/20261107090000_student_referral_and_education. Tests insert these
// rows because the test setup empties every table; tests/unit/referral-sources-reference.test.ts keeps this
// list and the migration equal.
export const REFERRAL_SOURCE_ROWS = [
  { code: 'friend_family', name: 'Friend or family', displayOrder: 1 },
  { code: 'school_teacher', name: 'School or teacher', displayOrder: 2 },
  { code: 'instagram', name: 'Instagram', displayOrder: 3 },
  { code: 'youtube', name: 'YouTube', displayOrder: 4 },
  { code: 'whatsapp', name: 'WhatsApp', displayOrder: 5 },
  { code: 'google_search', name: 'Google search', displayOrder: 6 },
  { code: 'poster_ad', name: 'Poster or ad', displayOrder: 7 },
  { code: 'news_blog', name: 'News or blog', displayOrder: 8 },
  { code: 'other', name: 'Other', displayOrder: 9 },
] as const;
