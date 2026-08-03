import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { ProposalVersion } from './entities/proposal-version.entity';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProposalVersion, Job]),
    RuntimeSettingsModule,
  ],
  controllers: [ProposalsController],
  providers: [ProposalsService],
  exports: [ProposalsService],
})
export class ProposalsModule {}
