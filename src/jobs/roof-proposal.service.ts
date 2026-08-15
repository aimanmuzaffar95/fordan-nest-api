import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomerMessagingRendererService } from '../email/customer-messaging-renderer.service';
import { FilesService } from '../files/files.service';
import { CrmBrandingUploadSlot } from '../files/crm-branding.constants';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { Battery } from '../batteries/entities/battery.entity';
import { Inverter } from '../inverters/entities/inverter.entity';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { Customer } from '../customers/entities/customer.entity';
import { RoofDesignService } from '../solar-design/roof-design.service';
import {
  RoofDesignRenderCompositeService,
  metresPerPixel,
} from '../solar-design/roof-design-render-composite.service';
import { SolarImageryService } from '../solar-design/solar-imagery.service';
import {
  DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C,
  runSimulation,
  type PanelSpec,
  type RoofDesignDocInput,
  type SimulationInput,
  type SimulationResult,
} from '../solar-design/simulation';
import {
  PricingMode,
  ProposalStatus,
  ProposalVersion,
  isLiveProposalStatus,
} from '../proposals/entities/proposal-version.entity';
import { JobsService, type JobListViewer } from './jobs.service';
import {
  RoofProposalPdfService,
  type BuildRoofProposalPdfArgs,
  type RoofProposalEquipmentRow,
  type RoofProposalLineItem,
  type RoofProposalPricingMode,
} from './roof-proposal-pdf.service';
import type { ProposalConfigItem } from './job-quotation.service';
import type {
  RoofDesignDoc,
  RoofDesignRecord,
} from '../solar-design/types/roof-design-doc.type';

export type ValidatedRoofProposalResult = {
  pdfBuffer: Buffer;
  attachmentFilename: string;
  customerName: string;
  customerEmail: string | null;
};

const RENDER_FALLBACK_WIDTH_PX = 1200;
const RENDER_FALLBACK_HEIGHT_PX = 800;

@Injectable()
export class RoofProposalService {
  private readonly logger = new Logger(RoofProposalService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly roofDesigns: RoofDesignService,
    private readonly renderComposite: RoofDesignRenderCompositeService,
    private readonly imagery: SolarImageryService,
    private readonly files: FilesService,
    private readonly settings: RuntimeSettingsService,
    private readonly customerMessaging: CustomerMessagingRendererService,
    private readonly pdf: RoofProposalPdfService,
    @InjectRepository(ProposalVersion)
    private readonly proposalVersionsRepo: Repository<ProposalVersion>,
    @InjectRepository(SolarPanel)
    private readonly solarPanelsRepo: Repository<SolarPanel>,
    @InjectRepository(Inverter)
    private readonly invertersRepo: Repository<Inverter>,
    @InjectRepository(Battery)
    private readonly batteriesRepo: Repository<Battery>,
    @InjectRepository(Customer)
    private readonly customersRepo: Repository<Customer>,
  ) {}

  async buildValidatedProposalPdf(
    jobId: string,
    viewer: JobListViewer,
  ): Promise<ValidatedRoofProposalResult> {
    const [jobDetail, roofDesign, proposalConfig, latestProposalVersion] =
      await Promise.all([
        this.jobs.getOne(jobId, viewer),
        this.roofDesigns.getForJob(jobId),
        this.jobs.getProposalConfig(jobId, viewer),
        this.proposalVersionsRepo.findOne({
          where: { jobId },
          order: { versionNumber: 'DESC' },
        }),
      ]);

    if (!roofDesign || roofDesign.doc.arrays.length === 0) {
      throw new BadRequestException(
        'Save a roof design with at least one array before generating the proposal PDF',
      );
    }

    const customer = jobDetail.customer;
    const customerName =
      `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim() ||
      'Customer';
    const orderNumber = jobDetail.job.orderNumber;
    const attachmentFilename = `proposal_${orderNumber.toLowerCase()}.pdf`;

    const doc: RoofDesignDocInput = {
      version: roofDesign.doc.version,
      anchor: roofDesign.doc.anchor,
      arrays: roofDesign.doc.arrays,
      obstructions: roofDesign.doc.obstructions,
    };

    const panels = await this.resolvePanelSpecs(doc);

    // Round 7: the zero-price defect kept resurfacing (proposal version
    // totalPrice, then job.projectPrice) because "is there a real price"
    // was being answered separately at every call site, and each site's
    // fallback re-trusted a field that persists an unset price as `'0.00'`,
    // not `null` — `String(dto.totalPrice ?? 0)` in proposals.service.ts,
    // `dto.projectPrice ?? 0` in jobs.service.ts. Neither field can tell
    // "explicitly priced at zero" apart from "never priced", so neither can
    // be trusted on its own with a bare `!= null` check. `resolveAgreedPrice`
    // is now the *only* place that decides whether a real, agreed price
    // exists for this job: a priced proposal version first (finalised status
    // + strictly positive), then the job price only if it clears `> 0`
    // (mirroring `hasProjectPrice` in jobs.service.ts:1098-1099, which
    // already establishes `> 0` as this codebase's correct test). Every
    // commercial figure below — cover, investment page, payment schedule,
    // and the simulation's own cost basis — must be derived from its
    // result, not from re-reading `latestProposalVersion` or
    // `jobDetail.job.projectPrice` directly.
    const agreedPrice = this.resolveAgreedPrice(
      latestProposalVersion,
      jobDetail.job.projectPrice,
    );
    let pricedVersion =
      agreedPrice.source === 'version' ? agreedPrice.version : null;
    let agreedAmount = agreedPrice.amount;

    // Round 9: cheap, additive distinction for the cover's unpriced copy —
    // when there is no agreed price *and* the reason is specifically that
    // the only version we have was once priced but is no longer live
    // (declined/expired/superseded, not draft), "pricing has not been
    // finalised yet" is misleading in the opposite direction: it *was*
    // finalised, the customer just didn't take it or it lapsed. Falling
    // back to `jobDetail.job.projectPrice` still wins when it clears the
    // `> 0` bar (that's still a real, current price), so this only fires
    // when the job has genuinely nothing else to fall back on either.
    const priceDeclinedOrExpired =
      agreedAmount == null &&
      latestProposalVersion != null &&
      latestProposalVersion.status !== ProposalStatus.DRAFT &&
      !isLiveProposalStatus(latestProposalVersion.status) &&
      latestProposalVersion.totalPrice != null &&
      Number(latestProposalVersion.totalPrice) > 0;

    // Round 8: `computeFinancials` always recomputes off the *live* design
    // (`doc` above), but a priced version's totalPrice/rebate/deposit/etc.
    // are frozen at the moment it was priced — nothing previously compared
    // the two, so adding or removing panels after pricing (without a
    // reprice) left a real, positive agreed price sitting next to a system
    // that's no longer what was priced, with ROI/payback computed against
    // that now-wrong cost basis. Same defect family as rounds 5-7 (a
    // confident number on a document that doesn't back it), just entered
    // through the design side instead of the price side.
    //
    // `send()` (proposals.service.ts) freezes `systemSnapshot.roofDesign`
    // (the whole `RoofDesignRecord`, including its `updatedAt`) at send
    // time, so comparing that timestamp to the live design's `updatedAt` is
    // enough to detect drift without a deep polygon diff. Falls back to the
    // unpriced cover (no fabricated ROI) *and* states plainly why, rather
    // than silently keeping the stale price or silently keeping quiet about
    // it — either alone would repeat the same mistake in a new shape.
    //
    // Deliberately conservative: only versions that actually carry a
    // snapshot are checked. Versions sent before this snapshot existed (or
    // via a path that didn't populate it) have no baseline to compare
    // against, so they're left as-is rather than guessed at.
    const priceStaleSinceDesignChange = this.isPriceStaleSinceDesignChange(
      pricedVersion,
      roofDesign,
    );
    if (priceStaleSinceDesignChange) {
      pricedVersion = null;
      agreedAmount = null;
    }

    const batterySizeKwh = Number(jobDetail.job.batterySizeKwh ?? 0);
    const totalPrice = agreedAmount ?? undefined;
    const rebateAmount =
      pricedVersion?.rebateAmount != null
        ? Number(pricedVersion.rebateAmount)
        : undefined;

    // Round 10: this path previously never populated `importTariffPerKwh`/
    // `feedInTariffPerKwh` at all, so `computeFinancials` always fell back to
    // its hardcoded defaults and `tariffSource` was always
    // `'fallback-estimate'` here even for a customer whose real rates had
    // been captured (`solar-simulation.service.ts`'s interactive-studio path
    // already does this — this is the PDF path catching up to it). Both
    // legs must come from the customer's bill for `tariffSource` to read
    // `'customer'` (see `computeFinancials`'s own "both real tariff legs
    // must be present" comment) — a single real rate paired with a
    // defaulted one is still a `fallback-estimate`, which is exactly right:
    // partial data should never be presented as bill-accurate.
    const customerEntity = jobDetail.job.customerId
      ? await this.customersRepo.findOne({
          where: { id: jobDetail.job.customerId },
        })
      : null;
    const importTariffPerKwh =
      customerEntity?.importTariffPerKwh != null
        ? Number(customerEntity.importTariffPerKwh)
        : undefined;
    const feedInTariffPerKwh =
      customerEntity?.feedInTariffPerKwh != null
        ? Number(customerEntity.feedInTariffPerKwh)
        : undefined;
    const dailySupplyCharge =
      customerEntity?.dailySupplyCharge != null
        ? Number(customerEntity.dailySupplyCharge)
        : undefined;

    const simulationInput: SimulationInput = {
      doc,
      panels,
      financial: {
        grossCost: totalPrice,
        rebateAmount,
        importTariffPerKwh,
        feedInTariffPerKwh,
        dailySupplyCharge,
      },
      battery: batterySizeKwh > 0 ? { capacityKwh: batterySizeKwh } : null,
    };

    let simulation: SimulationResult;
    try {
      simulation = runSimulation(simulationInput);
    } catch (err) {
      this.logger.error(
        `Roof proposal simulation failed for job ${jobId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Could not simulate this roof design — check the design for invalid arrays before generating a proposal',
      );
    }

    const renderResult = await this.resolveRenderImage(jobId, roofDesign);

    const runtime = await this.settings.getSettings();
    const appearanceRaw = runtime.crmAppearanceSettings as unknown as Record<
      string,
      unknown
    >;
    const currency =
      typeof runtime.companyProfileSettings.currency === 'string' &&
      runtime.companyProfileSettings.currency.trim()
        ? runtime.companyProfileSettings.currency.trim()
        : 'USD';

    const pdfCopy = await this.customerMessaging.resolveQuotationPdfCopy({
      customerName,
      orderNumber,
    });
    const appearanceName =
      typeof appearanceRaw.appDisplayName === 'string'
        ? appearanceRaw.appDisplayName.trim()
        : '';
    const appearanceHex =
      typeof appearanceRaw.primaryHex === 'string'
        ? appearanceRaw.primaryHex.trim()
        : '';
    const brandName = appearanceName || pdfCopy.brandName;
    const primaryHex = appearanceHex || pdfCopy.primaryHex;

    let logoBytes: Buffer | undefined;
    try {
      const download = await this.files.getPublicCrmBrandingDownload(
        CrmBrandingUploadSlot.logo,
      );
      logoBytes = await this.streamToBuffer(download.stream);
    } catch {
      logoBytes = undefined;
    }

    const arrayRows = doc.arrays.map((arr) => {
      const result = simulation.system.arrays.find((a) => a.id === arr.id);
      return {
        id: arr.id,
        name: arr.name,
        tiltDegrees: arr.tiltDegrees,
        azimuthDegrees: arr.azimuthDegrees,
        panelCount: result?.panelCount ?? 0,
        dcKw: result?.dcKw ?? 0,
        annualKwh: result?.annualKwh ?? 0,
      };
    });

    const proposalItems = proposalConfig.items as ProposalConfigItem[];
    const pricingMode = this.resolvePricingMode(latestProposalVersion);
    const lineItems = this.buildLineItems(proposalItems);
    const equipment = await this.buildEquipmentRows(proposalItems);

    const pdfArgs: BuildRoofProposalPdfArgs = {
      attachmentFilename,
      pdfBrandName: brandName,
      pdfPrimaryHex: primaryHex,
      pdfHeadline: pdfCopy.headline,
      pdfThankYou: pdfCopy.thankYou,
      pdfFooterNote: pdfCopy.footerNote,
      currency,
      logoImageBytes: logoBytes,
      customerName,
      customerAddress: customer?.address?.trim() ?? '',
      orderNumber,
      systemTypeLabel: this.toSystemTypeLabel(jobDetail.job.systemType),
      renderImageBytes: renderResult.buffer,
      renderAttribution: roofDesign.doc.imagery.attribution,
      renderDegradedReason: renderResult.degradedReason,
      renderHasDesignOverlay: renderResult.hasDesignOverlay,
      arrays: arrayRows,
      simulation,
      // Every field below uses `!= null` / conditional-on-presence checks,
      // never `||`/truthy — a genuine $0 bill, $0 total price, $0 deposit
      // (e.g. a promotion), 0% interest or $0 monthly payment is real data,
      // not "unset", and must reach the PDF layer as a real zero rather
      // than collapsing to `null` ("Not available") one layer below where
      // the same class of bug was already fixed.
      monthlyBillBefore:
        simulation.financial.monthlyBillBefore != null
          ? simulation.financial.monthlyBillBefore
          : null,
      pricingMode,
      // Round 7: `totalPrice` is `agreedAmount` — already the single
      // resolved answer (and, as of round 8, already `null`'d out if the
      // priced version's design has since drifted) — safe to pass straight
      // through with no re-check against either raw source field.
      // `depositAmount` and every other commercial-terms field below still
      // key off `pricedVersion` (finalised status + totalPrice > 0, and now
      // also `null` when stale) rather than the raw `latestProposalVersion`
      // — an unpriced/stale draft's deposit/interest/term/monthly-payment/
      // PPA-rate are just as fabricated-looking as its totalPrice would be,
      // since none of them were actually agreed against what's shown either.
      totalPrice: agreedAmount,
      priceStaleSinceDesignChange,
      priceDeclinedOrExpired,
      depositAmount: pricedVersion
        ? Number(pricedVersion.depositAmount)
        : jobDetail.job.depositAmount != null
          ? Number(jobDetail.job.depositAmount)
          : null,
      rebateAmount: rebateAmount ?? null,
      interestRatePercent:
        pricedVersion?.interestRatePercent != null
          ? Number(pricedVersion.interestRatePercent)
          : null,
      termMonths: pricedVersion?.termMonths ?? null,
      monthlyPayment:
        pricedVersion?.monthlyPayment != null
          ? Number(pricedVersion.monthlyPayment)
          : null,
      ppaRatePerKwh:
        pricedVersion?.ppaRatePerKwh != null
          ? Number(pricedVersion.ppaRatePerKwh)
          : null,
      lineItems,
      equipmentPanels: equipment.panels,
      equipmentInverters: equipment.inverters,
      equipmentBatteries: equipment.batteries,
      // Round 10: only meaningful (and only ever populated) alongside
      // `simulation.financial.tariffSource === 'customer'` — both legs had
      // to be real for that to be true, so these are never partially set
      // when the PDF layer reads them. Pass the customer's own rates
      // through so the savings page can show *which* numbers were used
      // rather than just asserting they were real.
      customerImportTariffPerKwh: importTariffPerKwh ?? null,
      customerFeedInTariffPerKwh: feedInTariffPerKwh ?? null,
      customerDailySupplyCharge: dailySupplyCharge ?? null,
    };

    const pdfBuffer = await this.pdf.buildProposalPdf(pdfArgs);

    return {
      pdfBuffer,
      attachmentFilename,
      customerName,
      customerEmail: customer?.email ?? null,
    };
  }

  private resolvePricingMode(
    version: ProposalVersion | null,
  ): RoofProposalPricingMode {
    if (!version) return 'cash';
    switch (version.pricingMode) {
      case PricingMode.LOAN:
        return 'loan';
      case PricingMode.LEASE:
        return 'lease';
      case PricingMode.PPA:
        return 'ppa';
      default:
        return 'cash';
    }
  }

  private buildLineItems(items: ProposalConfigItem[]): RoofProposalLineItem[] {
    return items.map((item) => ({
      label: item.name,
      subtitle: item.subtitle,
      quantity: item.quantity,
      unitPrice: item.proposalUnitPrice,
      lineTotal: item.lineTotal,
    }));
  }

  private async buildEquipmentRows(items: ProposalConfigItem[]): Promise<{
    panels: RoofProposalEquipmentRow[];
    inverters: RoofProposalEquipmentRow[];
    batteries: RoofProposalEquipmentRow[];
  }> {
    const panelIds = items
      .filter((i) => i.equipmentType === 'panel')
      .map((i) => i.equipmentId);
    const inverterIds = items
      .filter((i) => i.equipmentType === 'inverter')
      .map((i) => i.equipmentId);
    const batteryIds = items
      .filter((i) => i.equipmentType === 'battery')
      .map((i) => i.equipmentId);

    const [panelRows, inverterRows, batteryRows] = await Promise.all([
      panelIds.length
        ? this.solarPanelsRepo.find({ where: { id: In(panelIds) } })
        : Promise.resolve([]),
      inverterIds.length
        ? this.invertersRepo.find({ where: { id: In(inverterIds) } })
        : Promise.resolve([]),
      batteryIds.length
        ? this.batteriesRepo.find({ where: { id: In(batteryIds) } })
        : Promise.resolve([]),
    ]);
    const panelsById = new Map(panelRows.map((p) => [p.id, p]));
    const invertersById = new Map(inverterRows.map((i) => [i.id, i]));
    const batteriesById = new Map(batteryRows.map((b) => [b.id, b]));

    const panels: RoofProposalEquipmentRow[] = items
      .filter((i) => i.equipmentType === 'panel')
      .map((item) => {
        const panel = panelsById.get(item.equipmentId);
        const specLines: string[] = [];
        if (item.wattage) specLines.push(`${item.wattage} W`);
        if (panel?.efficiency)
          specLines.push(`${panel.efficiency}% efficiency`);
        if (panel?.warrantyYears)
          specLines.push(`${panel.warrantyYears}yr warranty`);
        return {
          name: item.name,
          subtitle: item.subtitle,
          quantity: item.quantity,
          specLines,
        };
      });

    const inverters: RoofProposalEquipmentRow[] = items
      .filter((i) => i.equipmentType === 'inverter')
      .map((item) => {
        const inverter = invertersById.get(item.equipmentId);
        const specLines: string[] = [];
        if (item.inverterCapacityKw)
          specLines.push(`${item.inverterCapacityKw} kW`);
        if (inverter?.efficiency)
          specLines.push(`${inverter.efficiency}% efficiency`);
        if (inverter?.warrantyYears)
          specLines.push(`${inverter.warrantyYears}yr warranty`);
        return {
          name: item.name,
          subtitle: item.subtitle,
          quantity: item.quantity,
          specLines,
        };
      });

    const batteries: RoofProposalEquipmentRow[] = items
      .filter((i) => i.equipmentType === 'battery')
      .map((item) => {
        const battery = batteriesById.get(item.equipmentId);
        const specLines: string[] = [];
        if (item.batteryCapacityKwh)
          specLines.push(`${item.batteryCapacityKwh} kWh`);
        if (battery?.cycleLife) specLines.push(`${battery.cycleLife} cycles`);
        if (battery?.warrantyYears)
          specLines.push(`${battery.warrantyYears}yr warranty`);
        return {
          name: item.name,
          subtitle: item.subtitle,
          quantity: item.quantity,
          specLines,
        };
      });

    return { panels, inverters, batteries };
  }

  private async resolvePanelSpecs(
    doc: RoofDesignDocInput,
  ): Promise<PanelSpec[]> {
    const panelModelIds = Array.from(
      new Set(doc.arrays.map((a) => a.panelModelId)),
    ).filter(Boolean);
    if (panelModelIds.length === 0) return [];

    const rows = await this.solarPanelsRepo.find({
      where: { id: In(panelModelIds) },
    });
    return rows.map((row) => ({
      id: row.id,
      wattage: Number(row.wattage),
      tempCoefficientPerC: DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C / 100,
      noctC: null,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
    }));
  }

  /**
   * Resolves the roof render bytes with graceful, never-blank degradation:
   * 1) the stored `roof_design_render` file (fast path — canvas capture);
   * 2) a fresh server-side tile composite over the design's anchor/zoom;
   * 3) undefined — `RoofProposalPdfService` renders a clean placeholder,
   *    never a blank box or a red X.
   */
  private async resolveRenderImage(
    jobId: string,
    roofDesign: NonNullable<
      Awaited<ReturnType<RoofDesignService['getForJob']>>
    >,
  ): Promise<{
    buffer?: Buffer;
    degradedReason?: string;
    hasDesignOverlay?: boolean;
  }> {
    if (roofDesign.renderFileId) {
      try {
        const download = await this.files.getJobFileStreamWithKindGate({
          jobId,
          fileId: roofDesign.renderFileId,
          allowedKinds: ['roof_design_render'],
        });
        const buffer = await this.streamToBuffer(download.stream);
        // The stored `roof_design_render` file is always the browser's own
        // canvas capture of the designer, which draws the roof outline and
        // per-array overlay before exporting — it always has the design.
        return { buffer, hasDesignOverlay: true };
      } catch (err) {
        this.logger.warn(
          `Stored roof render unavailable for job ${jobId}, falling back to composite: ${(err as Error).message}`,
        );
      }
    }

    try {
      const panelSizeByModelId = await this.roofDesigns.resolvePanelSizesForDoc(
        roofDesign.doc,
      );
      const resolvedProvider = await this.imagery.resolveProvider();
      const zoom = this.resolveHeroCropZoom(
        roofDesign.doc,
        RENDER_FALLBACK_WIDTH_PX,
        RENDER_FALLBACK_HEIGHT_PX,
        resolvedProvider.maxNativeZoom,
      );
      const buffer = await this.renderComposite.composite(
        roofDesign.doc,
        zoom,
        RENDER_FALLBACK_WIDTH_PX,
        RENDER_FALLBACK_HEIGHT_PX,
        panelSizeByModelId,
      );
      // `RoofDesignRenderCompositeService` now draws each array's polygon
      // and every geometrically-valid enabled panel over the stitched
      // tiles (item 1, 2026-08-15), so this fallback tier carries the same
      // design overlay the browser capture does — flip `hasDesignOverlay`
      // accordingly (see roof-proposal-pdf §5 handling of that flag).
      return { buffer, hasDesignOverlay: true };
    } catch (err) {
      this.logger.warn(
        `Roof render composite failed for job ${jobId}: ${(err as Error).message}`,
      );
      return {
        degradedReason:
          'Satellite imagery is temporarily unavailable — your design details are below.',
      };
    }
  }

  /**
   * Round 7 — the single answer to "is there a real, agreed price for this
   * job, and what is it?". Every commercial figure in the generated PDF
   * (cover, investment page, payment schedule, and the simulation's cost
   * basis) must be derived from this, not from re-reading
   * `latestProposalVersion` or `jobDetail.job.projectPrice` at each call
   * site — that per-site duplication is exactly what let the zero-price
   * defect resurface twice after the first fix (proposal version
   * `totalPrice`, then `job.projectPrice`), because both fields persist an
   * *unset* price as the string `'0.00'`, not `null`
   * (`proposals.service.ts`'s `String(dto.totalPrice ?? 0)`,
   * `jobs.service.ts`'s `dto.projectPrice ?? 0`), so a bare `!= null` check
   * on either one silently admits "never priced" as if it were "priced at
   * zero". `> 0` is the only test that tells them apart — the same
   * reasoning `jobs.service.ts`'s own `hasProjectPrice` already applies
   * (`Number.isFinite(projectPrice) && projectPrice > 0`).
   *
   * Precedence: a priced proposal version (*live* status — `SENT`, `VIEWED`
   * or `ACCEPTED`, per `isLiveProposalStatus` — and strictly positive) wins
   * when one exists — it's the frozen, customer-shown snapshot. Only when
   * there is no such version do we fall back to the job's own price, and
   * only if that clears the same `> 0` bar. Anything else — no version and
   * no positive job price — resolves to "no agreed price", full stop;
   * callers only ever need to check the returned `amount` for `!= null`,
   * because this function has already done the "is it real" thinking for
   * them.
   *
   * Round 9: previously this only excluded `DRAFT`, so a `DECLINED`,
   * `EXPIRED` or `SUPERSEDED` version — offered once, but no longer a live
   * offer — still resolved to a confident agreed price. Owner-approved fix:
   * route through the shared `isLiveProposalStatus` predicate instead of a
   * local `!== DRAFT` test, so a declined/expired/superseded version now
   * falls through to the job-price/none path exactly like a draft does.
   */
  private resolveAgreedPrice(
    version: ProposalVersion | null,
    jobProjectPrice: number | string | null | undefined,
  ):
    | { source: 'version'; version: ProposalVersion; amount: number }
    | { source: 'job'; version: null; amount: number }
    | { source: 'none'; version: null; amount: null } {
    if (
      version &&
      isLiveProposalStatus(version.status) &&
      version.totalPrice != null &&
      Number(version.totalPrice) > 0
    ) {
      return { source: 'version', version, amount: Number(version.totalPrice) };
    }
    const jobPrice =
      jobProjectPrice != null && jobProjectPrice !== ''
        ? Number(jobProjectPrice)
        : NaN;
    if (Number.isFinite(jobPrice) && jobPrice > 0) {
      return { source: 'job', version: null, amount: jobPrice };
    }
    return { source: 'none', version: null, amount: null };
  }

  /**
   * Round 8 — true only when we have positive evidence the priced version's
   * frozen design has drifted from the live one. See the call site above
   * for the full reasoning; this is intentionally a shallow `updatedAt`
   * comparison (not a polygon-level diff) because `updatedAt` only ever
   * moves on a real `upsert` to the design, so any mismatch means *some*
   * edit happened after this version was priced — precise enough for "has
   * this changed at all", which is the question that matters here.
   */
  private isPriceStaleSinceDesignChange(
    version: ProposalVersion | null,
    liveRoofDesign: RoofDesignRecord | null,
  ): boolean {
    if (!version || !liveRoofDesign) return false;
    const snapshot = version.systemSnapshot as {
      roofDesign?: { updatedAt?: string };
    } | null;
    const snapshotUpdatedAt = snapshot?.roofDesign?.updatedAt;
    if (!snapshotUpdatedAt) return false;
    return snapshotUpdatedAt !== liveRoofDesign.updatedAt;
  }

  /**
   * Round 6, item 2 — the composite fallback used the design's *saved map
   * zoom* verbatim, which is whatever the user happened to be looking at
   * when they last saved (often zoomed out for neighbourhood context) —
   * not a crop chosen to show the customer their roof. Pick the tightest
   * zoom that still fits the whole design (all array polygons, in local
   * metres from the anchor) inside the render frame with a margin, so the
   * hero image is at least a tighter, correctly-centred crop on the
   * customer's own roof rather than a wide aerial the customer has to hunt
   * through. Never zooms out past what the user saved (that would show
   * *more* than intended), only in.
   *
   * Round 8 correction: my round-7 report claimed this takes a small array
   * to "~60% of the frame width". That was wrong — it was eyeballed off a
   * downtown-intersection test fixture, not computed against a realistic
   * residential array size. Worked through the real formula against typical
   * systems (3–12 panels, ~9–15 m² of roof): the `maxZoom` cap below binds
   * before `marginFraction` ever does, landing at roughly 6.5% (3 panels) to
   * 9–12% (10–12 panels) of frame width — a real, measurable improvement
   * over the saved-zoom baseline (roughly 19px to 50–90px wide in a 1200px
   * frame), but "locatable within the frame", not "dominant". The cap, not
   * the fit maths, is what's binding, which is why it's now threaded through
   * as a parameter from the configured imagery provider's own
   * `maxNativeZoom` (19 for Esri, 21 for Google, 22 for Mapbox) instead of a
   * flat `21` — a provider that genuinely supports more zoom now gets to use
   * it, rather than being capped to a number picked for the previous
   * (Esri-only) test.
   */
  private resolveHeroCropZoom(
    doc: RoofDesignDoc,
    widthPx: number,
    heightPx: number,
    maxZoom: number,
  ): number {
    const savedZoom = doc.imagery.zoom;
    const points = doc.arrays.flatMap((a) => a.polygon);
    if (points.length === 0) return savedZoom;

    const maxAbsX = Math.max(...points.map((p) => Math.abs(p.x)));
    const maxAbsY = Math.max(...points.map((p) => Math.abs(p.y)));
    if (maxAbsX === 0 && maxAbsY === 0) return savedZoom;

    // Design extent should occupy at most this fraction of the frame,
    // leaving a visible margin of surrounding roof/property context. In
    // practice `maxZoom` below binds long before this does for realistic
    // (small) residential arrays — see the correction above.
    const marginFraction = 0.62;
    const requiredMppX = (2 * maxAbsX) / (widthPx * marginFraction);
    const requiredMppY = (2 * maxAbsY) / (heightPx * marginFraction);
    const requiredMpp = Math.max(requiredMppX, requiredMppY);
    if (requiredMpp <= 0) return savedZoom;

    const mppAtSavedZoom = metresPerPixel(doc.anchor.lat, savedZoom);
    // metres-per-pixel halves each zoom level in; solve for the zoom whose
    // mpp matches what's required to fit the design with the margin above.
    const zoomDelta = Math.log2(mppAtSavedZoom / requiredMpp);
    const fitZoom = savedZoom + zoomDelta;

    // Only ever zoom in relative to what was saved, and never past what the
    // configured provider actually serves.
    return Math.min(maxZoom, Math.max(savedZoom, Math.round(fitZoom)));
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer | Uint8Array) =>
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
      );
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private toSystemTypeLabel(systemType: string): string {
    if (systemType === 'both') return 'Solar + Battery';
    if (systemType === 'battery') return 'Battery';
    return 'Solar';
  }
}
