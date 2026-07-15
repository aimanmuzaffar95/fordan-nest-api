import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AdminGuard,
  InstallerGuard,
  ManagerGuard,
} from '../auth/guards/role.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { EmployeeRole } from './entities/employee-role.entity';
import { StaffRole } from './entities/staff-role.entity';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCredential, StaffRole, EmployeeRole]),
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
    NotificationsModule,
    PermissionsModule,
  ],
  controllers: [StaffController],
  providers: [
    StaffService,
    JwtAuthGuard,
    RolesGuard,
    AdminGuard,
    ManagerGuard,
    InstallerGuard,
  ],
  exports: [StaffService],
})
export class StaffModule {}
