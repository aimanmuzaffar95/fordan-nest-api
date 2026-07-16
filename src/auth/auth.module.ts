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
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
