/**
 * Demo categories and default prices for local development and demos (LMS-54, LMS-58).
 * Never run in production. Requires the reference seed (`npx prisma db seed`) first.
 *
 * Tutors pick leaves of the category tree (a category without sub-categories); each
 * leaf has one category curriculum that prices point at (migration
 * 20261105090000_category_simple_leaves). Paths below the seeded tabs are created
 * here, the way an admin would build them in Categories & content.
 *
 * Usage: npm run db:seed:demo
 */
import { prisma } from '../src/infrastructure/database/connection.js';
import { createCategory } from '../src/modules/category-tree/category-tree.service.js';
import { createPriceRule } from '../src/modules/pricing/pricing.service.js';
import { redisClient } from '../src/infrastructure/redis/connection.js';

/** Names below an existing tab (by its path). `pricePaise` adds a default (all tutors) price. */
const PATHS: { under: string; names: string[]; pricePaise?: number }[] = [
  { under: 'academic/school/k-12', names: ['CBSE', 'Physics', 'Class 11'], pricePaise: 120000 },
  { under: 'academic/school/k-12', names: ['CBSE', 'Physics', 'Class 12'], pricePaise: 145000 },
  { under: 'academic/school/k-12', names: ['CBSE', 'Chemistry', 'Class 11'], pricePaise: 110000 },
  { under: 'academic/school/k-12', names: ['CBSE', 'Mathematics', 'Class 10'], pricePaise: 99950 },
  { under: 'academic/school/k-12', names: ['ICSE', 'Physics', 'Class 10'], pricePaise: 105000 },
  { under: 'academic/school/k-12', names: ['ICSE', 'English', 'Class 9'] },
  { under: 'academic/university', names: ['Mathematics', 'Year 1'], pricePaise: 180000 },
  { under: 'academic/jee-neet', names: ['JEE Main', 'Physics'], pricePaise: 250000 },
  { under: 'academic/jee-neet', names: ['NEET', 'Chemistry'] },
  { under: 'academic/jee-neet', names: ['NEET', 'Biology'], pricePaise: 220000 },
  { under: 'non-academic/research-skill', names: ['Computer Science', 'Beginner'] },
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
      if (!p.pricePaise) continue;
      const curriculum = await prisma.curriculum.findFirstOrThrow({
        where: { categoryId: parent.id, subjectId: null, boardId: null, levelId: null },
      });
      try {
        await createPriceRule(
          { curriculumId: curriculum.id, facultyId: null, sessionPricePaise: p.pricePaise, isActive: true },
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
