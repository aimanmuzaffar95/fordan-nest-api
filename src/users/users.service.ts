import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user-role.enum';

type HashPasswordFn = (
  data: string,
  saltOrRounds: string | number,
) => Promise<string>;
const hashPassword = hash as unknown as HashPasswordFn;

export type CreateUserWithCredentialInput = {
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string;
  username: string;
  password: string;
  role: UserRole;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserCredential)
    private readonly credentialsRepository: Repository<UserCredential>,
    private readonly dataSource: DataSource,
  ) {}

  async seedDefaultUsers(): Promise<void> {
    const defaultUsers = [
      {
        username: 'admin',
        password: 'admin',
        firstName: 'Admin',
        lastName: 'User',
        emailAddress: 'admin@local.dev',
        phoneNumber: '+10000000000',
        role: UserRole.ADMIN,
      },
      {
        username: 'manager',
        password: 'manager',
        firstName: 'Manager',
        lastName: 'User',
        emailAddress: 'manager@local.dev',
        phoneNumber: '+10000000001',
        role: UserRole.MANAGER,
      },
      {
        username: 'installer',
        password: 'installer',
        firstName: 'Installer',
        lastName: 'User',
        emailAddress: 'installer@local.dev',
        phoneNumber: '+10000000002',
        role: UserRole.INSTALLER,
      },
    ] as const;

    for (const defaultUser of defaultUsers) {
      let user = await this.usersRepository.findOne({
        where: { emailAddress: defaultUser.emailAddress },
      });

      if (!user) {
        user = this.usersRepository.create({
          firstName: defaultUser.firstName,
          lastName: defaultUser.lastName,
          emailAddress: defaultUser.emailAddress,
          phoneNumber: defaultUser.phoneNumber,
          role: defaultUser.role,
        });
        user = await this.usersRepository.save(user);
      } else if (user.role !== defaultUser.role) {
        user.role = defaultUser.role;
        user.firstName = defaultUser.firstName;
        user.lastName = defaultUser.lastName;
        user.phoneNumber = defaultUser.phoneNumber;
        user = await this.usersRepository.save(user);
      }

      const credential = await this.credentialsRepository.findOne({
        where: { username: defaultUser.username },
      });

      if (credential) {
        continue;
      }

      await this.credentialsRepository.save(
        this.credentialsRepository.create({
          username: defaultUser.username,
          passwordHash: await hashPassword(defaultUser.password, 10),
          user,
        }),
      );
    }
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async createUserWithCredentials(
    input: CreateUserWithCredentialInput,
  ): Promise<{ id: string; username: string; role: UserRole }> {
    if (![UserRole.MANAGER, UserRole.INSTALLER].includes(input.role)) {
      throw new BadRequestException(
        'Admin can only create manager or installer users',
      );
    }

    const existingCredential = await this.credentialsRepository.findOne({
      where: { username: input.username },
    });

    if (existingCredential) {
      throw new ConflictException('Username already exists');
    }

    const existingEmail = await this.usersRepository.findOne({
      where: { emailAddress: input.emailAddress },
    });

    if (existingEmail) {
      throw new ConflictException('Email address already exists');
    }

    return this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const credentialRepository = manager.getRepository(UserCredential);

      const user = await userRepository.save(
        userRepository.create({
          firstName: input.firstName,
          lastName: input.lastName,
          emailAddress: input.emailAddress,
          phoneNumber: input.phoneNumber,
          role: input.role,
        }),
      );

      const credential = await credentialRepository.save(
        credentialRepository.create({
          username: input.username,
          passwordHash: await hashPassword(input.password, 10),
          user,
        }),
      );

      return {
        id: user.id,
        username: credential.username,
        role: user.role,
      };
    });
  }
}
