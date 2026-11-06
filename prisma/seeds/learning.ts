import type { PrismaClient } from '@prisma/client';

/**
 * Learning catalogue for the student onboarding step: the `catalogue.category_tree` flag (switched on),
 * teaching languages, extra non-academic branches (Coding, Music, Languages, Wellness), an international
 * school leaf, and offerings (curricula) for every bookable leaf so each leaf has subjects to pick.
 * Needs the reference seed (`npm run db:seed`) first. Idempotent: rows are created only where missing,
 * nothing is deleted. Sample data for QA and demos, so it must never run in production.
 * Shapes covered: leaf with board and class, leaf with class only, leaf with neither (Guitar), depth 1 and 2.
 */
export async function seedLearning(prisma: PrismaClient): Promise<void> {
  type Leaf = { id: string; code: string };

  async function node(
    parentCode: string | null,
    code: string,
    name: string,
    opts: { bookable?: boolean; board?: boolean; level?: boolean; order?: number } = {}
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
        requiresBoard: opts.board ?? false,
        requiresLevel: opts.level ?? false,
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
  async function board(code: string, name: string): Promise<string> {
    const row = await prisma.board.upsert({ where: { code }, update: {}, create: { code, name } });
    return row.id;
  }
  async function level(code: string, name: string, sortOrder: number): Promise<string> {
    const row = await prisma.level.upsert({
      where: { code },
      update: {},
      create: { code, name, sortOrder },
    });
    return row.id;
  }
  const allow = (categoryId: string, levelIds: string[]) =>
    prisma.categoryLevel.createMany({
      data: levelIds.map((levelId) => ({ categoryId, levelId })),
      skipDuplicates: true,
    });

  async function offer(
    categoryId: string,
    subjectIds: string[],
    boardIds: (string | null)[],
    levelIds: (string | null)[]
  ): Promise<number> {
    const data = subjectIds.flatMap((subjectId) =>
      boardIds.flatMap((boardId) =>
        levelIds.map((levelId) => ({ categoryId, subjectId, boardId, levelId }))
      )
    );
    const { count } = await prisma.curriculum.createMany({ data, skipDuplicates: true });
    return count;
  }

  async function levelsOf(categoryPath: string): Promise<{ id: string; code: string }[]> {
    const category = await prisma.category.findFirstOrThrow({ where: { path: categoryPath } });
    const rows = await prisma.categoryLevel.findMany({
      where: { categoryId: category.id },
      include: { level: true },
    });
    return rows.map((row) => ({ id: row.level.id, code: row.level.code }));
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
  const boards = [
    await board('cbse', 'CBSE'),
    await board('icse', 'ICSE'),
    await board('state-board', 'State Board'),
  ];
  const k12Levels = await levelsOf('academic/school/k-12');
  const band = (from: number, to: number) =>
    k12Levels.filter((l) => {
      const n = Number(l.code.replace('class-', ''));
      return n >= from && n <= to;
    });
  await offer(
    k12.id,
    [S.english, S.maths, S.hindi],
    boards,
    band(1, 5).map((l) => l.id)
  );
  await offer(
    k12.id,
    [S.english, S.maths, S.hindi, S.social],
    boards,
    band(6, 8).map((l) => l.id)
  );
  await offer(
    k12.id,
    [S.english, S.maths, S.hindi, S.social, S.physics, S.chemistry, S.biology],
    boards,
    band(9, 10).map((l) => l.id)
  );
  await offer(
    k12.id,
    [
      S.physics,
      S.chemistry,
      S.maths,
      S.biology,
      S.english,
      S.cs,
      S.economics,
      S.accountancy,
      S.business,
    ],
    boards,
    band(11, 12).map((l) => l.id)
  );

  const international = await node(
    'academic/school',
    'international',
    'International (IGCSE / IB)',
    {
      bookable: true,
      board: true,
      level: true,
      order: 2,
    }
  );
  const intlBoards = [await board('igcse', 'IGCSE'), await board('ib', 'IB')];
  const intlLevels = [
    await level('grade-9', 'Grade 9', 109),
    await level('grade-10', 'Grade 10', 110),
    await level('grade-11', 'Grade 11', 111),
    await level('grade-12', 'Grade 12', 112),
  ];
  await allow(international.id, intlLevels);
  await offer(
    international.id,
    [S.maths, S.physics, S.chemistry, S.biology, S.english, S.cs],
    intlBoards,
    intlLevels
  );

  const university = await prisma.category.findFirstOrThrow({
    where: { path: 'academic/university' },
  });
  await offer(
    university.id,
    [S.maths, S.physics, S.chemistry, S.cs, S.economics, S.accountancy, S.business, S.english],
    [null],
    (await levelsOf('academic/university')).map((l) => l.id)
  );

  const entrance = await prisma.category.findFirstOrThrow({ where: { path: 'academic/jee-neet' } });
  for (const l of await levelsOf('academic/jee-neet')) {
    const subjects =
      l.code === 'neet' ? [S.physics, S.chemistry, S.biology] : [S.physics, S.chemistry, S.maths];
    await offer(entrance.id, subjects, [null], [l.id]);
  }

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
    ]),
    [null],
    (await levelsOf('non-academic/research-skill')).map((l) => l.id)
  );

  const beginner = await level('beginner', 'Beginner', 1);
  const intermediate = await level('intermediate', 'Intermediate', 2);
  const advanced = await level('advanced', 'Advanced', 3);
  const coding = await node('non-academic', 'coding', 'Coding', {
    bookable: true,
    level: true,
    order: 2,
  });
  await allow(coding.id, [beginner, intermediate, advanced]);
  await offer(
    coding.id,
    await extra([
      ['python', 'Python'],
      ['web-development', 'Web Development'],
      ['java', 'Java'],
      ['data-structures', 'Data Structures'],
    ]),
    [null],
    [beginner, intermediate, advanced]
  );

  // Leaves that need neither a board nor a class: the student picks the skill only
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
      await offer(leaf.id, await extra(subjects), [null], [null]);
    }
  }
}
