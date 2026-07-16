import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AllowPasswordResetRequired } from './decorators/allow-password-reset-required.decorator';
import {
  AuthLoginResult,
  AuthProfile,
  AuthService,
  McpAuthResult,
} from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { McpLoginDto } from './dto/mcp-login.dto';
import { UserRole } from '../users/entities/user-role.enum';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { shouldSkipLoginSystemAuditHeader } from './smoke-login-audit.util';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiHeader({
    name: 'X-Fordan-Smoke-Secret',
    required: false,
    description:
      'When it matches the API env `API_SMOKE_SECRET`, login does not write `system_audit_logs` rows.',
  })
  @ApiOperation({
    summary: 'Login (returns accessToken + role + mustChangePassword)',
  })
  login(
    @Body() loginDto: LoginDto,
    @Headers('x-fordan-smoke-secret') xFordanSmokeSecret?: string | string[],
  ): Promise<AuthLoginResult> {
    return this.authService.login(loginDto, {
      skipLoginSystemAudit:
        shouldSkipLoginSystemAuditHeader(xFordanSmokeSecret),
    });
  }

  @Post('mcp')
  @ApiOperation({
    summary:
      'Exchange an MCP access key for a short-lived JWT (used by the MCP server)',
  })
  loginWithMcpKey(@Body() dto: McpLoginDto): Promise<McpAuthResult> {
    return this.authService.loginWithMcpKey(dto.key);
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
