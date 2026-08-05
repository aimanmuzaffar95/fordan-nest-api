import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The mobile offline queue replays a capture with a stable `clientRequestId`
 * so the replay is idempotent. That was enforced only by a read-then-insert in
 * `SurveysService`, which is check-then-act: eight concurrent replays of one id
 * created two rows. This constraint is what actually makes it idempotent.
 *
 * Postgres gets a partial unique index so the many legacy `NULL`
 * `clientRequestId` rows are unaffected. MariaDB/MySQL have no partial indexes,
 * but they allow repeated `NULL`s in a unique index, which gives the same
 * behaviour from a plain one.
 */
export class AddSiteSurveyClientRequestUniqueIndex20260804_1700000001800 implements MigrationInterface {
  private readonly index = 'uq_site_surveys_job_client_request';
  private readonly table = 'site_surveys';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.table))) return;

    const isPostgres = queryRunner.connection.options.type === 'postgres';

    // Collapse any duplicates already stored, oldest row wins, or the index
    // cannot be created.
    await queryRunner.query(
      isPostgres
        ? `DELETE FROM "${this.table}" a
             USING "${this.table}" b
            WHERE a."clientRequestId" IS NOT NULL
              AND a."clientRequestId" = b."clientRequestId"
              AND a."jobId" = b."jobId"
              AND a."createdAt" > b."createdAt"`
        : `DELETE a FROM \`${this.table}\` a
             JOIN \`${this.table}\` b
               ON a.\`clientRequestId\` = b.\`clientRequestId\`
              AND a.\`jobId\` = b.\`jobId\`
              AND a.\`createdAt\` > b.\`createdAt\`
            WHERE a.\`clientRequestId\` IS NOT NULL`,
    );

    await queryRunner.query(
      isPostgres
        ? `CREATE UNIQUE INDEX IF NOT EXISTS "${this.index}"
             ON "${this.table}" ("jobId", "clientRequestId")
             WHERE "clientRequestId" IS NOT NULL`
        : `CREATE UNIQUE INDEX \`${this.index}\`
             ON \`${this.table}\` (\`jobId\`, \`clientRequestId\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.table))) return;

    await queryRunner.query(
      queryRunner.connection.options.type === 'postgres'
        ? `DROP INDEX IF EXISTS "${this.index}"`
        : `DROP INDEX \`${this.index}\` ON \`${this.table}\``,
    );
  }
}
