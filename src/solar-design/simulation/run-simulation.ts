/**
 * Orchestrates the pure physics/finance modules into the §4 `SimulationResult`
 * contract. `runSimulation` itself is a pure function (no DB/HTTP) so it can
 * be unit-exercised directly from a throwaway script; `SolarSimulationService`
 * (the Nest-injectable) only resolves catalog lookups and calls this.
 */

import {
  DEFAULT_ANNUAL_DEGRADATION_PERCENT,
  DEFAULT_DC_AC_RATIO_WHEN_NO_INVERTER,
  DEFAULT_FIRST_YEAR_DEGRADATION_PERCENT,
  DEFAULT_GROUND_ALBEDO,
  DEFAULT_INVERTER_RATED_EFFICIENCY_PERCENT,
  FALLBACK_PANEL_HEIGHT_MM,
  FALLBACK_PANEL_WIDTH_MM,
  LIFETIME_YEARS,
} from './constants';
import {
  deriveClearnessIndexFromMonthlyGhi,
  getMonthlyAmbientTempC,
  getMonthlyClearnessIndex,
} from './climate';
import { computeOffset, resolveConsumption } from './consumption';
import { computeEnvironment } from './environment';
import {
  resolveNonTemperatureLosses,
  runProductionModel,
  type ResolvedArray,
} from './pv-production';
import { computeFinancials } from './financial';
import { buildWarnings } from './warnings';
import { polygonAreaM2 } from './geometry';
import type {
  DesignWarning,
  ObstructionInput,
  PanelSpec,
  RoofArrayInput,
  SimulationInput,
  SimulationResult,
} from './types';
import {
  InsetPolygonError,
  insetPolygon,
  panelRectangle,
  polygonFullyInsideAny,
  polygonsOverlap,
} from '../roof-geometry.util';

const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0);

const panelFootprintAreaM2 = (panel: PanelSpec | undefined): number => {
  const widthMm = panel?.widthMm ?? FALLBACK_PANEL_WIDTH_MM;
  const heightMm = panel?.heightMm ?? FALLBACK_PANEL_HEIGHT_MM;
  return (widthMm / 1000) * (heightMm / 1000);
};

type ArrayGeometryValidation = {
  /** ids of enabled panels that are geometrically valid — usable in the maths. */
  validPanelIds: Set<string>;
  /** ids of enabled panels excluded from the maths (off-roof, overlapping, or the whole array failed its setback). */
  invalidPanelIds: Set<string>;
  /** true when the array's setback leaves no buildable area at all — every enabled panel is excluded. */
  arraySetbackFailed: boolean;
};

/**
 * Geometric validity check for `/simulate` (item 3, roof-design-studio gap
 * list): the `PUT` path (`RoofDesignService.validateDoc`) rejects an invalid
 * design outright, but `/simulate` is the *live* feedback call fired on
 * every drag — it must never hard-fail mid-drag. Instead it excludes
 * geometrically invalid panels from the production/financial maths (so the
 * numbers on screen never silently include a panel hanging off the roof)
 * and reports them via `warnings`, using the exact same predicates
 * (`insetPolygon`, `panelRectangle`, `polygonFullyInsideAny`,
 * `polygonsOverlap`) the `PUT` validator uses, from `roof-geometry.util.ts`
 * — no second copy of this geometry.
 */
const validateArrayGeometry = (
  arrayInput: RoofArrayInput,
  panel: PanelSpec | undefined,
  obstructions: ObstructionInput[],
): ArrayGeometryValidation => {
  const enabledPanels = arrayInput.panels.filter((p) => p.enabled);
  const validPanelIds = new Set<string>();
  const invalidPanelIds = new Set<string>();

  let buildableAreas: ReturnType<typeof insetPolygon>;
  try {
    buildableAreas = insetPolygon(arrayInput.polygon, arrayInput.setbackM);
  } catch (err) {
    if (err instanceof InsetPolygonError) {
      for (const p of enabledPanels) invalidPanelIds.add(p.id);
      return { validPanelIds, invalidPanelIds, arraySetbackFailed: true };
    }
    throw err;
  }

  const widthMm = panel?.widthMm ?? FALLBACK_PANEL_WIDTH_MM;
  const heightMm = panel?.heightMm ?? FALLBACK_PANEL_HEIGHT_MM;
  const widthM = widthMm / 1000;
  const heightM = heightMm / 1000;

  const rects = enabledPanels.map((placement) => ({
    placement,
    rect: panelRectangle(
      placement.cx,
      placement.cy,
      widthM,
      heightM,
      placement.rotationDegrees,
    ),
  }));

  for (const { placement, rect } of rects) {
    if (!polygonFullyInsideAny(rect, buildableAreas)) {
      invalidPanelIds.add(placement.id);
      continue;
    }
    for (const obstruction of obstructions) {
      if (polygonsOverlap(rect, obstruction.polygon)) {
        invalidPanelIds.add(placement.id);
        break;
      }
    }
  }

  for (let i = 0; i < rects.length; i += 1) {
    if (invalidPanelIds.has(rects[i].placement.id)) continue;
    for (let j = i + 1; j < rects.length; j += 1) {
      if (invalidPanelIds.has(rects[j].placement.id)) continue;
      if (polygonsOverlap(rects[i].rect, rects[j].rect)) {
        invalidPanelIds.add(rects[i].placement.id);
        invalidPanelIds.add(rects[j].placement.id);
      }
    }
  }

  for (const p of enabledPanels) {
    if (!invalidPanelIds.has(p.id)) validPanelIds.add(p.id);
  }

  return { validPanelIds, invalidPanelIds, arraySetbackFailed: false };
};

export const runSimulation = (input: SimulationInput): SimulationResult => {
  const { doc } = input;
  const latitudeDeg = doc.anchor.lat;
  const panelsById = new Map(input.panels.map((p) => [p.id, p]));

  // Geometric validity (item 3): computed once per array, up front, so both
  // the resolved panel count feeding every downstream production/financial
  // number *and* the warnings shown to the user come from the same
  // exclusion set — never let the numbers and the explanation disagree.
  const geometryByArrayId = new Map(
    doc.arrays.map((arrayInput) => [
      arrayInput.id,
      validateArrayGeometry(
        arrayInput,
        panelsById.get(arrayInput.panelModelId),
        doc.obstructions,
      ),
    ]),
  );

  const resolvedArrays: ResolvedArray[] = doc.arrays.map((arrayInput) => {
    const panel = panelsById.get(arrayInput.panelModelId);
    const wattage = panel?.wattage ?? 0;
    const panelCount =
      geometryByArrayId.get(arrayInput.id)?.validPanelIds.size ?? 0;
    return {
      input: arrayInput,
      panel: panel ?? { id: arrayInput.panelModelId, wattage: 0 },
      panelCount,
      dcKwStc: (panelCount * wattage) / 1000,
    };
  });

  const dcKw = sum(resolvedArrays.map((a) => a.dcKwStc));
  const panelCount = sum(resolvedArrays.map((a) => a.panelCount));
  const acKw =
    input.inverter?.acKw ?? dcKw / DEFAULT_DC_AC_RATIO_WHEN_NO_INVERTER;
  const inverterEffPercent =
    input.inverter?.ratedEfficiencyPercent ??
    DEFAULT_INVERTER_RATED_EFFICIENCY_PERCENT;

  // Irradiance calibration priority: explicit clearness override > real
  // monthly GHI (derived to a real, per-location clearness index) > the
  // coarse latitude-band fallback table (see constants.ts header note).
  // `climateDataSource` is surfaced on the result so callers never present a
  // fallback-table estimate to a customer as a measured figure.
  let monthlyClearnessIndex: number[];
  let climateDataSource: 'real' | 'fallback-estimate' | 'override';
  if (input.climate?.monthlyClearnessIndex) {
    monthlyClearnessIndex = input.climate.monthlyClearnessIndex;
    climateDataSource = 'override';
  } else if (input.climate?.monthlyGhiKwhM2Day) {
    monthlyClearnessIndex = deriveClearnessIndexFromMonthlyGhi(
      latitudeDeg,
      input.climate.monthlyGhiKwhM2Day,
    );
    climateDataSource = 'real';
  } else {
    monthlyClearnessIndex = getMonthlyClearnessIndex(latitudeDeg);
    climateDataSource = 'fallback-estimate';
  }
  const climateDataSourceLabel =
    climateDataSource === 'real'
      ? 'Real satellite-derived irradiance (cached per location).'
      : climateDataSource === 'override'
        ? 'Caller-supplied clearness index override.'
        : 'Provisional estimate from a regional latitude-band average — not measured for this address; treat as a rough guide only.';
  const monthlyAmbientTempC =
    input.climate?.monthlyAmbientTempC ?? getMonthlyAmbientTempC(latitudeDeg);
  const groundAlbedo = input.climate?.groundAlbedo ?? DEFAULT_GROUND_ALBEDO;
  const transpositionModel = input.climate?.transpositionModel ?? 'perez';
  const iamGlazing =
    input.climate?.iamGlazingRefractiveIndex !== undefined ||
    input.climate?.iamGlazingExtinctionCoefficientPerM !== undefined ||
    input.climate?.iamGlazingThicknessM !== undefined
      ? {
          refractiveIndex: input.climate?.iamGlazingRefractiveIndex,
          extinctionCoefficientPerM:
            input.climate?.iamGlazingExtinctionCoefficientPerM,
          thicknessM: input.climate?.iamGlazingThicknessM,
        }
      : undefined;
  const decompositionModel = input.climate?.decompositionModel;
  const nonTempLosses = resolveNonTemperatureLosses(input.losses);

  const productionModel = runProductionModel({
    latitudeDeg,
    arrays: resolvedArrays,
    monthlyClearnessIndex,
    monthlyAmbientTempC,
    groundAlbedo,
    transpositionModel,
    iamGlazing,
    decompositionModel,
    nonTempLosses,
    acRatedKw: acKw,
    inverterRatedEfficiencyPercent: inverterEffPercent,
  });

  const annualKwh = sum(productionModel.monthlySystemAcKwh);
  const annualPoaKwhPerM2 = sum(
    productionModel.monthlyPoaKwhPerM2SystemWeighted,
  );
  // Performance ratio: actual AC yield vs the theoretical STC yield implied
  // by the annual plane-of-array insolation (Yf / Yr, Duffie & Beckman style).
  const performanceRatio =
    dcKw > 0 && annualPoaKwhPerM2 > 0
      ? annualKwh / dcKw / annualPoaKwhPerM2
      : 0;

  const arraySystemResults = resolvedArrays.map((a) => {
    const monthly =
      productionModel.perArrayMonthlyAcKwh.get(a.input.id) ??
      (new Array(12).fill(0) as number[]);
    const arrayAnnualKwh = sum(monthly);
    return {
      id: a.input.id,
      panelCount: a.panelCount,
      dcKw: a.dcKwStc,
      tiltDegrees: a.input.tiltDegrees,
      azimuthDegrees: a.input.azimuthDegrees,
      annualKwh: arrayAnnualKwh,
      specificYieldKwhPerKwp: a.dcKwStc > 0 ? arrayAnnualKwh / a.dcKwStc : 0,
    };
  });

  // 25-year degradation schedule: 2% year-1 LID, then a flat annual rate.
  const firstYearDegradationPercent =
    input.degradation?.firstYearPercent ??
    DEFAULT_FIRST_YEAR_DEGRADATION_PERCENT;
  const annualDegradationPercent =
    input.degradation?.annualPercent ?? DEFAULT_ANNUAL_DEGRADATION_PERCENT;
  const degradationFactors: number[] = [];
  for (let year = 1; year <= LIFETIME_YEARS; year += 1) {
    if (year === 1) {
      degradationFactors.push(1 - firstYearDegradationPercent / 100);
    } else {
      const prior = degradationFactors[year - 2];
      degradationFactors.push(prior * (1 - annualDegradationPercent / 100));
    }
  }
  const lifetimeKwh = degradationFactors.reduce(
    (s, factor) => s + annualKwh * factor,
    0,
  );

  const shadingWeightedAvg =
    dcKw > 0
      ? sum(resolvedArrays.map((a) => a.input.shadingLossPercent * a.dcKwStc)) /
        dcKw
      : 0;
  const tempLossPercent =
    productionModel.totalDcKwhBeforeInverter > 0
      ? (productionModel.totalTempLossWeightedKwh /
          productionModel.totalDcKwhBeforeInverter) *
        100
      : 0;
  const inverterLossPercent =
    productionModel.totalDcKwhBeforeInverter > 0
      ? ((productionModel.totalDcKwhBeforeInverter - annualKwh) /
          productionModel.totalDcKwhBeforeInverter) *
        100
      : 0;

  const consumption = resolveConsumption(input.consumption);
  const offset = computeOffset(
    latitudeDeg,
    productionModel.monthlySystemAcKwh,
    consumption.monthlyKwh,
    input.battery,
  );

  const financial = computeFinancials({
    dcWatts: dcKw * 1000,
    importKwh: offset.importKwh,
    exportKwh: offset.exportKwh,
    annualConsumptionKwh: consumption.annualKwh,
    productionDegradationFactors: degradationFactors,
    financial: input.financial,
  });

  const environment = computeEnvironment(
    annualKwh,
    lifetimeKwh,
    input.gridEmissionsFactorKgPerKwh,
  );

  const arrayPanelCounts = new Map(
    resolvedArrays.map((a) => [a.input.id, a.panelCount]),
  );
  const panelFootprintByArray = new Map(
    resolvedArrays.map((a) => [
      a.input.id,
      panelFootprintAreaM2(panelsById.get(a.input.panelModelId)),
    ]),
  );

  const warnings = buildWarnings({
    arrays: doc.arrays,
    obstructions: doc.obstructions,
    latitudeDeg,
    dcKw,
    acKw,
    offsetPercent: offset.offsetPercent,
    arrayPanelCounts,
    panelFootprintAreaM2: panelFootprintByArray,
  });

  // Excluded-panel warnings (item 3) — one per affected array, so the user
  // learns *why* the panel count / DC kW moved rather than the figures just
  // silently disagreeing with what's drawn on screen.
  for (const arrayInput of doc.arrays) {
    const geometry = geometryByArrayId.get(arrayInput.id);
    if (!geometry || geometry.invalidPanelIds.size === 0) continue;
    const excluded: DesignWarning = geometry.arraySetbackFailed
      ? {
          id: `array-setback-invalid-${arrayInput.id}`,
          tone: 'error',
          title: 'Array setback leaves no buildable area',
          message: `"${arrayInput.name}" cannot honour its ${arrayInput.setbackM}m setback on this roof plane — all ${geometry.invalidPanelIds.size} panel(s) on it are excluded from production and savings until the array or its panels are fixed.`,
          arrayId: arrayInput.id,
        }
      : {
          id: `panels-excluded-geometry-${arrayInput.id}`,
          tone: 'warning',
          title: 'Panels excluded from calculations',
          message: `${geometry.invalidPanelIds.size} panel(s) on "${arrayInput.name}" are off the buildable roof area, overlap another panel, or overlap an obstruction, and are excluded from production and savings figures. Fix their placement to include them.`,
          arrayId: arrayInput.id,
        };
    warnings.push(excluded);
  }

  if (climateDataSource === 'fallback-estimate') {
    // `warning`, not `info`: this materially affects every downstream kWh
    // and $ figure on the design, including the customer-facing PDF, which
    // (per `roof-proposal-pdf.service.ts`) only surfaces a "flagged for
    // review" note for warning/error-tone items. A provisional number that
    // does not announce itself as provisional is the exact failure mode the
    // P4 round-2 fix exists to prevent — do not silently downgrade this.
    warnings.push({
      id: 'climate-data-unavailable',
      tone: 'warning',
      title: 'Provisional irradiance estimate',
      message:
        'Real satellite irradiance data is not yet cached for this address, so production figures use a regional latitude-band average. Figures will refine automatically once site-specific data is available — treat them as provisional in the meantime.',
    });
  }

  // Roof-area-exhausted / usable-area sanity note: guards against pathological
  // zero-area polygons producing NaN warnings.
  for (const a of doc.arrays) {
    if (polygonAreaM2(a.polygon) === 0) {
      warnings.push({
        id: `zero-area-array-${a.id}`,
        tone: 'error',
        title: 'Invalid roof plane',
        message: `"${a.name}" has no measurable area — check its outline.`,
        arrayId: a.id,
      });
    }
  }

  return {
    system: {
      panelCount,
      dcKw,
      acKw,
      arrays: arraySystemResults,
    },
    production: {
      annualKwh,
      monthlyKwh: productionModel.monthlySystemAcKwh,
      specificYieldKwhPerKwp: dcKw > 0 ? annualKwh / dcKw : 0,
      performanceRatio,
      firstYearDegradationPercent,
      lifetimeKwh,
      climateDataSource,
      climateDataSourceLabel,
      lossStack: {
        soilingPercent: (1 - nonTempLosses.soiling) * 100,
        shadingPercentWeightedAvg: shadingWeightedAvg,
        mismatchPercent: (1 - nonTempLosses.mismatch) * 100,
        wiringPercent: (1 - nonTempLosses.wiring) * 100,
        connectionsPercent: (1 - nonTempLosses.connections) * 100,
        lightInducedDegradationPercent: (1 - nonTempLosses.lid) * 100,
        nameplatePercent: (1 - nonTempLosses.nameplate) * 100,
        availabilityPercent: (1 - nonTempLosses.availability) * 100,
        temperaturePercent: tempLossPercent,
        inverterPercent: inverterLossPercent,
      },
    },
    consumption,
    offset,
    financial,
    environment,
    warnings,
  };
};
