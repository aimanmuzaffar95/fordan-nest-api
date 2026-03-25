import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { EmployeeFormsController } from './employee-forms.controller';
import { EmployeeFormsService } from './employee-forms.service';
import { EmployeeForm } from './entities/employee-form.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmployeeForm, User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
  ],
  controllers: [EmployeeFormsController],
  providers: [EmployeeFormsService, JwtAuthGuard, RolesGuard],
  exports: [EmployeeFormsService],
})
export class EmployeeFormsModule {}
