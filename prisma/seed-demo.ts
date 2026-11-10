/**
 * Demo categories and default prices for local development and demos (LMS-54, LMS-58).
 * Never run in production. Requires the reference seed (`npx prisma db seed`) first.
 *
 * Tutors pick a subject of a leaf of the category tree (a category without
 * sub-categories); each subject offering is a curriculum that prices point at (migration
 * 20261110090000_leaf_subject_offerings). Paths below the seeded tabs are created
 * here, the way an admin would build them in Categories & content.
 *
 * Usage: npm run db:seed:demo
 */
import { prisma } from '../src/infrastructure/database/connection.js';
import { createCategory } from '../src/modules/category-tree/category-tree.service.js';
import { attachSubject } from '../src/modules/category-tree/category-tree.subjects.js';
import { createPriceRule } from '../src/modules/pricing/pricing.service.js';
import { redisClient } from '../src/infrastructure/redis/connection.js';

/**
 * Names below an existing tab (by its path); the last name is the leaf and `subject` the
 * subject it offers. `pricePaise` adds a default (all tutors) price for that subject.
 */
const PATHS: { under: string; names: string[]; subject: string; pricePaise?: number }[] = [
  { under: 'academic/school/k-12', names: ['CBSE', 'Physics', 'Class 11'], subject: 'Physics', pricePaise: 120000 },
  { under: 'academic/school/k-12', names: ['CBSE', 'Physics', 'Class 12'], subject: 'Physics', pricePaise: 145000 },
  { under: 'academic/school/k-12', names: ['CBSE', 'Chemistry', 'Class 11'], subject: 'Chemistry', pricePaise: 110000 },
  { under: 'academic/school/k-12', names: ['CBSE', 'Mathematics', 'Class 10'], subject: 'Mathematics', pricePaise: 99950 },
  { under: 'academic/school/k-12', names: ['ICSE', 'Physics', 'Class 10'], subject: 'Physics', pricePaise: 105000 },
  { under: 'academic/school/k-12', names: ['ICSE', 'English', 'Class 9'], subject: 'English' },
  { under: 'academic/university', names: ['Mathematics', 'Year 1'], subject: 'Mathematics', pricePaise: 180000 },
  { under: 'academic/jee-neet', names: ['JEE Main', 'Physics'], subject: 'Physics', pricePaise: 250000 },
  { under: 'academic/jee-neet', names: ['NEET', 'Chemistry'], subject: 'Chemistry' },
  { under: 'academic/jee-neet', names: ['NEET', 'Biology'], subject: 'Biology', pricePaise: 220000 },
  { under: 'non-academic/research-skill', names: ['Computer Science', 'Beginner'], subject: 'Computer Science' },
];

const codeOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(?![a-z])/, 'c-');

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed must never run in production');
  }

  for (const p of PATHS) {
    const label = [p.under, ...p.names].join(' › ');
    try {
      let parent = await prisma.category.findUniqueOrThrow({ where: { path: p.under } });
      for (const name of p.names) {
        const { node } = await createCategory(parent.id, { code: codeOf(name), name }, { userId: null });
        parent = await prisma.category.findUniqueOrThrow({ where: { id: node.id } });
      }
      console.log(`Present ${label}`);
      const { curriculumId } = await attachSubject(parent.id, { name: p.subject }, { userId: null });
      if (!p.pricePaise) continue;
      try {
        await createPriceRule(
          { curriculumId, facultyId: null, sessionPricePaise: p.pricePaise, isActive: true },
          { userId: null }
        );
        console.log(`Priced ${label}`);
      } catch (err) {
        // Re-runs hit 409 for the existing default rule
        console.log(`Skipped price ${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      console.log(`Skipped ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// Importing the category-tree module opens a Redis connection; close it so the script exits
async function disconnect(): Promise<void> {
  await prisma.$disconnect();
  await redisClient?.quit();
}

main()
  .then(disconnect)
  .catch(async (e) => {
    console.error(e);
    await disconnect();
    process.exit(1);
  });
