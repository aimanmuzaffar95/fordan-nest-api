import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Root-cause fix for the recurring "fabricated $0 ROI on a customer-facing
 * PDF" defect (see `jobs/roof-proposal.service.ts`'s `resolveAgreedPrice`
 * header). Two creation paths coerced an absent price to `0` before
 * persisting it (`jobs.service.ts`'s `dto.projectPrice ?? 0`,
 * `proposals.service.ts`'s `String(dto.totalPrice ?? 0)`), which made "no
 * price was ever supplied" indistinguishable from "priced at $0" once it
 * hit the database. Both call sites now persist `null` for an absent price;
 * this migration makes the columns able to actually hold that.
 *
 * `jobs.projectPrice` was already `nullable: true` at the entity level (its
 * originating migration, `20260320-CreateJobsTable.ts`, predates that and
 * still marks it `isNullable: false` — this reconciles the schema with the
 * entity). `proposal_versions.totalPrice` was `NOT NULL DEFAULT 0`
 * (`20260803-CreatePhase2FieldAndProposal.ts`) and is now nullable with no
 * default.
 *
 * IMPORTANT — no backfill. Existing rows that hold `'0.00'` are NOT
 * retroactively converted to `NULL`: there is no way to tell, after the
 * fact, which of those were genuinely priced at zero and which were never
 * priced, and guessing would corrupt real records. Those rows are already
 * handled correctly by the `> 0` predicates in `jobs.service.ts`
 * (`hasProjectPrice`) and `roof-proposal.service.ts`
 * (`resolveAgreedPrice`), which treat a non-positive stored price as
 * "unpriced" regardless of whether it's `'0.00'` or `null`. Do not "tidy up"
 * old `0.00` rows to `null` later — it is not safe.
 */
export class MakePriceColumnsNullable20260819_1700000004001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('jobs')) {
      const jobsTable = await queryRunner.getTable('jobs');
      const projectPriceColumn = jobsTable?.findColumnByName('projectPrice');
      if (projectPriceColumn && !projectPriceColumn.isNullable) {
        await queryRunner.changeColumn(
          'jobs',
          'projectPrice',
          new TableColumn({
            name: 'projectPrice',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: true,
          }),
        );
      }
    }

    if (await queryRunner.hasTable('proposal_versions')) {
      const proposalVersionsTable =
        await queryRunner.getTable('proposal_versions');
      const totalPriceColumn =
        proposalVersionsTable?.findColumnByName('totalPrice');
      if (totalPriceColumn && !totalPriceColumn.isNullable) {
        await queryRunner.changeColumn(
          'proposal_versions',
          'totalPrice',
          new TableColumn({
            name: 'totalPrice',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: true,
          }),
        );
      }
    }
  }

  public async down(): Promise<void> {
    // Intentionally not reversed: reverting to NOT NULL DEFAULT 0 would
    // require deciding what to write into any `NULL` rows created since this
    // migration ran, which is exactly the ambiguity this migration exists to
    // remove. Additive-only.
  }
}
