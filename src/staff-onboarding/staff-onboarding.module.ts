import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '../email/email.module';
import { EmployeeFormsModule } from '../employee-forms/employee-forms.module';
import { StaffModule } from '../staff/staff.module';
import { User } from '../users/entities/user.entity';
import { StaffOnboardingInvite } from './entities/staff-onboarding-invite.entity';
import {
  StaffOnboardingController,
  StaffOnboardingPublicController,
} from './staff-onboarding.controller';
import { StaffOnboardingService } from './staff-onboarding.service';
import { StaffOnboardingAcceptService } from './staff-onboarding-accept.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([StaffOnboardingInvite, User]),
    EmailModule,
    EmployeeFormsModule,
    StaffModule,
  ],
  controllers: [StaffOnboardingController, StaffOnboardingPublicController],
  providers: [StaffOnboardingService, StaffOnboardingAcceptService],
  exports: [StaffOnboardingService],
})
export class StaffOnboardingModule {}
