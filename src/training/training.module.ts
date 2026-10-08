import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { SystemAuditModule } from '../system-audit/system-audit.module';
import { User } from '../users/entities/user.entity';
import { TrainingAttempt } from './entities/training-attempt.entity';
import { TrainingModuleEntity } from './entities/training-module.entity';
import { TrainingQuestion } from './entities/training-question.entity';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TrainingModuleEntity,
      TrainingQuestion,
      TrainingAttempt,
      User,
    ]),
    NotificationsModule,
    SystemAuditModule,
  ],
  controllers: [TrainingController],
  providers: [TrainingService],
})
export class TrainingModule {}
