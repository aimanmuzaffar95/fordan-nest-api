import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobIdToInvoicesTable20260320 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Use raw SQL to avoid TypeORM typings mismatches for addColumn(TableColumn).
    await queryRunner.query(
      'ALTER TABLE "invoices" ADD COLUMN "jobId" uuid NULL;',
    );
    await queryRunner.query(
      'ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_jobId_jobs" FOREIGN KEY ("jobId") REFERENCES "jobs"("id");',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_jobId_jobs";',
    );
    await queryRunner.query(
      'ALTER TABLE "invoices" DROP COLUMN IF EXISTS "jobId";',
    );
  }
}
