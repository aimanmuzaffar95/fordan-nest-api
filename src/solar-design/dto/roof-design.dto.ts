import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LocalPointDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}

export class RoofDesignImageryDto {
  @IsString()
  @MaxLength(60)
  provider: string;

  @IsNumber()
  @Min(0)
  @Max(24)
  zoom: number;

  @IsOptional()
  @IsString()
  capturedAt?: string | null;

  @IsString()
  @MaxLength(500)
  attribution: string;

  @IsOptional()
  @IsString()
  uploadFileId?: string | null;
}

export class PanelPlacementDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsNumber()
  cx: number;

  @IsNumber()
  cy: number;

  @IsNumber()
  @Min(-360)
  @Max(360)
  rotationDegrees: number;

  @IsBoolean()
  enabled: boolean;
}

export class RoofArrayDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LocalPointDto)
  polygon: LocalPointDto[];

  @IsNumber()
  @Min(0)
  @Max(60)
  tiltDegrees: number;

  @IsNumber()
  @Min(0)
  @Max(359.9)
  azimuthDegrees: number;

  @IsString()
  panelModelId: string;

  @IsIn(['portrait', 'landscape'])
  panelOrientation: 'portrait' | 'landscape';

  @IsNumber()
  @Min(0)
  @Max(5)
  rowSpacingM: number;

  @IsNumber()
  @Min(0)
  @Max(5)
  columnSpacingM: number;

  @IsNumber()
  @Min(0)
  @Max(5)
  setbackM: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  shadingLossPercent: number;

  /** Capped well above any realistic residential/commercial array to bound the O(n²) overlap checks in `RoofDesignService.validateDoc`. */
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PanelPlacementDto)
  panels: PanelPlacementDto[];
}

export class ObstructionDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsIn(['vent', 'skylight', 'chimney', 'tree', 'other'])
  kind: 'vent' | 'skylight' | 'chimney' | 'tree' | 'other';

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LocalPointDto)
  polygon: LocalPointDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  heightM?: number | null;
}

export class AnchorDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

/** Full-document body for `PUT /jobs/:jobId/roof-design`. */
export class RoofDesignDocDto {
  @IsIn([1])
  version: 1;

  @ValidateNested()
  @Type(() => AnchorDto)
  anchor: AnchorDto;

  @ValidateNested()
  @Type(() => RoofDesignImageryDto)
  imagery: RoofDesignImageryDto;

  /** Hard cap of 4 — enforced again in the service for a clearer 422 message. */
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => RoofArrayDto)
  arrays: RoofArrayDto[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ObstructionDto)
  obstructions: ObstructionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

/** Body for `POST /jobs/:jobId/roof-design/simulate`. */
export class SimulateRoofDesignDto extends RoofDesignDocDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBillBefore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  importRatePerKwh?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  exportRatePerKwh?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  annualConsumptionKwh?: number;
}

/**
 * Body for `POST /jobs/:jobId/roof-design/render`. `pngBase64` is the fast
 * path (browser-captured canvas). When the browser reports `not-ready` or
 * `cors-blocked` (or simply omits it), the API falls back to stitching the
 * tile grid itself — see `RoofDesignRenderService`.
 */
export class RenderRoofDesignDto {
  /** Data-URL or raw base64 PNG of the canvas render. */
  @IsOptional()
  @IsString()
  pngBase64?: string;

  @IsOptional()
  @IsIn(['cors-blocked', 'not-ready'])
  captureStatus?: 'cors-blocked' | 'not-ready';

  @IsOptional()
  @IsNumber()
  @Min(64)
  @Max(4096)
  widthPx?: number;

  @IsOptional()
  @IsNumber()
  @Min(64)
  @Max(4096)
  heightPx?: number;
}
