import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * PRD v2 Phase 3 — the Opportunity/Project split and everything that hangs off
 * the delivery side: permits, install visits, defects, and the
 * inspection/interconnection/PTO milestones.
 *
 * Purely new tables. No existing column changes and no backfill: projects come
 * into existence when a contract is signed with the `projectSplit` flag on, so
 * in-flight jobs are unaffected until an operator chooses to enable it. The
 * roadmap's backfill of in-flight jobs is a separate, deliberate step.
 */
export class CreatePhase3ProjectExecution20260803_1700000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const json = isPostgres ? 'jsonb' : 'json';
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const projectFk = {
      columnNames: ['projectId'],
      referencedTableName: 'projects',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    };

    // ─── projects ─────────────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('projects'))) {
      await queryRunner.createTable(
        new Table({
          name: 'projects',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            // Unique: a job has at most one delivery project.
            { name: 'jobId', type: 'uuid', isUnique: true },
            {
              name: 'projectNumber',
              type: 'varchar',
              length: '50',
              isUnique: true,
            },
            { name: 'customerId', type: 'uuid' },
            {
              name: 'stage',
              type: 'varchar',
              length: '30',
              default: "'initiated'",
            },
            {
              name: 'siteAddress',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'systemSizeKw',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'batterySizeKwh',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'contractValue',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            { name: 'contractSignedAt', type: ts, isNullable: true },
            { name: 'projectManagerUserId', type: 'uuid', isNullable: true },
            { name: 'targetInstallDate', type: 'date', isNullable: true },
            { name: 'actualInstallDate', type: 'date', isNullable: true },
            { name: 'targetPtoDate', type: 'date', isNullable: true },
            { name: 'actualPtoDate', type: 'date', isNullable: true },
            { name: 'completedAt', type: ts, isNullable: true },
            { name: 'readinessChecklist', type: json, isNullable: true },
            { name: 'readinessConfirmedAt', type: ts, isNullable: true },
            {
              name: 'readinessConfirmedByUserId',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'holdReason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'heldAt', type: ts, isNullable: true },
            { name: 'notes', type: 'text', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [
            {
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
        }),
      );
      for (const index of [
        { name: 'idx_projects_stage', columnNames: ['stage'] },
        { name: 'idx_projects_customer', columnNames: ['customerId'] },
      ]) {
        await queryRunner.createIndex('projects', new TableIndex(index));
      }
    }

    // ─── permits ──────────────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('permits'))) {
      await queryRunner.createTable(
        new Table({
          name: 'permits',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'projectId', type: 'uuid' },
            { name: 'permitType', type: 'varchar', length: '60' },
            { name: 'authorityName', type: 'varchar', length: '160' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'not_started'",
            },
            {
              name: 'referenceNumber',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            { name: 'targetSubmissionDate', type: 'date', isNullable: true },
            { name: 'submittedDate', type: 'date', isNullable: true },
            { name: 'targetApprovalDate', type: 'date', isNullable: true },
            { name: 'approvedDate', type: 'date', isNullable: true },
            { name: 'expiryDate', type: 'date', isNullable: true },
            { name: 'revisionCount', type: 'int', default: 0 },
            { name: 'revisionNotes', type: 'text', isNullable: true },
            {
              name: 'rejectionReason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            {
              name: 'feeAmount',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            { name: 'stalledAlertSentAt', type: ts, isNullable: true },
            { name: 'notes', type: 'text', isNullable: true },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [projectFk],
        }),
      );
      for (const index of [
        { name: 'idx_permits_project', columnNames: ['projectId'] },
        { name: 'idx_permits_status', columnNames: ['status'] },
      ]) {
        await queryRunner.createIndex('permits', new TableIndex(index));
      }
    }

    // ─── project_milestones ───────────────────────────────────────────────
    if (!(await queryRunner.hasTable('project_milestones'))) {
      await queryRunner.createTable(
        new Table({
          name: 'project_milestones',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'projectId', type: 'uuid' },
            { name: 'type', type: 'varchar', length: '20' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'not_started'",
            },
            {
              name: 'authorityName',
              type: 'varchar',
              length: '160',
              isNullable: true,
            },
            {
              name: 'referenceNumber',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            { name: 'targetDate', type: 'date', isNullable: true },
            { name: 'scheduledAt', type: ts, isNullable: true },
            { name: 'completedDate', type: 'date', isNullable: true },
            { name: 'correctionList', type: 'text', isNullable: true },
            { name: 'attemptNumber', type: 'int', default: 1 },
            { name: 'notes', type: 'text', isNullable: true },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [projectFk],
        }),
      );
      for (const index of [
        { name: 'idx_project_milestones_project', columnNames: ['projectId'] },
        {
          name: 'idx_project_milestones_type_status',
          columnNames: ['type', 'status'],
        },
      ]) {
        await queryRunner.createIndex(
          'project_milestones',
          new TableIndex(index),
        );
      }
    }

    // ─── install_visits ───────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('install_visits'))) {
      await queryRunner.createTable(
        new Table({
          name: 'install_visits',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'projectId', type: 'uuid' },
            { name: 'visitNumber', type: 'int', default: 1 },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'scheduled'",
            },
            { name: 'scheduledDate', type: 'date', isNullable: true },
            { name: 'startedAt', type: ts, isNullable: true },
            { name: 'completedAt', type: ts, isNullable: true },
            { name: 'crewUserIds', type: json, isNullable: true },
            { name: 'leadInstallerUserId', type: 'uuid', isNullable: true },
            { name: 'completionPercent', type: 'int', isNullable: true },
            { name: 'outstandingWork', type: 'text', isNullable: true },
            {
              name: 'abortReason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'notes', type: 'text', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [projectFk],
        }),
      );
      for (const index of [
        { name: 'idx_install_visits_project', columnNames: ['projectId'] },
        { name: 'idx_install_visits_status', columnNames: ['status'] },
      ]) {
        await queryRunner.createIndex('install_visits', new TableIndex(index));
      }
    }

    // ─── install_defects ──────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('install_defects'))) {
      await queryRunner.createTable(
        new Table({
          name: 'install_defects',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'projectId', type: 'uuid' },
            { name: 'installVisitId', type: 'uuid', isNullable: true },
            { name: 'title', type: 'varchar', length: '200' },
            { name: 'description', type: 'text', isNullable: true },
            {
              name: 'severity',
              type: 'varchar',
              length: '20',
              default: "'minor'",
            },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'open'",
            },
            { name: 'reportedByUserId', type: 'uuid', isNullable: true },
            { name: 'assignedUserId', type: 'uuid', isNullable: true },
            { name: 'resolvedAt', type: ts, isNullable: true },
            { name: 'resolvedByUserId', type: 'uuid', isNullable: true },
            { name: 'resolutionNotes', type: 'text', isNullable: true },
            {
              name: 'waiverReason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'photoFileIds', type: json, isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
        }),
      );
      for (const index of [
        { name: 'idx_install_defects_project', columnNames: ['projectId'] },
        { name: 'idx_install_defects_status', columnNames: ['status'] },
      ]) {
        await queryRunner.createIndex('install_defects', new TableIndex(index));
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'install_defects',
      'install_visits',
      'project_milestones',
      'permits',
      'projects',
    ]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
