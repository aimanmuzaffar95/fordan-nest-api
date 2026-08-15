/** Customer-safe design warnings, per spec §4's minimum list. */

import {
  AWAY_FROM_EQUATOR_THRESHOLD_DEG,
  DC_AC_RATIO_MAX,
  DC_AC_RATIO_MIN,
  MAX_ARRAYS,
  OFFSET_WARNING_THRESHOLD_PERCENT,
  ROOF_AREA_EXHAUSTED_COVERAGE_FRACTION,
  SHADING_WARNING_THRESHOLD_PERCENT,
} from './constants';
import { pointInPolygon, polygonAreaM2 } from './geometry';
import type { DesignWarning, ObstructionInput, RoofArrayInput } from './types';

export type WarningInputs = {
  arrays: RoofArrayInput[];
  obstructions: ObstructionInput[];
  latitudeDeg: number;
  dcKw: number;
  acKw: number;
  offsetPercent: number;
  arrayPanelCounts: Map<string, number>;
  panelFootprintAreaM2: Map<string, number>; // per-panel footprint area
};

const equatorFacingAzimuth = (latitudeDeg: number): number =>
  latitudeDeg >= 0 ? 180 : 0;

const angularDifference = (a: number, b: number): number => {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
};

export const buildWarnings = (inputs: WarningInputs): DesignWarning[] => {
  const warnings: DesignWarning[] = [];
  const { arrays, obstructions, latitudeDeg, dcKw, acKw, offsetPercent } =
    inputs;

  if (arrays.length > MAX_ARRAYS) {
    warnings.push({
      id: 'too-many-arrays',
      tone: 'error',
      title: 'Too many arrays',
      message: `A design may contain at most ${MAX_ARRAYS} arrays.`,
    });
  }

  // Panels overlapping an obstruction.
  for (const array of arrays) {
    for (const panel of array.panels) {
      if (!panel.enabled) continue;
      for (const obstruction of obstructions) {
        if (pointInPolygon({ x: panel.cx, y: panel.cy }, obstruction.polygon)) {
          warnings.push({
            id: `panel-overlaps-obstruction-${panel.id}`,
            tone: 'error',
            title: 'Panel overlaps an obstruction',
            message: `A panel on "${array.name}" overlaps a ${obstruction.kind}. Move or remove it.`,
            arrayId: array.id,
          });
        }
      }
    }
  }

  const dcAcRatio = acKw > 0 ? dcKw / acKw : 0;
  if (
    dcAcRatio > 0 &&
    (dcAcRatio < DC_AC_RATIO_MIN || dcAcRatio > DC_AC_RATIO_MAX)
  ) {
    warnings.push({
      id: 'dc-ac-ratio-out-of-range',
      tone: 'warning',
      title: 'Unusual DC:AC ratio',
      message: `The DC:AC ratio is ${dcAcRatio.toFixed(2)}, outside the typical ${DC_AC_RATIO_MIN}-${DC_AC_RATIO_MAX} range. Check the inverter sizing.`,
    });
  }

  const idealAzimuth = equatorFacingAzimuth(latitudeDeg);
  for (const array of arrays) {
    const diff = angularDifference(array.azimuthDegrees, idealAzimuth);
    if (diff > AWAY_FROM_EQUATOR_THRESHOLD_DEG) {
      warnings.push({
        id: `array-away-from-equator-${array.id}`,
        tone: 'warning',
        title: 'Array faces away from the sun',
        message: `"${array.name}" faces away from the equator, which will significantly reduce its production.`,
        arrayId: array.id,
      });
    }

    if (array.shadingLossPercent > SHADING_WARNING_THRESHOLD_PERCENT) {
      warnings.push({
        id: `high-shading-${array.id}`,
        tone: 'warning',
        title: 'High shading loss',
        message: `"${array.name}" has a shading loss of ${array.shadingLossPercent}%, above the ${SHADING_WARNING_THRESHOLD_PERCENT}% guideline.`,
        arrayId: array.id,
      });
    }

    const usableAreaM2 = Math.max(0, polygonAreaM2(array.polygon));
    const footprintPerPanel = inputs.panelFootprintAreaM2.get(array.id) ?? 0;
    const panelCount = inputs.arrayPanelCounts.get(array.id) ?? 0;
    const occupiedAreaM2 = footprintPerPanel * panelCount;
    if (
      usableAreaM2 > 0 &&
      occupiedAreaM2 / usableAreaM2 >= ROOF_AREA_EXHAUSTED_COVERAGE_FRACTION
    ) {
      warnings.push({
        id: `roof-area-exhausted-${array.id}`,
        tone: 'info',
        title: 'Roof area fully utilized',
        message: `"${array.name}" is at or near its panel capacity for the available roof area.`,
        arrayId: array.id,
      });
    }
  }

  if (offsetPercent > OFFSET_WARNING_THRESHOLD_PERCENT) {
    warnings.push({
      id: 'offset-oversized',
      tone: 'warning',
      title: 'System oversized for consumption',
      message: `Estimated production is ${offsetPercent.toFixed(0)}% of consumption, above the ${OFFSET_WARNING_THRESHOLD_PERCENT}% guideline. Excess export may be worth less than self-consumption.`,
    });
  }

  const panelModelIds = new Set(arrays.map((a) => a.panelModelId));
  if (panelModelIds.size > 1) {
    warnings.push({
      id: 'mixed-panel-models',
      tone: 'info',
      title: 'Mixed panel models',
      message:
        'Different arrays use different panel models, which can complicate warranty and monitoring.',
    });
  }

  return warnings;
};
