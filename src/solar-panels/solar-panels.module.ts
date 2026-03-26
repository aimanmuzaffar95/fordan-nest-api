import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SolarPanel } from './entities/solar-panel.entity';
import { SolarPanelsController } from './solar-panels.controller';
import { SolarPanelsService } from './solar-panels.service';

@Module({
  imports: [TypeOrmModule.forFeature([SolarPanel])],
  controllers: [SolarPanelsController],
  providers: [SolarPanelsService],
  exports: [SolarPanelsService],
})
export class SolarPanelsModule {}
