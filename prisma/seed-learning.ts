/**
 * Seeds the learning catalogue (flag, languages, branches and offerings) for QA and demos. Refuses to run in
 * production. Requires the reference seed (`npm run db:seed`) first.
 *
 * Usage: npm run db:seed:learning
 */
import { prisma } from '../src/infrastructure/database/connection.js';
import { seedLearning } from './seeds/learning.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The learning catalogue is sample data and is never seeded in production.');
  }
  await seedLearning(prisma);
  const [categories, curricula] = await Promise.all([
    prisma.category.count(),
    prisma.curriculum.count(),
  ]);
  console.log(`Learning catalogue ready: ${categories} categories, ${curricula} offerings.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
