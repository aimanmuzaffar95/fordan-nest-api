import { BadRequestException, Injectable } from '@nestjs/common';
import { TILE_TOKEN_TTL_MS } from './solar-tile-token.service';
import {
  RuntimeSettingsService,
  type SolarImagerySettings,
} from '../runtime-settings/runtime-settings.service';

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

/** Web-Mercator metres-per-pixel at a given latitude/zoom (tile size 256) — same formula the render composite and the web client use. */
export function metresPerPixelAt(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Slippy-map tile coordinates for a lat/lon at a given zoom (standard Web Mercator tiling). */
export function latLonToTile(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.min(Math.max(x, 0), n - 1),
    y: Math.min(Math.max(y, 0), n - 1),
  };
}

/** A candidate provider config to resolve/test without touching the saved runtime setting. */
export type ImageryProviderCandidate = {
  provider: 'esri' | 'google' | 'mapbox';
  apiKey?: string | null;
};

// Cache TTL for the DB-backed resolution — a backstop for multi-worker
// deployments (each cPanel `lsnode` worker holds its own in-memory cache and
// version counter, so a PATCH handled by one worker doesn't instantly
// invalidate another's cache; this bounds how stale the others can get).
// resolveProvider() is on the hot path (every tile request), so it isn't
// left uncached entirely.
const RESOLVED_PROVIDER_CACHE_TTL_MS = 30_000;

function buildGoogle(key: string): ResolvedImageryProvider {
  return {
    provider: 'google',
    upstreamTemplate: `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=${key}`,
    upstreamHost: 'mt1.google.com',
    attribution: '© Google',
    maxNativeZoom: 21,
    keyless: false,
  };
}

function buildMapbox(token: string): ResolvedImageryProvider {
  return {
    provider: 'mapbox',
    upstreamTemplate: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token=${token}`,
    upstreamHost: 'api.mapbox.com',
    attribution: '© Mapbox © OpenStreetMap',
    maxNativeZoom: 22,
    keyless: false,
  };
}

/**
 * §6 of `docs/specs/solar-design-studio.md` — resolves the configured
 * imagery provider server-side so provider keys never reach the web bundle.
 * Keyed providers (google/mapbox) are handed out as a same-origin proxy URL
 * (`/solar-design/tiles/{z}/{x}/{y}`); the API injects the credential when it
 * fetches upstream.
 *
 * Resolution order: the runtime setting saved via `Settings ▸ Integrations ▸
 * Imagery` (`RuntimeSettingsService`, encrypted at rest) takes precedence;
 * `SOLAR_IMAGERY_PROVIDER`/`SOLAR_IMAGERY_GOOGLE_KEY`/
 * `SOLAR_IMAGERY_MAPBOX_TOKEN` env vars remain a fallback for deployments
 * that have never touched the runtime setting, so nothing breaks on upgrade.
 * Falls back to keyless Esri if neither resolves a usable key.
 */
@Injectable()
export class SolarImageryService {
  constructor(private readonly runtimeSettings: RuntimeSettingsService) {}

  private cache: {
    version: number;
    expiresAt: number;
    value: ResolvedImageryProvider;
  } | null = null;

  /** Resolves the configured provider, including the upstream (key-bearing) fetch template. */
  async resolveProvider(): Promise<ResolvedImageryProvider> {
    const version = this.runtimeSettings.getImagerySettingsVersion();
    const now = Date.now();
    if (
      this.cache &&
      this.cache.version === version &&
      this.cache.expiresAt > now
    ) {
      return this.cache.value;
    }

    const setting = await this.runtimeSettings.getSolarImagerySettings();
    const resolved = this.buildResolved(setting);
    this.cache = {
      version,
      expiresAt: now + RESOLVED_PROVIDER_CACHE_TTL_MS,
      value: resolved,
    };
    return resolved;
  }

  /**
   * Resolves a not-yet-saved candidate provider/key — used by `POST
   * /solar-design/imagery-test` so an admin can verify a key before saving
   * it, never touching the cache or the persisted setting.
   */
  resolveCandidate(
    candidate: ImageryProviderCandidate,
  ): ResolvedImageryProvider {
    return this.buildResolved({
      provider: candidate.provider,
      googleKey:
        candidate.provider === 'google' ? (candidate.apiKey ?? null) : null,
      mapboxToken:
        candidate.provider === 'mapbox' ? (candidate.apiKey ?? null) : null,
    });
  }

  private buildResolved(
    setting: SolarImagerySettings,
  ): ResolvedImageryProvider {
    const provider = (
      setting.provider ??
      process.env.SOLAR_IMAGERY_PROVIDER ??
      'esri'
    )
      .trim()
      .toLowerCase();

    if (provider === 'google') {
      const key =
        setting.googleKey ?? process.env.SOLAR_IMAGERY_GOOGLE_KEY?.trim();
      if (key) {
        return buildGoogle(key);
      }
    }

    if (provider === 'mapbox') {
      const token =
        setting.mapboxToken ?? process.env.SOLAR_IMAGERY_MAPBOX_TOKEN?.trim();
      if (token) {
        return buildMapbox(token);
      }
    }

    return ESRI;
  }

  /**
   * Resolves a provider/key for `POST /solar-design/imagery-test`: uses the
   * given `apiKey` if present, otherwise the currently *saved* key for that
   * provider (so a key can be re-tested after saving without retyping it).
   * Never falls back to the env var here — the whole point of the test
   * action is to verify what's actually configured in the runtime setting,
   * not to silently succeed off an env fallback the admin can't see.
   */
  async resolveForTest(
    candidate: ImageryProviderCandidate,
  ): Promise<ResolvedImageryProvider> {
    if (candidate.provider === 'esri') {
      return ESRI;
    }
    const key = candidate.apiKey?.trim()
      ? candidate.apiKey.trim()
      : (await this.runtimeSettings.getSolarImagerySettings())[
          candidate.provider === 'google' ? 'googleKey' : 'mapboxToken'
        ];
    if (!key) {
      throw new BadRequestException(
        `No ${candidate.provider} key to test — enter one first.`,
      );
    }
    return candidate.provider === 'google'
      ? buildGoogle(key)
      : buildMapbox(key);
  }

  /** Public token response (§6 canonical shape) — never leaks the upstream/key-bearing template. */
  async getImageryToken(): Promise<ImageryTokenResponse> {
    const resolved = await this.resolveProvider();
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
