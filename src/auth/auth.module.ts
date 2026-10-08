import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffModule } from '../staff/staff.module';
import { UsersModule } from '../users/users.module';
import { SystemAuditModule } from '../system-audit/system-audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserCredential } from './entities/user-credential.entity';
import { resolveJwtSecret } from './jwt-secret.util';

/** `AUTH_SESSION_IDLE_MINUTES` (default 60, clamped 5–1440). */
export function sessionIdleMinutes(): number {
  const n = Number(process.env.AUTH_SESSION_IDLE_MINUTES ?? '60');
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 5), 1440) : 60;
}
import { McpAccessModule } from '../mcp-access/mcp-access.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserCredential]),
    UsersModule,
    StaffModule,
    SystemAuditModule,
    McpAccessModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      // Idle window: a token lives this long, and clients call POST
      // /auth/refresh while the user is active, so the session only ends
      // after this much inactivity (web + mobile sliding session).
      signOptions: { expiresIn: `${sessionIdleMinutes()}m` },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
