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

export type AuthProfile = {
  id: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string;
  mustChangePassword: boolean;
};

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(UserCredential)
    private readonly credentialsRepository: Repository<UserCredential>,
    private readonly usersService: UsersService,
    private readonly staffService: StaffService,
    private readonly jwtService: JwtService,
    private readonly systemAudit: SystemAuditLogService,
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

    const passwordMatches = await comparePassword(
      loginDto.password,
      credential.passwordHash,
    );

    if (!passwordMatches) {
      if (!skipAudit) {
        await this.systemAudit.record({
          action: SYSTEM_AUDIT_ACTION.AUTH_LOGIN_FAILURE,
          actorUserId: credential.user.id,
          resourceType: 'auth',
          resourceId: credential.user.id,
          metadata: { reason: 'invalid_password' },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
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
