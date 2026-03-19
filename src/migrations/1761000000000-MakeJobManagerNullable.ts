import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class MakeJobManagerNullable1761000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      'jobs',
      'managerId',
      new TableColumn({
        name: 'managerId',
        type: 'uuid',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      'jobs',
      'managerId',
      new TableColumn({
        name: 'managerId',
        type: 'uuid',
        isNullable: false,
      }),
    );
  }
}
