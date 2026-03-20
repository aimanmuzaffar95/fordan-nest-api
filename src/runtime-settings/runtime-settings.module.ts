import { Module } from '@nestjs/common';
import { RuntimeSettingsService } from './runtime-settings.service';
import { RuntimeSettingsController } from './runtime-settings.controller';

@Module({
  providers: [RuntimeSettingsService],
  controllers: [RuntimeSettingsController],
  exports: [RuntimeSettingsService],
})
export class RuntimeSettingsModule {}

