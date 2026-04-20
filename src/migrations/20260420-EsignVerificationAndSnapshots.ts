import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class EsignVerificationAndSnapshots1776686400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_settings')) {
      const addAdmin = async (name: string, column: TableColumn) => {
        if (!(await queryRunner.hasColumn('admin_settings', name))) {
          await queryRunner.addColumn('admin_settings', column);
        }
      };

      await addAdmin(
        'esignRequireVerificationToView',
        new TableColumn({
          name: 'esignRequireVerificationToView',
          type: 'boolean',
          default: true,
        }),
      );

      await addAdmin(
        'esignEmailMagicLinkEnabled',
        new TableColumn({
          name: 'esignEmailMagicLinkEnabled',
          type: 'boolean',
          default: true,
        }),
      );

      await addAdmin(
        'esignSmsOtpEnabled',
        new TableColumn({
          name: 'esignSmsOtpEnabled',
          type: 'boolean',
          default: false,
        }),
      );

      await addAdmin(
        'esignProposalTermsMarkdown',
        new TableColumn({
          name: 'esignProposalTermsMarkdown',
          type: 'text',
          isNullable: true,
        }),
      );

      await addAdmin(
        'esignProposalTermsVersion',
        new TableColumn({
          name: 'esignProposalTermsVersion',
          type: 'int',
          default: 1,
        }),
      );

      await addAdmin(
        'esignProposalAcceptanceMarkdown',
        new TableColumn({
          name: 'esignProposalAcceptanceMarkdown',
          type: 'text',
          isNullable: true,
        }),
      );

      await addAdmin(
        'esignProposalAcceptanceVersion',
        new TableColumn({
          name: 'esignProposalAcceptanceVersion',
          type: 'int',
          default: 1,
        }),
      );

      await addAdmin(
        'esignProposalShowSystemDetails',
        new TableColumn({
          name: 'esignProposalShowSystemDetails',
          type: 'boolean',
          default: true,
        }),
      );

      await addAdmin(
        'esignProposalShowIncludedServices',
        new TableColumn({
          name: 'esignProposalShowIncludedServices',
          type: 'boolean',
          default: true,
        }),
      );

      await addAdmin(
        'esignProposalIncludedServicesMarkdown',
        new TableColumn({
          name: 'esignProposalIncludedServicesMarkdown',
          type: 'text',
          isNullable: true,
        }),
      );

      await addAdmin(
        'esignProposalIncludedServicesVersion',
        new TableColumn({
          name: 'esignProposalIncludedServicesVersion',
          type: 'int',
          default: 1,
        }),
      );

      await addAdmin(
        'esignProposalShowWarranty',
        new TableColumn({
          name: 'esignProposalShowWarranty',
          type: 'boolean',
          default: true,
        }),
      );

      await addAdmin(
        'esignProposalWarrantyMarkdown',
        new TableColumn({
          name: 'esignProposalWarrantyMarkdown',
          type: 'text',
          isNullable: true,
        }),
      );

      await addAdmin(
        'esignProposalWarrantyVersion',
        new TableColumn({
          name: 'esignProposalWarrantyVersion',
          type: 'int',
          default: 1,
        }),
      );

      await addAdmin(
        'esignProposalShowAssumptions',
        new TableColumn({
          name: 'esignProposalShowAssumptions',
          type: 'boolean',
          default: true,
        }),
      );

      await addAdmin(
        'esignProposalAssumptionsMarkdown',
        new TableColumn({
          name: 'esignProposalAssumptionsMarkdown',
          type: 'text',
          isNullable: true,
        }),
      );

      await addAdmin(
        'esignProposalAssumptionsVersion',
        new TableColumn({
          name: 'esignProposalAssumptionsVersion',
          type: 'int',
          default: 1,
        }),
      );

      await addAdmin(
        'esignProposalQuoteAdjustmentsJson',
        new TableColumn({
          name: 'esignProposalQuoteAdjustmentsJson',
          type: 'text',
          isNullable: true,
        }),
      );

      await addAdmin(
        'esignProposalQuoteAdjustmentsVersion',
        new TableColumn({
          name: 'esignProposalQuoteAdjustmentsVersion',
          type: 'int',
          default: 1,
        }),
      );
    }

    if (await queryRunner.hasTable('job_signature_requests')) {
      const addSig = async (name: string, column: TableColumn) => {
        if (!(await queryRunner.hasColumn('job_signature_requests', name))) {
          await queryRunner.addColumn('job_signature_requests', column);
        }
      };

      await addSig(
        'emailVerifyTokenHash',
        new TableColumn({
          name: 'emailVerifyTokenHash',
          type: 'varchar',
          length: '64',
          isNullable: true,
        }),
      );

      await addSig(
        'emailVerifySentAt',
        new TableColumn({
          name: 'emailVerifySentAt',
          type: 'timestamp',
          isNullable: true,
        }),
      );

      await addSig(
        'emailVerifiedAt',
        new TableColumn({
          name: 'emailVerifiedAt',
          type: 'timestamp',
          isNullable: true,
        }),
      );

      await addSig(
        'verifiedAt',
        new TableColumn({
          name: 'verifiedAt',
          type: 'timestamp',
          isNullable: true,
        }),
      );

      await addSig(
        'proposalSnapshot',
        new TableColumn({
          name: 'proposalSnapshot',
          type: queryRunner.connection.options.type === 'postgres' ? 'jsonb' : 'json',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('job_signature_requests')) {
      for (const col of [
        'proposalSnapshot',
        'verifiedAt',
        'emailVerifiedAt',
        'emailVerifySentAt',
        'emailVerifyTokenHash',
      ]) {
        if (await queryRunner.hasColumn('job_signature_requests', col)) {
          await queryRunner.dropColumn('job_signature_requests', col);
        }
      }
    }

    if (await queryRunner.hasTable('admin_settings')) {
      for (const col of [
        'esignProposalQuoteAdjustmentsVersion',
        'esignProposalQuoteAdjustmentsJson',
        'esignProposalAssumptionsVersion',
        'esignProposalAssumptionsMarkdown',
        'esignProposalShowAssumptions',
        'esignProposalWarrantyVersion',
        'esignProposalWarrantyMarkdown',
        'esignProposalShowWarranty',
        'esignProposalIncludedServicesVersion',
        'esignProposalIncludedServicesMarkdown',
        'esignProposalShowIncludedServices',
        'esignProposalShowSystemDetails',
        'esignProposalAcceptanceVersion',
        'esignProposalAcceptanceMarkdown',
        'esignProposalTermsVersion',
        'esignProposalTermsMarkdown',
        'esignSmsOtpEnabled',
        'esignEmailMagicLinkEnabled',
        'esignRequireVerificationToView',
      ]) {
        if (await queryRunner.hasColumn('admin_settings', col)) {
          await queryRunner.dropColumn('admin_settings', col);
        }
      }
    }
  }
}

