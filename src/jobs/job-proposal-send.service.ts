import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { CustomerMessagingRendererService } from '../email/customer-messaging-renderer.service';
import { EmailService } from '../email/email.service';
import { FilesService } from '../files/files.service';
import type { UploadKind } from '../files/upload.constants';
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

/**
 * How long a version may sit in `SENDING` before a later send attempt is
 * allowed to treat it as abandoned and reclaim it (self-healing — no cron,
 * no operator).
 *
 * Chosen deliberately generous, not tight: this is the *only* thing standing
 * between "stuck forever after a crash" and "reclaimed while genuinely still
 * in flight, producing a duplicate customer email" — the exact defect this
 * whole change exists to prevent. It must clear the slowest realistic
 * PDF-build+SMTP round trip with real margin, not just the common case.
 * SMTP on this host has already been slow enough to blow a 50s DB lock
 * timeout (the original incident), and the deploy notes call out shared-host
 * IMAP/SMTP throttling under load, which can mean multiple send/retry
 * cycles inside the mail transport itself, not one slow call. 10 minutes is
 * comfortably above any plausible single `sendProposal` invocation (PDF
 * render: seconds; email render: instant; SMTP including host-side
 * throttling/backoff: normally sub-minute, pathologically maybe a minute or
 * two) while still healing within a human-noticeable window rather than
 * requiring anyone to notice and intervene.
 *
 * Worst case if a genuinely slow-but-still-alive send exceeds this window
 * and a concurrent retry lands in that exact gap: the retry reclaims the
 * row and sends its own email for the same version — a duplicate customer
 * email, same failure mode this fix targets, just now bounded to "crash (or
 * 10+ minute SMTP stall) AND a concurrent retry inside that window" instead
 * of "any double-click". The `claimedAt` fencing token below (reused from
 * the existing `updatedAt` column — no new schema) additionally guarantees
 * that even in that rare case, the two attempts can never corrupt each
 * other's `sentPdfFileId`/`sentAt` — whichever finalizes first wins the DB
 * write cleanly, and the loser's finalize is skipped rather than clobbering
 * it.
 */
const STALE_SENDING_RECLAIM_MS = 10 * 60 * 1000;

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
 *
 * Three separate boundaries, none of which holds a database lock across an
 * external call (SMTP, PDF rendering, file storage):
 *
 *  1. `claimVersionForSend` — fast, local-DB-only work: find-or-create the
 *     DRAFT version, then win it with a conditional `UPDATE ... WHERE
 *     status = 'draft'` (same pattern as `JobSignatureService
 *     .completePublicSign`'s claim). Only one concurrent caller can ever
 *     move a given version to `SENDING`; a loser re-reads and, finding the
 *     version no longer DRAFT, mints/claims a fresh version instead — the
 *     same "double-click creates a superseding resend" behavior this code
 *     always had, just without a lock held anywhere.
 *  2. Outside any transaction — PDF build (via `buildValidatedProposalPdf`,
 *     already run up front), email render + send, PDF file persistence.
 *  3. `proposals.send(...)` run inside a short transaction — flips the
 *     claimed version to `SENT`, supersedes siblings, writes the timeline
 *     event, and records `sentPdfFileId`.
 *
 * If step 2 fails (PDF or email), the claim is released back to `DRAFT`
 * (best effort) so the version is immediately resendable — never stuck.
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
    // is the single source of truth for the PDF layout/branding. Run before
    // any claim — it's read-only against the job's live state and doesn't
    // need serializing.
    const pdfResult = await this.roofProposal.buildValidatedProposalPdf(
      jobId,
      viewer,
    );

    // Step 1 (short, local-DB-only): claim a version to send. See class doc.
    const { version, linkPreview, claimedAt } = await this.claimVersionForSend(
      jobId,
      jobDetail,
      customerEmail,
      customerName,
      viewer,
      req,
    );

    try {
      // Step 2 (no transaction, no lock held): render + send the email, then
      // persist the PDF. Both are slow/external and must never run under a
      // held row lock.
      const emailNumbers = await this.computeEmailNumbers(jobId, version);
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
      const savedFile = await this.files.persistJobGeneratedPdf({
        jobId,
        buffer: pdfResult.pdfBuffer,
        displayName: `Proposal ${jobDetail.job.orderNumber} v${version.versionNumber}`,
        kind: PROPOSAL_FILE_KIND,
        contentType: 'application/pdf',
        uploadedByUserId: viewer.userId,
        timelineActorUserId: viewer.userId,
      });

      // Step 3 (short transaction): flip the claimed version to `sent`
      // (freezes the roof design snapshot, supersedes siblings, emits
      // `proposal_sent` timeline event) and record `sentPdfFileId`, all
      // local DB work with no external call inside the transaction.
      //
      // Fenced on `claimedAt` (the `updatedAt` value stamped when we won the
      // claim in step 1) before doing any of that: in the rare case our
      // claim was stale-reclaimed by a concurrent attempt (see
      // `STALE_SENDING_RECLAIM_MS`), `updatedAt` will have moved and this
      // conditional update affects zero rows. We do NOT then finalize —
      // the email/file we just sent may be a genuine duplicate (documented
      // risk above), but we at least never overwrite whatever the reclaiming
      // attempt writes to `sentPdfFileId`/`sentAt`.
      const sent = await this.dataSource.transaction(async (manager) => {
        const versionRepo = manager.getRepository(ProposalVersion);
        const fence = await versionRepo
          .createQueryBuilder()
          .update(ProposalVersion)
          .set({ status: ProposalStatus.SENDING })
          .where('id = :id', { id: version.id })
          .andWhere('status = :sending', {
            sending: ProposalStatus.SENDING,
          })
          .andWhere(`${this.updatedAtColumn()} = :claimedAt`, { claimedAt })
          .execute();
        if (!fence.affected) {
          throw new ServiceUnavailableException({
            message:
              'This proposal send was reclaimed by a concurrent retry before it could be recorded. The email may already have gone out under that retry — check the timeline before resending.',
            code: 'PROPOSAL_SEND_RECLAIMED',
          });
        }
        const saved = await this.proposals.send(
          version.id,
          { email: customerEmail },
          viewer,
          manager,
        );
        await manager.update(ProposalVersion, saved.id, {
          sentPdfFileId: savedFile.id,
        });
        return saved;
      });

      return {
        jobId,
        proposalVersionId: sent.id,
        versionNumber: sent.versionNumber,
        recipientEmail: customerEmail,
        sentAt: sent.sentAt?.toISOString() ?? new Date().toISOString(),
        signingUrl: linkPreview.signingUrl,
      };
    } catch (err) {
      // The email failed, PDF persistence failed, or the finalize
      // transaction itself failed after a successful send (the latter is
      // logged loudly below — see class doc for what that means for the
      // customer). Either way, release the claim — fenced on `claimedAt` so
      // we only ever release *our own* claim, never a claim a stale-reclaim
      // has since taken over — so the version is not stuck in `SENDING`
      // forever and a retry can pick it straight back up.
      await this.releaseClaim(version.id, claimedAt, err).catch(
        () => undefined,
      );
      throw err;
    }
  }

  /**
   * Wins the right to send a version via a conditional `UPDATE ... WHERE
   * status = 'draft' OR (status = 'sending' AND stale)` — the same
   * atomic-claim shape as `JobSignatureService.completePublicSign`, extended
   * to be self-healing (see `STALE_SENDING_RECLAIM_MS`). Retries a handful
   * of times: a concurrent caller that loses the race re-reads (now sees the
   * version is no longer DRAFT/stale) and mints/claims a fresh version
   * instead, exactly the "double-click supersedes into a new version"
   * behavior this endpoint already had — just without ever blocking on a
   * lock.
   *
   * Returns `claimedAt` — the `updatedAt` this specific claim stamped onto
   * the row — so the finalize step can fence its write against a later
   * stale-reclaim (see the transaction in `sendProposal`).
   */
  private async claimVersionForSend(
    jobId: string,
    jobDetail: Awaited<ReturnType<JobsService['getOne']>>,
    customerEmail: string,
    customerName: string,
    viewer: JobListViewer,
    req?: Request,
  ): Promise<{
    version: ProposalVersion;
    linkPreview: { signingUrl: string };
    claimedAt: Date;
  }> {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let version = await this.proposalVersionsRepo.findOne({
        where: { jobId },
        order: { versionNumber: 'DESC' },
      });
      const staleSendingCutoff = new Date(
        Date.now() - STALE_SENDING_RECLAIM_MS,
      );
      const isStaleSending =
        !!version &&
        version.status === ProposalStatus.SENDING &&
        version.updatedAt < staleSendingCutoff;
      // `sentPdfFileId` is a one-time write — once a version has ever been
      // sent (SENT, VIEWED, or any terminal status), it must never be
      // resent into, because that would silently overwrite the PDF/snapshot
      // an already-delivered link points to. Only a still-unsent DRAFT
      // version, or a `SENDING` version abandoned long enough to be
      // considered dead, is reused; anything else always mints a fresh
      // version instead, so the original link keeps resolving to exactly
      // what it was minted for.
      if (
        !version ||
        (version.status !== ProposalStatus.DRAFT && !isStaleSending)
      ) {
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

      const claim = await this.proposalVersionsRepo
        .createQueryBuilder()
        .update(ProposalVersion)
        .set({ status: ProposalStatus.SENDING })
        .where('id = :id', { id: version.id })
        .andWhere(
          new Brackets((qb) => {
            qb.where('status = :draft', {
              draft: ProposalStatus.DRAFT,
            }).orWhere(
              `status = :sending AND ${this.updatedAtColumn()} < :cutoff`,
              {
                sending: ProposalStatus.SENDING,
                cutoff: staleSendingCutoff,
              },
            );
          }),
        )
        .execute();
      if (!claim.affected) {
        // Lost the race — another concurrent request claimed (or reclaimed)
        // this exact version between our read and our write. Loop: the next
        // iteration will see it's no longer claimable and mint a new
        // version instead.
        continue;
      }

      // Re-read to capture the exact `updatedAt` this claim stamped — the
      // fencing token the finalize step checks before it ever writes
      // `sentPdfFileId`.
      const claimed = await this.proposalVersionsRepo.findOneOrFail({
        where: { id: version.id },
      });

      try {
        // Mint the acceptance link — local DB work only, no external call —
        // while still holding the claim, so the email we're about to render
        // always has a real signing URL.
        const linkPreview =
          await this.jobSignatures.createProposalSignatureRequest(
            jobId,
            version.id,
            customerEmail,
            customerName,
            viewer.userId,
            req,
          );
        return { version: claimed, linkPreview, claimedAt: claimed.updatedAt };
      } catch (err) {
        await this.releaseClaim(version.id, claimed.updatedAt, err).catch(
          () => undefined,
        );
        throw err;
      }
    }
    throw new ServiceUnavailableException({
      message:
        'Could not claim a proposal version to send right now. Please retry.',
      code: 'PROPOSAL_SEND_CONTENDED',
    });
  }

  /**
   * Best-effort release of a claimed-but-not-finished version back to
   * `DRAFT`. Conditional on the version still being `SENDING` *and* still
   * stamped with `claimedAt` — the fencing token from the claim this call is
   * releasing — so it can never release a claim a stale-reclaim has since
   * taken over (which would let a third caller pile onto an already-live
   * send). Never throws — callers treat this as cleanup, not part of the
   * error path they need to see.
   */
  /**
   * Dialect-safe identifier for the fence column. `"updatedAt"` is an
   * identifier on Postgres but a STRING LITERAL on MariaDB/MySQL (no
   * ANSI_QUOTES in production's sql_mode), so every fence/reclaim compared
   * the text 'updatedAt' against a date and matched nothing: finalize
   * always 503'd after the email had gone out, releaseClaim never released,
   * and rows stuck in `sending` forever. Let the driver quote it.
   */
  private updatedAtColumn(): string {
    return this.dataSource.driver.escape('updatedAt');
  }

  private async releaseClaim(
    versionId: string,
    claimedAt: Date,
    cause: unknown,
  ): Promise<void> {
    const release = await this.proposalVersionsRepo
      .createQueryBuilder()
      .update(ProposalVersion)
      .set({ status: ProposalStatus.DRAFT })
      .where('id = :id', { id: versionId })
      .andWhere('status = :sending', { sending: ProposalStatus.SENDING })
      .andWhere(`${this.updatedAtColumn()} = :claimedAt`, { claimedAt })
      .execute();
    if (release.affected) {
      this.logger.warn(
        `Released proposal version ${versionId} claim back to draft after failure: ${
          (cause as Error)?.message ?? String(cause)
        }`,
      );
    }
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
