import {
  CanActivate,
  ExecutionContext,
  Optional,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UserRole } from '../../users/entities/user-role.enum';

type JwtPayload = {
  sub: string;
  role: UserRole;
  isAdmin?: boolean;
};

type AuthenticatedRequest = Request & { user?: JwtPayload };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Optional() private readonly jwtService?: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);
    const secret = (
      process.env.JWT_SECRET?.trim() || 'development-secret'
    ).toString();
    const jwt = this.jwtService ?? new JwtService({ secret });

    try {
      const payload = await jwt.verifyAsync<JwtPayload>(token, { secret });

      if (!payload.sub || !payload.role) {
        throw new UnauthorizedException('Invalid token');
      }

      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
