import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateUserByAdminDto } from './dto/create-user-by-admin.dto';
import { UserRole } from './entities/user-role.enum';
import { UserDirectoryEntry, UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('JWT')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @AdminOnly()
  createUserByAdmin(
    @Body() dto: CreateUserByAdminDto,
  ): Promise<{ id: string; username: string; role: UserRole }> {
    return this.usersService.createUserWithCredentials(dto);
  }

  /**
   * Batch id -> display-name/role lookup. Gated the same as `/staff` reads
   * (ADMIN/MANAGER/INSTALLER) — this is a name-resolution directory, not a
   * contact-details export, so it does not need the tighter `/staff`
   * mutation roles, but it must not be looser than `/staff`'s own read gate.
   * Matched against `GET /staff` in staff.controller.ts.
   */
  @Get('directory')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiQuery({
    name: 'ids',
    required: true,
    description: 'Comma-separated user ids to resolve (max 200 per request).',
  })
  async getDirectoryEntries(
    @Query('ids') ids?: string,
  ): Promise<UserDirectoryEntry[]> {
    if (!ids || !ids.trim()) {
      throw new BadRequestException('ids query parameter is required');
    }
    const idList = ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.usersService.getDirectoryEntries(idList);
  }

  @Get('directory/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async getDirectoryEntry(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDirectoryEntry> {
    return this.usersService.getDirectoryEntry(id);
  }
}
