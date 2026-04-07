import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class RemoveTeamsFromSchema20260407_1700000000019 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropAssignmentTeamForeignKey(queryRunner);

    if (await queryRunner.hasColumn('assignments', 'teamId')) {
      await queryRunner.dropColumn('assignments', 'teamId');
    }

    if (await queryRunner.hasColumn('jobs', 'assignedTeamId')) {
      await queryRunner.dropColumn('jobs', 'assignedTeamId');
    }

    if (await queryRunner.hasColumn('users', 'teamId')) {
      await queryRunner.dropColumn('users', 'teamId');
    }

    if (await queryRunner.hasColumn('admin_settings', 'maxJobsPerTeamPerDay')) {
      await queryRunner.dropColumn('admin_settings', 'maxJobsPerTeamPerDay');
    }

    if (await queryRunner.hasTable('teams')) {
      await queryRunner.dropTable('teams');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('teams'))) {
      await queryRunner.createTable(
        new Table({
          name: 'teams',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              default:
                queryRunner.connection.options.type === 'postgres'
                  ? 'gen_random_uuid()'
                  : undefined,
            },
            {
              name: 'name',
              type: 'varchar',
              length: '100',
              isNullable: false,
              isUnique: true,
            },
            {
              name: 'dailyCapacityKw',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: false,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
          ],
        }),
      );
    }

    if (!(await queryRunner.hasColumn('users', 'teamId'))) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'teamId',
          type: 'uuid',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('jobs', 'assignedTeamId'))) {
      await queryRunner.addColumn(
        'jobs',
        new TableColumn({
          name: 'assignedTeamId',
          type: 'uuid',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('assignments', 'teamId'))) {
      await queryRunner.addColumn(
        'assignments',
        new TableColumn({
          name: 'teamId',
          type: 'uuid',
          isNullable: true,
        }),
      );
    }

    const assignmentsTable = await queryRunner.getTable('assignments');
    const hasAssignmentTeamForeignKey = assignmentsTable?.foreignKeys.some(
      (foreignKey) =>
        foreignKey.columnNames.length === 1 &&
        foreignKey.columnNames[0] === 'teamId',
    );

    if (
      !hasAssignmentTeamForeignKey &&
      (await queryRunner.hasTable('assignments'))
    ) {
      await queryRunner.createForeignKey(
        'assignments',
        new TableForeignKey({
          columnNames: ['teamId'],
          referencedTableName: 'teams',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }

    if (
      !(await queryRunner.hasColumn('admin_settings', 'maxJobsPerTeamPerDay'))
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'maxJobsPerTeamPerDay',
          type: 'int',
          isNullable: false,
          default: 2,
        }),
      );
    }
  }

  private async dropAssignmentTeamForeignKey(
    queryRunner: QueryRunner,
  ): Promise<void> {
    if (!(await queryRunner.hasTable('assignments'))) {
      return;
    }

    const assignmentsTable = await queryRunner.getTable('assignments');
    const teamForeignKey = assignmentsTable?.foreignKeys.find(
      (foreignKey) =>
        foreignKey.columnNames.length === 1 &&
        foreignKey.columnNames[0] === 'teamId',
    );

    if (teamForeignKey) {
      await queryRunner.dropForeignKey('assignments', teamForeignKey);
    }
  }
}
