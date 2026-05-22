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
import { PermissionsService } from '../permissions/permissions.service';

@Controller('customers/:customerId/jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerJobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async create(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateJobForCustomerDto,
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, 'customer:job:create');
    this.permissions.assertPermission(effective, 'job:create');

    return this.jobsService.createForCustomer(
      req.user?.sub ?? null,
      req.user?.role ?? null,
      customerId,
      dto,
    );
  }
}
