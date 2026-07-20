import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateEmployeeRoleDto } from './dto/create-employee-role.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { CreateStaffRoleDto } from './dto/create-staff-role.dto';
import { ResetStaffPasswordDto } from './dto/reset-staff-password.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { EmployeeRole } from './entities/employee-role.entity';
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

type EmployeeRoleSummary = {
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
  staffType: UserRole.MANAGER | UserRole.INSTALLER | UserRole.EMPLOYEE;
  emailAddress: string;
  username: string;
  staffRole: StaffRoleSummary | null;
  employeeRole: EmployeeRoleSummary | null;
};

const hashPassword = hash as unknown as HashPasswordFn;

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserCredential)
    private readonly credentialsRepository: Repository<UserCredential>,
    @InjectRepository(StaffRole)
    private readonly staffRolesRepository: Repository<StaffRole>,
    @InjectRepository(EmployeeRole)
    private readonly employeeRolesRepository: Repository<EmployeeRole>,
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    private readonly notificationsService: NotificationsService,
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
        role: In([UserRole.MANAGER, UserRole.INSTALLER, UserRole.EMPLOYEE]),
        deletedAt: IsNull(),
      },
      relations: {
        credential: true,
        staffRole: true,
        employeeRole: true,
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

    // Handle EMPLOYEE type (non-technical staff)
    if (payload.staffType === UserRole.EMPLOYEE) {
      const employeeRole = await this.resolveEmployeeRole(
        payload.employeeRoleId,
      );

      const identificationNumber =
        payload.identificationNumber?.trim() || (await this.generateStaffId());

      await this.ensureActiveIdentificationAvailable(identificationNumber);
      await this.ensureEmailAvailable(payload.emailAddress);

      const user = await this.usersRepository.save(
        this.usersRepository.create({
          firstName: payload.firstName,
          lastName: payload.lastName,
          phoneNumber: payload.phoneNumber,
          address: payload.address,
          identificationNumber,
          role: UserRole.EMPLOYEE,
          emailAddress: payload.emailAddress,
          employeeRoleId: employeeRole.id,
          staffRoleId: null,
        }),
      );

      user.employeeRole = employeeRole;
      const result = this.toStaffListItem(user);

      await this.sendNotificationSafely(
        () =>
          this.notificationsService.sendToRole(
            UserRole.ADMIN,
            {
              type: NOTIFICATION_TYPE.STAFF_ACCOUNT_CREATED,
              title: 'New staff account created',
              body: `${result.firstName} ${result.lastName} was added as Non-Technical Staff.`,
              metadata: {
                staffUserId: result.id,
                staffType: result.staffType,
                emailAddress: result.emailAddress,
              },
              dedupeKey: `staff-created:${result.id}`,
            },
            { excludeUserIds: [result.id] },
          ),
        `staff-created:${result.id}`,
      );

      return result;
    }

    // Handle MANAGER/INSTALLER (technical staff)
    const staffRole = await this.resolveStaffRole(
      payload.staffType,
      payload.staffRoleId,
    );

    if (!payload.username) {
      throw new BadRequestException('Username is required for technical staff');
    }
    if (!payload.password) {
      throw new BadRequestException('Password is required for technical staff');
    }

    const username = payload.username;
    const password = payload.password;

    const identificationNumber =
      payload.identificationNumber?.trim() || (await this.generateStaffId());

    await this.ensureActiveIdentificationAvailable(identificationNumber);
    await this.ensureEmailAvailable(payload.emailAddress);
    await this.ensureUsernameAvailable(username);

    const createdStaff = await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const credentialRepository = manager.getRepository(UserCredential);

      const user = await userRepository.save(
        userRepository.create({
          firstName: payload.firstName,
          lastName: payload.lastName,
          phoneNumber: payload.phoneNumber,
          address: payload.address,
          identificationNumber: identificationNumber,
          role: payload.staffType,
          emailAddress: payload.emailAddress,
          staffRoleId: staffRole?.id ?? null,
        }),
      );

      const credential = await credentialRepository.save(
        credentialRepository.create({
          username,
          passwordHash: await hashPassword(password, 10),
          mustChangePassword: true,
          user,
        }),
      );

      user.credential = credential;
      user.staffRole = staffRole ?? null;
      return this.toStaffListItem(user);
    });

    this.sendWelcomeEmail(createdStaff, password);
    await this.sendNotificationSafely(
      () =>
        this.notificationsService.sendToRole(
          UserRole.ADMIN,
          {
            type: NOTIFICATION_TYPE.STAFF_ACCOUNT_CREATED,
            title: 'New staff account created',
            body: `${createdStaff.firstName} ${createdStaff.lastName} was added as ${createdStaff.staffType}.`,
            metadata: {
              staffUserId: createdStaff.id,
              staffType: createdStaff.staffType,
              emailAddress: createdStaff.emailAddress,
            },
            dedupeKey: `staff-created:${createdStaff.id}`,
          },
          { excludeUserIds: [createdStaff.id] },
        ),
      `staff-created:${createdStaff.id}`,
    );

    return createdStaff;
  }

  async updateStaff(id: string, dto: UpdateStaffDto): Promise<StaffListItem> {
    const existing = await this.findActiveStaffOrFail(id);
    const payload = this.normalizeUpdatePayload(dto);

    const nextStaffType =
      payload.staffType ??
      (existing.role as
        | UserRole.MANAGER
        | UserRole.INSTALLER
        | UserRole.EMPLOYEE);

    // Check credential boundary: prevent type changes between employee and technical staff
    const isCurrentlyEmployee = existing.role === UserRole.EMPLOYEE;
    const isNextEmployee = nextStaffType === UserRole.EMPLOYEE;

    if (isCurrentlyEmployee && !isNextEmployee) {
      throw new BadRequestException(
        'Staff type cannot be changed from non-technical to technical',
      );
    }
    if (!isCurrentlyEmployee && isNextEmployee) {
      throw new BadRequestException(
        'Staff type cannot be changed from technical to non-technical',
      );
    }

    // Handle EMPLOYEE update
    if (isNextEmployee) {
      const nextEmployeeRoleId =
        payload.employeeRoleId === undefined
          ? existing.employeeRoleId
          : payload.employeeRoleId;

      if (!nextEmployeeRoleId) {
        throw new BadRequestException(
          'Non-technical staff must have an employee role',
        );
      }

      const employeeRole = await this.resolveEmployeeRole(nextEmployeeRoleId);

      const nextIdentificationNumber =
        payload.identificationNumber ?? existing.identificationNumber;
      const nextEmail = payload.emailAddress ?? existing.emailAddress;

      if (!nextIdentificationNumber) {
        throw new BadRequestException(
          'Identification number is required for staff members',
        );
      }

      await this.ensureActiveIdentificationAvailable(
        nextIdentificationNumber,
        id,
      );
      await this.ensureEmailAvailable(nextEmail, id);

      existing.firstName = payload.firstName ?? existing.firstName;
      existing.lastName = payload.lastName ?? existing.lastName;
      existing.phoneNumber = payload.phoneNumber ?? existing.phoneNumber;
      existing.address = payload.address ?? existing.address;
      existing.identificationNumber = nextIdentificationNumber;
      existing.emailAddress = nextEmail;
      existing.employeeRoleId = employeeRole.id;
      existing.employeeRole = employeeRole;

      const savedUser = await this.usersRepository.save(existing);
      return this.toStaffListItem(savedUser);
    }

    // Handle MANAGER/INSTALLER update
    if (!existing.credential) {
      throw new BadRequestException(
        'Staff member is missing login credentials. Recreate this record to manage login fields.',
      );
    }

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

  async resetTemporaryPassword(
    id: string,
    dto: ResetStaffPasswordDto,
    actorUserId: string,
  ): Promise<{ staffId: string; username: string; mustChangePassword: true }> {
    const existing = await this.findActiveStaffOrFail(id);

    // Reject employee records — they have no login credentials
    if (existing.role === UserRole.EMPLOYEE) {
      throw new BadRequestException(
        'This staff member does not have login credentials',
      );
    }

    // Reject if technical staff but credential is missing
    if (!existing.credential) {
      throw new BadRequestException(
        'Staff member is missing login credentials. Recreate this record to manage login fields.',
      );
    }

    // Hash and set the new temporary password
    existing.credential.passwordHash = await hashPassword(
      dto.temporaryPassword,
      10,
    );
    existing.credential.mustChangePassword = true;
    // Invalidate any tokens the staff member still holds from before the reset.
    existing.credential.tokenVersion =
      (existing.credential.tokenVersion ?? 0) + 1;
    await this.credentialsRepository.save(existing.credential);

    // Emit structured audit log
    this.logger.log(
      JSON.stringify({
        event: 'staff_temporary_password_reset_issued',
        performedByUserId: actorUserId,
        targetUserId: existing.id,
        targetUsername: existing.credential.username,
        targetStaffType: existing.role,
      }),
    );

    return {
      staffId: existing.id,
      username: existing.credential.username,
      mustChangePassword: true,
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
        role: In([UserRole.MANAGER, UserRole.INSTALLER, UserRole.EMPLOYEE]),
        deletedAt: IsNull(),
      },
      relations: {
        credential: true,
        staffRole: true,
        employeeRole: true,
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
        deletedAt: IsNull(),
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

  private async resolveEmployeeRole(
    employeeRoleId?: string | null,
  ): Promise<EmployeeRole> {
    if (!employeeRoleId) {
      throw new BadRequestException(
        'Non-technical staff members must have an employee role',
      );
    }

    const role = await this.employeeRolesRepository.findOne({
      where: { id: employeeRoleId },
    });

    if (!role) {
      throw new NotFoundException('Employee role not found');
    }

    return role;
  }

  async listEmployeeRoles(): Promise<EmployeeRoleSummary[]> {
    const roles = await this.employeeRolesRepository.find({
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

  async createEmployeeRole(
    dto: CreateEmployeeRoleDto,
  ): Promise<EmployeeRoleSummary> {
    await this.ensureEmployeeRoleNameAvailable(dto.name);

    const role = await this.employeeRolesRepository.save(
      this.employeeRolesRepository.create({
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

  async seedDefaultEmployeeRoles(): Promise<void> {
    const defaults: Array<Pick<EmployeeRole, 'name' | 'description'>> = [
      {
        name: 'Sales Representative',
        description:
          'Handles customer outreach, lead qualification and sales pipeline',
      },
      {
        name: 'Customer Support',
        description:
          'Manages customer inquiries, after-sales support and issue resolution',
      },
    ];

    for (const role of defaults) {
      const existing = await this.employeeRolesRepository
        .createQueryBuilder('role')
        .where('LOWER(role.name) = LOWER(:name)', { name: role.name })
        .getOne();

      if (existing) {
        continue;
      }

      await this.employeeRolesRepository.save(
        this.employeeRolesRepository.create(role),
      );
    }
  }

  private async ensureEmployeeRoleNameAvailable(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const query = this.employeeRolesRepository
      .createQueryBuilder('role')
      .where('LOWER(role.name) = LOWER(:name)', {
        name: name.trim(),
      });

    if (excludeId) {
      query.andWhere('role.id != :excludeId', { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new ConflictException('Employee role already exists');
    }
  }

  private normalizeCreatePayload(dto: CreateStaffDto): CreateStaffDto {
    const isEmployee = dto.staffType === UserRole.EMPLOYEE;

    return {
      ...dto,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      phoneNumber: dto.phoneNumber.trim(),
      address: dto.address.trim(),
      identificationNumber: dto.identificationNumber?.trim(),
      emailAddress: dto.emailAddress.trim().toLowerCase(),
      username: isEmployee ? undefined : dto.username?.trim(),
      password: isEmployee ? undefined : dto.password?.trim(),
      staffRoleId: dto.staffRoleId?.trim(),
      employeeRoleId: dto.employeeRoleId?.trim(),
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
      employeeRoleId:
        dto.employeeRoleId === undefined || dto.employeeRoleId === null
          ? dto.employeeRoleId
          : dto.employeeRoleId.trim(),
    };
  }

  private sendWelcomeEmail(
    staff: StaffListItem,
    temporaryPassword: string,
  ): void {
    this.email.fireAndForget({
      to: staff.emailAddress,
      subject: 'Welcome to Fordan Solar CRM',
      template: 'welcome',
      context: {
        firstName: staff.firstName,
        username: staff.username,
        temporaryPassword,
        loginUrl: this.getStaffLoginUrl(),
        currentYear: new Date().getFullYear(),
        staffTypeLabel: this.toStaffTypeLabel(staff.staffType),
        staffRoleName: staff.staffRole?.name ?? null,
      },
    });
  }

  private async sendNotificationSafely(
    action: () => Promise<unknown>,
    context: string,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification skipped for ${context}: ${message}`);
    }
  }

  private getStaffLoginUrl(): string {
    const fallbackUrl = 'http://localhost:5173/login';
    const rawBaseUrl = process.env.WEB_APP_URL?.trim();

    if (!rawBaseUrl) {
      return fallbackUrl;
    }

    try {
      const normalizedBaseUrl = rawBaseUrl.endsWith('/')
        ? rawBaseUrl
        : `${rawBaseUrl}/`;
      return new URL('login', normalizedBaseUrl).toString();
    } catch {
      this.logger.warn(
        `Invalid WEB_APP_URL "${rawBaseUrl}" — falling back to ${fallbackUrl}`,
      );
      return fallbackUrl;
    }
  }

  private toStaffTypeLabel(
    staffType: UserRole.MANAGER | UserRole.INSTALLER | UserRole.EMPLOYEE,
  ): string {
    if (staffType === UserRole.MANAGER) return 'Manager';
    if (staffType === UserRole.INSTALLER) return 'Installer';
    return 'Non-Technical Staff';
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
      staffType: user.role as
        | UserRole.MANAGER
        | UserRole.INSTALLER
        | UserRole.EMPLOYEE,
      emailAddress: user.emailAddress,
      username:
        user.role === UserRole.EMPLOYEE
          ? ''
          : (user.credential?.username ?? ''),
      staffRole: user.staffRole
        ? {
            id: user.staffRole.id,
            name: user.staffRole.name,
            description: user.staffRole.description,
          }
        : null,
      employeeRole: user.employeeRole
        ? {
            id: user.employeeRole.id,
            name: user.employeeRole.name,
            description: user.employeeRole.description,
          }
        : null,
    };
  }

  private async generateStaffId(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `FRD-${year}-`;

    const latest = await this.usersRepository
      .createQueryBuilder('user')
      .where('user.identificationNumber LIKE :prefix', { prefix: `${prefix}%` })
      .andWhere('user.deletedAt IS NULL')
      .orderBy('user.identificationNumber', 'DESC')
      .getOne();

    let nextSequence = 1;
    if (latest?.identificationNumber) {
      const parts = latest.identificationNumber.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) {
        nextSequence = lastNum + 1;
      }
    }

    return `${prefix}${String(nextSequence).padStart(4, '0')}`;
  }
}
