import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateJobDto } from './dto/create-job.dto';
import { FindJobAuditLogQueryDto } from './dto/find-job-audit-log-query.dto';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';
import { TransitionJobStageDto } from './dto/transition-job-stage.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobsService } from './jobs.service';

type AuthenticatedRequest = Request & {
  user?: {
    sub: string;
    role: UserRole;
  };
};

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateJobDto, @Req() req: AuthenticatedRequest) {
    return this.jobsService.create(dto, req.user?.sub ?? null);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findAll(@Query() query: FindJobsQueryDto, @Req() req: AuthenticatedRequest) {
    const page = query.page ?? 1;
    const limit = query.pageSize ?? query.limit ?? 20;
    const isAdmin = req.user?.role === UserRole.ADMIN;
    const managerId = isAdmin ? query.managerId : (req.user?.sub ?? undefined);

    return this.jobsService.findAll({
      page,
      limit,
      managerId,
      installerId: query.installerId,
      includeDeleted: query.includeDeleted ?? false,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(typeof query.contractSigned === 'boolean'
        ? { contractSigned: query.contractSigned }
        : {}),
    });
  }

  @Post(':id/stage')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  transitionStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionJobStageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.jobsService.transitionStage(
      req.user?.sub ?? null,
      req.user?.role ?? null,
      id,
      dto.toStage,
      dto.overridePreMeterLock ?? false,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobsService.findDetail(id);
  }

  @Get(':id/audit-logs')
  findAuditLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FindJobAuditLogQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.jobsService.findAuditLogs(id, page, limit);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.jobsService.update(
      id,
      dto,
      req.user?.sub ?? null,
      req.user?.role ?? null,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.jobsService.softDelete(id, req.user?.sub ?? null);
  }

  @Patch(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.jobsService.restore(id, req.user?.sub ?? null);
  }
}
