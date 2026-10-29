/**
 * Demo catalogue paths for local development and demos (LMS-54). Never run in
 * production. Requires the reference seed (`npx prisma db seed`) first.
 *
 * Usage: npm run db:seed:demo
 */
import { prisma } from '../src/infrastructure/database/connection.js';
import { createPath } from '../src/modules/catalogue/catalogue.mutations.js';

const PATHS: { category: string; subsection?: string; board?: string; subject: string; level: string }[] = [
  { category: 'school', subsection: 'k-12', board: 'cbse', subject: 'physics', level: 'class-11' },
  { category: 'school', subsection: 'k-12', board: 'cbse', subject: 'physics', level: 'class-12' },
  { category: 'school', subsection: 'k-12', board: 'cbse', subject: 'chemistry', level: 'class-11' },
  { category: 'school', subsection: 'k-12', board: 'cbse', subject: 'mathematics', level: 'class-10' },
  { category: 'school', subsection: 'k-12', board: 'icse', subject: 'physics', level: 'class-10' },
  { category: 'school', subsection: 'k-12', board: 'icse', subject: 'english', level: 'class-9' },
  { category: 'university', subject: 'mathematics', level: 'year-1' },
  { category: 'jee-neet', subject: 'physics', level: 'jee-main' },
  { category: 'jee-neet', subject: 'chemistry', level: 'neet' },
  { category: 'jee-neet', subject: 'biology', level: 'neet' },
  { category: 'research-skill', subject: 'computer-science', level: 'beginner' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed must never run in production');
  }

  for (const p of PATHS) {
    const category = await prisma.category.findUniqueOrThrow({ where: { code: p.category } });
    const root = await prisma.catalogueNode.findUniqueOrThrow({ where: { categoryId: category.id } });
    const subsection = p.subsection
      ? await prisma.catalogueNode.findFirstOrThrow({ where: { parentId: root.id, slug: p.subsection } })
      : null;
    const board = p.board ? await prisma.board.findUniqueOrThrow({ where: { code: p.board } }) : null;
    const subject = await prisma.subject.findUniqueOrThrow({ where: { code: p.subject } });
    const level = await prisma.level.findUniqueOrThrow({ where: { code: p.level } });

    const label = [p.category, p.subsection, p.board, p.subject, p.level].filter(Boolean).join(' › ');
    try {
      await createPath(
        {
          categoryId: category.id,
          subsectionNodeId: subsection?.id,
          boardId: board?.id,
          subjectId: subject.id,
          levelId: level.id,
          status: 'PUBLISHED',
        },
        { userId: null }
      );
      console.log(`Created ${label}`);
    } catch (err) {
      // Re-runs hit 409 for paths that already exist
      console.log(`Skipped ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
