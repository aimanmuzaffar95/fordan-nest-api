import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { SolarDesignModule } from '../solar-design/solar-design.module';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { ProposalVersion } from './entities/proposal-version.entity';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProposalVersion, Job, TimelineEvent]),
    RuntimeSettingsModule,
    // forwardRef: closes the cycle
    //   JobsModule -> TasksModule -> ProposalsModule -> SolarDesignModule -> JobsModule
    forwardRef(() => SolarDesignModule),
  ],
  controllers: [ProposalsController],
  providers: [ProposalsService],
  exports: [ProposalsService],
})
export class ProposalsModule {}
