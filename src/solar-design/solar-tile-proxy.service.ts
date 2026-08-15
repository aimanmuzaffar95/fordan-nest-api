import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common';
import {
  SolarImageryService,
  type ResolvedImageryProvider,
} from './solar-imagery.service';

export type ProxiedTile = {
  buffer: Buffer;
  contentType: string;
};

const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * §6 tile proxy: fetches upstream imagery tiles server-side so keyed
 * providers never expose their credential to the browser, and so every
 * provider is same-origin (removes CORS variance from render capture).
 * Only ever fetches the host of the currently-configured provider — guards
 * against being used as an open proxy.
 */
@Injectable()
export class SolarTileProxyService {
  constructor(private readonly imagery: SolarImageryService) {}

  /** Validates z/x/y are in range for the given zoom and throws otherwise. */
  private validateCoords(z: number, x: number, y: number): void {
    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 0 ||
      z > 24
    ) {
      throw new BadRequestException('Invalid tile coordinates');
    }
    const size = 2 ** z;
    if (x < 0 || x >= size || y < 0 || y >= size) {
      throw new BadRequestException('Tile coordinates out of range for zoom');
    }
  }

  async fetchTile(z: number, x: number, y: number): Promise<ProxiedTile> {
    this.validateCoords(z, x, y);
    const resolved = await this.imagery.resolveProvider();
    return this.fetchTileFromResolved(resolved, z, x, y);
  }

  /**
   * Same fetch/redirect/timeout guards as `fetchTile`, but against an
   * arbitrary resolved provider rather than the saved runtime setting —
   * used by `POST /solar-design/imagery-test` to verify a candidate key
   * before it's saved.
   */
  async fetchTileFromResolved(
    resolved: ResolvedImageryProvider,
    z: number,
    x: number,
    y: number,
  ): Promise<ProxiedTile> {
    this.validateCoords(z, x, y);
    const url = resolved.upstreamTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));

    // Belt-and-braces: only ever fetch the configured provider's own host,
    // even though the template is built from a fixed constant, not client
    // input — this keeps the guard true even if that ever changes.
    const host = new URL(url).host;
    if (host !== resolved.upstreamHost) {
      throw new BadRequestException('Refusing to proxy an untrusted host');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let response: Response;
    try {
      // `redirect: 'manual'` — never let fetch silently follow a 3xx to an
      // unchecked host; a misbehaving/compromised upstream could otherwise
      // redirect the proxy anywhere. We re-validate the `Location` host
      // ourselves and only follow it if it stays on the configured provider.
      response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new BadRequestException(
            'Upstream imagery provider redirected without a Location header',
          );
        }
        const redirectHost = new URL(location, url).host;
        if (redirectHost !== resolved.upstreamHost) {
          throw new BadRequestException(
            'Refusing to follow a redirect to an untrusted host',
          );
        }
        response = await fetch(location, {
          signal: controller.signal,
          redirect: 'manual',
        });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        throw new GatewayTimeoutException(
          'Upstream imagery provider timed out',
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new BadRequestException(
        `Upstream imagery provider returned ${response.status}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType };
  }
}
