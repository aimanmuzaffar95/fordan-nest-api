import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Optional,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { ALLOW_PASSWORD_RESET_REQUIRED_KEY } from '../decorators/allow-password-reset-required.decorator';
import { resolveJwtSecret } from '../jwt-secret.util';
import { UserCredential } from '../entities/user-credential.entity';
import { UserRole } from '../../users/entities/user-role.enum';

type JwtPayload = {
  sub: string;
  role: UserRole;
  isAdmin?: boolean;
};

type AuthenticatedRequest = Request & { user?: JwtPayload };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    @Optional() private readonly jwtService?: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);
    const secret = resolveJwtSecret();
    const jwt = this.jwtService ?? new JwtService({ secret });

    try {
      const payload = await jwt.verifyAsync<JwtPayload>(token, { secret });

      if (!payload.sub || !payload.role) {
        throw new UnauthorizedException('Invalid token');
      }

      const credential = await this.dataSource
        .getRepository(UserCredential)
        .findOne({
          where: {
            user: {
              id: payload.sub,
            },
          },
        });

      if (!credential || credential.user.deletedAt) {
        throw new UnauthorizedException('Invalid token');
      }

      const allowPasswordResetRequired =
        this.reflector.getAllAndOverride<boolean>(
          ALLOW_PASSWORD_RESET_REQUIRED_KEY,
          [context.getHandler(), context.getClass()],
        ) ?? false;

      if (credential.mustChangePassword && !allowPasswordResetRequired) {
        throw new ForbiddenException('Password change required');
      }

      request.user = payload;
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
