import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

type JobIdRow = {
  jobId: string;
};

export class MakeAssignmentTeamOptional20260329_1700000000017
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('assignments'))) return;
    if (!(await queryRunner.hasColumn('assignments', 'teamId'))) return;

    const table = await queryRunner.getTable('assignments');
    const teamIdColumn = table?.findColumnByName('teamId');
    if (!teamIdColumn || teamIdColumn.isNullable) return;

    await queryRunner.changeColumn(
      'assignments',
      'teamId',
      new TableColumn({
        name: 'teamId',
        type: 'uuid',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('assignments'))) return;
    if (!(await queryRunner.hasColumn('assignments', 'teamId'))) return;

    const table = await queryRunner.getTable('assignments');
    const teamIdColumn = table?.findColumnByName('teamId');
    if (!teamIdColumn || !teamIdColumn.isNullable) return;

    const dialect = queryRunner.connection.options.type;
    const assignmentsTable = this.escapeIdentifier('assignments', dialect);
    const jobsTable = this.escapeIdentifier('jobs', dialect);
    const jobIdColumn = this.escapeIdentifier('jobId', dialect);
    const teamIdColumnName = this.escapeIdentifier('teamId', dialect);
    const idColumn = this.escapeIdentifier('id', dialect);
    const assignedTeamIdColumn = this.escapeIdentifier('assignedTeamId', dialect);
    const assignedStaffUserIdColumn =
      this.escapeIdentifier('assignedStaffUserId', dialect);
    const scheduledDateColumn = this.escapeIdentifier('scheduledDate', dialect);
    const scheduledSlotColumn = this.escapeIdentifier('scheduledSlot', dialect);
    const installDateColumn = this.escapeIdentifier('installDate', dialect);

    const affectedJobRows = (await queryRunner.query(
      `SELECT DISTINCT ${jobIdColumn} AS "jobId" FROM ${assignmentsTable} WHERE ${teamIdColumnName} IS NULL`,
    )) as JobIdRow[];

    if (affectedJobRows.length > 0) {
      const ids = affectedJobRows.map((row) => row.jobId);
      const inClause = ids.map((id) => `'${id}'`).join(', ');
      await queryRunner.query(
        `UPDATE ${jobsTable}
         SET ${assignedTeamIdColumn} = NULL,
             ${assignedStaffUserIdColumn} = NULL,
             ${scheduledDateColumn} = NULL,
             ${scheduledSlotColumn} = NULL,
             ${installDateColumn} = NULL
         WHERE ${idColumn} IN (${inClause})`,
      );
      await queryRunner.query(
        `DELETE FROM ${assignmentsTable} WHERE ${teamIdColumnName} IS NULL`,
      );
    }

    await queryRunner.changeColumn(
      'assignments',
      'teamId',
      new TableColumn({
        name: 'teamId',
        type: 'uuid',
        isNullable: false,
      }),
    );
  }

  private escapeIdentifier(identifier: string, dialect: string) {
    if (dialect === 'postgres') {
      return `"${identifier}"`;
    }

    return `\`${identifier}\``;
  }
}
