import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
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
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionOverride } from './entities/permission-override.entity';

/**
 * @Global(): `PermissionsGuard` is now used by `@RequirePermission` across
 * ~25 feature modules that have no other reason to import PermissionsModule
 * directly. A prior version of this module was not global, and every one of
 * those modules forgot the import — Nest's DI container silently compiles
 * (tsc doesn't see DI graphs) and unit tests pass (they construct
 * controllers directly, bypassing the module graph), so the app only
 * revealed the break at actual boot. Global avoids this whole class of
 * "wired the decorator, forgot the module import" defect recurring; the
 * guard/service still have to be explicitly imported into any test that
 * wants to exercise them, since @Global does not affect testing modules.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PermissionRoleProfile,
      PermissionRoleGrant,
      PermissionRoleScope,
      PermissionOverride,
      StaffRole,
      User,
    ]),
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
    SystemAuditModule,
  ],
  controllers: [PermissionsController],
  providers: [PermissionsService, JwtAuthGuard, RolesGuard, PermissionsGuard],
  exports: [PermissionsService, PermissionsGuard],
})
export class PermissionsModule {}
