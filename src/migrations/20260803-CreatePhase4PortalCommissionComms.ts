import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * PRD v2 Phase 4 — customer portal access tokens, commission events, and the
 * SMS/call communication log.
 *
 * All new tables; nothing existing is touched. Note the unique index on
 * `portal_access_tokens.tokenHash`: only the hash is ever stored, so a
 * database leak cannot yield working portal links.
 */
export class CreatePhase4PortalCommissionComms20260803_1700000002100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};

    // ─── portal_access_tokens ─────────────────────────────────────────────
    if (!(await queryRunner.hasTable('portal_access_tokens'))) {
      await queryRunner.createTable(
        new Table({
          name: 'portal_access_tokens',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            // SHA-256 hex. Never the plaintext token.
            { name: 'tokenHash', type: 'varchar', length: '64' },
            { name: 'customerId', type: 'uuid' },
            { name: 'jobId', type: 'uuid' },
            { name: 'expiresAt', type: ts },
            { name: 'revokedAt', type: ts, isNullable: true },
            { name: 'lastAccessedAt', type: ts, isNullable: true },
            { name: 'accessCount', type: 'int', default: 0 },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
          ],
        }),
      );
      await queryRunner.createIndex(
        'portal_access_tokens',
        new TableIndex({
          name: 'idx_portal_tokens_hash',
          columnNames: ['tokenHash'],
          isUnique: true,
        }),
      );
      await queryRunner.createIndex(
        'portal_access_tokens',
        new TableIndex({
          name: 'idx_portal_tokens_customer',
          columnNames: ['customerId'],
        }),
      );
    }

    // ─── commission_events ────────────────────────────────────────────────
    if (!(await queryRunner.hasTable('commission_events'))) {
      await queryRunner.createTable(
        new Table({
          name: 'commission_events',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'userId', type: 'uuid' },
            { name: 'jobId', type: 'uuid', isNullable: true },
            { name: 'projectId', type: 'uuid', isNullable: true },
            { name: 'eventType', type: 'varchar', length: '30' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'pending'",
            },
            { name: 'amount', type: 'numeric', precision: 12, scale: 2 },
            {
              name: 'currency',
              type: 'varchar',
              length: '3',
              default: "'AUD'",
            },
            {
              name: 'basisAmount',
              type: 'numeric',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'ratePercent',
              type: 'numeric',
              precision: 6,
              scale: 3,
              isNullable: true,
            },
            {
              name: 'planName',
              type: 'varchar',
              length: '120',
              isNullable: true,
            },
            { name: 'reversesEventId', type: 'uuid', isNullable: true },
            { name: 'approvedAt', type: ts, isNullable: true },
            { name: 'approvedByUserId', type: 'uuid', isNullable: true },
            { name: 'paidAt', type: ts, isNullable: true },
            {
              name: 'payoutReference',
              type: 'varchar',
              length: '60',
              isNullable: true,
            },
            {
              name: 'reason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'notes', type: 'text', isNullable: true },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
        }),
      );
      for (const index of [
        {
          name: 'idx_commission_user_status',
          columnNames: ['userId', 'status'],
        },
        { name: 'idx_commission_job', columnNames: ['jobId'] },
        { name: 'idx_commission_status', columnNames: ['status'] },
      ]) {
        await queryRunner.createIndex(
          'commission_events',
          new TableIndex(index),
        );
      }
    }

    // ─── communication_logs ───────────────────────────────────────────────
    if (!(await queryRunner.hasTable('communication_logs'))) {
      await queryRunner.createTable(
        new Table({
          name: 'communication_logs',
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
            { name: 'channel', type: 'varchar', length: '20' },
            { name: 'direction', type: 'varchar', length: '10' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'queued'",
            },
            {
              name: 'counterparty',
              type: 'varchar',
              length: '320',
              isNullable: true,
            },
            { name: 'body', type: 'text', isNullable: true },
            { name: 'durationSeconds', type: 'int', isNullable: true },
            {
              name: 'externalId',
              type: 'varchar',
              length: '120',
              isNullable: true,
            },
            {
              name: 'providerName',
              type: 'varchar',
              length: '60',
              isNullable: true,
            },
            {
              name: 'failureReason',
              type: 'varchar',
              length: '200',
              isNullable: true,
            },
            { name: 'occurredAt', type: ts },
            { name: 'staffUserId', type: 'uuid', isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
        }),
      );
      for (const index of [
        { name: 'idx_comm_logs_customer', columnNames: ['customerId'] },
        { name: 'idx_comm_logs_job', columnNames: ['jobId'] },
        { name: 'idx_comm_logs_occurred', columnNames: ['occurredAt'] },
      ]) {
        await queryRunner.createIndex(
          'communication_logs',
          new TableIndex(index),
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'communication_logs',
      'commission_events',
      'portal_access_tokens',
    ]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
