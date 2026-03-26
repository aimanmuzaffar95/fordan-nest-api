import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatteriesController } from './batteries.controller';
import { BatteriesService } from './batteries.service';
import { Battery } from './entities/battery.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Battery])],
  controllers: [BatteriesController],
  providers: [BatteriesService],
  exports: [BatteriesService],
})
export class BatteriesModule {}
