import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inverter } from './entities/inverter.entity';
import { InvertersController } from './inverters.controller';
import { InvertersService } from './inverters.service';

@Module({
  imports: [TypeOrmModule.forFeature([Inverter])],
  controllers: [InvertersController],
  providers: [InvertersService],
  exports: [InvertersService],
})
export class InvertersModule {}
