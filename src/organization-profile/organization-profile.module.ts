import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationProfile } from './organization-profile.entity';
import { OrganizationProfileService } from './organization-profile.service';
import { OrganizationProfileController } from './organization-profile.controller';
import { SystemAuditModule } from '../system-audit/system-audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationProfile]), SystemAuditModule],
  controllers: [OrganizationProfileController],
  providers: [OrganizationProfileService],
  exports: [OrganizationProfileService],
})
export class OrganizationProfileModule {}
