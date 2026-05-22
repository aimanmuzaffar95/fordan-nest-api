import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffRole } from '../staff/entities/staff-role.entity';
import { SystemAuditModule } from '../system-audit/system-audit.module';
import { User } from '../users/entities/user.entity';
import { PermissionRoleGrant } from './entities/permission-role-grant.entity';
import { PermissionRoleProfile } from './entities/permission-role-profile.entity';
import { PermissionRoleScope } from './entities/permission-role-scope.entity';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PermissionRoleProfile,
      PermissionRoleGrant,
      PermissionRoleScope,
      StaffRole,
      User,
    ]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
    SystemAuditModule,
  ],
  controllers: [PermissionsController],
  providers: [PermissionsService, JwtAuthGuard, RolesGuard],
  exports: [PermissionsService],
})
export class PermissionsModule {}
