import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSettings } from './admin-settings.entity';
import { RuntimeSettingsService } from './runtime-settings.service';
import { RuntimeSettingsController } from './runtime-settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AdminSettings])],
  providers: [RuntimeSettingsService],
  controllers: [RuntimeSettingsController],
  exports: [RuntimeSettingsService],
})
export class RuntimeSettingsModule {}
