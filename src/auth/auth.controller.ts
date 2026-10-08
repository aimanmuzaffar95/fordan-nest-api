import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
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

// Brute-force protection on credential endpoints (per IP). Override via env.
const authThrottleTtlMs = Number(process.env.AUTH_THROTTLE_TTL_MS ?? '60000');
const authThrottleLimit = Number(process.env.AUTH_THROTTLE_LIMIT ?? '10');

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: authThrottleTtlMs, limit: authThrottleLimit } })
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
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: authThrottleTtlMs, limit: authThrottleLimit } })
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
      throw new UnauthorizedException('Missing user');
    }

    return this.authService.getProfile(userId);
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @AllowPasswordResetRequired()
  @ApiOperation({
    summary: 'Sliding session — re-issue the access token',
    description:
      'Call while the user is active and the current token is past half its lifetime. Returns a fresh token with the same claims; the old one stays valid until its own expiry. Not available to MCP tokens.',
  })
  async refresh(
    @Req() req: Request & { user?: { sub: string; mcp?: boolean } },
  ): Promise<{
    accessToken: string;
    role: UserRole;
    mustChangePassword: boolean;
  }> {
    const userId = req.user?.sub;
    if (!userId || req.user?.mcp) {
      throw new UnauthorizedException('Cannot refresh this session');
    }
    return this.authService.refresh(userId);
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
      throw new UnauthorizedException('Missing user');
    }

    return this.authService.changePassword(userId, dto);
  }
}
