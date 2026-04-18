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

export type AuditLogItemDto = {
  id: string;
  createdAt: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: unknown | null;
};

export type AuditLogListResponseDto = {
  items: AuditLogItemDto[];
  total: number;
  page: number;
  pageSize: number;
};

@ApiTags('Audit log')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditLogController {
  constructor(
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
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;

    const qb = this.auditRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actorUser', 'actor')
      .orderBy('log.createdAt', 'DESC')
      .skip(skip)
      .take(pageSize);

    const [rows, total] = await qb.getManyAndCount();

    const items: AuditLogItemDto[] = rows.map((log) => {
      const actor = log.actorUser;
      const actorName = actor
        ? `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || null
        : null;
      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        action: log.action,
        actorUserId: log.actorUserId,
        actorName,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        metadata: log.metadata ?? null,
      };
    });

    return { items, total, page, pageSize };
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
