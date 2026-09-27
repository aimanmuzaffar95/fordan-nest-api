import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * `proposal_versions.updatedAt` is now doubling as an optimistic-concurrency
 * fencing token (`JobProposalSendService`'s `claimVersionForSend` /
 * `releaseClaim` / the send-finalize transaction — see that class's doc
 * comment). The fencing check reads `updatedAt` back into a JS `Date`
 * (millisecond precision) and later compares it with `WHERE "updatedAt" =
 * :token`. The column's previous default precision (6 — microseconds on
 * Postgres, `datetime(6)` on MariaDB) silently gets truncated on every read
 * into a `Date`, so the round-tripped value essentially never equality-
 * matches the row it came from — the fence would reject *every* finalize,
 * not just genuinely contended ones. Narrowing the column to millisecond
 * precision (3) is what `Date` can actually represent exactly, so a value
 * read then written back always matches itself.
 *
 * Purely a precision narrowing on an existing housekeeping timestamp column
 * — no data is dropped that anything in this codebase reads (nothing
 * depends on sub-millisecond `updatedAt` resolution), and existing values
 * are truncated in place by the `ALTER`, not rewritten wholesale.
 *
 * `DATABASE_SYNCHRONIZE=true` applies this automatically on dev/staging.
 * Production has no `migration:run` path (schema is applied by hand) — run
 * this by hand there:
 *
 *   ALTER TABLE proposal_versions
 *     MODIFY COLUMN updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
 *       ON UPDATE CURRENT_TIMESTAMP(3);
 */
export class NarrowProposalVersionUpdatedAtPrecision20260821_1700000005001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('proposal_versions'))) {
      return;
    }
    const table = await queryRunner.getTable('proposal_versions');
    const column = table?.findColumnByName('updatedAt');
    if (!column || column.precision === 3) {
      return;
    }
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    await queryRunner.changeColumn(
      'proposal_versions',
      'updatedAt',
      new TableColumn({
        name: 'updatedAt',
        type: isPostgres ? 'timestamp' : 'datetime',
        precision: 3,
        isNullable: false,
        default: isPostgres ? 'now()' : 'CURRENT_TIMESTAMP(3)',
        onUpdate: isPostgres ? undefined : 'CURRENT_TIMESTAMP(3)',
      }),
    );
  }

  public async down(): Promise<void> {
    // Intentionally not reversed — going back to microsecond precision would
    // just reintroduce the fencing bug this migration exists to close, for
    // no benefit (nothing reads `updatedAt` at sub-millisecond resolution).
  }
}
