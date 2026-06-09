import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { StaffAvailability } from './entities/staff-availability.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([StaffAvailability]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, JwtAuthGuard, RolesGuard],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
