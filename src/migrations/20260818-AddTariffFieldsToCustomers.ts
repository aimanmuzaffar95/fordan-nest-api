import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Solar proposal financials — per-customer electricity tariff capture.
 *
 * Until now `FinancialInput`'s tariff fields
 * (`solar-design/simulation/types.ts`) were never populated from anywhere:
 * every proposal ran on the engine's hardcoded defaults (30c/kWh import,
 * 5c/kWh feed-in, $1.00/day supply — see `simulation/financial.ts`'s module
 * header). This adds the fields to `customers` so `SolarSimulationService`
 * can read a customer's real rates at proposal time, falling back to the
 * documented defaults when absent.
 *
 * All four columns are nullable and default-free: "not captured" must stay
 * distinguishable from a genuine 0c/kWh or $0/day — this codebase has
 * already shipped customer-facing bugs from exactly that ambiguity. No
 * backfill; existing rows simply read as "not captured" until a manager
 * enters a bill.
 *
 * `decimal`, not `float`, for money/rate precision on both dialects.
 * `precision/scale` are safe on both Postgres and MariaDB 10.6 — no
 * dialect branching needed here (unlike uuid columns, see
 * `common/migration-uuid.util.ts`).
 */
export class AddTariffFieldsToCustomers20260818_1700000004000 implements MigrationInterface {
  private readonly columns: TableColumn[] = [
    new TableColumn({
      name: 'importTariffPerKwh',
      type: 'decimal',
      precision: 8,
      scale: 4,
      isNullable: true,
    }),
    new TableColumn({
      name: 'feedInTariffPerKwh',
      type: 'decimal',
      precision: 8,
      scale: 4,
      isNullable: true,
    }),
    new TableColumn({
      name: 'dailySupplyCharge',
      type: 'decimal',
      precision: 8,
      scale: 4,
      isNullable: true,
    }),
    new TableColumn({
      name: 'averageMonthlyBill',
      type: 'decimal',
      precision: 10,
      scale: 2,
      isNullable: true,
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('customers'))) return;

    for (const column of this.columns) {
      if (await queryRunner.hasColumn('customers', column.name)) continue;
      await queryRunner.addColumn('customers', column);
    }
  }

  public async down(): Promise<void> {
    // Additive-only migration; intentionally no destructive down().
  }
}
