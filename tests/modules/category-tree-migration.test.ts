import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { config } from '@config/index';

/**
 * ADR-0005 migration test on a scratch database: the legacy fixture is migrated with the
 * expand and contract migrations, verified, then rolled back with both rollback scripts
 * and compared with the starting point. Also checks that a failed verification aborts
 * the expand migration without changing anything.
 */
const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'prisma/migrations');
const EXPAND = '20261102090000_category_tree_expand';
const CONTRACT = '20261102100000_category_tree_contract';
const sql = (file: string) => fs.readFileSync(file, 'utf8');
const migrationSql = (name: string) => sql(path.join(MIGRATIONS, name, 'migration.sql'));
const rollbackSql = (name: string) => sql(path.join(ROOT, 'prisma/rollbacks', `${name}.down.sql`));

const scratchName = `amentorz_test_ctm_${randomUUID().slice(0, 8)}`;
const serverUrl = new URL(config.databaseUrl);
serverUrl.search = '';
const urlFor = (db: string) => {
  const u = new URL(serverUrl);
  u.pathname = `/${db}`;
  return u.toString();
};

async function withClient<T>(db: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urlFor(db) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function applyMigration(c: Client, name: string): Promise<void> {
  await c.query(
    `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at)
                 VALUES ($1, 'test', $2, clock_timestamp())`,
    [randomUUID(), name]
  );
  await c.query(migrationSql(name));
  await c.query(`UPDATE "_prisma_migrations" SET finished_at = now() WHERE migration_name = $1`, [
    name,
  ]);
}

async function freshLegacyDatabase(): Promise<void> {
  await withClient('postgres', async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${scratchName}`);
    await c.query(`CREATE DATABASE ${scratchName}`);
  });
  await withClient(scratchName, async (c) => {
    await c.query(`CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
      finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count int NOT NULL DEFAULT 0)`);
    const legacy = fs
      .readdirSync(MIGRATIONS)
      .filter((m) => /^\d/.test(m) && m < EXPAND)
      .sort();
    for (const name of legacy) await applyMigration(c, name);
    await c.query(sql(path.join(ROOT, 'tests/fixtures/category-tree-legacy.sql')));
  });
}

/** Structure and data fingerprint, to prove a rollback restores the starting point. */
async function fingerprint(c: Client): Promise<{ schema: string; data: string }> {
  const schema = await c.query(`
    SELECT 'col' AS k, table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS v
      FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL SELECT 'idx', indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = 'public'
    UNION ALL SELECT 'con', conrelid::regclass || '.' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION ALL SELECT 'trg', tgname FROM pg_trigger WHERE NOT tgisinternal
    UNION ALL SELECT 'fn', proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    ORDER BY 1, 2`);
  const data = await c.query(`
    SELECT (SELECT string_agg(id::text || code || name, ',' ORDER BY id) FROM categories) AS categories,
           (SELECT string_agg(id::text || category_id::text || coalesce(level_id::text, '-'), ',' ORDER BY id) FROM curricula) AS curricula,
           (SELECT string_agg(id::text || category_id::text, ',' ORDER BY id) FROM student_profiles) AS profiles,
           (SELECT string_agg(id::text || curriculum_id::text, ',' ORDER BY id) FROM price_rules) AS prices`);
  const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return { schema: hash(schema.rows), data: hash(data.rows) };
}

describe('Category tree migration (ADR-0005)', () => {
  beforeAll(async () => {
    await freshLegacyDatabase();
  }, 60_000);

  afterAll(async () => {
    await withClient('postgres', (c) =>
      c.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`)
    );
  });

  it('backfills, verifies, contracts and rolls back to the exact starting point', async () => {
    await withClient(scratchName, async (c) => {
      const before = await fingerprint(c);

      await applyMigration(c, EXPAND);
      const tree = await c.query(
        `SELECT id, path, depth, is_bookable, is_active FROM categories ORDER BY path`
      );
      expect(tree.rows.map((r) => [r.path, r.is_bookable])).toEqual([
        ['academic', false],
        ['academic/jee-neet', true],
        ['academic/school', false],
        ['academic/school/competitive', true],
        ['academic/school/general', true],
        ['academic/school/k-12', true],
        ['academic/university', true],
        ['non-academic', false],
        ['non-academic/research-skill', true],
      ]);
      // The draft sub-section is inactive and keeps its node id
      const competitive = tree.rows.find((r) => r.path === 'academic/school/competitive');
      expect(competitive).toMatchObject({
        id: '50000000-0000-4000-8000-000000000012',
        is_active: false,
      });

      const curricula = await c.query(
        `SELECT cu.id, c.path FROM curricula cu JOIN categories c ON c.id = cu.category_id ORDER BY cu.id`
      );
      expect(curricula.rows.map((r) => r.path)).toEqual([
        'academic/school/k-12',
        'academic/school/k-12',
        'academic/school/general',
        'academic/university',
        'non-academic/research-skill',
      ]);
      const profiles = await c.query(
        `SELECT sp.id, c.path FROM student_profiles sp JOIN categories c ON c.id = sp.category_id ORDER BY sp.id`
      );
      expect(profiles.rows.map((r) => r.path)).toEqual([
        'academic/school/k-12',
        'academic/university',
      ]);
      // Every curriculum's level is allowed on its leaf, including the unscoped "Beginner"
      const failures = await c.query(`SELECT * FROM category_tree_verify() WHERE failures > 0`);
      expect(failures.rows).toEqual([]);
      // Price rules keep their curriculum ids
      expect((await c.query(`SELECT curriculum_id FROM price_rules`)).rows[0].curriculum_id).toBe(
        '60000000-0000-4000-8000-000000000001'
      );

      await applyMigration(c, CONTRACT);
      await expect(
        c.query(`INSERT INTO curricula (category_id, subject_id, level_id, updated_at)
                 VALUES ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
                         '40000000-0000-4000-8000-000000000011', now())`)
      ).rejects.toThrow(/curricula_category_id_level_id_fkey/);
      // Without a level the FK is skipped, and the reference trigger refuses the branch
      await expect(
        c.query(`INSERT INTO curricula (category_id, board_id, subject_id, updated_at)
                 VALUES ((SELECT id FROM categories WHERE path = 'academic/school'), '20000000-0000-4000-8000-000000000001',
                         '30000000-0000-4000-8000-000000000001', now())`)
      ).rejects.toThrow(/CATEGORY_NOT_BOOKABLE/);

      await c.query(rollbackSql(CONTRACT));
      await c.query(rollbackSql(EXPAND));
      expect(await fingerprint(c)).toEqual(before);
    });
  }, 60_000);

  it('aborts the whole expand migration when a student cannot be placed on one leaf', async () => {
    await freshLegacyDatabase();
    await withClient(scratchName, async (c) => {
      // No subjects, and School will have three leaves: the migration cannot choose
      await c.query(`DELETE FROM student_subjects`);
      const before = await fingerprint(c);
      await expect(applyMigration(c, EXPAND)).rejects.toThrow(/profiles_not_on_bookable_leaf=1/);
      await c.query('ROLLBACK').catch(() => undefined);
      await c.query(`DELETE FROM "_prisma_migrations" WHERE migration_name = $1`, [EXPAND]);
      expect(await fingerprint(c)).toEqual(before);
    });
  }, 60_000);
});
