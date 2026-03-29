import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AllowPasswordResetRequired } from './decorators/allow-password-reset-required.decorator';
import { AuthLoginResult, AuthProfile, AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../users/entities/user-role.enum';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Login (returns accessToken + role + mustChangePassword)',
  })
  login(@Body() loginDto: LoginDto): Promise<AuthLoginResult> {
    return this.authService.login(loginDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Current user profile' })
  @AllowPasswordResetRequired()
  async me(
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
  ): Promise<AuthProfile> {
    const userId = req.user?.sub;
    if (!userId) {
      // Guard should prevent this, but keep it safe.
      throw new Error('Missing user');
    }

    return this.authService.getProfile(userId);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary:
      'Change the current user password and clear the first-login reset requirement',
  })
  @AllowPasswordResetRequired()
  async changePassword(
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
    @Body() dto: ChangePasswordDto,
  ): Promise<{ mustChangePassword: boolean }> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing user');
    }

    return this.authService.changePassword(userId, dto);
  }
}
