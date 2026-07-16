import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { UserRole } from '../users/entities/user-role.enum';
import { McpAccessService } from './mcp-access.service';
import { CreateMcpAccessKeyDto } from './dto/create-mcp-access-key.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

/**
 * Admin-only management of MCP access keys, surfaced under Settings. Creating a
 * key returns its plaintext value ONCE — it is never retrievable again.
 */
@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('settings/mcp-access-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
export class McpAccessController {
  constructor(private readonly mcpAccess: McpAccessService) {}

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: 'List MCP access keys (admin)' })
  list() {
    return this.mcpAccess.list();
  }

  @Get('bindable-users')
  @AdminOnly()
  @ApiOperation({
    summary:
      'List accounts a key can be bound to (includes admins for full access)',
  })
  bindableUsers() {
    return this.mcpAccess.listBindableUsers();
  }

  @Post()
  @AdminOnly()
  @ApiOperation({
    summary: 'Create an MCP access key (admin). Plaintext returned once.',
  })
  create(@Body() dto: CreateMcpAccessKeyDto, @Req() req: AuthRequest) {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.mcpAccess.create(dto, actorId);
  }

  @Delete(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Revoke an MCP access key (admin)' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.mcpAccess.revoke(id, actorId);
  }
}
