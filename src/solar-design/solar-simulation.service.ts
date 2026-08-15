import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { SimulateRoofDesignDto } from './dto/roof-design.dto';
import { IrradianceCacheService } from './irradiance/irradiance-cache.service';
import {
  DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C,
  runSimulation,
  type FinancialInput,
  type PanelSpec,
  type RoofDesignDocInput,
  type SimulationResult,
} from './simulation';

/**
 * P4 owns this service's body (physics/finance) — P1 owns the controller and
 * `SimulateRoofDesignDto` request body (`./dto/roof-design.dto`) and the
 * `RoofDesign`/module registration, both already wired to call
 * `simulate(dto)` directly. This service maps that DTO onto the engine's
 * input shape, resolves panel specs from the catalog, and rounds the
 * response at the boundary; all physics/finance math lives in
 * `./simulation/*` as standalone, dependency-free modules.
 *
 * `production.lossStack` (soiling/shading/mismatch/wiring/connections/LID/
 * nameplate/availability/temperature/inverter, each individually computed
 * per spec item 4) is included on the returned `SimulationResult` — it's an
 * additive field beyond spec §4's literal example, safe for clients that
 * don't read it yet.
 *
 * Tariff resolution precedence (added alongside per-customer tariff
 * capture): an explicit per-request override on `dto` wins (lets a rep try
 * "what if" rates in the live studio without touching the customer record),
 * then the customer's captured bill (`Customer.importTariffPerKwh` etc — see
 * that entity for why these are nullable, never defaulted to 0), then the
 * engine's own documented defaults (`./simulation/financial.ts` module
 * header). `financial.tariffSource` on the result tells the caller which of
 * the latter two applied.
 */

/** Rounds every numeric leaf of the result to sane display precision (money 2dp, energy 1dp, percent 2dp). */
const roundResult = (result: SimulationResult): SimulationResult => {
  const round = (value: number, dp: number): number => {
    const factor = 10 ** dp;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  };
  const roundArr = (values: number[], dp: number): number[] =>
    values.map((v) => round(v, dp));

  return {
    system: {
      ...result.system,
      dcKw: round(result.system.dcKw, 3),
      acKw: round(result.system.acKw, 3),
      arrays: result.system.arrays.map((a) => ({
        ...a,
        dcKw: round(a.dcKw, 3),
        annualKwh: round(a.annualKwh, 1),
        specificYieldKwhPerKwp: round(a.specificYieldKwhPerKwp, 1),
      })),
    },
    production: {
      ...result.production,
      annualKwh: round(result.production.annualKwh, 1),
      monthlyKwh: roundArr(result.production.monthlyKwh, 1),
      specificYieldKwhPerKwp: round(
        result.production.specificYieldKwhPerKwp,
        1,
      ),
      performanceRatio: round(result.production.performanceRatio, 4),
      lifetimeKwh: round(result.production.lifetimeKwh, 0),
      lossStack: {
        soilingPercent: round(result.production.lossStack.soilingPercent, 2),
        shadingPercentWeightedAvg: round(
          result.production.lossStack.shadingPercentWeightedAvg,
          2,
        ),
        mismatchPercent: round(result.production.lossStack.mismatchPercent, 2),
        wiringPercent: round(result.production.lossStack.wiringPercent, 2),
        connectionsPercent: round(
          result.production.lossStack.connectionsPercent,
          2,
        ),
        lightInducedDegradationPercent: round(
          result.production.lossStack.lightInducedDegradationPercent,
          2,
        ),
        nameplatePercent: round(
          result.production.lossStack.nameplatePercent,
          2,
        ),
        availabilityPercent: round(
          result.production.lossStack.availabilityPercent,
          2,
        ),
        temperaturePercent: round(
          result.production.lossStack.temperaturePercent,
          2,
        ),
        inverterPercent: round(result.production.lossStack.inverterPercent, 2),
      },
    },
    consumption: {
      ...result.consumption,
      annualKwh: round(result.consumption.annualKwh, 1),
      monthlyKwh: roundArr(result.consumption.monthlyKwh, 1),
    },
    offset: {
      selfConsumptionKwh: round(result.offset.selfConsumptionKwh, 1),
      exportKwh: round(result.offset.exportKwh, 1),
      importKwh: round(result.offset.importKwh, 1),
      offsetPercent: round(result.offset.offsetPercent, 1),
      selfSufficiencyPercent: round(result.offset.selfSufficiencyPercent, 1),
    },
    financial: {
      grossCost: round(result.financial.grossCost, 2),
      rebateAmount: round(result.financial.rebateAmount, 2),
      netCost: round(result.financial.netCost, 2),
      year1Savings: round(result.financial.year1Savings, 2),
      monthlyBillBefore: round(result.financial.monthlyBillBefore, 2),
      monthlyBillAfter: round(result.financial.monthlyBillAfter, 2),
      paybackYears: round(result.financial.paybackYears, 2),
      roiPercent: round(result.financial.roiPercent, 2),
      npv: round(result.financial.npv, 2),
      irrPercent: round(result.financial.irrPercent, 2),
      cashflow: result.financial.cashflow.map((c) => ({
        year: c.year,
        savings: round(c.savings, 2),
        cumulative: round(c.cumulative, 2),
      })),
      tariffSource: result.financial.tariffSource,
    },
    environment: {
      co2AvoidedTonnesPerYear: round(
        result.environment.co2AvoidedTonnesPerYear,
        3,
      ),
      co2AvoidedTonnes25y: round(result.environment.co2AvoidedTonnes25y, 2),
      treesEquivalent: round(result.environment.treesEquivalent, 1),
      carsEquivalent: round(result.environment.carsEquivalent, 2),
    },
    warnings: result.warnings,
  };
};

@Injectable()
export class SolarSimulationService {
  constructor(
    @InjectRepository(SolarPanel)
    private readonly solarPanelsRepo: Repository<SolarPanel>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(Customer)
    private readonly customersRepo: Repository<Customer>,
    private readonly irradianceCache: IrradianceCacheService,
  ) {}

  async simulate(
    dto: SimulateRoofDesignDto,
    jobId?: string,
  ): Promise<SimulationResult> {
    const doc: RoofDesignDocInput = {
      version: dto.version,
      anchor: dto.anchor,
      arrays: dto.arrays,
      obstructions: dto.obstructions,
    };
    const panels = await this.resolvePanelSpecs(doc);

    // P4 round-2 fix: read only from the persisted irradiance cache here —
    // a plain indexed DB lookup, not a network call, so this stays well
    // under the 100ms debounced-drag budget. On a cache miss, fall back to
    // the engine's own documented latitude-band estimate (which flags the
    // result as `production.climateDataSource = 'fallback-estimate'` and
    // adds a customer-safe warning) and kick off a background fetch so the
    // *next* simulate() call for this location gets real data.
    const cached = await this.irradianceCache.getCached(
      doc.anchor.lat,
      doc.anchor.lng,
    );
    if (!cached) {
      void this.irradianceCache.warmCache(doc.anchor.lat, doc.anchor.lng);
    }

    const financial = await this.resolveFinancialInput(dto, jobId);

    const result = runSimulation({
      doc,
      panels,
      climate: cached
        ? { monthlyGhiKwhM2Day: cached.monthlyGhiKwhM2Day }
        : undefined,
      financial,
      consumption: {
        annualKwh: dto.annualConsumptionKwh,
        source:
          typeof dto.annualConsumptionKwh === 'number' ? 'bill' : undefined,
      },
    });

    return roundResult(result);
  }

  /**
   * Precedence: explicit per-request override (`dto.importRatePerKwh` etc,
   * a rep trying "what if" rates in the live studio) > the customer's
   * captured bill (`Customer.importTariffPerKwh` etc) > engine defaults
   * (left `undefined` here so `computeFinancials` applies them and reports
   * `tariffSource: 'fallback-estimate'`).
   */
  private async resolveFinancialInput(
    dto: SimulateRoofDesignDto,
    jobId?: string,
  ): Promise<FinancialInput> {
    let customer: Customer | null = null;
    if (jobId) {
      const job = await this.jobsRepo.findOne({
        where: { id: jobId },
        select: { id: true, customerId: true },
      });
      if (job?.customerId) {
        customer = await this.customersRepo.findOne({
          where: { id: job.customerId },
        });
      }
    }

    const importTariffPerKwh =
      dto.importRatePerKwh ??
      (customer?.importTariffPerKwh != null
        ? Number(customer.importTariffPerKwh)
        : undefined);
    const feedInTariffPerKwh =
      dto.exportRatePerKwh ??
      (customer?.feedInTariffPerKwh != null
        ? Number(customer.feedInTariffPerKwh)
        : undefined);
    const dailySupplyCharge =
      customer?.dailySupplyCharge != null
        ? Number(customer.dailySupplyCharge)
        : undefined;
    const monthlyBillBefore =
      dto.monthlyBillBefore ??
      (customer?.averageMonthlyBill != null
        ? Number(customer.averageMonthlyBill)
        : undefined);

    return {
      importTariffPerKwh,
      feedInTariffPerKwh,
      dailySupplyCharge,
      monthlyBillBefore,
    };
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
      // `widthMm`/`heightMm` are numeric columns on `SolarPanel` (P1); the
      // engine falls back to the spec's default panel dimensions when unset.
      widthMm: row.widthMm,
      heightMm: row.heightMm,
    }));
  }
}
