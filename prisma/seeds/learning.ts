import type { PrismaClient } from '@prisma/client';

/**
 * Learning catalogue for the student onboarding step: the `catalogue.category_tree` flag (switched on),
 * teaching languages, extra non-academic branches (Coding, Music, Languages, Wellness), an international
 * school leaf, and a subject offering (curriculum) for every leaf so each leaf has subjects to pick.
 * Needs the reference seed (`npm run db:seed`) first. Idempotent: rows are created only where missing,
 * nothing is deleted. Sample data for QA and demos, so it must never run in production.
 * Offerings are plain subjects on a leaf (no board or class): the learner catalogue never asks for them since
 * the category tree was simplified, and an offering with a board or class cannot be resolved.
 * Shapes covered: leaves at depth 1 and 2, with a handful of subjects each.
 */
export async function seedLearning(prisma: PrismaClient): Promise<void> {
  type Leaf = { id: string; code: string };

  async function node(
    parentCode: string | null,
    code: string,
    name: string,
    opts: { bookable?: boolean; order?: number } = {}
  ): Promise<Leaf & { path: string; depth: number }> {
    const parent = parentCode
      ? await prisma.category.findFirstOrThrow({ where: { path: parentCode } })
      : null;
    const path = parent ? `${parent.path}/${code}` : code;
    const found = await prisma.category.findUnique({ where: { path } });
    if (found) return found;
    return prisma.category.create({
      data: {
        parentId: parent?.id ?? null,
        code,
        name,
        path,
        depth: parent ? parent.depth + 1 : 0,
        isBookable: opts.bookable ?? false,
        displayOrder: opts.order ?? 0,
      },
    });
  }

  async function subject(code: string, name: string): Promise<string> {
    const row = await prisma.subject.upsert({
      where: { code },
      update: {},
      create: { code, name },
    });
    return row.id;
  }
  async function offer(categoryId: string, subjectIds: string[]): Promise<number> {
    const data = subjectIds.map((subjectId) => ({
      categoryId,
      subjectId,
      boardId: null,
      levelId: null,
    }));
    const { count } = await prisma.curriculum.createMany({ data, skipDuplicates: true });
    return count;
  }

  await prisma.featureFlag.upsert({
    where: { name: 'catalogue.category_tree' },
    update: { isEnabled: true },
    create: { name: 'catalogue.category_tree', isEnabled: true },
  });

  for (const [order, [code, name, languageCodes]] of (
    [
      ['en', 'English', ['en']],
      ['hi', 'Hindi', ['hi']],
      ['ml', 'Malayalam', ['ml']],
      ['ta', 'Tamil', ['ta']],
    ] as const
  ).entries()) {
    await prisma.teachingLanguage.upsert({
      where: { code },
      update: {},
      create: { code, name, languageCodes: [...languageCodes], displayOrder: order },
    });
  }

  const S = {
    english: await subject('english', 'English'),
    hindi: await subject('hindi', 'Hindi'),
    maths: await subject('mathematics', 'Mathematics'),
    physics: await subject('physics', 'Physics'),
    chemistry: await subject('chemistry', 'Chemistry'),
    biology: await subject('biology', 'Biology'),
    social: await subject('social-science', 'Social Science'),
    cs: await subject('computer-science', 'Computer Science'),
    economics: await subject('economics', 'Economics'),
    accountancy: await subject('accountancy', 'Accountancy'),
    business: await subject('business-studies', 'Business Studies'),
  };
  const extra = async (list: [string, string][]) =>
    Promise.all(list.map(([code, name]) => subject(code, name)));

  // ── Academic ──────────────────────────────────────────────────────────────
  const k12 = await prisma.category.findFirstOrThrow({ where: { path: 'academic/school/k-12' } });
  await offer(k12.id, [
    S.english,
    S.maths,
    S.hindi,
    S.social,
    S.physics,
    S.chemistry,
    S.biology,
    S.cs,
    S.economics,
    S.accountancy,
    S.business,
  ]);

  const international = await node(
    'academic/school',
    'international',
    'International (IGCSE / IB)',
    { bookable: true, order: 2 }
  );
  await offer(international.id, [S.maths, S.physics, S.chemistry, S.biology, S.english, S.cs]);

  const university = await prisma.category.findFirstOrThrow({
    where: { path: 'academic/university' },
  });
  await offer(university.id, [
    S.maths,
    S.physics,
    S.chemistry,
    S.cs,
    S.economics,
    S.accountancy,
    S.business,
    S.english,
  ]);

  const entrance = await prisma.category.findFirstOrThrow({ where: { path: 'academic/jee-neet' } });
  await offer(entrance.id, [S.physics, S.chemistry, S.maths, S.biology]);

  // ── Non-academic ──────────────────────────────────────────────────────────
  const research = await prisma.category.findFirstOrThrow({
    where: { path: 'non-academic/research-skill' },
  });
  await offer(
    research.id,
    await extra([
      ['research-methods', 'Research Methods'],
      ['academic-writing', 'Academic Writing'],
      ['data-analysis', 'Data Analysis'],
    ])
  );

  const coding = await node('non-academic', 'coding', 'Coding', { bookable: true, order: 2 });
  await offer(
    coding.id,
    await extra([
      ['python', 'Python'],
      ['web-development', 'Web Development'],
      ['java', 'Java'],
      ['data-structures', 'Data Structures'],
    ])
  );

  // Skill leaves: the student picks the skill only
  const groups: [string, string, [string, string, [string, string][]][]][] = [
    [
      'music',
      'Music',
      [
        [
          'guitar',
          'Guitar',
          [
            ['acoustic-guitar', 'Acoustic guitar'],
            ['electric-guitar', 'Electric guitar'],
          ],
        ],
        [
          'piano',
          'Piano & Keyboard',
          [
            ['western-piano', 'Western piano'],
            ['keyboard', 'Keyboard'],
          ],
        ],
        [
          'vocals',
          'Vocals',
          [
            ['carnatic-vocal', 'Carnatic vocal'],
            ['hindustani-vocal', 'Hindustani vocal'],
            ['western-vocal', 'Western vocal'],
          ],
        ],
      ],
    ],
    [
      'languages',
      'Languages',
      [
        [
          'spoken-english',
          'Spoken English',
          [
            ['conversation', 'Conversation'],
            ['interview-prep', 'Interview prep'],
          ],
        ],
        [
          'french',
          'French',
          [
            ['french-basics', 'French basics'],
            ['delf-prep', 'DELF prep'],
          ],
        ],
        [
          'german',
          'German',
          [
            ['german-basics', 'German basics'],
            ['goethe-prep', 'Goethe prep'],
          ],
        ],
      ],
    ],
    [
      'wellness',
      'Wellness',
      [
        [
          'yoga',
          'Yoga',
          [
            ['hatha-yoga', 'Hatha yoga'],
            ['power-yoga', 'Power yoga'],
          ],
        ],
        ['meditation', 'Meditation', [['mindfulness', 'Mindfulness']]],
      ],
    ],
  ];
  for (const [index, [groupCode, groupName, leaves]] of groups.entries()) {
    await node('non-academic', groupCode, groupName, { order: 3 + index });
    for (const [leafCode, leafName, subjects] of leaves) {
      const leaf = await node(`non-academic/${groupCode}`, leafCode, leafName, { bookable: true });
      await offer(leaf.id, await extra(subjects));
    }
  }
}
