import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SolarTileTokenService } from '../solar-tile-token.service';

/**
 * Dedicated guard for `GET /solar-design/tiles/:z/:x/:y` — deliberately
 * *not* `JwtAuthGuard`, since the route is loaded as a plain `<img src>` by
 * the map library and cannot carry an `Authorization` header. Validates the
 * short-lived `?token=` query param minted by
 * `GET /solar-design/imagery-token` instead.
 */
@Injectable()
export class SolarTileTokenGuard implements CanActivate {
  constructor(private readonly tileTokens: SolarTileTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.query.token;
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Missing tile token');
    }
    try {
      await this.tileTokens.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired tile token');
    }
  }
}
