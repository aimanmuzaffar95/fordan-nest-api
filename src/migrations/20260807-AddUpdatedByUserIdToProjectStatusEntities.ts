import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * `updatedByUserId` on the four project status-bearing tables.
 *
 * The project History timeline could say who *created* a permit/milestone
 * (`createdByUserId`) but not who last *changed its status* — exactly what an
 * operator audits ("PTO milestone → Passed", "Install visit #1 →
 * Completed"). Set from the authenticated principal on every status mutation
 * (never client-supplied); existing rows get `NULL`, which the client already
 * renders as an honest unresolved actor.
 */
export class AddUpdatedByUserIdToProjectStatusEntities20260807_1700000002300 implements MigrationInterface {
  private readonly targets = [
    {
      table: 'project_milestones',
      fk: 'FK_project_milestones_updatedByUserId_users',
    },
    { table: 'permits', fk: 'FK_permits_updatedByUserId_users' },
    { table: 'install_visits', fk: 'FK_install_visits_updatedByUserId_users' },
    {
      table: 'install_defects',
      fk: 'FK_install_defects_updatedByUserId_users',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const uuidCol = await resolveUuidColumn(queryRunner);

    for (const { table, fk } of this.targets) {
      if (!(await queryRunner.hasTable(table))) continue;
      if (await queryRunner.hasColumn(table, 'updatedByUserId')) continue;

      await queryRunner.addColumn(
        table,
        new TableColumn({
          name: 'updatedByUserId',
          ...uuidCol,
          isNullable: true,
        }),
      );

      await queryRunner.createForeignKey(
        table,
        new TableForeignKey({
          name: fk,
          columnNames: ['updatedByUserId'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, fk } of this.targets) {
      if (!(await queryRunner.hasTable(table))) continue;
      if (!(await queryRunner.hasColumn(table, 'updatedByUserId'))) continue;

      const tableRef = await queryRunner.getTable(table);
      const existingFk =
        tableRef?.foreignKeys.find((f) => f.name === fk) ??
        tableRef?.foreignKeys.find((f) =>
          f.columnNames.includes('updatedByUserId'),
        );
      if (existingFk) {
        await queryRunner.dropForeignKey(table, existingFk);
      }
      await queryRunner.dropColumn(table, 'updatedByUserId');
    }
  }
}
