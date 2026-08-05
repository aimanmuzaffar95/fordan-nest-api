import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * Magic-link invites for staff onboarding.
 *
 * `userId` is nullable because an invite can precede the account: a brand-new
 * hire's user is created when they submit the form. `intendedRole` is captured
 * when the invite is issued rather than read from the submission, so the public
 * endpoint can never be persuaded to mint an admin.
 *
 * Only the token hash is stored; the plaintext lives in the email alone.
 */
export class CreateStaffOnboardingInvites20260806_1700000001900
  implements MigrationInterface
{
  private readonly table = 'staff_onboarding_invites';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(this.table)) return;

    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const uuidCol = await resolveUuidColumn(queryRunner);
    const timestampType = isPostgres ? 'timestamp' : 'datetime';

    await queryRunner.createTable(
      new Table({
        name: this.table,
        columns: [
          {
            name: 'id',
            ...uuidCol,
            isPrimary: true,
            generationStrategy: 'uuid',
            ...(isPostgres ? { default: 'uuid_generate_v4()' } : {}),
          },
          { name: 'tokenHash', type: 'varchar', length: '64' },
          { name: 'email', type: 'varchar', length: '255' },
          {
            name: 'firstName',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'lastName',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          { name: 'userId', ...uuidCol, isNullable: true },
          { name: 'intendedRole', type: 'varchar', length: '30' },
          { name: 'employeeRoleId', ...uuidCol, isNullable: true },
          { name: 'staffRoleId', ...uuidCol, isNullable: true },
          { name: 'expiresAt', type: timestampType },
          { name: 'acceptedAt', type: timestampType, isNullable: true },
          { name: 'revokedAt', type: timestampType, isNullable: true },
          { name: 'lastSentAt', type: timestampType, isNullable: true },
          { name: 'sendCount', type: 'int', default: 0 },
          { name: 'createdByUserId', ...uuidCol, isNullable: true },
          { name: 'createdAt', type: timestampType, default: 'now()' },
        ],
        foreignKeys: [
          {
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['employeeRoleId'],
            referencedTableName: 'employee_roles',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            columnNames: ['staffRoleId'],
            referencedTableName: 'staff_roles',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            columnNames: ['createdByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      this.table,
      new TableIndex({
        name: 'idx_staff_onboarding_invites_hash',
        columnNames: ['tokenHash'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      this.table,
      new TableIndex({
        name: 'idx_staff_onboarding_invites_email',
        columnNames: ['email'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(this.table)) {
      await queryRunner.dropTable(this.table);
    }
  }
}
