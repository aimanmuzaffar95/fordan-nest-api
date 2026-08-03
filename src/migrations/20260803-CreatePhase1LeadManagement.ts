import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * PRD v2 Phase 1 — territories + routing audit, qualification fields, and
 * household matching/merge.
 *
 * Everything is additive: new tables plus nullable columns on `customers`.
 * Existing rows keep working with `qualificationStatus` defaulted to
 * `unqualified` and a null household key (recomputed lazily, or in bulk via
 * `POST /customers/household-keys/backfill`).
 */
export class CreatePhase1LeadManagement20260803_1700000001800 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const json = isPostgres ? 'jsonb' : 'json';
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};

    // ─── territories ──────────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('territories'))) {
      await queryRunner.createTable(
        new Table({
          name: 'territories',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'name', type: 'varchar', length: '120' },
            { name: 'description', type: 'text', isNullable: true },
            { name: 'postcodes', type: json, isNullable: true },
            { name: 'regions', type: json, isNullable: true },
            {
              name: 'routingStrategy',
              type: 'varchar',
              length: '30',
              default: "'round_robin'",
            },
            { name: 'ownerUserId', type: 'uuid', isNullable: true },
            { name: 'reassignAfterHours', type: 'int', isNullable: true },
            { name: 'rotationCursor', type: 'int', default: 0 },
            { name: 'active', type: 'boolean', default: true },
            { name: 'priority', type: 'int', default: 100 },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
            { name: 'deletedAt', type: ts, isNullable: true },
          ],
        }),
      );
      await queryRunner.createIndex(
        'territories',
        new TableIndex({
          name: 'idx_territories_active',
          columnNames: ['active'],
        }),
      );
    }

    // ─── territory_members ────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('territory_members'))) {
      await queryRunner.createTable(
        new Table({
          name: 'territory_members',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'territoryId', type: 'uuid' },
            { name: 'userId', type: 'uuid' },
            { name: 'weight', type: 'int', default: 1 },
            { name: 'active', type: 'boolean', default: true },
            { name: 'assignedCount', type: 'int', default: 0 },
            { name: 'lastAssignedAt', type: ts, isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          uniques: [
            {
              name: 'uq_territory_member',
              columnNames: ['territoryId', 'userId'],
            },
          ],
          foreignKeys: [
            {
              columnNames: ['territoryId'],
              referencedTableName: 'territories',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
            {
              columnNames: ['userId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
        }),
      );
      await queryRunner.createIndex(
        'territory_members',
        new TableIndex({
          name: 'idx_territory_members_territory',
          columnNames: ['territoryId'],
        }),
      );
    }

    // ─── lead_routing_events ──────────────────────────────────────────────
    // No FK on territoryId: territories are soft-deleted and the audit trail
    // must survive a hard delete too.
    if (!(await queryRunner.hasTable('lead_routing_events'))) {
      await queryRunner.createTable(
        new Table({
          name: 'lead_routing_events',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'customerId', type: 'uuid' },
            { name: 'jobId', type: 'uuid', isNullable: true },
            { name: 'territoryId', type: 'uuid', isNullable: true },
            {
              name: 'territoryName',
              type: 'varchar',
              length: '120',
              isNullable: true,
            },
            { name: 'outcome', type: 'varchar', length: '30' },
            {
              name: 'strategy',
              type: 'varchar',
              length: '30',
              isNullable: true,
            },
            { name: 'assignedUserId', type: 'uuid', isNullable: true },
            { name: 'previousUserId', type: 'uuid', isNullable: true },
            { name: 'reason', type: 'text', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
          ],
        }),
      );
      await queryRunner.createIndex(
        'lead_routing_events',
        new TableIndex({
          name: 'idx_lead_routing_customer',
          columnNames: ['customerId'],
        }),
      );
      await queryRunner.createIndex(
        'lead_routing_events',
        new TableIndex({
          name: 'idx_lead_routing_created',
          columnNames: ['createdAt'],
        }),
      );
    }

    // ─── customer_merge_logs ──────────────────────────────────────────────
    if (!(await queryRunner.hasTable('customer_merge_logs'))) {
      await queryRunner.createTable(
        new Table({
          name: 'customer_merge_logs',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'survivorCustomerId', type: 'uuid' },
            { name: 'mergedCustomerId', type: 'uuid' },
            { name: 'performedByUserId', type: 'uuid', isNullable: true },
            {
              name: 'reason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'mergedSnapshot', type: json, isNullable: true },
            { name: 'movedCounts', type: json, isNullable: true },
            { name: 'filledFields', type: json, isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
          ],
        }),
      );
      await queryRunner.createIndex(
        'customer_merge_logs',
        new TableIndex({
          name: 'idx_customer_merge_survivor',
          columnNames: ['survivorCustomerId'],
        }),
      );
      await queryRunner.createIndex(
        'customer_merge_logs',
        new TableIndex({
          name: 'idx_customer_merge_merged',
          columnNames: ['mergedCustomerId'],
        }),
      );
    }

    // ─── admin_settings.qualificationConfig ───────────────────────────────
    if (
      (await queryRunner.hasTable('admin_settings')) &&
      !(await queryRunner.hasColumn('admin_settings', 'qualificationConfig'))
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'qualificationConfig',
          type: json,
          isNullable: true,
        }),
      );
    }

    // ─── customers: qualification + household columns ─────────────────────
    if (!(await queryRunner.hasTable('customers'))) return;

    const columns: TableColumn[] = [
      new TableColumn({
        name: 'qualificationStatus',
        type: 'varchar',
        length: '20',
        isNullable: false,
        default: "'unqualified'",
      }),
      new TableColumn({
        name: 'qualificationScore',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'qualificationAnswers',
        type: json,
        isNullable: true,
      }),
      new TableColumn({
        name: 'disqualificationReason',
        type: 'varchar',
        length: '200',
        isNullable: true,
      }),
      new TableColumn({ name: 'qualifiedAt', type: ts, isNullable: true }),
      new TableColumn({
        name: 'qualifiedByUserId',
        type: 'uuid',
        isNullable: true,
      }),
      new TableColumn({ name: 'nurtureUntil', type: ts, isNullable: true }),
      new TableColumn({
        name: 'householdKey',
        type: 'varchar',
        length: '180',
        isNullable: true,
      }),
      new TableColumn({
        name: 'mergedIntoCustomerId',
        type: 'uuid',
        isNullable: true,
      }),
      new TableColumn({ name: 'mergedAt', type: ts, isNullable: true }),
    ];

    for (const column of columns) {
      if (await queryRunner.hasColumn('customers', column.name)) continue;
      await queryRunner.addColumn('customers', column);
    }

    const indexes: Array<{ name: string; columnNames: string[] }> = [
      { name: 'idx_customers_household_key', columnNames: ['householdKey'] },
      {
        name: 'idx_customers_qualification_status',
        columnNames: ['qualificationStatus'],
      },
    ];
    const table = await queryRunner.getTable('customers');
    for (const index of indexes) {
      if (table?.indices.some((i) => i.name === index.name)) continue;
      await queryRunner.createIndex('customers', new TableIndex(index));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('customers')) {
      for (const name of [
        'qualificationStatus',
        'qualificationScore',
        'qualificationAnswers',
        'disqualificationReason',
        'qualifiedAt',
        'qualifiedByUserId',
        'nurtureUntil',
        'householdKey',
        'mergedIntoCustomerId',
        'mergedAt',
      ]) {
        if (await queryRunner.hasColumn('customers', name)) {
          await queryRunner.dropColumn('customers', name);
        }
      }
    }
    if (
      (await queryRunner.hasTable('admin_settings')) &&
      (await queryRunner.hasColumn('admin_settings', 'qualificationConfig'))
    ) {
      await queryRunner.dropColumn('admin_settings', 'qualificationConfig');
    }
    for (const table of [
      'customer_merge_logs',
      'lead_routing_events',
      'territory_members',
      'territories',
    ]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
