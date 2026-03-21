import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class CreateTeamsAndOpsTables20260321_1700000000006 implements MigrationInterface {
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';
    const boolFalseDefault =
      dialect === 'mysql' || dialect === 'mariadb' ? '0' : 'false';
    const boolTrueDefault =
      dialect === 'mysql' || dialect === 'mariadb' ? '1' : 'true';

    return { dialect, uuidDefault, boolFalseDefault, boolTrueDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault, boolFalseDefault } =
      this.getDialectDefaults(queryRunner);

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (!(await queryRunner.hasTable('teams'))) {
      await queryRunner.createTable(
        new Table({
          name: 'teams',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
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
              default: '0',
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

    if (!(await queryRunner.hasTable('assignments'))) {
      await queryRunner.createTable(
        new Table({
          name: 'assignments',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            { name: 'teamId', type: 'uuid', isNullable: false },
            { name: 'staffUserId', type: 'uuid', isNullable: false },
            { name: 'scheduledDate', type: 'date', isNullable: false },
            { name: 'slot', type: 'varchar', length: '10', isNullable: false },
            {
              name: 'locked',
              type: 'boolean',
              isNullable: false,
              default: boolFalseDefault,
            },
            { name: 'lockedAt', type: 'timestamp', isNullable: true },
            { name: 'lockedByUserId', type: 'uuid', isNullable: true },
            { name: 'lockReason', type: 'text', isNullable: true },
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
          uniques: [
            {
              columnNames: ['staffUserId', 'scheduledDate', 'slot'],
            },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['teamId'],
              referencedTableName: 'teams',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['staffUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['lockedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('meter_applications'))) {
      await queryRunner.createTable(
        new Table({
          name: 'meter_applications',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            { name: 'type', type: 'varchar', length: '20', isNullable: false },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              isNullable: false,
            },
            { name: 'dateSubmitted', type: 'date', isNullable: false },
            { name: 'submittedByUserId', type: 'uuid', isNullable: false },
            { name: 'approvalDate', type: 'date', isNullable: true },
            { name: 'approvedByUserId', type: 'uuid', isNullable: true },
            { name: 'rejectedAt', type: 'date', isNullable: true },
            { name: 'rejectedByUserId', type: 'uuid', isNullable: true },
            { name: 'rejectionReason', type: 'text', isNullable: true },
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
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['submittedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['approvedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
            new TableForeignKey({
              columnNames: ['rejectedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('alerts'))) {
      await queryRunner.createTable(
        new Table({
          name: 'alerts',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            { name: 'type', type: 'varchar', length: '80', isNullable: false },
            {
              name: 'severity',
              type: 'varchar',
              length: '10',
              isNullable: false,
            },
            { name: 'message', type: 'text', isNullable: false },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
            { name: 'acknowledgedAt', type: 'timestamp', isNullable: true },
            { name: 'acknowledgedByUserId', type: 'uuid', isNullable: true },
            { name: 'resolvedAt', type: 'timestamp', isNullable: true },
            { name: 'resolvedByUserId', type: 'uuid', isNullable: true },
            {
              name: 'updatedAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['acknowledgedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
            new TableForeignKey({
              columnNames: ['resolvedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('files'))) {
      await queryRunner.createTable(
        new Table({
          name: 'files',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            {
              name: 'ownerType',
              type: 'varchar',
              length: '50',
              isNullable: false,
            },
            { name: 'ownerId', type: 'uuid', isNullable: false },
            { name: 'kind', type: 'varchar', length: '80', isNullable: false },
            {
              name: 'storageDriver',
              type: 'varchar',
              length: '20',
              isNullable: false,
              default: "'local'",
            },
            {
              name: 'storageKey',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'originalName',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'contentType',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            { name: 'sizeBytes', type: 'bigint', isNullable: true },
            { name: 'uploadedByUserId', type: 'uuid', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['uploadedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('notes'))) {
      await queryRunner.createTable(
        new Table({
          name: 'notes',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            { name: 'body', type: 'text', isNullable: false },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
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
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['createdByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('timeline_events'))) {
      await queryRunner.createTable(
        new Table({
          name: 'timeline_events',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            { name: 'type', type: 'varchar', length: '80', isNullable: false },
            { name: 'payload', type: 'json', isNullable: false },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['createdByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
        }),
      );
    }

    if (await queryRunner.hasTable('jobs')) {
      const jobColumns: Array<
        Pick<TableColumn, 'name' | 'type' | 'isNullable'>
      > = [
        { name: 'systemSizeKw', type: 'numeric', isNullable: false },
        { name: 'batterySizeKwh', type: 'numeric', isNullable: true },
        { name: 'etaCompletionDate', type: 'date', isNullable: true },
        { name: 'pipelineStage', type: 'varchar', isNullable: false },
        { name: 'installDate', type: 'date', isNullable: true },
        { name: 'assignedTeamId', type: 'uuid', isNullable: true },
        { name: 'assignedStaffUserId', type: 'uuid', isNullable: true },
        { name: 'scheduledDate', type: 'date', isNullable: true },
        { name: 'scheduledSlot', type: 'varchar', isNullable: true },
        { name: 'managerId', type: 'uuid', isNullable: true },
        { name: 'jobStatus', type: 'varchar', isNullable: true },
        { name: 'invoiceStatus', type: 'varchar', isNullable: true },
        { name: 'invoiceDate', type: 'date', isNullable: true },
        { name: 'invoiceDueDate', type: 'date', isNullable: true },
        { name: 'paidDate', type: 'date', isNullable: true },
      ];

      for (const c of jobColumns) {
        if (await queryRunner.hasColumn('jobs', c.name)) continue;

        if (c.name === 'systemSizeKw') {
          await queryRunner.addColumn(
            'jobs',
            new TableColumn({
              name: c.name,
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: false,
              default: '0',
            }),
          );
        } else if (c.name === 'batterySizeKwh') {
          await queryRunner.addColumn(
            'jobs',
            new TableColumn({
              name: c.name,
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            }),
          );
        } else if (c.name === 'pipelineStage') {
          await queryRunner.addColumn(
            'jobs',
            new TableColumn({
              name: c.name,
              type: 'varchar',
              length: '50',
              isNullable: false,
              default: "'lead'",
            }),
          );
        } else if (c.name === 'scheduledSlot') {
          await queryRunner.addColumn(
            'jobs',
            new TableColumn({
              name: c.name,
              type: 'varchar',
              length: '10',
              isNullable: true,
            }),
          );
        } else if (c.name === 'jobStatus' || c.name === 'invoiceStatus') {
          await queryRunner.addColumn(
            'jobs',
            new TableColumn({
              name: c.name,
              type: 'varchar',
              length: '50',
              isNullable: true,
            }),
          );
        } else {
          await queryRunner.addColumn(
            'jobs',
            new TableColumn({
              name: c.name,
              type: c.type,
              isNullable: c.isNullable ?? true,
            }),
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('timeline_events')) {
      await queryRunner.dropTable('timeline_events');
    }
    if (await queryRunner.hasTable('notes')) {
      await queryRunner.dropTable('notes');
    }
    if (await queryRunner.hasTable('files')) {
      await queryRunner.dropTable('files');
    }
    if (await queryRunner.hasTable('alerts')) {
      await queryRunner.dropTable('alerts');
    }
    if (await queryRunner.hasTable('meter_applications')) {
      await queryRunner.dropTable('meter_applications');
    }
    if (await queryRunner.hasTable('assignments')) {
      await queryRunner.dropTable('assignments');
    }
    if (await queryRunner.hasTable('teams')) {
      await queryRunner.dropTable('teams');
    }
  }
}
