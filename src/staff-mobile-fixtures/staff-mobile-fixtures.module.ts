import { Module } from '@nestjs/common';
import { StaffMobileFixturesController } from './staff-mobile-fixtures.controller';
import { StaffMobileFixturesService } from './staff-mobile-fixtures.service';

@Module({
  controllers: [StaffMobileFixturesController],
  providers: [StaffMobileFixturesService],
})
export class StaffMobileFixturesModule {}
