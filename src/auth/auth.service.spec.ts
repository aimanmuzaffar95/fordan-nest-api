import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash } from 'bcrypt';
import { Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { UserCredential } from './entities/user-credential.entity';

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
            createAdminIfMissing: jest.fn(),
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

  it('returns a token for valid admin credentials', async () => {
    (credentialsRepository.findOne as jest.Mock).mockResolvedValue({
      username: 'admin',
      passwordHash: await hash('admin', 1),
      user: {
        id: 'user-id',
        role: UserRole.ADMIN,
      },
    });

    await expect(
      authService.login({ username: 'admin', password: 'admin' }),
    ).resolves.toEqual({ accessToken: 'mock-token' });
  });

  it('rejects invalid credentials', async () => {
    (credentialsRepository.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      authService.login({ username: 'admin', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
