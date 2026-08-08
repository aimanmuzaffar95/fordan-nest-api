import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { DataSource, In, IsNull, Repository } from 'typeorm';
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

/**
 * Minimal display-only projection — deliberately excludes email, phone,
 * credentials and any auth metadata. Used to resolve an actor id (which can
 * be ANY role, including ADMIN — `/staff` structurally excludes admins) to a
 * human-readable name for read-only UI surfaces like activity feeds.
 */
export type UserDirectoryEntry = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: UserRole;
};

/** Hard cap on a single batch lookup — guards against unbounded enumeration via a huge id list. */
export const USER_DIRECTORY_BATCH_LIMIT = 200;

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
          address: null,
          identificationNumber: null,
          role: defaultUser.role,
          staffRoleId: null,
          deletedAt: null,
        });
        user = await this.usersRepository.save(user);
      } else if (user.role !== defaultUser.role) {
        user.role = defaultUser.role;
        user.firstName = defaultUser.firstName;
        user.lastName = defaultUser.lastName;
        user.phoneNumber = defaultUser.phoneNumber;
        user.deletedAt = null;
        user = await this.usersRepository.save(user);
      }

      const credential = await this.credentialsRepository.findOne({
        where: { username: defaultUser.username },
      });

      if (credential) {
        continue;
      }

      // Default credentials are only acceptable as a bootstrap: everywhere
      // except explicit local development the first login must immediately
      // rotate them.
      const isDevelopment =
        (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'development';
      await this.credentialsRepository.save(
        this.credentialsRepository.create({
          username: defaultUser.username,
          passwordHash: await hashPassword(defaultUser.password, 10),
          mustChangePassword: !isDevelopment,
          user,
        }),
      );
    }
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
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
          address: null,
          identificationNumber: null,
          role: input.role,
          staffRoleId: null,
          deletedAt: null,
        }),
      );

      const credential = await credentialRepository.save(
        credentialRepository.create({
          username: input.username,
          passwordHash: await hashPassword(input.password, 10),
          mustChangePassword: true,
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

  /** Single-id directory lookup — resolves any active user's display name/role. */
  async getDirectoryEntry(id: string): Promise<UserDirectoryEntry> {
    const user = await this.usersRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toDirectoryEntry(user);
  }

  /**
   * Batch directory lookup — the History-feed use case: many actor ids on
   * one page, resolved in a single round trip instead of one request per row.
   * Silently drops ids that don't resolve (soft-deleted/unknown) rather than
   * erroring the whole batch.
   */
  async getDirectoryEntries(ids: string[]): Promise<UserDirectoryEntry[]> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    if (uniqueIds.length > USER_DIRECTORY_BATCH_LIMIT) {
      throw new BadRequestException(
        `Cannot resolve more than ${USER_DIRECTORY_BATCH_LIMIT} ids in a single request`,
      );
    }

    const users = await this.usersRepository.find({
      where: { id: In(uniqueIds), deletedAt: IsNull() },
    });

    return users.map((user) => this.toDirectoryEntry(user));
  }

  private toDirectoryEntry(user: User): UserDirectoryEntry {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName} ${user.lastName}`.trim(),
      role: user.role,
    };
  }
}
