import { Injectable } from '@nestjs/common';
import { TILE_TOKEN_TTL_MS } from './solar-tile-token.service';

export type ImageryProvider = 'esri-world-imagery' | 'google' | 'mapbox';

/**
 * Canonical shape per §6 of `docs/specs/solar-design-studio.md` (settled
 * 2026-08-15, `expiresAt` added 2026-08-15 addendum below). `expiresAt` is
 * an authoritative ISO-8601 UTC timestamp (`Date#toISOString()`, e.g.
 * `"2026-08-15T10:20:30.000Z"`) for when the frontend should re-request this
 * token — anchored to the same clock the token was minted on, not something
 * the client derives from a locally-observed response time, which erodes
 * under request latency and clock drift. Always present, even for keyless
 * providers (Esri), so the client's refresh logic is uniform across
 * providers; mirrors `TILE_TOKEN_TTL_MS` exactly so it can never disagree
 * with the token's real lifetime.
 */
export type ImageryTokenResponse = {
  provider: string;
  urlTemplate: string;
  maxNativeZoom: number;
  attribution: string;
  expiresAt: string;
};

/** Internal resolution of the configured provider, including the upstream (key-bearing) template. */
export type ResolvedImageryProvider = {
  provider: ImageryProvider;
  /** Upstream template the API fetches from (may include a credential). */
  upstreamTemplate: string;
  /** Host allow-listed for the tile proxy — never fetch anything else. */
  upstreamHost: string;
  attribution: string;
  maxNativeZoom: number;
  /** Whether the client is given the upstream template directly (keyless) or must go via the proxy. */
  keyless: boolean;
};

const ESRI: ResolvedImageryProvider = {
  provider: 'esri-world-imagery',
  upstreamTemplate:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  upstreamHost: 'server.arcgisonline.com',
  attribution:
    'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  maxNativeZoom: 19,
  keyless: true,
};

/**
 * §6 of `docs/specs/solar-design-studio.md` — resolves the configured
 * imagery provider server-side so provider keys never reach the web bundle.
 * Keyed providers (google/mapbox) are handed out as a same-origin proxy URL
 * (`/solar-design/tiles/{z}/{x}/{y}`); the API injects the credential when it
 * fetches upstream. `SOLAR_IMAGERY_PROVIDER` selects
 * `esri-world-imagery` | `google` | `mapbox`; the matching key/token env var
 * must also be set or the service falls back to Esri.
 */
@Injectable()
export class SolarImageryService {
  /** Resolves the configured provider, including the upstream (key-bearing) fetch template. */
  resolveProvider(): ResolvedImageryProvider {
    const provider = (
      process.env.SOLAR_IMAGERY_PROVIDER ?? 'esri-world-imagery'
    )
      .trim()
      .toLowerCase();

    if (provider === 'google') {
      const key = process.env.SOLAR_IMAGERY_GOOGLE_KEY?.trim();
      if (key) {
        return {
          provider: 'google',
          upstreamTemplate: `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=${key}`,
          upstreamHost: 'mt1.google.com',
          attribution: '© Google',
          maxNativeZoom: 21,
          keyless: false,
        };
      }
    }

    if (provider === 'mapbox') {
      const token = process.env.SOLAR_IMAGERY_MAPBOX_TOKEN?.trim();
      if (token) {
        return {
          provider: 'mapbox',
          upstreamTemplate: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token=${token}`,
          upstreamHost: 'api.mapbox.com',
          attribution: '© Mapbox © OpenStreetMap',
          maxNativeZoom: 22,
          keyless: false,
        };
      }
    }

    return ESRI;
  }

  /** Public token response (§6 canonical shape) — never leaks the upstream/key-bearing template. */
  getImageryToken(): ImageryTokenResponse {
    const resolved = this.resolveProvider();
    return {
      provider: resolved.provider,
      urlTemplate: resolved.keyless
        ? resolved.upstreamTemplate
        : '/solar-design/tiles/{z}/{x}/{y}',
      maxNativeZoom: resolved.maxNativeZoom,
      attribution: resolved.attribution,
      expiresAt: new Date(Date.now() + TILE_TOKEN_TTL_MS).toISOString(),
    };
  }
}
