import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { StaffService } from '../staff/staff.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UserCredential } from './entities/user-credential.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { SYSTEM_AUDIT_ACTION } from '../system-audit/system-audit-action.constants';
import { McpAccessService } from '../mcp-access/mcp-access.service';

type ComparePasswordFn = (data: string, encrypted: string) => Promise<boolean>;
type HashPasswordFn = (
  data: string,
  saltOrRounds: string | number,
) => Promise<string>;

const comparePassword = compare as unknown as ComparePasswordFn;
const hashPassword = hash as unknown as HashPasswordFn;

export type AuthLoginResult = {
  accessToken: string;
  role: UserRole;
  mustChangePassword: boolean;
};

export type McpAuthResult = {
  accessToken: string;
  role: UserRole;
  allowWrites: boolean;
};

export type AuthProfile = {
  id: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string;
  mustChangePassword: boolean;
};

/** Consecutive failed logins before an account is temporarily locked. */
const MAX_FAILED_LOGIN_ATTEMPTS = Number(process.env.AUTH_MAX_FAILED_ATTEMPTS ?? 5);
/** How long the lock lasts, in minutes. */
const LOGIN_LOCKOUT_MINUTES = Number(process.env.AUTH_LOCKOUT_MINUTES ?? 15);

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(UserCredential)
    private readonly credentialsRepository: Repository<UserCredential>,
    private readonly usersService: UsersService,
    private readonly staffService: StaffService,
    private readonly jwtService: JwtService,
    private readonly systemAudit: SystemAuditLogService,
    private readonly mcpAccess: McpAccessService,
  ) {}

  async onModuleInit(): Promise<void> {
    const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
    const seedFlag =
      process.env.SEED_DEFAULT_USERS ??
      (nodeEnv === 'production' ? 'false' : 'true');
    const shouldSeed = seedFlag.toLowerCase() === 'true';
    if (shouldSeed) {
      await this.usersService.seedDefaultUsers();
      await this.staffService.seedDefaultStaffRoles();
      await this.staffService.seedDefaultEmployeeRoles();
    }
  }

  async login(
    loginDto: LoginDto,
    opts?: { skipLoginSystemAudit?: boolean },
  ): Promise<AuthLoginResult> {
    const skipAudit = opts?.skipLoginSystemAudit === true;
    const normalizedUsername = loginDto.username.trim();
    const credential = await this.credentialsRepository.findOne({
      where: { username: normalizedUsername },
    });

    if (!credential) {
      if (!skipAudit) {
        await this.systemAudit.record({
          action: SYSTEM_AUDIT_ACTION.AUTH_LOGIN_FAILURE,
          actorUserId: null,
          resourceType: 'auth',
          resourceId: null,
          metadata: { reason: 'unknown_user' },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (credential.user.deletedAt) {
      if (!skipAudit) {
        await this.systemAudit.record({
          action: SYSTEM_AUDIT_ACTION.AUTH_LOGIN_FAILURE,
          actorUserId: credential.user.id,
          resourceType: 'auth',
          resourceId: credential.user.id,
          metadata: { reason: 'account_inactive' },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (credential.user.active === false) {
      if (!skipAudit) {
        await this.systemAudit.record({
          action: SYSTEM_AUDIT_ACTION.AUTH_LOGIN_FAILURE,
          actorUserId: credential.user.id,
          resourceType: 'auth',
          resourceId: credential.user.id,
          metadata: { reason: 'account_deactivated' },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
      if (!skipAudit) {
        await this.systemAudit.record({
          action: SYSTEM_AUDIT_ACTION.AUTH_LOGIN_FAILURE,
          actorUserId: credential.user.id,
          resourceType: 'auth',
          resourceId: credential.user.id,
          metadata: { reason: 'account_locked' },
        });
      }
      throw new UnauthorizedException(
        'Account temporarily locked due to repeated failed logins. Try again shortly.',
      );
    }

    const passwordMatches = await comparePassword(
      loginDto.password,
      credential.passwordHash,
    );

    if (!passwordMatches) {
      const attempts = (credential.failedLoginAttempts ?? 0) + 1;
      const shouldLock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      await this.credentialsRepository.update(credential.id, {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60_000)
          : credential.lockedUntil ?? null,
      });
      if (!skipAudit) {
        await this.systemAudit.record({
          action: SYSTEM_AUDIT_ACTION.AUTH_LOGIN_FAILURE,
          actorUserId: credential.user.id,
          resourceType: 'auth',
          resourceId: credential.user.id,
          metadata: { reason: shouldLock ? 'invalid_password_locked' : 'invalid_password', attempts },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login clears any accumulated failures / lock.
    if ((credential.failedLoginAttempts ?? 0) > 0 || credential.lockedUntil) {
      await this.credentialsRepository.update(credential.id, {
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
    }

    const payload = {
      sub: credential.user.id,
      role: credential.user.role,
      isAdmin: credential.user.role === UserRole.ADMIN,
      tv: credential.tokenVersion ?? 0,
    };

    if (!skipAudit) {
      await this.systemAudit.record({
        action: SYSTEM_AUDIT_ACTION.AUTH_LOGIN_SUCCESS,
        actorUserId: credential.user.id,
        resourceType: 'auth',
        resourceId: credential.user.id,
        metadata: { role: credential.user.role },
      });
    }

    return {
      accessToken: await this.jwtService.signAsync(payload),
      role: credential.user.role,
      mustChangePassword: credential.mustChangePassword,
    };
  }

  /**
   * Exchange an MCP access key for a short-lived JWT bound to the key's staff
   * account. The token carries `mcp: true` and `mcpWrites` so the guard can
   * enforce read-only server-side regardless of the MCP client. The bound
   * account's role continues to bound all RBAC downstream.
   */
  async loginWithMcpKey(rawKey: string): Promise<McpAuthResult> {
    const principal = await this.mcpAccess.authenticate(rawKey);
    const credential = await this.findCredentialByUserIdOrFail(
      principal.user.id,
    );

    const payload = {
      sub: principal.user.id,
      role: principal.user.role,
      isAdmin: principal.user.role === UserRole.ADMIN,
      tv: credential.tokenVersion ?? 0,
      mcp: true,
      mcpWrites: principal.allowWrites,
      mcpKeyId: principal.keyId,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      role: principal.user.role,
      allowWrites: principal.allowWrites,
    };
  }

  async getProfile(userId: string): Promise<AuthProfile> {
    const credential = await this.findCredentialByUserIdOrFail(userId);
    return this.toAuthProfile(credential);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ mustChangePassword: boolean }> {
    const credential = await this.findCredentialByUserIdOrFail(userId);

    if (!dto.currentPassword || dto.currentPassword.trim().length === 0) {
      throw new BadRequestException('Current password is required');
    }

    const currentPasswordMatches = await comparePassword(
      dto.currentPassword,
      credential.passwordHash,
    );

    if (!currentPasswordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    credential.passwordHash = await hashPassword(dto.newPassword, 10);
    credential.mustChangePassword = false;
    // Invalidate every token issued before this change.
    credential.tokenVersion = (credential.tokenVersion ?? 0) + 1;
    await this.credentialsRepository.save(credential);

    return {
      mustChangePassword: false,
    };
  }

  private async findCredentialByUserIdOrFail(
    userId: string,
  ): Promise<UserCredential> {
    const credential = await this.credentialsRepository.findOne({
      where: {
        user: {
          id: userId,
        },
      },
    });

    if (!credential || credential.user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    return credential;
  }

  private toAuthProfile(credential: UserCredential): AuthProfile {
    return {
      id: credential.user.id,
      role: credential.user.role,
      firstName: credential.user.firstName,
      lastName: credential.user.lastName,
      emailAddress: credential.user.emailAddress,
      phoneNumber: credential.user.phoneNumber,
      mustChangePassword: credential.mustChangePassword,
    };
  }
}
