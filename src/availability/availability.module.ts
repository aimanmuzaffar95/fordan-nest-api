import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { Assignment } from '../assignments/entities/assignment.entity';
import { StaffAvailability } from './entities/staff-availability.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([StaffAvailability, Assignment]),
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, JwtAuthGuard, RolesGuard],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
