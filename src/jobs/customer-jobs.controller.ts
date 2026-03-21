import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateJobForCustomerDto } from './dto/create-job-for-customer.dto';
import { JobsService } from './jobs.service';

@Controller('customers/:customerId/jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerJobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateJobForCustomerDto,
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
  ) {
    return this.jobsService.createForCustomer(
      req.user?.sub ?? null,
      customerId,
      dto,
    );
  }
}
