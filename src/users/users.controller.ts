import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateUserByAdminDto } from './dto/create-user-by-admin.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UserSummaryDto } from './dto/user-summary.dto';
import { UserRole } from './entities/user-role.enum';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findUsers(@Query() query: FindUsersQueryDto): Promise<UserSummaryDto[]> {
    return this.usersService.findDirectoryUsers(query.roles);
  }

  @Post()
  @AdminOnly()
  createUserByAdmin(
    @Body() dto: CreateUserByAdminDto,
  ): Promise<{ id: string; username: string; role: UserRole }> {
    return this.usersService.createUserWithCredentials(dto);
  }
}
