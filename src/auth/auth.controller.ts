import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../users/entities/user-role.enum';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Login (returns accessToken + role)' })
  login(
    @Body() loginDto: LoginDto,
  ): Promise<{ accessToken: string; role: UserRole }> {
    return this.authService.login(loginDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Current user profile' })
  async me(
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
  ): Promise<{
    id: string;
    role: UserRole;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber: string;
  }> {
    const userId = req.user?.sub;
    if (!userId) {
      // Guard should prevent this, but keep it safe.
      throw new Error('Missing user');
    }
    const user = await this.usersService.findById(userId);
    return {
      id: user.id,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      emailAddress: user.emailAddress,
      phoneNumber: user.phoneNumber,
    };
  }
}
