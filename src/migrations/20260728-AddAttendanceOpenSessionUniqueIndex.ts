import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-ATTEND-03: prevent concurrent double clock-in.
 *
 * Clock-in was a check-then-insert with no lock and no DB invariant, so two
 * concurrent requests could both pass the "any open session?" check and insert
 * two un-clocked-out records for the same staff member. This adds a PARTIAL
 * UNIQUE index enforcing at most one open (clockOutAt IS NULL) attendance
 * record per staff. The service now catches the resulting 23505 and maps it to
 * the existing 409 "already clocked in" response.
 *
 * Idempotent:
 *  - existing duplicate open sessions (produced by the pre-fix race) are closed
 *    first (older ones get clockOutAt = clockInAt) so the unique index can be
 *    built; without this, CREATE UNIQUE INDEX would fail on legacy data.
 *  - CREATE UNIQUE INDEX IF NOT EXISTS makes re-runs safe.
 */
export class AddAttendanceOpenSessionUniqueIndex20260728_1700000001000
  implements MigrationInterface
{
  private readonly indexName = 'uq_attendance_open_session_per_staff';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('attendance_records'))) {
      return;
    }

    // Close pre-existing duplicate open sessions, keeping the most recent open
    // record per staff so the partial-unique index below can be created.
    await queryRunner.query(`
      UPDATE "attendance_records" AS a
      SET "clockOutAt" = a."clockInAt"
      FROM (
        SELECT "id",
               ROW_NUMBER() OVER (
                 PARTITION BY "staffId"
                 ORDER BY "clockInAt" DESC, "id" DESC
               ) AS rn
        FROM "attendance_records"
        WHERE "clockOutAt" IS NULL
      ) AS ranked
      WHERE a."id" = ranked."id" AND ranked.rn > 1
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${this.indexName}"
      ON "attendance_records" ("staffId")
      WHERE "clockOutAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('attendance_records'))) {
      return;
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "${this.indexName}"`);
  }
}
