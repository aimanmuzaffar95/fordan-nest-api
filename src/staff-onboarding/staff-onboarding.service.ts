import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { EmailService } from '../email/email.service';
import { StaffOnboardingInvite } from './entities/staff-onboarding-invite.entity';

/** Roles an invite may create. Admin is deliberately absent. */
export const INVITABLE_ROLES: UserRole[] = [
  UserRole.MANAGER,
  UserRole.INSTALLER,
  UserRole.EMPLOYEE,
];

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type InviteSummary = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  userId: string | null;
  intendedRole: UserRole;
  employeeRoleId: string | null;
  staffRoleId: string | null;
  status: InviteStatus;
  expiresAt: string;
  acceptedAt: string | null;
  lastSentAt: string | null;
  sendCount: number;
  createdAt: string;
};

const DEFAULT_TTL_DAYS = 14;

@Injectable()
export class StaffOnboardingService {
  private readonly logger = new Logger(StaffOnboardingService.name);

  constructor(
    @InjectRepository(StaffOnboardingInvite)
    private readonly inviteRepo: Repository<StaffOnboardingInvite>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly email: EmailService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private statusOf(
    invite: StaffOnboardingInvite,
    now = new Date(),
  ): InviteStatus {
    if (invite.revokedAt) return 'revoked';
    if (invite.acceptedAt) return 'accepted';
    if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
    return 'pending';
  }

  private toSummary(invite: StaffOnboardingInvite): InviteSummary {
    return {
      id: invite.id,
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
      userId: invite.userId,
      intendedRole: invite.intendedRole,
      employeeRoleId: invite.employeeRoleId,
      staffRoleId: invite.staffRoleId,
      status: this.statusOf(invite),
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt?.toISOString() ?? null,
      lastSentAt: invite.lastSentAt?.toISOString() ?? null,
      sendCount: invite.sendCount,
      createdAt: invite.createdAt.toISOString(),
    };
  }

  /** `WEB_APP_URL`-based onboarding link. Mirrors `StaffService.getStaffLoginUrl`. */
  private onboardingUrl(token: string): string {
    const base = process.env.WEB_APP_URL?.trim() || 'http://localhost:5173';
    try {
      const normalized = base.endsWith('/') ? base : `${base}/`;
      return new URL(`onboarding/${token}`, normalized).toString();
    } catch {
      this.logger.warn(`Invalid WEB_APP_URL "${base}" — using the raw path`);
      return `/onboarding/${token}`;
    }
  }

  async list(): Promise<InviteSummary[]> {
    const invites = await this.inviteRepo.find({
      order: { createdAt: 'DESC' },
      take: 500,
    });
    return invites.map((i) => this.toSummary(i));
  }

  /**
   * Issue an invite and email the link.
   *
   * Either `userId` (an existing staff member fills their own form without
   * logging in) or an email plus role (a new hire whose account is created when
   * they submit). The plaintext token is returned once so the caller can show
   * or copy it; only its hash is stored.
   */
  async invite(
    dto: {
      userId?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      role?: UserRole;
      employeeRoleId?: string;
      staffRoleId?: string;
      ttlDays?: number;
    },
    actorUserId: string,
  ): Promise<{ invite: InviteSummary; url: string }> {
    let userId: string | null = null;
    let email = dto.email?.trim().toLowerCase() ?? '';
    let firstName = dto.firstName?.trim() || null;
    let lastName = dto.lastName?.trim() || null;
    let role = dto.role;

    if (dto.userId) {
      const user = await this.usersRepo.findOne({
        where: { id: dto.userId, deletedAt: IsNull() },
      });
      if (!user) throw new NotFoundException('Staff member not found');
      if (user.role === UserRole.ADMIN) {
        throw new ForbiddenException(
          'Admins do not complete an onboarding form',
        );
      }
      userId = user.id;
      email = user.emailAddress;
      firstName = user.firstName;
      lastName = user.lastName;
      role = user.role;
    } else {
      if (!email) {
        throw new BadRequestException(
          'An email address is required to invite someone new',
        );
      }
      if (!role || !INVITABLE_ROLES.includes(role)) {
        throw new BadRequestException(
          `Choose the role this hire will get: ${INVITABLE_ROLES.join(', ')}`,
        );
      }
      // Mirror StaffService's own rules so the invite cannot be issued into a
      // shape that will fail at submit time, when the invitee is the one who
      // sees the error.
      if (role === UserRole.EMPLOYEE && !dto.employeeRoleId) {
        throw new BadRequestException(
          'Non-technical staff must be given an employee role on the invite',
        );
      }
      if (role === UserRole.INSTALLER && !dto.staffRoleId) {
        throw new BadRequestException(
          'Installers must be given a staff role on the invite',
        );
      }
      if (role === UserRole.MANAGER && dto.staffRoleId) {
        throw new BadRequestException(
          'Managers cannot be given a staff role',
        );
      }
      // A matching account already exists — invite that person instead of
      // creating a duplicate on submit.
      const existing = await this.usersRepo.findOne({
        where: { emailAddress: email, deletedAt: IsNull() },
      });
      if (existing) {
        if (existing.role === UserRole.ADMIN) {
          throw new ForbiddenException(
            'Admins do not complete an onboarding form',
          );
        }
        userId = existing.id;
        firstName = existing.firstName;
        lastName = existing.lastName;
        role = existing.role;
      }
    }

    // Supersede any live invite for the same recipient so only one link works.
    const live = await this.inviteRepo.find({
      where: userId ? { userId } : { email },
    });
    const now = new Date();
    for (const prior of live) {
      if (this.statusOf(prior, now) === 'pending') {
        prior.revokedAt = now;
        await this.inviteRepo.save(prior);
      }
    }

    const token = randomBytes(32).toString('base64url');
    const ttlDays = Math.min(Math.max(dto.ttlDays ?? DEFAULT_TTL_DAYS, 1), 60);
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

    const invite = await this.inviteRepo.save(
      this.inviteRepo.create({
        tokenHash: this.hash(token),
        email,
        firstName,
        lastName,
        userId,
        intendedRole: role as UserRole,
        employeeRoleId: dto.employeeRoleId ?? null,
        staffRoleId: dto.staffRoleId ?? null,
        expiresAt,
        lastSentAt: now,
        sendCount: 1,
        createdByUserId: actorUserId,
      }),
    );

    const url = this.onboardingUrl(token);
    await this.sendInviteEmail(email, firstName, url, expiresAt);

    return { invite: this.toSummary(invite), url };
  }

  /** Email failures must not lose the invite — the link can still be copied. */
  private async sendInviteEmail(
    to: string,
    firstName: string | null,
    url: string,
    expiresAt: Date,
  ): Promise<void> {
    const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
    const expiry = expiresAt.toDateString();
    try {
      await this.email.send({
        to,
        subject: 'Complete your onboarding',
        html: `
          <p>${greeting}</p>
          <p>Please complete your staff onboarding form using the link below.</p>
          <p><a href="${url}">Complete onboarding</a></p>
          <p>This link works until ${expiry} and can only be used once.</p>
        `,
        text: `${greeting}\n\nComplete your staff onboarding form: ${url}\n\nThis link works until ${expiry} and can only be used once.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Onboarding invite email to ${to} failed: ${message}`);
    }
  }

  async resend(id: string): Promise<InviteSummary> {
    const invite = await this.inviteRepo.findOne({ where: { id } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (this.statusOf(invite) !== 'pending') {
      throw new BadRequestException(
        'Only a pending invite can be resent — issue a new one instead',
      );
    }
    // The stored hash cannot be reversed, so resending mints a fresh token and
    // retires the old link.
    const token = randomBytes(32).toString('base64url');
    invite.tokenHash = this.hash(token);
    invite.lastSentAt = new Date();
    invite.sendCount += 1;
    const saved = await this.inviteRepo.save(invite);

    await this.sendInviteEmail(
      invite.email,
      invite.firstName,
      this.onboardingUrl(token),
      invite.expiresAt,
    );
    return this.toSummary(saved);
  }

  async revoke(id: string): Promise<InviteSummary> {
    const invite = await this.inviteRepo.findOne({ where: { id } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (!invite.revokedAt && !invite.acceptedAt) {
      invite.revokedAt = new Date();
      await this.inviteRepo.save(invite);
    }
    return this.toSummary(invite);
  }

  /**
   * Resolve a plaintext token to a usable invite.
   *
   * Every failure — unknown, revoked, expired, already used — is a plain
   * `NotFoundException` so the public endpoint cannot be used to probe which
   * tokens exist.
   */
  async resolveToken(token: string): Promise<StaffOnboardingInvite> {
    if (!token) throw new NotFoundException('Invite not found');
    const invite = await this.inviteRepo.findOne({
      where: { tokenHash: this.hash(token) },
    });
    if (!invite || this.statusOf(invite) !== 'pending') {
      throw new NotFoundException('Invite not found');
    }
    return invite;
  }

  /** Marks the invite used and records the account it belongs to. */
  async markAccepted(
    invite: StaffOnboardingInvite,
    userId: string,
  ): Promise<void> {
    invite.acceptedAt = new Date();
    invite.userId = userId;
    await this.inviteRepo.save(invite);
  }
}
