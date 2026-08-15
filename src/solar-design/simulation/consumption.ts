/**
 * Consumption estimate + self-consumption/export/import split.
 *
 * We only have monthly production and monthly consumption totals (no true
 * interval/AMI data). To still model self-consumption vs export we synthesise
 * a daily *shape* for both — a half-sine daylight production curve (derived
 * from the same day-length the physics model already computes) and a fixed
 * generic residential consumption shape (`DEFAULT_HOURLY_CONSUMPTION_SHAPE`)
 * — and overlap them hour-by-hour for a representative day per month, then
 * scale by days-in-month. This is a simplification (real homes vary day to
 * day) but is far better than a flat annual offset ratio and is the standard
 * "shape overlap" approach used by lightweight solar calculators before
 * true 8760 interval data is available. A battery, if present, is dispatched
 * on that same representative day (reset each day — no inter-day carryover,
 * documented simplification; deep dispatch modelling needs real interval
 * data and is out of scope here).
 */

import {
  DAYS_IN_MONTH,
  DEFAULT_ANNUAL_CONSUMPTION_KWH,
  DEFAULT_BATTERY_ROUND_TRIP_EFFICIENCY_PERCENT,
  DEFAULT_BATTERY_USABLE_FRACTION,
  DEFAULT_HOURLY_CONSUMPTION_SHAPE,
  REPRESENTATIVE_DAY_OF_YEAR,
} from './constants';
import { declinationDeg, sunsetHourAngleDeg } from './solar-geometry';
import type { BatteryInput, ConsumptionInput } from './types';

export type ResolvedConsumption = {
  annualKwh: number;
  monthlyKwh: number[];
  source: 'bill' | 'interval' | 'estimate';
};

export const resolveConsumption = (
  input: ConsumptionInput | undefined,
): ResolvedConsumption => {
  if (input?.monthlyKwh && input.monthlyKwh.length === 12) {
    return {
      monthlyKwh: input.monthlyKwh,
      annualKwh: input.monthlyKwh.reduce((s, v) => s + v, 0),
      source: input.source ?? 'bill',
    };
  }
  if (typeof input?.annualKwh === 'number' && input.annualKwh > 0) {
    const monthly = DAYS_IN_MONTH.map(
      (days) => (input.annualKwh! * days) / 365,
    );
    return {
      annualKwh: input.annualKwh,
      monthlyKwh: monthly,
      source: input.source ?? 'bill',
    };
  }
  const annual = DEFAULT_ANNUAL_CONSUMPTION_KWH;
  const monthly = DAYS_IN_MONTH.map((days) => (annual * days) / 365);
  return { annualKwh: annual, monthlyKwh: monthly, source: 'estimate' };
};

/** Normalized (sum=1) half-sine daylight production shape over 24 clock-hour bins. */
const buildProductionShape = (
  latitudeDeg: number,
  dayOfYear: number,
): number[] => {
  const decl = declinationDeg(dayOfYear);
  const sunsetAngleDeg = sunsetHourAngleDeg(latitudeDeg, decl);
  const dayLengthHours = Math.max(0.1, (2 * sunsetAngleDeg) / 15);
  const start = 12 - dayLengthHours / 2;
  const end = 12 + dayLengthHours / 2;

  const raw: number[] = [];
  for (let h = 0; h < 24; h += 1) {
    const hourCentre = h + 0.5;
    if (hourCentre <= start || hourCentre >= end) {
      raw.push(0);
    } else {
      raw.push(Math.sin((Math.PI * (hourCentre - start)) / dayLengthHours));
    }
  }
  const sum = raw.reduce((s, v) => s + v, 0);
  return sum > 0 ? raw.map((v) => v / sum) : raw;
};

export type OffsetResult = {
  selfConsumptionKwh: number;
  exportKwh: number;
  importKwh: number;
  offsetPercent: number;
  selfSufficiencyPercent: number;
};

export const computeOffset = (
  latitudeDeg: number,
  monthlyProductionKwh: number[],
  monthlyConsumptionKwh: number[],
  battery?: BatteryInput | null,
): OffsetResult => {
  let selfConsumptionKwh = 0;
  let exportKwh = 0;
  let importKwh = 0;

  const usableCapacityKwh = battery
    ? battery.capacityKwh *
      (battery.usableFraction ?? DEFAULT_BATTERY_USABLE_FRACTION)
    : 0;
  const roundTripEff =
    (battery?.roundTripEfficiencyPercent ??
      DEFAULT_BATTERY_ROUND_TRIP_EFFICIENCY_PERCENT) / 100;
  const legEff = Math.sqrt(Math.max(0.01, roundTripEff));

  const consumptionShape = DEFAULT_HOURLY_CONSUMPTION_SHAPE;

  for (let month = 0; month < 12; month += 1) {
    const dayOfYear = REPRESENTATIVE_DAY_OF_YEAR[month];
    const daysInMonth = DAYS_IN_MONTH[month];
    const productionShape = buildProductionShape(latitudeDeg, dayOfYear);
    // Representative-day totals: the monthly kWh spread evenly across the
    // days in that month, then shaped hourly. Battery SOC is tracked across
    // this single representative day (reset each day — see file header) and
    // the day's totals are scaled by `daysInMonth` once, not per hour.
    const dailyProd = (monthlyProductionKwh[month] ?? 0) / daysInMonth;
    const dailyCons = (monthlyConsumptionKwh[month] ?? 0) / daysInMonth;

    let socKwh = 0;
    let daySelfConsumption = 0;
    let dayExport = 0;
    let dayImport = 0;

    for (let h = 0; h < 24; h += 1) {
      const prodHour = productionShape[h] * dailyProd;
      const consHour = consumptionShape[h] * dailyCons;

      const directSelf = Math.min(prodHour, consHour);
      let surplus = Math.max(0, prodHour - consHour);
      let deficit = Math.max(0, consHour - prodHour);
      let batteryDelivered = 0;

      if (usableCapacityKwh > 0) {
        if (surplus > 0) {
          const roomKwh = usableCapacityKwh - socKwh;
          const charge = Math.min(surplus, roomKwh / legEff);
          socKwh += charge * legEff;
          surplus -= charge;
        } else if (deficit > 0) {
          const available = socKwh * legEff;
          batteryDelivered = Math.min(deficit, available);
          socKwh -= batteryDelivered / legEff;
          deficit -= batteryDelivered;
        }
      }

      daySelfConsumption += directSelf + batteryDelivered;
      dayExport += surplus;
      dayImport += deficit;
    }

    selfConsumptionKwh += daySelfConsumption * daysInMonth;
    exportKwh += dayExport * daysInMonth;
    importKwh += dayImport * daysInMonth;
  }

  const annualConsumption = monthlyConsumptionKwh.reduce((s, v) => s + v, 0);
  const annualProduction = monthlyProductionKwh.reduce((s, v) => s + v, 0);

  return {
    selfConsumptionKwh,
    exportKwh,
    importKwh,
    offsetPercent:
      annualConsumption > 0 ? (annualProduction / annualConsumption) * 100 : 0,
    selfSufficiencyPercent:
      annualConsumption > 0
        ? (selfConsumptionKwh / annualConsumption) * 100
        : 0,
  };
};
