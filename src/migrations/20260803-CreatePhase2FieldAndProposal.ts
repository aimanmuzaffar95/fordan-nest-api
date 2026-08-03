import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * PRD v2 Phase 2 — site surveys, proposal versions, financing applications,
 * and the document taxonomy columns on `files`.
 *
 * Additive only. `files` gains nullable classification columns plus
 * `isCurrentVersion` defaulted to true, so every existing upload keeps
 * behaving as the current copy of an uncategorised document.
 */
export class CreatePhase2FieldAndProposal20260803_1700000001900 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const json = isPostgres ? 'jsonb' : 'json';
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const jobFk = {
      columnNames: ['jobId'],
      referencedTableName: 'jobs',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    };

    // ─── site_surveys ─────────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('site_surveys'))) {
      await queryRunner.createTable(
        new Table({
          name: 'site_surveys',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'jobId', type: 'uuid' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'scheduled'",
            },
            {
              name: 'outcome',
              type: 'varchar',
              length: '30',
              isNullable: true,
            },
            { name: 'assignedUserId', type: 'uuid', isNullable: true },
            { name: 'scheduledAt', type: ts, isNullable: true },
            { name: 'startedAt', type: ts, isNullable: true },
            { name: 'completedAt', type: ts, isNullable: true },
            { name: 'completedByUserId', type: 'uuid', isNullable: true },
            {
              name: 'roofType',
              type: 'varchar',
              length: '30',
              isNullable: true,
            },
            { name: 'roofAgeYears', type: 'int', isNullable: true },
            { name: 'roofPitchDegrees', type: 'int', isNullable: true },
            { name: 'roofOrientationDegrees', type: 'int', isNullable: true },
            { name: 'storeys', type: 'int', isNullable: true },
            {
              name: 'usableRoofAreaSqm',
              type: 'numeric',
              precision: 10,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'roofConditionAcceptable',
              type: 'boolean',
              isNullable: true,
            },
            {
              name: 'shadingLevel',
              type: 'varchar',
              length: '20',
              isNullable: true,
            },
            { name: 'shadingNotes', type: 'text', isNullable: true },
            {
              name: 'phaseType',
              type: 'varchar',
              length: '20',
              isNullable: true,
            },
            {
              name: 'switchboardUpgradeRequired',
              type: 'boolean',
              isNullable: true,
            },
            { name: 'switchboardNotes', type: 'text', isNullable: true },
            { name: 'mainSwitchRatingAmps', type: 'int', isNullable: true },
            { name: 'cableRunMetres', type: 'int', isNullable: true },
            {
              name: 'accessDifficulty',
              type: 'varchar',
              length: '20',
              isNullable: true,
            },
            { name: 'scaffoldRequired', type: 'boolean', isNullable: true },
            { name: 'craneRequired', type: 'boolean', isNullable: true },
            { name: 'accessNotes', type: 'text', isNullable: true },
            { name: 'outcomeNotes', type: 'text', isNullable: true },
            {
              name: 'remediationCost',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            { name: 'photoFileIds', type: json, isNullable: true },
            { name: 'extra', type: json, isNullable: true },
            {
              name: 'clientRequestId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [jobFk],
        }),
      );
      await queryRunner.createIndex(
        'site_surveys',
        new TableIndex({
          name: 'idx_site_surveys_job',
          columnNames: ['jobId'],
        }),
      );
      await queryRunner.createIndex(
        'site_surveys',
        new TableIndex({
          name: 'idx_site_surveys_status',
          columnNames: ['status'],
        }),
      );
    }

    // ─── proposal_versions ────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('proposal_versions'))) {
      await queryRunner.createTable(
        new Table({
          name: 'proposal_versions',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'jobId', type: 'uuid' },
            { name: 'versionNumber', type: 'int' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'draft'",
            },
            {
              name: 'pricingMode',
              type: 'varchar',
              length: '10',
              default: "'cash'",
            },
            {
              name: 'totalPrice',
              type: 'numeric',
              precision: 12,
              scale: 2,
              default: 0,
            },
            {
              name: 'depositAmount',
              type: 'numeric',
              precision: 12,
              scale: 2,
              default: 0,
            },
            {
              name: 'rebateAmount',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'interestRatePercent',
              type: 'numeric',
              precision: 6,
              scale: 3,
              isNullable: true,
            },
            { name: 'termMonths', type: 'int', isNullable: true },
            {
              name: 'monthlyPayment',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'ppaRatePerKwh',
              type: 'numeric',
              precision: 8,
              scale: 4,
              isNullable: true,
            },
            { name: 'lineItemsSnapshot', type: json, isNullable: true },
            { name: 'systemSnapshot', type: json, isNullable: true },
            { name: 'notes', type: 'text', isNullable: true },
            { name: 'sentAt', type: ts, isNullable: true },
            { name: 'sentByUserId', type: 'uuid', isNullable: true },
            {
              name: 'sentToEmail',
              type: 'varchar',
              length: '320',
              isNullable: true,
            },
            { name: 'firstViewedAt', type: ts, isNullable: true },
            { name: 'lastViewedAt', type: ts, isNullable: true },
            { name: 'viewCount', type: 'int', default: 0 },
            { name: 'expiresAt', type: ts, isNullable: true },
            { name: 'acceptedAt', type: ts, isNullable: true },
            { name: 'declinedAt', type: ts, isNullable: true },
            {
              name: 'declineReason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          // The unique index is the real concurrency guard for version numbers.
          uniques: [
            {
              name: 'uq_proposal_version_job_number',
              columnNames: ['jobId', 'versionNumber'],
            },
          ],
          foreignKeys: [jobFk],
        }),
      );
      await queryRunner.createIndex(
        'proposal_versions',
        new TableIndex({
          name: 'idx_proposal_versions_job',
          columnNames: ['jobId'],
        }),
      );
      await queryRunner.createIndex(
        'proposal_versions',
        new TableIndex({
          name: 'idx_proposal_versions_status',
          columnNames: ['status'],
        }),
      );
    }

    // ─── financing_applications ───────────────────────────────────────────
    if (!(await queryRunner.hasTable('financing_applications'))) {
      await queryRunner.createTable(
        new Table({
          name: 'financing_applications',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'jobId', type: 'uuid' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'intent'",
            },
            { name: 'lenderName', type: 'varchar', length: '120' },
            {
              name: 'productName',
              type: 'varchar',
              length: '120',
              isNullable: true,
            },
            {
              name: 'externalReference',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            {
              name: 'requestedAmount',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'approvedAmount',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'interestRatePercent',
              type: 'numeric',
              precision: 6,
              scale: 3,
              isNullable: true,
            },
            { name: 'termMonths', type: 'int', isNullable: true },
            {
              name: 'monthlyPayment',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            { name: 'submittedAt', type: ts, isNullable: true },
            { name: 'decisionAt', type: ts, isNullable: true },
            { name: 'approvalExpiresAt', type: ts, isNullable: true },
            { name: 'settledAt', type: ts, isNullable: true },
            {
              name: 'declineReason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'outstandingRequirements', type: 'text', isNullable: true },
            { name: 'notes', type: 'text', isNullable: true },
            { name: 'expiryReminderSentAt', type: ts, isNullable: true },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [jobFk],
        }),
      );
      for (const index of [
        { name: 'idx_financing_job', columnNames: ['jobId'] },
        { name: 'idx_financing_status', columnNames: ['status'] },
        { name: 'idx_financing_expiry', columnNames: ['approvalExpiresAt'] },
      ]) {
        await queryRunner.createIndex(
          'financing_applications',
          new TableIndex(index),
        );
      }
    }

    // ─── admin_settings.documentTaxonomy ──────────────────────────────────
    if (
      (await queryRunner.hasTable('admin_settings')) &&
      !(await queryRunner.hasColumn('admin_settings', 'documentTaxonomy'))
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'documentTaxonomy',
          type: json,
          isNullable: true,
        }),
      );
    }

    // ─── files: taxonomy columns ──────────────────────────────────────────
    if (!(await queryRunner.hasTable('files'))) return;
    const fileColumns = [
      new TableColumn({
        name: 'categoryId',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({ name: 'tags', type: json, isNullable: true }),
      new TableColumn({
        name: 'versionNumber',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'isCurrentVersion',
        type: 'boolean',
        isNullable: false,
        default: true,
      }),
    ];
    for (const column of fileColumns) {
      if (await queryRunner.hasColumn('files', column.name)) continue;
      await queryRunner.addColumn('files', column);
    }

    const filesTable = await queryRunner.getTable('files');
    if (
      !filesTable?.indices.some((i) => i.name === 'idx_files_owner_category')
    ) {
      await queryRunner.createIndex(
        'files',
        new TableIndex({
          name: 'idx_files_owner_category',
          columnNames: ['ownerId', 'categoryId'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('files')) {
      for (const name of [
        'categoryId',
        'tags',
        'versionNumber',
        'isCurrentVersion',
      ]) {
        if (await queryRunner.hasColumn('files', name)) {
          await queryRunner.dropColumn('files', name);
        }
      }
    }
    if (
      (await queryRunner.hasTable('admin_settings')) &&
      (await queryRunner.hasColumn('admin_settings', 'documentTaxonomy'))
    ) {
      await queryRunner.dropColumn('admin_settings', 'documentTaxonomy');
    }
    for (const table of [
      'financing_applications',
      'proposal_versions',
      'site_surveys',
    ]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
