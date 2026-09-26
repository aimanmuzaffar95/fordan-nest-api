import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { Project } from '../projects/entities/project.entity';
import { PortalAccessToken } from './entities/portal-access-token.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import {
  ComplaintsService,
  PortalTicket,
} from '../complaints/complaints.service';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/entities/invoice-status.enum';
import {
  ProposalStatus,
  ProposalVersion,
} from '../proposals/entities/proposal-version.entity';
import { FilesService } from '../files/files.service';
import { JobQuotationService } from '../jobs/job-quotation.service';
import { RoofProposalService } from '../jobs/roof-proposal.service';
import { JobListViewer } from '../jobs/jobs.service';
import { User } from '../users/entities/user.entity';
import { AttendanceRecord } from '../attendance/entities/attendance-record.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { RoofDesignService } from '../solar-design/roof-design.service';
import { SolarSimulationService } from '../solar-design/solar-simulation.service';

/** Default link lifetime. Long enough to be useful, short enough to expire. */
const DEFAULT_TTL_DAYS = 90;

/**
 * Customer-visible milestones. Deliberately coarse and plain-language: the
 * portal must never leak internal stage names, pricing, margins, staff names,
 * or the existence of problems the company hasn't chosen to disclose.
 */
type PortalMilestone = {
  key: string;
  label: string;
  status: 'done' | 'current' | 'upcoming';
  date: string | null;
};

export type PortalStatusView = {
  customerFirstName: string;
  orderReference: string;
  systemSizeKw: number | null;
  batterySizeKwh: number | null;
  headline: string;
  milestones: PortalMilestone[];
  /** Scheduled install date, when one is set and confirmed. */
  scheduledInstallDate: string | null;
  completedAt: string | null;
  /** How to reach the installer — from Settings → Company profile. */
  support: { companyName: string; phone: string | null; email: string | null };
  /** The job's manager (the customer's agent), when one is assigned. */
  agent: { name: string; phone: string | null; email: string | null } | null;
  /** Who is scheduled / on site today — pinned on the portal. */
  today: PortalToday;
  /** Newest first. Plain-language progress notes derived from the job timeline. */
  updates: { at: string; text: string }[];
};

export type PortalDocuments = {
  proposal: {
    available: boolean;
    status: ProposalStatus | null;
    sentAt: string | null;
    acceptedAt: string | null;
    totalPrice: string | null;
  };
  quote: { available: boolean };
  invoices: {
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    issueDate: string;
    dueDate: string;
    total: string;
    amountPaid: string;
  }[];
  files: {
    id: string;
    name: string;
    contentType: string | null;
    sizeBytes: string | null;
    uploadedAt: string;
  }[];
};

export type PortalTodayCrew = {
  firstName: string;
  /** scheduled = assigned for today, not clocked in yet; on_site = clocked in; left = clocked out. */
  status: 'scheduled' | 'on_site' | 'left';
  slot: 'AM' | 'PM' | null;
  arrivedAt: string | null;
  leftAt: string | null;
};
export type PortalToday = {
  date: string;
  scheduled: boolean;
  onSiteNow: number;
  crew: PortalTodayCrew[];
};

export type PortalDesign = {
  panelCount: number;
  arrayCount: number;
  dcKw: number | null;
  annualKwh: number | null;
  annualSavings: number | null;
  paybackYears: number | null;
  hasRender: boolean;
  updatedAt: string;
};

/** Timeline event types the customer may see, and how to phrase them. */
const UPDATE_TEXT: Record<
  string,
  (payload: Record<string, unknown>) => string | null
> = {
  job_created: () => 'We received your enquiry.',
  proposal_sent: () => 'Your proposal has been sent to you.',
  proposal_accepted: () => 'Thanks — your proposal was accepted.',
  pre_meter: () => 'Your connection paperwork has been submitted.',
  post_meter: () => 'Final connection paperwork has been submitted.',
  meter_status_change: (p) =>
    p.status === 'approved'
      ? 'Your connection paperwork was approved.'
      : p.status === 'rejected'
        ? 'Some paperwork needs another look — we are on it.'
        : null,
  stage_change: (p) => {
    const idx =
      typeof p.toStage === 'string'
        ? STAGE_TO_MILESTONE_INDEX[p.toStage]
        : undefined;
    return typeof idx === 'number'
      ? `Progress: ${MILESTONE_SEQUENCE[idx].label.toLowerCase()}.`
      : null;
  },
};

/** Ordered customer-facing journey, mapped from internal stages. */
const MILESTONE_SEQUENCE: Array<{ key: string; label: string }> = [
  { key: 'enquiry', label: 'Enquiry received' },
  { key: 'quote', label: 'Quote provided' },
  { key: 'agreement', label: 'Agreement signed' },
  { key: 'approvals', label: 'Approvals and paperwork' },
  { key: 'scheduled', label: 'Installation scheduled' },
  { key: 'installed', label: 'System installed' },
  { key: 'connected', label: 'Connected and switched on' },
];

/** Internal pipeline stage → how far along the customer journey it is. */
const STAGE_TO_MILESTONE_INDEX: Record<string, number> = {
  lead: 0,
  quoted: 1,
  won: 2,
  pre_meter_submitted: 3,
  pre_meter_approved: 3,
  scheduled: 4,
  installed: 5,
  post_meter_submitted: 5,
  completed: 6,
  invoiced: 6,
  paid: 6,
};

@Injectable()
export class CustomerPortalService {
  constructor(
    @InjectRepository(PortalAccessToken)
    private readonly tokenRepo: Repository<PortalAccessToken>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(ProposalVersion)
    private readonly proposalVersionRepo: Repository<ProposalVersion>,
    private readonly settings: RuntimeSettingsService,
    private readonly complaints: ComplaintsService,
    private readonly files: FilesService,
    private readonly quotation: JobQuotationService,
    private readonly roofProposal: RoofProposalService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AttendanceRecord)
    private readonly attendanceRepo: Repository<AttendanceRecord>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    private readonly roofDesigns: RoofDesignService,
    private readonly simulation: SolarSimulationService,
  ) {}

  /** Roof design summary for the dashboard hero. Null when no design has been drawn. */
  async designForToken(token: string): Promise<PortalDesign | null> {
    const { job } = await this.resolveLiveToken(token);
    const design = await this.roofDesigns.getForJob(job.id);
    if (!design || design.doc.arrays.length === 0) return null;
    const arrays = design.doc.arrays;
    const panelCount = arrays.reduce(
      (sum, a) => sum + a.panels.filter((p) => p.enabled).length,
      0,
    );
    let dcKw: number | null = null;
    let annualKwh: number | null = null;
    let annualSavings: number | null = null;
    let paybackYears: number | null = null;
    try {
      const sim = await this.simulation.simulate(
        {
          version: design.doc.version,
          anchor: design.doc.anchor,
          arrays: design.doc.arrays,
          obstructions: design.doc.obstructions,
        } as Parameters<SolarSimulationService['simulate']>[0],
        job.id,
      );
      dcKw = sim.system.dcKw;
      annualKwh = sim.production.annualKwh;
      annualSavings = sim.financial?.year1Savings ?? null;
      paybackYears = sim.financial?.paybackYears ?? null;
    } catch {
      // Simulation is best-effort for the dashboard; the render + panel count still show.
    }
    return {
      panelCount,
      arrayCount: arrays.length,
      dcKw,
      annualKwh,
      annualSavings,
      paybackYears,
      hasRender: true,
      updatedAt: design.updatedAt,
    };
  }

  async renderForToken(token: string): Promise<Buffer | null> {
    const { job } = await this.resolveLiveToken(token);
    return this.roofProposal.renderImageForPortal(job.id);
  }

  /**
   * The PDF builders take a staff viewer for scoping. The portal token has
   * already pinned the request to one job, so an unscoped ADMIN viewer is
   * the correct equivalent; the id is a marker, never persisted.
   */
  private portalViewer(job: Job): JobListViewer {
    return {
      userId: `portal:${job.id}`,
      role: UserRole.ADMIN,
      jobScope: 'all',
      canViewJobFinancials: true,
    };
  }

  async documentsForToken(token: string): Promise<PortalDocuments> {
    const { job } = await this.resolveLiveToken(token);
    const [latestProposal, invoices, files] = await Promise.all([
      this.proposalVersionRepo.findOne({
        where: { jobId: job.id },
        order: { versionNumber: 'DESC' },
      }),
      this.invoiceRepo.find({
        where: { jobId: job.id },
        order: { issueDate: 'DESC' },
      }),
      this.files.listCustomerVisibleJobFiles(job.id),
    ]);

    const customerFacing = new Set<ProposalStatus>([
      ProposalStatus.SENT,
      ProposalStatus.VIEWED,
      ProposalStatus.ACCEPTED,
      ProposalStatus.DECLINED,
      ProposalStatus.EXPIRED,
    ]);
    const proposalAvailable =
      !!latestProposal && customerFacing.has(latestProposal.status);

    let quoteAvailable = false;
    try {
      await this.quotation.validateQuotationPrerequisites(
        job.id,
        this.portalViewer(job),
      );
      quoteAvailable = true;
    } catch {
      quoteAvailable = false;
    }

    return {
      proposal: {
        available: proposalAvailable,
        status:
          proposalAvailable && latestProposal ? latestProposal.status : null,
        sentAt: latestProposal?.sentAt
          ? latestProposal.sentAt.toISOString()
          : null,
        acceptedAt: latestProposal?.acceptedAt
          ? latestProposal.acceptedAt.toISOString()
          : null,
        totalPrice: proposalAvailable
          ? (latestProposal?.totalPrice ?? null)
          : null,
      },
      quote: { available: quoteAvailable },
      invoices: invoices
        .filter((inv) => inv.status !== InvoiceStatus.DRAFT)
        .map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          currency: inv.currency,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          total: inv.total,
          amountPaid: inv.amountPaid,
        })),
      files: files.map((f) => ({
        id: f.id,
        name: f.displayName?.trim() || f.originalName?.trim() || 'File',
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        uploadedAt: f.createdAt,
      })),
    };
  }

  async proposalPdfForToken(token: string) {
    const { job } = await this.resolveLiveToken(token);
    const latest = await this.proposalVersionRepo.findOne({
      where: { jobId: job.id },
      order: { versionNumber: 'DESC' },
    });
    if (
      !latest ||
      latest.status === ProposalStatus.DRAFT ||
      latest.status === ProposalStatus.SENDING
    ) {
      throw new NotFoundException('Not found');
    }
    return this.roofProposal.buildValidatedProposalPdf(
      job.id,
      this.portalViewer(job),
    );
  }

  async quotePdfForToken(token: string) {
    const { job } = await this.resolveLiveToken(token);
    return this.quotation.buildValidatedQuotationPdf(
      job.id,
      this.portalViewer(job),
    );
  }

  async fileForToken(token: string, fileId: string) {
    const { job } = await this.resolveLiveToken(token);
    return this.files.getCustomerVisibleJobFileDownload(job.id, fileId);
  }

  /**
   * Resolve a live portal token to its job and customer, or 404. Every
   * failure is the same 404 so tokens cannot be enumerated.
   */
  private async resolveLiveToken(
    token: string,
  ): Promise<{ record: PortalAccessToken; job: Job; customer: Customer }> {
    const flags = await this.settings.getFeatureFlags();
    if (!flags.customerPortal?.enabled) {
      throw new NotFoundException('Not found');
    }
    if (!token || token.length < 20) {
      throw new NotFoundException('Not found');
    }
    const record = await this.tokenRepo.findOne({
      where: { tokenHash: this.hash(token) },
    });
    if (
      !record ||
      record.revokedAt !== null ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundException('Not found');
    }
    const job = await this.jobRepo.findOne({ where: { id: record.jobId } });
    const customer = await this.customerRepo.findOne({
      where: { id: record.customerId },
    });
    if (!job || !customer) throw new NotFoundException('Not found');
    return { record, job, customer };
  }

  async ticketsForToken(token: string): Promise<PortalTicket[]> {
    const { job } = await this.resolveLiveToken(token);
    return this.complaints.listForPortal(job.id);
  }

  async createTicketForToken(
    token: string,
    subject: string,
    body: string,
  ): Promise<PortalTicket> {
    const { job, customer } = await this.resolveLiveToken(token);
    return this.complaints.createFromPortal({
      jobId: job.id,
      customerId: customer.id,
      subject,
      body,
    });
  }

  async replyForToken(
    token: string,
    ticketId: string,
    body: string,
  ): Promise<PortalTicket> {
    const { job } = await this.resolveLiveToken(token);
    return this.complaints.addCustomerMessage(ticketId, job.id, body);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mint a portal link for a job. Returns the plaintext token exactly once —
   * it is never retrievable again.
   */
  async issueToken(
    jobId: string,
    viewer: { userId: string; role: UserRole },
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ token: string; expiresAt: string }> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'customerPortal', viewer.role)) {
      throw new ForbiddenException(
        'The customer portal is not enabled for your role',
      );
    }

    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (viewer.role === UserRole.MANAGER && job.managerId !== viewer.userId) {
      throw new ForbiddenException('That job is not one of yours');
    }

    // 32 bytes of CSPRNG entropy — this is a bearer credential on a public
    // endpoint, so it must not be guessable or enumerable.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await this.tokenRepo.save(
      this.tokenRepo.create({
        tokenHash: this.hash(token),
        customerId: job.customerId,
        jobId: job.id,
        expiresAt,
        createdByUserId: viewer.userId,
      }),
    );

    return { token, expiresAt: expiresAt.toISOString() };
  }

  async revokeAllForJob(
    jobId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<{ revoked: number }> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'customerPortal', viewer.role)) {
      throw new ForbiddenException(
        'The customer portal is not enabled for your role',
      );
    }
    const live = await this.tokenRepo.find({
      where: { jobId, revokedAt: IsNull() },
    });
    if (live.length === 0) return { revoked: 0 };
    const now = new Date();
    await this.tokenRepo.save(live.map((t) => ({ ...t, revokedAt: now })));
    return { revoked: live.length };
  }

  /**
   * Resolve a portal token to a customer-safe status view.
   *
   * Public and unauthenticated. Returns a generic NotFound for every failure
   * mode — expired, revoked, or wrong — so the endpoint can't be used to probe
   * which tokens exist.
   */
  async statusForToken(token: string): Promise<PortalStatusView> {
    const { record, job, customer } = await this.resolveLiveToken(token);

    await this.tokenRepo.update(
      { id: record.id },
      {
        lastAccessedAt: new Date(),
        accessCount: record.accessCount + 1,
      },
    );

    // The delivery project, when the split is live, is the better source for
    // install/PTO dates.
    const project = await this.projectRepo.findOne({
      where: { jobId: job.id },
    });

    const reachedIndex = STAGE_TO_MILESTONE_INDEX[job.pipelineStage] ?? 0;
    const milestones: PortalMilestone[] = MILESTONE_SEQUENCE.map(
      (milestone, index) => ({
        key: milestone.key,
        label: milestone.label,
        status:
          index < reachedIndex
            ? 'done'
            : index === reachedIndex
              ? 'current'
              : 'upcoming',
        date: null,
      }),
    );

    const scheduledDate =
      project?.targetInstallDate ?? job.installDate ?? job.scheduledDate;
    const installedDate = project?.actualInstallDate ?? null;
    const ptoDate = project?.actualPtoDate ?? null;

    const setDate = (key: string, value: string | null) => {
      const found = milestones.find((m) => m.key === key);
      if (found && value) found.date = value;
    };
    setDate('scheduled', scheduledDate);
    setDate('installed', installedDate);
    setDate('connected', ptoDate);

    const [company, timeline, manager] = await Promise.all([
      this.settings.getSettings().then((all) => all.companyProfileSettings),
      this.timelineRepo.find({
        where: { jobId: job.id },
        order: { createdAt: 'DESC' },
        take: 40,
      }),
      job.managerId
        ? this.userRepo.findOne({ where: { id: job.managerId } })
        : Promise.resolve(null),
    ]);
    const today = await this.todayForJob(job.id);
    const updates = timeline
      .map((event) => {
        const phrase = UPDATE_TEXT[event.type];
        const text = phrase
          ? phrase((event.payload ?? {}) as Record<string, unknown>)
          : null;
        return text ? { at: event.createdAt.toISOString(), text } : null;
      })
      .filter((u): u is { at: string; text: string } => u !== null)
      .slice(0, 10);

    return {
      customerFirstName: customer.firstName,
      // Order number only. No pricing, no staff names, no internal notes.
      orderReference: job.orderNumber,
      systemSizeKw: job.systemSizeKw ? Number(job.systemSizeKw) : null,
      batterySizeKwh: job.batterySizeKwh ? Number(job.batterySizeKwh) : null,
      headline: this.headlineFor(reachedIndex, scheduledDate),
      milestones,
      scheduledInstallDate: scheduledDate,
      completedAt: ptoDate,
      support: {
        companyName: company.tradingName || company.legalName,
        phone: company.supportPhone,
        email: company.supportEmail,
      },
      agent: manager
        ? {
            name: `${manager.firstName} ${manager.lastName}`.trim(),
            phone: manager.phoneNumber?.trim() || null,
            email: manager.emailAddress?.trim() || null,
          }
        : null,
      updates,
      today,
    };
  }

  /**
   * Today's crew for the customer: assignments dated today plus any
   * attendance record opened today (clock-in without an assignment row
   * still counts — the customer cares who is physically there). First
   * names only.
   */
  private async todayForJob(jobId: string): Promise<PortalToday> {
    // "Today" is the company's local day (Settings → Company profile →
    // timezone), not UTC — an Australian customer checking at 8am must see
    // this morning's crew, not yesterday's UTC date.
    const tz =
      (await this.settings.getSettings()).companyProfileSettings.timezone ||
      'Australia/Sydney';
    const now = new Date();
    let date: string;
    try {
      date = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
    } catch {
      date = now.toISOString().slice(0, 10);
    }
    // ponytail: attendance is matched on a rolling 18h window (open sessions
    // always included) instead of exact local-midnight bounds; swap for a
    // tz-aware day range if overnight jobs ever matter.
    const since = new Date(now.getTime() - 18 * 3600 * 1000);
    const [assignments, records] = await Promise.all([
      this.assignmentRepo.find({
        where: { jobId, scheduledDate: date },
        relations: { staffUser: true },
      }),
      this.attendanceRepo
        .createQueryBuilder('a')
        .leftJoinAndSelect('a.staff', 'staff')
        .where('a.jobId = :jobId', { jobId })
        .andWhere('(a.clockOutAt IS NULL OR a.clockInAt >= :since)', { since })
        .orderBy('a.clockInAt', 'DESC')
        .getMany(),
    ]);
    const crew = new Map<string, PortalTodayCrew>();
    for (const a of assignments) {
      crew.set(a.staffUserId, {
        firstName: a.staffUser?.firstName?.trim() || 'Installer',
        status: 'scheduled',
        slot: a.slot === 'AM' || a.slot === 'PM' ? a.slot : null,
        arrivedAt: null,
        leftAt: null,
      });
    }
    for (const r of records) {
      // newest record per person wins (ordered DESC above)
      if (crew.get(r.staffId)?.arrivedAt) continue;
      const existing = crew.get(r.staffId);
      crew.set(r.staffId, {
        firstName:
          existing?.firstName ?? (r.staff?.firstName?.trim() || 'Installer'),
        status: r.clockOutAt ? 'left' : 'on_site',
        slot: existing?.slot ?? null,
        arrivedAt: r.clockInAt.toISOString(),
        leftAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
      });
    }
    const list = [...crew.values()];
    return {
      date,
      scheduled: list.length > 0,
      onSiteNow: list.filter((c) => c.status === 'on_site').length,
      crew: list,
    };
  }

  /** Plain-language status line — no jargon, no internal stage names. */
  private headlineFor(index: number, scheduledDate: string | null): string {
    switch (index) {
      case 0:
        return 'We have your enquiry and will be in touch shortly.';
      case 1:
        return 'Your quote is ready — let us know if you have any questions.';
      case 2:
        return 'Thanks for signing. We are getting the paperwork underway.';
      case 3:
        return 'We are waiting on approvals from your network provider.';
      case 4:
        return scheduledDate
          ? `Your installation is booked for ${scheduledDate}.`
          : 'Your installation is being scheduled.';
      case 5:
        return 'Your system is installed. We are finalising the connection.';
      default:
        return 'All done — your system is connected and running.';
    }
  }
}
