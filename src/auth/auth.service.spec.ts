import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { StaffService } from '../staff/staff.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { UserCredential } from './entities/user-credential.entity';

type HashPasswordFn = (
  data: string,
  saltOrRounds: string | number,
) => Promise<string>;
const hashPassword = hash as unknown as HashPasswordFn;
const comparePassword = compare as unknown as (
  data: string,
  encrypted: string,
) => Promise<boolean>;

describe('AuthService', () => {
  let authService: AuthService;
  let credentialsRepository: Repository<UserCredential>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserCredential),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            seedDefaultUsers: jest.fn(),
          },
        },
        {
          provide: StaffService,
          useValue: {
            seedDefaultStaffRoles: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('mock-token'),
          },
        },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
    credentialsRepository = moduleRef.get(getRepositoryToken(UserCredential));
  });

  it('returns a token and role for valid admin credentials', async () => {
    (credentialsRepository.findOne as jest.Mock).mockResolvedValue({
      username: 'admin',
      passwordHash: await hashPassword('admin', 1),
      mustChangePassword: false,
      user: {
        id: 'user-id',
        role: UserRole.ADMIN,
      },
    });

    await expect(
      authService.login({ username: 'admin', password: 'admin' }),
    ).resolves.toEqual({
      accessToken: 'mock-token',
      role: UserRole.ADMIN,
      mustChangePassword: false,
    });
  });

  it('rejects invalid credentials', async () => {
    (credentialsRepository.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      authService.login({ username: 'admin', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('clears the first-login password reset flag after a successful password change', async () => {
    const existingHash = await hashPassword('temp-password', 1);
    const credential = {
      username: 'installer',
      passwordHash: existingHash,
      mustChangePassword: true,
      user: {
        id: 'user-id',
        role: UserRole.INSTALLER,
        deletedAt: null,
      },
    };

    let savedCredential: UserCredential | null = null;
    (credentialsRepository.findOne as jest.Mock).mockResolvedValue(credential);
    const saveMock = (credentialsRepository as unknown as { save: jest.Mock })
      .save;
    saveMock.mockImplementation((value: UserCredential) => {
      savedCredential = value;
      return Promise.resolve(value);
    });

    await expect(
      authService.changePassword('user-id', {
        currentPassword: 'temp-password',
        newPassword: 'new-password-123',
      }),
    ).resolves.toEqual({ mustChangePassword: false });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mustChangePassword: false,
      }),
    );

    expect(savedCredential).not.toBeNull();

    if (!savedCredential) {
      throw new Error('Expected credential to be saved');
    }

    const finalizedCredential = savedCredential as UserCredential;
    const savedPasswordHash = String(finalizedCredential.passwordHash);

    await expect(
      comparePassword('new-password-123', savedPasswordHash),
    ).resolves.toBe(true);
  });

  it('rejects password changes when the current password is incorrect', async () => {
    (credentialsRepository.findOne as jest.Mock).mockResolvedValue({
      username: 'installer',
      passwordHash: await hashPassword('temp-password', 1),
      mustChangePassword: true,
      user: {
        id: 'user-id',
        role: UserRole.INSTALLER,
        deletedAt: null,
      },
    });

    await expect(
      authService.changePassword('user-id', {
        currentPassword: 'wrong-password',
        newPassword: 'new-password-123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
