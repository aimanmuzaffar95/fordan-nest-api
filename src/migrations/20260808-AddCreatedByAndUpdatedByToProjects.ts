import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * `createdByUserId`/`updatedByUserId` on `projects`, mirroring the pattern
 * already applied to `project_milestones`, `permits`, `install_visits` and
 * `install_defects` (see `20260807-AddUpdatedByUserIdToProjectStatusEntities`).
 *
 * The project History timeline could never name a person for "Project
 * created", "Project put on hold" or "Project marked completed" — those rows
 * were permanently anonymous. `createdByUserId` is set from the user whose
 * action (signing the contract) triggered `createFromSignedJob`; null for
 * projects created before this column existed or by a system-triggered path
 * with no principal. `updatedByUserId` is set on every `stage` mutation.
 */
export class AddCreatedByAndUpdatedByToProjects20260808_1700000002400 implements MigrationInterface {
  private readonly table = 'projects';
  private readonly columns = [
    {
      name: 'createdByUserId',
      fk: 'FK_projects_createdByUserId_users',
    },
    {
      name: 'updatedByUserId',
      fk: 'FK_projects_updatedByUserId_users',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.table))) return;
    const uuidCol = await resolveUuidColumn(queryRunner);

    for (const { name, fk } of this.columns) {
      if (await queryRunner.hasColumn(this.table, name)) continue;

      await queryRunner.addColumn(
        this.table,
        new TableColumn({
          name,
          ...uuidCol,
          isNullable: true,
        }),
      );

      await queryRunner.createForeignKey(
        this.table,
        new TableForeignKey({
          name: fk,
          columnNames: [name],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.table))) return;

    for (const { name, fk } of this.columns) {
      if (!(await queryRunner.hasColumn(this.table, name))) continue;

      const tableRef = await queryRunner.getTable(this.table);
      const existingFk =
        tableRef?.foreignKeys.find((f) => f.name === fk) ??
        tableRef?.foreignKeys.find((f) => f.columnNames.includes(name));
      if (existingFk) {
        await queryRunner.dropForeignKey(this.table, existingFk);
      }
      await queryRunner.dropColumn(this.table, name);
    }
  }
}
