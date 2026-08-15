import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, In, Repository } from 'typeorm';
import { CustomerMessagingRendererService } from '../email/customer-messaging-renderer.service';
import { EmailService } from '../email/email.service';
import { FilesService } from '../files/files.service';
import type { UploadKind } from '../files/upload.constants';
import { Job } from './entities/job.entity';
import {
  PricingMode,
  ProposalStatus,
  ProposalVersion,
} from '../proposals/entities/proposal-version.entity';
import { ProposalsService } from '../proposals/proposals.service';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { RoofDesignService } from '../solar-design/roof-design.service';
import {
  DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C,
  runSimulation,
  type PanelSpec,
  type RoofDesignDocInput,
  type SimulationInput,
} from '../solar-design/simulation';
import { JobSignatureService } from './job-signature.service';
import { JobsService, type JobListViewer } from './jobs.service';
import { RoofProposalService } from './roof-proposal.service';

const PROPOSAL_FILE_KIND = 'proposal_pdf' as UploadKind;

export type SendProposalResult = {
  jobId: string;
  proposalVersionId: string;
  versionNumber: number;
  recipientEmail: string;
  sentAt: string;
  signingUrl: string;
};

/**
 * Orchestrates P6 "send proposal to the customer": builds the branded PDF
 * (via the concurrently-built `RoofProposalService`/`RoofProposalPdfService`),
 * emails it with proposal-specific copy, freezes it as the sent snapshot,
 * and mints an acceptance link through the existing e-sign machinery.
 *
 * Ordering matters for `EMAIL_DELIVERY_FAILED` semantics: the PDF is built
 * and the email is sent *before* anything is persisted or the
 * `ProposalVersion` is transitioned — a failed send leaves no trace of
 * "sent".
 */
@Injectable()
export class JobProposalSendService {
  private readonly logger = new Logger(JobProposalSendService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly roofProposal: RoofProposalService,
    private readonly roofDesigns: RoofDesignService,
    private readonly proposals: ProposalsService,
    private readonly jobSignatures: JobSignatureService,
    private readonly email: EmailService,
    private readonly customerMessaging: CustomerMessagingRendererService,
    private readonly files: FilesService,
    @InjectRepository(ProposalVersion)
    private readonly proposalVersionsRepo: Repository<ProposalVersion>,
    @InjectRepository(SolarPanel)
    private readonly solarPanelsRepo: Repository<SolarPanel>,
    private readonly dataSource: DataSource,
  ) {}

  async sendProposal(
    jobId: string,
    viewer: JobListViewer,
    req?: Request,
  ): Promise<SendProposalResult> {
    const jobDetail = await this.jobs.getOne(jobId, viewer);
    const customer = jobDetail.customer;
    const customerEmail = customer?.email?.trim();
    if (!customerEmail) {
      throw new BadRequestException('Customer email is missing for this job');
    }
    const customerName =
      `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim() ||
      'Customer';

    // A design + successful simulation are required to send a proposal.
    // `buildValidatedProposalPdf` already enforces both (400 otherwise) and
    // is the single source of truth for the PDF layout/branding.
    const pdfResult = await this.roofProposal.buildValidatedProposalPdf(
      jobId,
      viewer,
    );

    // Everything from "pick the version to send" through "mark it sent" is
    // serialized per-job by holding a pessimistic row lock on the `Job`
    // itself for the duration. Without this, two overlapping send-proposal
    // calls (a double-click, or a retry after a slow SMTP round trip) can
    // both read the same fresh DRAFT version, both mail a distinct signing
    // URL for the *same* `proposalVersionId`, and the second caller's final
    // update silently overwrites the first's `sentPdfFileId` — a sent
    // proposal mutating after the fact, exactly the guarantee this piece
    // exists to uphold. Locking the `Job` row (rather than the version row)
    // covers the first-ever send too, when no version row exists yet to
    // lock. The second caller's `SELECT ... FOR UPDATE` blocks until the
    // first transaction commits, so by the time it proceeds the version it
    // just read is already `SENT` and it correctly mints a brand-new
    // version instead of reusing/overwriting the first one — the same
    // superseded-link behavior as a normal sequential resend.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let sent: ProposalVersion;
    let savedFile: { id: string };
    let linkPreview: { signingUrl: string };
    try {
      await queryRunner.manager.findOne(Job, {
        where: { id: jobId },
        lock: { mode: 'pessimistic_write' },
      });

      // Find (or open) the version that is "ready to send". `sentPdfFileId`
      // is a one-time write — once a version has ever been sent (SENT,
      // VIEWED, or any terminal status), it must never be resent into,
      // because that would silently overwrite the PDF/snapshot an
      // already-delivered link points to (the whole "sent proposal cannot
      // change" guarantee). Only a still-unsent DRAFT version is reused; a
      // resend for any other reason — price tweak, double-click, retry after
      // a transient failure — always mints a fresh version instead, so the
      // original link keeps resolving to exactly what it was minted for.
      let version = await this.proposalVersionsRepo.findOne({
        where: { jobId },
        order: { versionNumber: 'DESC' },
      });
      if (!version || version.status !== ProposalStatus.DRAFT) {
        version = await this.proposals.createVersion(
          jobId,
          {
            pricingMode: PricingMode.CASH,
            totalPrice: Number(jobDetail.job.projectPrice ?? 0) || 0,
            depositAmount: Number(jobDetail.job.depositAmount ?? 0) || 0,
          },
          viewer,
        );
      }

      // Independent recompute of the headline numbers for the email copy
      // (system size / savings / payback / offset). Uses the same
      // `runSimulation` engine as the PDF so the figures agree with the
      // document the customer is about to open.
      const emailNumbers = await this.computeEmailNumbers(jobId, version);

      // Mint the acceptance link first (no external side effect), then render
      // the email with the real URL, then send. Nothing on the
      // `ProposalVersion` is mutated until the email has actually gone out.
      linkPreview = await this.jobSignatures.createProposalSignatureRequest(
        jobId,
        version.id,
        customerEmail,
        customerName,
        viewer.userId,
        req,
      );

      const finalEmail =
        await this.customerMessaging.renderProposalSentCustomerEmail({
          customerName,
          orderNumber: jobDetail.job.orderNumber,
          systemSizeLabel: emailNumbers.systemSizeLabel,
          annualSavingsLabel: emailNumbers.annualSavingsLabel,
          paybackLabel: emailNumbers.paybackLabel,
          offsetPercentLabel: emailNumbers.offsetPercentLabel,
          provisional: emailNumbers.provisional,
          viewProposalUrl: linkPreview.signingUrl,
        });

      try {
        await this.email.send({
          to: customerEmail,
          subject: finalEmail.subject,
          html: finalEmail.html,
        });
      } catch (err) {
        this.logger.error(
          `Proposal email failed for job ${jobId}: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException({
          message: 'Email delivery failed. Proposal was not sent.',
          code: 'EMAIL_DELIVERY_FAILED',
        });
      }

      // Store the exact PDF that was emailed — every later view/sign/accept
      // reads this file, never a live regeneration (immutability guarantee).
      savedFile = await this.files.persistJobGeneratedPdf({
        jobId,
        buffer: pdfResult.pdfBuffer,
        displayName: `Proposal ${jobDetail.job.orderNumber} v${version.versionNumber}`,
        kind: PROPOSAL_FILE_KIND,
        contentType: 'application/pdf',
        uploadedByUserId: viewer.userId,
        timelineActorUserId: viewer.userId,
      });

      // Transition the version to `sent` (freezes the roof design snapshot,
      // supersedes siblings, emits `proposal_sent` timeline event).
      sent = await this.proposals.send(
        version.id,
        { email: customerEmail },
        viewer,
      );
      await this.proposalVersionsRepo.update(
        { id: sent.id },
        { sentPdfFileId: savedFile.id },
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return {
      jobId,
      proposalVersionId: sent.id,
      versionNumber: sent.versionNumber,
      recipientEmail: customerEmail,
      sentAt: sent.sentAt?.toISOString() ?? new Date().toISOString(),
      signingUrl: linkPreview.signingUrl,
    };
  }

  private async computeEmailNumbers(
    jobId: string,
    version: ProposalVersion,
  ): Promise<{
    systemSizeLabel: string;
    annualSavingsLabel: string;
    paybackLabel: string;
    offsetPercentLabel: string;
    provisional: boolean;
  }> {
    const currencyFmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    try {
      const roofDesign = await this.roofDesigns.getForJob(jobId);
      if (!roofDesign || roofDesign.doc.arrays.length === 0) {
        return this.fallbackEmailNumbers();
      }
      const doc: RoofDesignDocInput = {
        version: roofDesign.doc.version,
        anchor: roofDesign.doc.anchor,
        arrays: roofDesign.doc.arrays,
        obstructions: roofDesign.doc.obstructions,
      };
      const panelModelIds = Array.from(
        new Set(doc.arrays.map((a) => a.panelModelId)),
      ).filter(Boolean);
      const rows = panelModelIds.length
        ? await this.solarPanelsRepo.find({ where: { id: In(panelModelIds) } })
        : [];
      const panels: PanelSpec[] = rows.map((row) => ({
        id: row.id,
        wattage: Number(row.wattage),
        tempCoefficientPerC: DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C / 100,
        noctC: null,
        widthMm: row.widthMm,
        heightMm: row.heightMm,
      }));
      const simulationInput: SimulationInput = {
        doc,
        panels,
        financial: {
          grossCost: Number(version.totalPrice) || undefined,
          rebateAmount: version.rebateAmount
            ? Number(version.rebateAmount)
            : undefined,
        },
        battery: null,
      };
      const simulation = runSimulation(simulationInput);
      // Same warning the PDF checks for (roof-proposal-pdf.service.ts) — if
      // the sim ran on a fallback regional irradiance average rather than
      // real site data, the headline numbers below are provisional. The
      // email must say so rather than presenting them as final figures.
      const provisional = simulation.warnings.some(
        (w) => w.id === 'climate-data-unavailable',
      );
      return {
        systemSizeLabel: `${simulation.system.dcKw.toFixed(1)}kW`,
        annualSavingsLabel: currencyFmt.format(
          Math.max(0, simulation.financial.year1Savings || 0),
        ),
        paybackLabel:
          simulation.financial.paybackYears &&
          Number.isFinite(simulation.financial.paybackYears)
            ? `${simulation.financial.paybackYears.toFixed(1)} years`
            : 'a few years',
        offsetPercentLabel: `${Math.round(
          Math.min(100, Math.max(0, simulation.offset.offsetPercent || 0)),
        )}%`,
        provisional,
      };
    } catch (err) {
      this.logger.warn(
        `Could not compute proposal email numbers for job ${jobId}: ${(err as Error).message}`,
      );
      return this.fallbackEmailNumbers();
    }
  }

  private fallbackEmailNumbers() {
    return {
      systemSizeLabel: 'your new solar',
      annualSavingsLabel: 'real',
      paybackLabel: 'a few years',
      offsetPercentLabel: 'most',
      // Unknown/failed computation is treated the same as provisional —
      // never claim precision we don't have.
      provisional: true,
    };
  }
}
