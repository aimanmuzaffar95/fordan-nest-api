import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { LeadRoutingEvent } from './entities/lead-routing-event.entity';
import { TerritoryMember } from './entities/territory-member.entity';
import { Territory } from './entities/territory.entity';
import { LeadRoutingService } from './lead-routing.service';
import { TerritoriesController } from './territories.controller';
import { TerritoriesService } from './territories.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Territory,
      TerritoryMember,
      LeadRoutingEvent,
      Customer,
      User,
    ]),
    NotificationsModule,
    RuntimeSettingsModule,
  ],
  controllers: [TerritoriesController],
  providers: [TerritoriesService, LeadRoutingService],
  exports: [TerritoriesService, LeadRoutingService],
})
export class TerritoriesModule {}
