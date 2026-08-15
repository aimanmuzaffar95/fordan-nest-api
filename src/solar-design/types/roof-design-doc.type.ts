/**
 * Plain (non-decorated) shapes for the roof design document, mirroring
 * `docs/specs/solar-design-studio.md` §2 exactly. These are the types stored
 * in `RoofDesign.doc` (json) and returned to clients. The validated request
 * body uses the `class-validator`-decorated DTOs in `../dto/roof-design.dto`,
 * which are structurally compatible with these types.
 */

export type LocalPoint = { x: number; y: number };

export type RoofDesignImagery = {
  provider: string;
  zoom: number;
  capturedAt?: string | null;
  attribution: string;
  uploadFileId?: string | null;
};

export type PanelPlacement = {
  id: string;
  cx: number;
  cy: number;
  rotationDegrees: number;
  enabled: boolean;
};

export type RoofArray = {
  id: string;
  name: string;
  polygon: LocalPoint[];
  tiltDegrees: number;
  azimuthDegrees: number;
  panelModelId: string;
  panelOrientation: 'portrait' | 'landscape';
  rowSpacingM: number;
  columnSpacingM: number;
  setbackM: number;
  shadingLossPercent: number;
  panels: PanelPlacement[];
};

export type Obstruction = {
  id: string;
  kind: 'vent' | 'skylight' | 'chimney' | 'tree' | 'other';
  polygon: LocalPoint[];
  heightM?: number | null;
};

export type RoofDesignDoc = {
  version: 1;
  anchor: { lat: number; lng: number };
  imagery: RoofDesignImagery;
  arrays: RoofArray[];
  obstructions: Obstruction[];
  notes?: string;
};

/** Shape returned by `GET/PUT /jobs/:jobId/roof-design`. */
export type RoofDesignRecord = {
  jobId: string;
  doc: RoofDesignDoc;
  updatedAt: string;
  updatedByUserId: string | null;
  renderFileId: string | null;
};
