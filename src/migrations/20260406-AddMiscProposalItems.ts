import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMiscProposalItems20260406_1700000000018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('job_proposal_selections'))) return;
    if (
      !(await queryRunner.hasColumn('job_proposal_selections', 'equipmentType'))
    ) {
      return;
    }

    const dialect = queryRunner.connection.options.type;

    if (dialect === 'postgres') {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type enum_type
            INNER JOIN pg_enum enum_value ON enum_value.enumtypid = enum_type.oid
            WHERE enum_type.typname = 'job_proposal_selections_equipmenttype_enum'
              AND enum_value.enumlabel = 'misc'
          ) THEN
            ALTER TYPE "job_proposal_selections_equipmenttype_enum" ADD VALUE 'misc';
          END IF;
        END $$;
      `);
      return;
    }

    await queryRunner.changeColumn(
      'job_proposal_selections',
      'equipmentType',
      new TableColumn({
        name: 'equipmentType',
        type: 'enum',
        enum: ['panel', 'inverter', 'battery', 'misc'],
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('job_proposal_selections'))) return;
    if (
      !(await queryRunner.hasColumn('job_proposal_selections', 'equipmentType'))
    ) {
      return;
    }

    const dialect = queryRunner.connection.options.type;

    if (dialect === 'postgres') {
      await queryRunner.query(
        `DELETE FROM "job_proposal_selections" WHERE "equipmentType" = 'misc'`,
      );
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_type
            WHERE typname = 'job_proposal_selections_equipmenttype_enum'
          ) THEN
            ALTER TYPE "job_proposal_selections_equipmenttype_enum" RENAME TO "job_proposal_selections_equipmenttype_enum_old";
            CREATE TYPE "job_proposal_selections_equipmenttype_enum" AS ENUM ('panel', 'inverter', 'battery');
            ALTER TABLE "job_proposal_selections"
              ALTER COLUMN "equipmentType" TYPE "job_proposal_selections_equipmenttype_enum"
              USING "equipmentType"::text::"job_proposal_selections_equipmenttype_enum";
            DROP TYPE "job_proposal_selections_equipmenttype_enum_old";
          END IF;
        END $$;
      `);
      return;
    }

    await queryRunner.changeColumn(
      'job_proposal_selections',
      'equipmentType',
      new TableColumn({
        name: 'equipmentType',
        type: 'enum',
        enum: ['panel', 'inverter', 'battery'],
        isNullable: false,
      }),
    );
  }
}
