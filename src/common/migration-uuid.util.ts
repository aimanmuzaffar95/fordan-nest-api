import type { QueryRunner } from 'typeorm';

/**
 * UUID column spec for migrations, resolved against the database being
 * migrated rather than assumed.
 *
 * Two production realities force this:
 *
 * 1. **Type.** Production runs MariaDB 10.6, which has no native `uuid` type
 *    (that landed in 10.7), and its schema stores every id as `varchar(36)` —
 *    the convention TypeORM used when the database was first built. Declaring
 *    `type: 'uuid'` fails outright on 10.6 and, on 10.7+, creates a *native*
 *    uuid column whose foreign keys to the existing `varchar(36)` primary keys
 *    are rejected with errno 150.
 *
 * 2. **Charset.** Production's tables are `latin1` (the server default when
 *    they were created) while the database default is now `utf8mb4`. MySQL
 *    requires both sides of a foreign key to share a charset and collation, so
 *    a new utf8mb4 `varchar(36)` referencing a latin1 `jobs.id` is also
 *    rejected with errno 150.
 *
 * Hardcoding `latin1` would fix production and break every fresh install
 * (where the targets really are utf8mb4), so the charset is read from an
 * existing id column instead. `users.id` is the probe: it is present in every
 * install and is a foreign-key target for most of the new tables.
 *
 * Only the id columns inherit this charset — the surrounding text columns keep
 * the database default, so task titles, survey notes and SMS bodies still get
 * full utf8mb4 rather than being narrowed to latin1.
 */
export type UuidColumnSpec =
  | { type: 'uuid' }
  | {
      type: 'varchar';
      length: '36';
      charset?: string;
      collation?: string;
    };

type CharsetRow = { cs: string | null; co: string | null };

export async function resolveUuidColumn(
  queryRunner: QueryRunner,
): Promise<UuidColumnSpec> {
  if (queryRunner.connection.options.type === 'postgres') {
    return { type: 'uuid' };
  }

  let cs: string | null = null;
  let co: string | null = null;
  try {
    const rows = (await queryRunner.query(
      `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS co
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'users'
          AND column_name = 'id'
        LIMIT 1`,
    )) as CharsetRow[] | undefined;
    cs = rows?.[0]?.cs ?? null;
    co = rows?.[0]?.co ?? null;
  } catch {
    // No probe available (brand-new database) — fall through to the server
    // default, which is correct when there is nothing to match.
  }

  return {
    type: 'varchar',
    length: '36',
    ...(cs ? { charset: cs } : {}),
    ...(co ? { collation: co } : {}),
  };
}
