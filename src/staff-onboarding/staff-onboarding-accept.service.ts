import { Injectable, Logger } from '@nestjs/common';
import { UserRole } from '../users/entities/user-role.enum';
import { StaffService } from '../staff/staff.service';
import { EmployeeFormsService } from '../employee-forms/employee-forms.service';
import { UpsertEmployeeFormDto } from '../employee-forms/dto/upsert-employee-form.dto';
import { StaffOnboardingService } from './staff-onboarding.service';

/**
 * Accepting an onboarding invite.
 *
 * Separated from `StaffOnboardingService` because it depends on `StaffService`,
 * and `StaffService` is a heavy module — keeping the token/invite logic free of
 * that dependency keeps the public surface easy to reason about.
 */
@Injectable()
export class StaffOnboardingAcceptService {
  private readonly logger = new Logger(StaffOnboardingAcceptService.name);

  constructor(
    private readonly onboarding: StaffOnboardingService,
    private readonly staff: StaffService,
    private readonly employeeForms: EmployeeFormsService,
  ) {}

  /**
   * Validate the token, create the account when the invite was for a new hire,
   * store the form, and spend the invite.
   *
   * The role comes from the invite, never from the submission. The response
   * deliberately carries no credentials — the account's welcome email handles
   * that through the existing path.
   */
  async acceptInvite(
    token: string,
    dto: UpsertEmployeeFormDto,
  ): Promise<{ submitted: true; accountCreated: boolean }> {
    const invite = await this.onboarding.resolveToken(token);

    let userId = invite.userId;
    let accountCreated = false;

    if (!userId) {
      const created = await this.staff.createStaff({
        firstName: dto.firstName,
        lastName: dto.surname,
        phoneNumber: dto.phoneMobile,
        address: dto.homeAddress ?? '',
        emailAddress: invite.email,
        // Fixed when the invite was issued — a submission cannot choose it.
        staffType: invite.intendedRole as
          | UserRole.MANAGER
          | UserRole.INSTALLER
          | UserRole.EMPLOYEE,
        ...(invite.employeeRoleId
          ? { employeeRoleId: invite.employeeRoleId }
          : {}),
        ...(invite.staffRoleId ? { staffRoleId: invite.staffRoleId } : {}),
        // Technical staff (manager/installer) must have a username, and the
        // invitee never picks one — derive it from the invited email and let
        // the suffix break ties.
        ...(invite.intendedRole === UserRole.EMPLOYEE
          ? {}
          : { username: await this.suggestUsername(invite.email) }),
      });
      userId = created.id;
      accountCreated = true;
      this.logger.log(`Onboarding invite created staff account ${userId}`);
    }

    await this.employeeForms.upsertForUser(userId, dto);
    await this.onboarding.markAccepted(invite, userId);

    return { submitted: true, accountCreated };
  }

  /**
   * A username derived from the invited email's local part, with a numeric
   * suffix if it is taken. `createStaff` rejects a duplicate, so this only has
   * to produce something plausible and unused.
   */
  private async suggestUsername(email: string): Promise<string> {
    const base =
      email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 24) || 'staff';

    const taken = await this.staff.isUsernameTaken(base);
    if (!taken) return base;

    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base}${i}`;
      if (!(await this.staff.isUsernameTaken(candidate))) return candidate;
    }
    // Vanishingly unlikely; a timestamp suffix is still readable.
    return `${base}${Date.now().toString().slice(-5)}`;
  }
}
