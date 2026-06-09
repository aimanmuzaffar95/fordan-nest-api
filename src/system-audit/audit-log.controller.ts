import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemAuditLog } from './entities/system-audit-log.entity';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto';
import {
  AuditLogListResponseDto,
  SystemAuditLogService,
} from './system-audit-log.service';

@ApiTags('Audit log')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditLogController {
  constructor(
    private readonly auditLog: SystemAuditLogService,
    @InjectRepository(SystemAuditLog)
    private readonly auditRepo: Repository<SystemAuditLog>,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List system audit events',
    description:
      'Admin-only, newest first. Covers organization profile changes, admin runtime settings updates, and authentication events recorded by the API.',
  })
  async list(
    @Query() query: ListAuditLogQueryDto,
  ): Promise<AuditLogListResponseDto> {
    return this.auditLog.listPaginated(query);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Delete one system audit log row',
    description:
      'Removes a single `system_audit_logs` row. Intended for operational cleanup (for example removing the `auth.login_success` row from an automated smoke login). Prefer `API_SMOKE_SECRET` on the API plus `X-Fordan-Smoke-Secret` on `POST /auth/login` so login does not insert audit rows.',
  })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ deleted: true }> {
    const result = await this.auditRepo.delete({ id });
    if (!result.affected) {
      throw new NotFoundException('Audit log entry not found');
    }
    return { deleted: true };
  }
}
