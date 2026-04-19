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

  async login(loginDto: LoginDto): Promise<AuthLoginResult> {
    const normalizedUsername = loginDto.username.trim();
    const credential = await this.credentialsRepository.findOne({
      where: { username: normalizedUsername },
    });

    if (!credential) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (credential.user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await comparePassword(
      loginDto.password,
      credential.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: credential.user.id,
      role: credential.user.role,
      isAdmin: credential.user.role === UserRole.ADMIN,
    };

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

    if (!credential.mustChangePassword) {
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
    }

    credential.passwordHash = await hashPassword(dto.newPassword, 10);
    credential.mustChangePassword = false;
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
