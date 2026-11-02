/**
 * Demo offerings (curricula on category-tree leaves, ADR-0005) and default prices for local development and demos (LMS-54, LMS-58). Never run in
 * production. Requires the reference seed (`npx prisma db seed`) first.
 *
 * Usage: npm run db:seed:demo
 */
import { prisma } from '../src/infrastructure/database/connection.js';
import { addOffering } from '../src/modules/category-tree/category-tree.offerings.js';
import { createPriceRule } from '../src/modules/pricing/pricing.service.js';
import { redisClient } from '../src/infrastructure/redis/connection.js';

/** `pricePaise` adds a default (all tutors) price rule; paths without one show "Not configured". */
const PATHS: {
  category: string;
  subsection?: string;
  board?: string;
  subject: string;
  level: string;
  pricePaise?: number;
}[] = [
  {
    category: 'school',
    subsection: 'k-12',
    board: 'cbse',
    subject: 'physics',
    level: 'class-11',
    pricePaise: 120000,
  },
  {
    category: 'school',
    subsection: 'k-12',
    board: 'cbse',
    subject: 'physics',
    level: 'class-12',
    pricePaise: 145000,
  },
  {
    category: 'school',
    subsection: 'k-12',
    board: 'cbse',
    subject: 'chemistry',
    level: 'class-11',
    pricePaise: 110000,
  },
  {
    category: 'school',
    subsection: 'k-12',
    board: 'cbse',
    subject: 'mathematics',
    level: 'class-10',
    pricePaise: 99950,
  },
  {
    category: 'school',
    subsection: 'k-12',
    board: 'icse',
    subject: 'physics',
    level: 'class-10',
    pricePaise: 105000,
  },
  { category: 'school', subsection: 'k-12', board: 'icse', subject: 'english', level: 'class-9' },
  { category: 'university', subject: 'mathematics', level: 'year-1', pricePaise: 180000 },
  { category: 'jee-neet', subject: 'physics', level: 'jee-main', pricePaise: 250000 },
  { category: 'jee-neet', subject: 'chemistry', level: 'neet' },
  { category: 'jee-neet', subject: 'biology', level: 'neet', pricePaise: 220000 },
  { category: 'research-skill', subject: 'computer-science', level: 'beginner' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed must never run in production');
  }

  for (const p of PATHS) {
    // The leaf: the sub-section when given (School › K-12), otherwise the tab itself
    const tab = await prisma.category.findFirstOrThrow({ where: { code: p.category, depth: 1 } });
    const leaf = p.subsection
      ? await prisma.category.findFirstOrThrow({ where: { parentId: tab.id, code: p.subsection } })
      : tab;
    const board = p.board
      ? await prisma.board.findUniqueOrThrow({ where: { code: p.board } })
      : null;
    const subject = await prisma.subject.findUniqueOrThrow({ where: { code: p.subject } });
    const level = await prisma.level.findUniqueOrThrow({ where: { code: p.level } });

    const label = [p.category, p.subsection, p.board, p.subject, p.level]
      .filter(Boolean)
      .join(' › ');
    try {
      const { created } = await addOffering(
        leaf.id,
        { subjectId: subject.id, boardId: board?.id ?? null, levelId: level.id },
        { userId: null }
      );
      console.log(`${created ? 'Created' : 'Already present'} ${label}`);
    } catch (err) {
      console.log(`Skipped ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (p.pricePaise) {
      const curriculum = await prisma.curriculum.findFirstOrThrow({
        where: {
          categoryId: leaf.id,
          boardId: board?.id ?? null,
          subjectId: subject.id,
          levelId: level.id,
        },
      });
      try {
        await createPriceRule(
          {
            curriculumId: curriculum.id,
            facultyId: null,
            sessionPricePaise: p.pricePaise,
            isActive: true,
          },
          { userId: null }
        );
        console.log(`Priced ${label}`);
      } catch (err) {
        // Re-runs hit 409 for the existing default rule
        console.log(`Skipped price ${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// Importing the catalogue module opens a Redis connection; close it so the script exits
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
