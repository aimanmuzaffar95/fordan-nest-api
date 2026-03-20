import {
  Controller,
  Get,
  Param,
  Body,
  Patch,
  Req,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';
import { UpdateJobPipelineDto } from './dto/update-job-pipeline.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  list(@Query() query: FindJobsQueryDto) {
    return this.jobs.list(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getOne(id);
  }

  @Patch(':id/pipeline')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  updatePipeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobPipelineDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    // JwtAuthGuard + RolesGuard should make this safe; still guard for runtime safety.
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.updateJobPipeline(id, dto, role, userId);
  }
}
