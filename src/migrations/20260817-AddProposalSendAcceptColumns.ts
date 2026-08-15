import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * P6 (send proposal + collect acceptance):
 * - `proposal_versions.sentPdfFileId` — the exact PDF (job file id) that was
 *   emailed to the customer at send time. Every later public view/sign/
 *   accept reads this stored file rather than regenerating the PDF, so an
 *   accepted proposal is bound to precisely what the customer was shown.
 * - `job_signature_requests.documentSource` / `.proposalVersionId` — reuses
 *   the existing e-sign request/token machinery for proposal acceptance
 *   (`documentSource = 'proposal'`) alongside the original quotation flow
 *   (`documentSource = 'quotation'`, the default for existing rows).
 */
export class AddProposalSendAcceptColumns20260817_1700000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const uuidCol = await resolveUuidColumn(queryRunner);

    const hasSentPdfFileId = await queryRunner.hasColumn(
      'proposal_versions',
      'sentPdfFileId',
    );
    if (!hasSentPdfFileId) {
      await queryRunner.addColumn(
        'proposal_versions',
        new TableColumn({
          name: 'sentPdfFileId',
          ...uuidCol,
          isNullable: true,
        }),
      );
    }

    const hasDocumentSource = await queryRunner.hasColumn(
      'job_signature_requests',
      'documentSource',
    );
    if (!hasDocumentSource) {
      await queryRunner.addColumn(
        'job_signature_requests',
        new TableColumn({
          name: 'documentSource',
          type: 'varchar',
          length: '20',
          isNullable: false,
          default: `'quotation'`,
        }),
      );
    }

    const hasProposalVersionId = await queryRunner.hasColumn(
      'job_signature_requests',
      'proposalVersionId',
    );
    if (!hasProposalVersionId) {
      await queryRunner.addColumn(
        'job_signature_requests',
        new TableColumn({
          name: 'proposalVersionId',
          ...uuidCol,
          isNullable: true,
        }),
      );
    }
  }

  public async down(): Promise<void> {
    // Additive-only migration; intentionally no destructive down().
  }
}
