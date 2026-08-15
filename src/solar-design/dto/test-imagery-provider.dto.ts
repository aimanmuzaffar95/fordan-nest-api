import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Body for `POST /solar-design/imagery-test` — verifies a provider/key
 * server-side by fetching one real tile, without persisting anything.
 * `apiKey` is optional so the currently *saved* key can be tested by
 * omitting it (e.g. after `google`/`mapbox` is already configured).
 */
export class TestImageryProviderDto {
  @IsIn(['esri', 'google', 'mapbox'])
  provider: 'esri' | 'google' | 'mapbox';

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  apiKey?: string;

  // Sample coordinate the reported metres-per-pixel is computed at. Defaults
  // to a representative mid-latitude coordinate if omitted.
  @IsOptional()
  @IsLatitude()
  sampleLat?: number;

  @IsOptional()
  @IsLongitude()
  sampleLon?: number;
}
