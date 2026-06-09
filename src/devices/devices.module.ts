import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceRegistration } from './entities/device-registration.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeviceRegistration]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
  ],
  controllers: [DevicesController],
  providers: [DevicesService, JwtAuthGuard, RolesGuard],
  exports: [DevicesService],
})
export class DevicesModule {}
