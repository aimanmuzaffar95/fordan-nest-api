import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { EquipmentItem } from './entities/equipment-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EquipmentItem]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
  ],
  controllers: [EquipmentController],
  providers: [EquipmentService, JwtAuthGuard, RolesGuard],
  exports: [EquipmentService],
})
export class EquipmentModule {}
