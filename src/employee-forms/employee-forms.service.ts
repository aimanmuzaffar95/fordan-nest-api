import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { EmployeeForm } from './entities/employee-form.entity';
import { UpsertEmployeeFormDto } from './dto/upsert-employee-form.dto';

export type EmployeeFormResponse = {
  id: string;
  userId: string;
  firstName: string;
  surname: string;
  dateOfBirth: string;
  driversLicenseNo: string;
  phoneMobile: string;
  phoneHome: string;
  email: string;
  homeAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  accountName: string;
  bsb: string;
  accountNo: string;
  hasSuperannuation: boolean;
  superFundName: string;
  superMemberNumber: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhoneMobile: string;
  emergencyContactPhoneHome: string;
  emergencyContactAddress: string;
  submittedAt: string;
  lockedForInstaller: boolean;
};

@Injectable()
export class EmployeeFormsService {
  constructor(
    @InjectRepository(EmployeeForm)
    private readonly employeeFormsRepository: Repository<EmployeeForm>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async list(): Promise<EmployeeFormResponse[]> {
    const rows = await this.employeeFormsRepository.find({
      relations: { user: true },
      where: {
        user: {
          deletedAt: IsNull(),
        },
      },
      order: {
        submittedAt: 'DESC',
      },
    });

    return rows.map((row) => this.toResponse(row));
  }

  async getForUser(userId: string): Promise<EmployeeFormResponse | null> {
    const row = await this.employeeFormsRepository.findOne({
      where: { userId },
    });

    return row ? this.toResponse(row) : null;
  }

  async upsertForUser(
    userId: string,
    dto: UpsertEmployeeFormDto,
  ): Promise<EmployeeFormResponse> {
    const user = await this.usersRepository.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Every staff role onboards, not just installers. Admins are the exception —
    // they are not onboarded staff. Restricting this to INSTALLER previously
    // left managers and non-technical employees unable to submit their own form
    // at all, and blocked onboarding invites for those roles.
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Admin users do not complete an employee onboarding form',
      );
    }

    const existing = await this.employeeFormsRepository.findOne({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException(
        'Employee form already submitted and locked. Please contact an admin for changes.',
      );
    }

    const normalized = this.normalizePayload(dto);
    const submittedAt = new Date();

    const saved = await this.employeeFormsRepository.save(
      this.employeeFormsRepository.create({
        userId,
        user,
        ...normalized,
        submittedAt,
      }),
    );

    const fullName = `${user.firstName} ${user.lastName}`.trim();
    await this.notificationsService.sendToRole(UserRole.ADMIN, {
      type: NOTIFICATION_TYPE.EMPLOYEE_FORM_SUBMITTED,
      title: 'Employee form submitted',
      body: `${fullName} has submitted their employee registration form.`,
      metadata: { employeeFormId: saved.id, installerUserId: userId },
    });

    return this.toResponse(saved);
  }

  async updateByAdmin(
    formId: string,
    dto: UpsertEmployeeFormDto,
  ): Promise<EmployeeFormResponse> {
    const existing = await this.employeeFormsRepository.findOne({
      where: { id: formId },
      relations: { user: true },
    });

    if (!existing || existing.user?.deletedAt) {
      throw new NotFoundException('Employee form not found');
    }

    Object.assign(existing, this.normalizePayload(dto));
    const saved = await this.employeeFormsRepository.save(existing);

    return this.toResponse(saved);
  }

  private normalizePayload(dto: UpsertEmployeeFormDto) {
    const nullable = (value: string | undefined): string | null => {
      const trimmed = value?.trim() ?? '';
      return trimmed.length > 0 ? trimmed : null;
    };

    return {
      firstName: dto.firstName.trim(),
      surname: dto.surname.trim(),
      dateOfBirth: nullable(dto.dateOfBirth),
      driversLicenseNo: nullable(dto.driversLicenseNo),
      phoneMobile: dto.phoneMobile.trim(),
      phoneHome: nullable(dto.phoneHome),
      email: dto.email.trim().toLowerCase(),
      homeAddress: nullable(dto.homeAddress),
      suburb: nullable(dto.suburb),
      state: nullable(dto.state),
      postcode: nullable(dto.postcode),
      accountName: nullable(dto.accountName),
      bsb: nullable(dto.bsb),
      accountNo: nullable(dto.accountNo),
      hasSuperannuation: dto.hasSuperannuation,
      superFundName: dto.hasSuperannuation ? nullable(dto.superFundName) : null,
      superMemberNumber: dto.hasSuperannuation
        ? nullable(dto.superMemberNumber)
        : null,
      emergencyContactName: nullable(dto.emergencyContactName),
      emergencyContactRelationship: nullable(dto.emergencyContactRelationship),
      emergencyContactPhoneMobile: nullable(dto.emergencyContactPhoneMobile),
      emergencyContactPhoneHome: nullable(dto.emergencyContactPhoneHome),
      emergencyContactAddress: nullable(dto.emergencyContactAddress),
    };
  }

  private toResponse(row: EmployeeForm): EmployeeFormResponse {
    return {
      id: row.id,
      userId: row.userId,
      firstName: row.firstName,
      surname: row.surname,
      dateOfBirth: row.dateOfBirth ?? '',
      driversLicenseNo: row.driversLicenseNo ?? '',
      phoneMobile: row.phoneMobile,
      phoneHome: row.phoneHome ?? '',
      email: row.email,
      homeAddress: row.homeAddress ?? '',
      suburb: row.suburb ?? '',
      state: row.state ?? '',
      postcode: row.postcode ?? '',
      accountName: row.accountName ?? '',
      bsb: row.bsb ?? '',
      accountNo: row.accountNo ?? '',
      hasSuperannuation: row.hasSuperannuation,
      superFundName: row.superFundName ?? '',
      superMemberNumber: row.superMemberNumber ?? '',
      emergencyContactName: row.emergencyContactName ?? '',
      emergencyContactRelationship: row.emergencyContactRelationship ?? '',
      emergencyContactPhoneMobile: row.emergencyContactPhoneMobile ?? '',
      emergencyContactPhoneHome: row.emergencyContactPhoneHome ?? '',
      emergencyContactAddress: row.emergencyContactAddress ?? '',
      submittedAt: row.submittedAt.toISOString(),
      lockedForInstaller: true,
    };
  }
}
