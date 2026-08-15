import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export const TILE_TOKEN_SCOPE = 'solar-tiles';
export const TILE_TOKEN_TTL = '10m';
/** `TILE_TOKEN_TTL` in milliseconds — kept as a single source so the token's
 * real lifetime and the `expiresAt` reported by `GET /solar-design/imagery-token`
 * can never drift apart. */
export const TILE_TOKEN_TTL_MS = 10 * 60 * 1000;

export type TileTokenPayload = {
  sub: string;
  scope: typeof TILE_TOKEN_SCOPE;
};

/**
 * §6 tile proxy auth. `<img src>`/`<TileLayer>` requests made by the
 * `GET /solar-design/tiles/:z/:x/:y` route cannot carry an `Authorization`
 * header, so the route cannot sit behind `JwtAuthGuard`. Instead
 * `GET /solar-design/imagery-token` embeds a short-lived, narrowly-scoped
 * token (signed with the same `JWT_SECRET`, via this module's own
 * `JwtModule` registration) as a `?token=` query parameter on the proxy
 * `urlTemplate`; `SolarTileTokenGuard` verifies it. The token carries no
 * authority beyond "may fetch tiles" — no job scope, no role, no write
 * access — and expires in `TILE_TOKEN_TTL`.
 */
@Injectable()
export class SolarTileTokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(userId: string): Promise<string> {
    const payload: TileTokenPayload = { sub: userId, scope: TILE_TOKEN_SCOPE };
    return this.jwt.signAsync(payload, { expiresIn: TILE_TOKEN_TTL });
  }

  async verify(token: string): Promise<TileTokenPayload> {
    const payload = await this.jwt.verifyAsync<TileTokenPayload>(token);
    if (payload.scope !== TILE_TOKEN_SCOPE || !payload.sub) {
      throw new Error('Invalid tile token payload');
    }
    return payload;
  }
}
