import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { StaffService } from '../staff/staff.service';
import { UserRole } from '../users/entities/user-role.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { UserCredential } from './entities/user-credential.entity';

type HashPasswordFn = (
  data: string,
  saltOrRounds: string | number,
) => Promise<string>;
const hashPassword = hash as unknown as HashPasswordFn;

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
      user: {
        id: 'user-id',
        role: UserRole.ADMIN,
        deletedAt: null,
      },
    });

    await expect(
      authService.login({ username: 'admin', password: 'admin' }),
    ).resolves.toEqual({ accessToken: 'mock-token', role: UserRole.ADMIN });
  });

  it('rejects invalid credentials', async () => {
    (credentialsRepository.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      authService.login({ username: 'admin', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
