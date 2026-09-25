import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Customer-portal tickets: complaints raised by customers from the portal.
 * - complaints.channel ('staff' | 'portal', default 'staff')
 * - complaint_events.fromCustomer (boolean, default false)
 *
 * cPanel/MariaDB: apply scripts/sql/2026-09-portal-tickets-mariadb.sql instead.
 */
export class PortalTickets20260926_1700000006200 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('complaints')) &&
      !(await queryRunner.hasColumn('complaints', 'channel'))
    ) {
      await queryRunner.addColumn(
        'complaints',
        new TableColumn({
          name: 'channel',
          type: 'varchar',
          length: '20',
          isNullable: false,
          default: "'staff'",
        }),
      );
    }
    if (
      (await queryRunner.hasTable('complaint_events')) &&
      !(await queryRunner.hasColumn('complaint_events', 'fromCustomer'))
    ) {
      await queryRunner.addColumn(
        'complaint_events',
        new TableColumn({
          name: 'fromCustomer',
          type: 'boolean',
          isNullable: false,
          default: false,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('complaint_events', 'fromCustomer')) {
      await queryRunner.dropColumn('complaint_events', 'fromCustomer');
    }
    if (await queryRunner.hasColumn('complaints', 'channel')) {
      await queryRunner.dropColumn('complaints', 'channel');
    }
  }
}
