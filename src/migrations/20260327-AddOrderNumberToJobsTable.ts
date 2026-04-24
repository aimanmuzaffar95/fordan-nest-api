import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

type RawJobRow = {
  jid: string;
  ord_num: string | null;
};

export class AddOrderNumberToJobsTable20260327_1700000000016 implements MigrationInterface {
  private readonly uniqueIndexName = 'IDX_jobs_orderNumber_unique';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('jobs'))) return;

    if (!(await queryRunner.hasColumn('jobs', 'orderNumber'))) {
      await queryRunner.addColumn(
        'jobs',
        new TableColumn({
          name: 'orderNumber',
          type: 'varchar',
          length: '50',
          isNullable: true,
        }),
      );
    }

    const jobsTableBeforeMigration = await queryRunner.getTable('jobs');
    const existingOrderNumberColumn =
      jobsTableBeforeMigration?.findColumnByName('orderNumber');
    const hasUniqueOrderNumberConstraint = Boolean(
      jobsTableBeforeMigration?.uniques.some(
        (unique) =>
          unique.columnNames.length === 1 &&
          unique.columnNames[0] === 'orderNumber',
      ) ||
      jobsTableBeforeMigration?.indices.some(
        (index) =>
          index.isUnique &&
          index.columnNames.length === 1 &&
          index.columnNames[0] === 'orderNumber',
      ),
    );

    if (
      existingOrderNumberColumn &&
      !existingOrderNumberColumn.isNullable &&
      hasUniqueOrderNumberConstraint
    ) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const tableName = this.escapeIdentifier('jobs', dialect);
    const idColumn = this.escapeIdentifier('id', dialect);
    const createdAtColumn = this.escapeIdentifier('createdAt', dialect);
    const orderNumberColumn = this.escapeIdentifier('orderNumber', dialect);

    const rows = (await queryRunner.query(
      `SELECT ${idColumn} AS jid, ${orderNumberColumn} AS ord_num FROM ${tableName} ORDER BY ${createdAtColumn} ASC, ${idColumn} ASC`,
    )) as RawJobRow[];

    let nextSequence = 1001;
    const claimedNumbers = new Set<number>();
    const jobsNeedingOrderNumber = new Set<string>();

    rows.forEach((row) => {
      const parsed = this.parseOrderNumber(row.ord_num);
      if (parsed === null) {
        jobsNeedingOrderNumber.add(row.jid);
        return;
      }

      if (claimedNumbers.has(parsed)) {
        jobsNeedingOrderNumber.add(row.jid);
        return;
      }

      claimedNumbers.add(parsed);
      if (parsed >= nextSequence) {
        nextSequence = parsed + 1;
      }
    });

    for (const row of rows) {
      if (this.parseOrderNumber(row.ord_num) !== null) {
        continue;
      }

      while (claimedNumbers.has(nextSequence)) {
        nextSequence += 1;
      }

      const orderNumber = this.formatOrderNumber(nextSequence);
      claimedNumbers.add(nextSequence);
      nextSequence += 1;

      await queryRunner.query(
        `UPDATE ${tableName} SET ${orderNumberColumn} = '${orderNumber}' WHERE ${idColumn} = '${row.jid}'`,
      );
    }

    // Do not use changeColumn on Postgres: it drops/recreates the column and wipes values before NOT NULL.
    const jobsTableBeforeNotNull = await queryRunner.getTable('jobs');
    const orderNumberCol = jobsTableBeforeNotNull?.columns.find(
      (c) => c.name === 'orderNumber',
    );
    if (orderNumberCol?.isNullable !== false) {
      if (dialect === 'postgres') {
        await queryRunner.query(
          `ALTER TABLE ${tableName} ALTER COLUMN ${orderNumberColumn} SET NOT NULL`,
        );
      } else {
        await queryRunner.query(
          `ALTER TABLE ${tableName} MODIFY ${orderNumberColumn} varchar(50) NOT NULL`,
        );
      }
    }

    const jobsTable = await queryRunner.getTable('jobs');
    const existingIndex = jobsTable?.indices.find(
      (index) =>
        index.isUnique &&
        index.columnNames.length === 1 &&
        index.columnNames[0] === 'orderNumber',
    );

    if (!existingIndex) {
      await queryRunner.createIndex(
        'jobs',
        new TableIndex({
          name: this.uniqueIndexName,
          columnNames: ['orderNumber'],
          isUnique: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('jobs'))) return;
    if (!(await queryRunner.hasColumn('jobs', 'orderNumber'))) return;

    const jobsTable = await queryRunner.getTable('jobs');
    const existingIndex = jobsTable?.indices.find(
      (index) => index.name === this.uniqueIndexName,
    );

    if (existingIndex) {
      await queryRunner.dropIndex('jobs', existingIndex);
    }

    await queryRunner.dropColumn('jobs', 'orderNumber');
  }

  private formatOrderNumber(sequence: number) {
    return `ORD-${sequence}`;
  }

  private parseOrderNumber(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    const match = /^ORD-(\d+)$/.exec(value);
    if (!match) {
      return null;
    }

    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private escapeIdentifier(identifier: string, dialect: string) {
    if (dialect === 'postgres') {
      return `"${identifier}"`;
    }

    return `\`${identifier}\``;
  }
}
