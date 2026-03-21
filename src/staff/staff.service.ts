import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateStaffDto } from './dto/create-staff.dto';
import { CreateStaffRoleDto } from './dto/create-staff-role.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffRole } from './entities/staff-role.entity';

type HashPasswordFn = (
  data: string,
  saltOrRounds: string | number,
) => Promise<string>;

type StaffRoleSummary = {
  id: string;
  name: string;
  description: string;
};

export type StaffListItem = {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  address: string;
  identificationNumber: string;
  staffType: UserRole.MANAGER | UserRole.INSTALLER;
  emailAddress: string;
  username: string;
  staffRole: StaffRoleSummary | null;
};

const hashPassword = hash as unknown as HashPasswordFn;

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserCredential)
    private readonly credentialsRepository: Repository<UserCredential>,
    @InjectRepository(StaffRole)
    private readonly staffRolesRepository: Repository<StaffRole>,
    private readonly dataSource: DataSource,
  ) {}

  async listRoles(): Promise<StaffRoleSummary[]> {
    const roles = await this.staffRolesRepository.find({
      order: {
        name: 'ASC',
      },
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
    }));
  }

  async createRole(dto: CreateStaffRoleDto): Promise<StaffRoleSummary> {
    await this.ensureRoleNameAvailable(dto.name);

    const role = await this.staffRolesRepository.save(
      this.staffRolesRepository.create({
        name: dto.name.trim(),
        description: dto.description.trim(),
      }),
    );

    return {
      id: role.id,
      name: role.name,
      description: role.description,
    };
  }

  async listStaff(): Promise<StaffListItem[]> {
    const users = await this.usersRepository.find({
      where: {
        role: In([UserRole.MANAGER, UserRole.INSTALLER]),
        deletedAt: IsNull(),
      },
      relations: {
        credential: true,
        staffRole: true,
      },
      order: {
        firstName: 'ASC',
        lastName: 'ASC',
      },
    });

    return users.map((user) => this.toStaffListItem(user));
  }

  async createStaff(dto: CreateStaffDto): Promise<StaffListItem> {
    const payload = this.normalizeCreatePayload(dto);
    const staffRole = await this.resolveStaffRole(
      payload.staffType,
      payload.staffRoleId,
    );

    await this.ensureActiveIdentificationAvailable(
      payload.identificationNumber,
    );
    await this.ensureEmailAvailable(payload.emailAddress);
    await this.ensureUsernameAvailable(payload.username);

    return this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const credentialRepository = manager.getRepository(UserCredential);

      const user = await userRepository.save(
        userRepository.create({
          firstName: payload.firstName,
          lastName: payload.lastName,
          phoneNumber: payload.phoneNumber,
          address: payload.address,
          identificationNumber: payload.identificationNumber,
          role: payload.staffType,
          emailAddress: payload.emailAddress,
          staffRoleId: staffRole?.id ?? null,
        }),
      );

      const credential = await credentialRepository.save(
        credentialRepository.create({
          username: payload.username,
          passwordHash: await hashPassword(payload.password, 10),
          user,
        }),
      );

      user.credential = credential;
      user.staffRole = staffRole ?? null;
      return this.toStaffListItem(user);
    });
  }

  async updateStaff(id: string, dto: UpdateStaffDto): Promise<StaffListItem> {
    const existing = await this.findActiveStaffOrFail(id);
    const payload = this.normalizeUpdatePayload(dto);

    if (!existing.credential) {
      throw new BadRequestException(
        'Staff member is missing login credentials. Recreate this record to manage login fields.',
      );
    }

    const nextStaffType =
      payload.staffType ??
      (existing.role as UserRole.MANAGER | UserRole.INSTALLER);
    const nextStaffRoleId =
      nextStaffType === UserRole.MANAGER
        ? null
        : payload.staffRoleId === undefined
          ? existing.staffRoleId
          : payload.staffRoleId;

    const nextIdentificationNumber =
      payload.identificationNumber ?? existing.identificationNumber;
    const nextEmail = payload.emailAddress ?? existing.emailAddress;
    const nextUsername = payload.username ?? existing.credential.username;

    if (!nextIdentificationNumber) {
      throw new BadRequestException(
        'Identification number is required for staff members',
      );
    }

    const staffRole = await this.resolveStaffRole(
      nextStaffType,
      nextStaffRoleId,
    );

    await this.ensureActiveIdentificationAvailable(
      nextIdentificationNumber,
      id,
    );
    await this.ensureEmailAvailable(nextEmail, id);
    await this.ensureUsernameAvailable(nextUsername, id);

    return this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const credentialRepository = manager.getRepository(UserCredential);

      existing.firstName = payload.firstName ?? existing.firstName;
      existing.lastName = payload.lastName ?? existing.lastName;
      existing.phoneNumber = payload.phoneNumber ?? existing.phoneNumber;
      existing.address = payload.address ?? existing.address;
      existing.identificationNumber = nextIdentificationNumber;
      existing.role = nextStaffType;
      existing.emailAddress = nextEmail;
      existing.staffRoleId = staffRole?.id ?? null;
      existing.staffRole = staffRole ?? null;

      const savedUser = await userRepository.save(existing);

      existing.credential.username = nextUsername;
      const savedCredential = await credentialRepository.save(
        existing.credential,
      );
      savedUser.credential = savedCredential;

      return this.toStaffListItem(savedUser);
    });
  }

  async softDeleteStaff(
    id: string,
  ): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.findActiveStaffOrFail(id);

    existing.deletedAt = new Date();
    existing.identificationNumber = this.archiveIdentificationNumber(
      existing.id,
      existing.identificationNumber,
    );

    await this.usersRepository.save(existing);

    return {
      id: existing.id,
      deletedAt: existing.deletedAt.toISOString(),
    };
  }

  async seedDefaultStaffRoles(): Promise<void> {
    const defaults: Array<Pick<StaffRole, 'name' | 'description'>> = [
      {
        name: 'Electrician',
        description:
          'Licensed electrician for wiring and electrical connections',
      },
      {
        name: 'Solar Panel Installer',
        description:
          'Handles mounting and installation of solar panels on rooftops',
      },
      {
        name: 'Inverter Technician',
        description:
          'Specialises in inverter setup, configuration and troubleshooting',
      },
    ];

    for (const role of defaults) {
      const existing = await this.staffRolesRepository
        .createQueryBuilder('role')
        .where('LOWER(role.name) = LOWER(:name)', { name: role.name })
        .getOne();

      if (existing) {
        continue;
      }

      await this.staffRolesRepository.save(
        this.staffRolesRepository.create(role),
      );
    }
  }

  private async findActiveStaffOrFail(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: {
        id,
        role: In([UserRole.MANAGER, UserRole.INSTALLER]),
        deletedAt: IsNull(),
      },
      relations: {
        credential: true,
        staffRole: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Staff member not found');
    }

    return user;
  }

  private async ensureRoleNameAvailable(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const query = this.staffRolesRepository
      .createQueryBuilder('role')
      .where('LOWER(role.name) = LOWER(:name)', {
        name: name.trim(),
      });

    if (excludeId) {
      query.andWhere('role.id != :excludeId', { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new ConflictException('Staff role already exists');
    }
  }

  private async ensureActiveIdentificationAvailable(
    identificationNumber: string,
    excludeUserId?: string,
  ): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: {
        identificationNumber,
        deletedAt: IsNull(),
        ...(excludeUserId ? { id: Not(excludeUserId) } : {}),
      },
    });

    if (user) {
      throw new ConflictException('Identification number already exists');
    }
  }

  private async ensureEmailAvailable(
    emailAddress: string,
    excludeUserId?: string,
  ): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: {
        emailAddress,
        ...(excludeUserId ? { id: Not(excludeUserId) } : {}),
      },
    });

    if (user) {
      throw new ConflictException('Email address already exists');
    }
  }

  private async ensureUsernameAvailable(
    username: string,
    excludeUserId?: string,
  ): Promise<void> {
    const credential = await this.credentialsRepository.findOne({
      where: {
        username,
      },
    });

    if (credential && credential.user.id !== excludeUserId) {
      throw new ConflictException('Username already exists');
    }
  }

  private async resolveStaffRole(
    staffType: UserRole.MANAGER | UserRole.INSTALLER,
    staffRoleId?: string | null,
  ): Promise<StaffRole | null> {
    if (staffType === UserRole.MANAGER) {
      if (staffRoleId) {
        throw new BadRequestException(
          'Manager staff members cannot have a staff role',
        );
      }

      return null;
    }

    if (!staffRoleId) {
      throw new BadRequestException(
        'Installer staff members must have a staff role',
      );
    }

    const role = await this.staffRolesRepository.findOne({
      where: { id: staffRoleId },
    });

    if (!role) {
      throw new NotFoundException('Staff role not found');
    }

    return role;
  }

  private normalizeCreatePayload(dto: CreateStaffDto): CreateStaffDto {
    return {
      ...dto,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      phoneNumber: dto.phoneNumber.trim(),
      address: dto.address.trim(),
      identificationNumber: dto.identificationNumber.trim(),
      emailAddress: dto.emailAddress.trim().toLowerCase(),
      username: dto.username.trim(),
      password: dto.password.trim(),
      staffRoleId: dto.staffRoleId?.trim(),
    };
  }

  private normalizeUpdatePayload(dto: UpdateStaffDto): UpdateStaffDto {
    return {
      ...dto,
      firstName: dto.firstName?.trim(),
      lastName: dto.lastName?.trim(),
      phoneNumber: dto.phoneNumber?.trim(),
      address: dto.address?.trim(),
      identificationNumber: dto.identificationNumber?.trim(),
      emailAddress: dto.emailAddress?.trim().toLowerCase(),
      username: dto.username?.trim(),
      staffRoleId:
        dto.staffRoleId === undefined || dto.staffRoleId === null
          ? dto.staffRoleId
          : dto.staffRoleId.trim(),
    };
  }

  private archiveIdentificationNumber(
    userId: string,
    identificationNumber: string | null,
  ): string {
    const archivedValue = `archived:${userId}:${identificationNumber ?? 'deleted'}`;
    return archivedValue.slice(0, 255);
  }

  private toStaffListItem(user: User): StaffListItem {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      address: user.address ?? '',
      identificationNumber: user.identificationNumber ?? '',
      staffType: user.role as UserRole.MANAGER | UserRole.INSTALLER,
      emailAddress: user.emailAddress,
      username: user.credential?.username ?? '',
      staffRole: user.staffRole
        ? {
            id: user.staffRole.id,
            name: user.staffRole.name,
            description: user.staffRole.description,
          }
        : null,
    };
  }
}
