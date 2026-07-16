import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Creates `mcp_access_keys` — admin-issued API keys that let an AI assistant
 * reach the CRM through the MCP server, each bound to a staff account whose
 * role bounds its access. Mirrors
 * src/mcp-access/entities/mcp-access-key.entity.ts.
 */
export class CreateMcpAccessKeys20260717_1700000000700 implements MigrationInterface {
  private defaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    return {
      dialect,
      uuidDefault: dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()',
      ts: dialect === 'postgres' ? 'timestamptz' : 'datetime',
    };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault, ts } = this.defaults(queryRunner);
    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (await queryRunner.hasTable('mcp_access_keys')) return;

    await queryRunner.createTable(
      new Table({
        name: 'mcp_access_keys',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: uuidDefault },
          { name: 'name', type: 'varchar', length: '120', isNullable: false },
          {
            name: 'tokenHash',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'displayHint',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          { name: 'boundUserId', type: 'uuid', isNullable: false },
          { name: 'allowWrites', type: 'boolean', default: false },
          { name: 'active', type: 'boolean', default: true },
          { name: 'expiresAt', type: ts, isNullable: true },
          { name: 'lastUsedAt', type: ts, isNullable: true },
          { name: 'createdByUserId', type: 'uuid', isNullable: false },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
          { name: 'revokedAt', type: ts, isNullable: true },
          { name: 'revokedByUserId', type: 'uuid', isNullable: true },
        ],
      }),
    );

    await queryRunner.createIndex(
      'mcp_access_keys',
      new TableIndex({
        name: 'idx_mcp_access_keys_token_hash',
        columnNames: ['tokenHash'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'mcp_access_keys',
      new TableIndex({
        name: 'idx_mcp_access_keys_bound_user',
        columnNames: ['boundUserId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('mcp_access_keys')) {
      await queryRunner.dropTable('mcp_access_keys');
    }
  }
}
