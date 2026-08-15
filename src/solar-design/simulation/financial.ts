/**
 * 25-year financial model: bill before/after, cashflow, payback (linear
 * interpolation within the crossing year, not a rounded integer), ROI,
 * NPV, and IRR by bisection (no closed form / no new dependency).
 * Money is only rounded to 2dp at the response boundary (`solar-simulation.service.ts`),
 * not inside these calculations, to avoid compounding rounding error.
 *
 * ASSUMPTION, not fact (round-7 note, raised by the critic): `FinancialInput`
 * (`params.financial`) is never populated by the only real caller today, and
 * no field exists anywhere on the job or customer entities to populate it
 * from — so in practice *every* proposal currently runs entirely on the
 * hardcoded defaults below (`./constants.ts`), not on any customer's actual
 * tariff. This is disclosed in the generated PDF's footer rather than
 * hidden, but it is worth naming explicitly here too, since whoever wires
 * real tariffs in later (a schema/product decision, out of this module's
 * scope) needs to know exactly what they are replacing:
 *   - `DEFAULT_IMPORT_TARIFF_PER_KWH`     = $0.30/kWh
 *   - `DEFAULT_FEED_IN_TARIFF_PER_KWH`    = $0.05/kWh
 *   - `DEFAULT_DAILY_SUPPLY_CHARGE`       = $1.00/day
 *   - `DEFAULT_TARIFF_ESCALATION_PERCENT` = 4%/yr
 *   - `DEFAULT_DISCOUNT_RATE_PERCENT`     = 6%/yr (NPV discount rate)
 *   - `DEFAULT_INSTALLED_COST_PER_WATT`   = $1.10/W
 *   - `DEFAULT_REBATE_AMOUNT`             = $0
 * None of these are measured, sourced, or customer-specific — they are
 * placeholder assumptions standing in for real tariff/finance data that
 * does not yet exist in this system.
 */

import {
  DEFAULT_DAILY_SUPPLY_CHARGE,
  DEFAULT_DISCOUNT_RATE_PERCENT,
  DEFAULT_FEED_IN_TARIFF_PER_KWH,
  DEFAULT_IMPORT_TARIFF_PER_KWH,
  DEFAULT_INSTALLED_COST_PER_WATT,
  DEFAULT_REBATE_AMOUNT,
  DEFAULT_TARIFF_ESCALATION_PERCENT,
  LIFETIME_YEARS,
} from './constants';
import type { FinancialInput } from './types';

export type FinancialModelParams = {
  dcWatts: number;
  importKwh: number;
  exportKwh: number;
  annualConsumptionKwh: number;
  /** Per-year fraction remaining vs year 1, e.g. [1, 0.995, 0.99, ...] length 25. */
  productionDegradationFactors: number[];
  financial?: FinancialInput;
};

export type FinancialModelResult = {
  grossCost: number;
  rebateAmount: number;
  netCost: number;
  year1Savings: number;
  monthlyBillBefore: number;
  monthlyBillAfter: number;
  paybackYears: number;
  roiPercent: number;
  npv: number;
  irrPercent: number;
  cashflow: Array<{ year: number; savings: number; cumulative: number }>;
  /** `'customer'` when both tariff rates came from the customer's bill; `'fallback-estimate'` otherwise. See `SimulationResult.financial.tariffSource`. */
  tariffSource: 'customer' | 'fallback-estimate';
};

const npvOf = (cashflows: number[], ratePercent: number): number => {
  const r = ratePercent / 100;
  return cashflows.reduce((sum, cf, i) => sum + cf / (1 + r) ** i, 0);
};

/** IRR by bisection on the NPV(rate)=0 root, since we add no numerics dependency. */
const irrByBisection = (cashflows: number[]): number => {
  // Round-7 fix: a degenerate all-zero cashflow (only reachable when both
  // netCost and year1Savings are exactly 0) makes `npvOf` identically 0 at
  // every rate. `npvLow * npvHigh` is then exactly 0, which slips past the
  // `> 0` no-sign-change guard below, and the bisection loop's
  // `Math.abs(npvMid) < 0.01` check fires on the very first midpoint —
  // returning a meaningless 225% "return" on a customer-facing document
  // (critic-reproduced). IRR is undefined for an all-zero cashflow; return
  // 0 rather than an arbitrary bisection artifact.
  if (cashflows.every((cf) => Math.abs(cf) < 1e-9)) return 0;

  // -0.5 (-50%), not -0.99: near r=-1, (1+r)^-i blows up for later years and
  // can produce a spurious NPV sign flip unrelated to a real root. -50% is
  // already far outside any plausible IRR for this system and keeps the
  // bracket numerically well-behaved.
  let low = -0.5;
  let high = 5; // 500%
  let npvLow = npvOf(cashflows, low * 100);
  const npvHigh = npvOf(cashflows, high * 100);
  if (Number.isNaN(npvLow) || Number.isNaN(npvHigh)) return 0;
  if (npvLow * npvHigh > 0) {
    // No sign change in range — cashflow never breaks even (or breaks even instantly).
    return npvOf(cashflows, 0) >= 0 ? high * 100 : low * 100;
  }
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const npvMid = npvOf(cashflows, mid * 100);
    if (Math.abs(npvMid) < 0.01) return mid * 100;
    if (npvLow * npvMid < 0) {
      high = mid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }
  return ((low + high) / 2) * 100;
};

export const computeFinancials = (
  params: FinancialModelParams,
): FinancialModelResult => {
  const {
    dcWatts,
    importKwh,
    exportKwh,
    annualConsumptionKwh,
    productionDegradationFactors,
  } = params;
  const f = params.financial ?? {};

  const grossCost = f.grossCost ?? dcWatts * DEFAULT_INSTALLED_COST_PER_WATT;
  const rebateAmount = f.rebateAmount ?? DEFAULT_REBATE_AMOUNT;
  const netCost = Math.max(0, grossCost - rebateAmount);

  // Both real tariff legs must be present to call this "customer" data —
  // one real rate and one defaulted rate would misrepresent the figures as
  // fully bill-accurate when only half of the inputs are.
  const tariffSource: 'customer' | 'fallback-estimate' =
    typeof f.importTariffPerKwh === 'number' &&
    typeof f.feedInTariffPerKwh === 'number'
      ? 'customer'
      : 'fallback-estimate';

  const importRate = f.importTariffPerKwh ?? DEFAULT_IMPORT_TARIFF_PER_KWH;
  const feedInRate = f.feedInTariffPerKwh ?? DEFAULT_FEED_IN_TARIFF_PER_KWH;
  const dailySupply = f.dailySupplyCharge ?? DEFAULT_DAILY_SUPPLY_CHARGE;
  const escalation =
    (f.escalationRatePercent ?? DEFAULT_TARIFF_ESCALATION_PERCENT) / 100;
  const discountRatePercent =
    f.discountRatePercent ?? DEFAULT_DISCOUNT_RATE_PERCENT;

  const annualSupplyCharge = dailySupply * 365;
  const billBeforeAnnual =
    typeof f.monthlyBillBefore === 'number'
      ? f.monthlyBillBefore * 12
      : annualConsumptionKwh * importRate + annualSupplyCharge;
  const billAfterYear1Annual =
    importKwh * importRate + annualSupplyCharge - exportKwh * feedInRate;
  const year1Savings = billBeforeAnnual - billAfterYear1Annual;

  const cashflow: Array<{ year: number; savings: number; cumulative: number }> =
    [];
  // `0 - netCost` (not the unary `-netCost`) deliberately: when netCost is
  // exactly 0 (a fully-rebated system), `-0` compares as NOT less than 0 in
  // JavaScript (`-0 < 0` is `false`), which silently broke the payback
  // crossing-detection loop below — a $0-net-cost system was reported as
  // "never pays back" (P4 round-6 fix). Subtraction of two positive zeros
  // yields `+0`, sidestepping the negative-zero footgun entirely.
  let cumulative = 0 - netCost;
  const flowsForIrr: number[] = [0 - netCost];

  for (let year = 1; year <= LIFETIME_YEARS; year += 1) {
    const escalationFactor = (1 + escalation) ** (year - 1);
    const degradationFactor = productionDegradationFactors[year - 1] ?? 1;
    // Savings scale with tariff escalation; the import/export split shifts
    // slightly with degradation (less export/self-consumption as output falls),
    // approximated here by scaling the whole year-1 savings by output degradation.
    const yearSavings = year1Savings * escalationFactor * degradationFactor;
    cumulative += yearSavings;
    cashflow.push({ year, savings: yearSavings, cumulative });
    flowsForIrr.push(yearSavings);
  }

  // Payback: linear-interpolate within the year the cumulative crosses zero.
  let paybackYears = LIFETIME_YEARS + 1;
  const startCumulative = 0 - netCost;
  if (startCumulative >= 0) {
    // A fully- or over-rebated system (netCost <= 0) is already broken even
    // before year 1's savings are counted at all — this is not a "crossing"
    // the loop below can detect (it only fires when the balance starts
    // negative and later reaches >= 0), so it must be handled explicitly.
    // Without this, the `-0 < 0 === false` bug above would have masked this
    // case even after the `0 - netCost` fix, because `prevCumulative` would
    // simply never be negative to begin with.
    paybackYears = 0;
  } else {
    let prevCumulative = startCumulative;
    for (const entry of cashflow) {
      if (entry.cumulative >= 0 && prevCumulative < 0) {
        const yearSpanDelta = entry.cumulative - prevCumulative;
        const fraction =
          yearSpanDelta !== 0 ? -prevCumulative / yearSpanDelta : 0;
        paybackYears = entry.year - 1 + fraction;
        break;
      }
      prevCumulative = entry.cumulative;
    }
    if (cashflow.length > 0 && cashflow[cashflow.length - 1].cumulative < 0) {
      paybackYears = LIFETIME_YEARS + 1; // never pays back within the modelled horizon
    }
  }

  const totalSavings25y = cashflow.reduce((s, c) => s + c.savings, 0);
  const roiPercent =
    netCost > 0 ? ((totalSavings25y - netCost) / netCost) * 100 : 0;
  const npv = npvOf(flowsForIrr, discountRatePercent);
  const irrPercent = irrByBisection(flowsForIrr);

  return {
    grossCost,
    rebateAmount,
    netCost,
    year1Savings,
    monthlyBillBefore: billBeforeAnnual / 12,
    monthlyBillAfter: billAfterYear1Annual / 12,
    paybackYears,
    roiPercent,
    npv,
    irrPercent,
    cashflow,
    tariffSource,
  };
};
