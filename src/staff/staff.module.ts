import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
import { StaffRole } from './entities/staff-role.entity';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCredential, StaffRole]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
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
