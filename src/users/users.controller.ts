import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateUserByAdminDto } from './dto/create-user-by-admin.dto';
import { UserRole } from './entities/user-role.enum';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  createUserByAdmin(
    @Body() dto: CreateUserByAdminDto,
  ): Promise<{ id: string; username: string; role: UserRole }> {
    return this.usersService.createUserWithCredentials(dto);
  }
}
