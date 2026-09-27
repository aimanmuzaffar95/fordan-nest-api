import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Compliance v2: templates carry a category (checklist/sop/training/safety),
 * a job phase, long-form instructions and evidence rules; submissions keep
 * the ids of evidence files. All nullable/defaulted — no backfill.
 *
 * cPanel/MariaDB: apply scripts/sql/2026-09-compliance-phases-mariadb.sql instead.
 */
export class CompliancePhasesAndEvidence20260928_1700000006400 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    const add = async (table: string, col: TableColumn) => {
      if (!(await q.hasTable(table))) return;
      if (await q.hasColumn(table, col.name)) return;
      await q.addColumn(table, col);
    };
    await add(
      'compliance_form_templates',
      new TableColumn({
        name: 'category',
        type: 'varchar',
        length: '20',
        isNullable: false,
        default: "'checklist'",
      }),
    );
    await add(
      'compliance_form_templates',
      new TableColumn({
        name: 'phase',
        type: 'varchar',
        length: '20',
        isNullable: false,
        default: "'any'",
      }),
    );
    await add(
      'compliance_form_templates',
      new TableColumn({ name: 'instructions', type: 'text', isNullable: true }),
    );
    await add(
      'compliance_form_templates',
      new TableColumn({ name: 'evidence', type: 'json', isNullable: true }),
    );
    await add(
      'job_compliance_submissions',
      new TableColumn({
        name: 'evidenceFileIds',
        type: 'json',
        isNullable: true,
      }),
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [t, c] of [
      ['job_compliance_submissions', 'evidenceFileIds'],
      ['compliance_form_templates', 'evidence'],
      ['compliance_form_templates', 'instructions'],
      ['compliance_form_templates', 'phase'],
      ['compliance_form_templates', 'category'],
    ] as const) {
      if (await q.hasColumn(t, c)) await q.dropColumn(t, c);
    }
  }
}
