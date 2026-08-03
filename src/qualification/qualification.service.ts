import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { TasksService } from '../tasks/tasks.service';
import {
  scoreQualification,
  type QualificationConfig,
} from './qualification.config';

export const QUALIFICATION_STATUSES = [
  'unqualified',
  'working',
  'qualified',
  'disqualified',
  'nurture',
] as const;

export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export type QualificationResult = {
  customerId: string;
  status: QualificationStatus;
  score: number | null;
  qualifiedThreshold: number;
  answers: Record<string, unknown>;
  disqualificationReason: string | null;
  qualifiedAt: string | null;
  nurtureUntil: string | null;
  /** Required criteria left blank — populated when a qualify attempt is rejected. */
  missingRequired: string[];
};

@Injectable()
export class QualificationService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly settings: RuntimeSettingsService,
    private readonly tasks: TasksService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'qualificationWorkflow', role)) {
      throw new ForbiddenException(
        'The qualification workflow is not enabled for your role',
      );
    }
  }

  async getConfig(role: UserRole): Promise<QualificationConfig> {
    await this.assertEnabled(role);
    return this.settings.getQualificationConfig();
  }

  async getForCustomer(
    customerId: string,
    role: UserRole,
  ): Promise<QualificationResult> {
    await this.assertEnabled(role);
    const customer = await this.load(customerId);
    const config = await this.settings.getQualificationConfig();
    return this.toResult(customer, config, []);
  }

  /**
   * Record or update an assessment.
   *
   * Scoring is always recomputed from the stored answers against the *current*
   * config, so a threshold change is reflected without a data migration; the
   * answers are the durable record, the score is derived.
   */
  async assess(params: {
    customerId: string;
    answers: Record<string, unknown>;
    status?: QualificationStatus;
    disqualificationReason?: string | null;
    actorUserId: string;
    role: UserRole;
  }): Promise<QualificationResult> {
    await this.assertEnabled(params.role);
    const customer = await this.load(params.customerId);
    const config = await this.settings.getQualificationConfig();

    const merged = {
      ...(customer.qualificationAnswers ?? {}),
      ...params.answers,
    };
    const { score, missingRequired } = scoreQualification(config, merged);

    // Status precedence: an explicit status wins; otherwise derive it from the
    // score, but never auto-qualify while a required answer is missing.
    let status: QualificationStatus;
    if (params.status) {
      status = params.status;
    } else if (missingRequired.length > 0) {
      status = 'working';
    } else {
      status = score >= config.qualifiedThreshold ? 'qualified' : 'working';
    }

    if (status === 'qualified' && missingRequired.length > 0) {
      throw new BadRequestException(
        `Cannot qualify: required criteria unanswered (${missingRequired.join(', ')})`,
      );
    }
    if (status === 'disqualified') {
      const reason = params.disqualificationReason?.trim();
      if (!reason) {
        throw new BadRequestException(
          'A disqualification reason is required to disqualify a lead',
        );
      }
      if (
        config.disqualificationReasons.length > 0 &&
        !config.disqualificationReasons.includes(reason)
      ) {
        throw new BadRequestException(
          `"${reason}" is not a configured disqualification reason`,
        );
      }
      customer.disqualificationReason = reason;
    } else {
      customer.disqualificationReason = null;
    }

    customer.qualificationAnswers = merged;
    customer.qualificationScore = score;
    customer.qualificationStatus = status;
    customer.qualifiedAt = status === 'qualified' ? new Date() : null;
    customer.qualifiedByUserId =
      status === 'qualified' ? params.actorUserId : null;

    if (status === 'nurture' && config.nurtureFollowUpDays !== null) {
      const until = new Date();
      until.setDate(until.getDate() + config.nurtureFollowUpDays);
      customer.nurtureUntil = until;
    } else {
      customer.nurtureUntil = null;
    }

    const saved = await this.customerRepo.save(customer);

    // A nurture lead only comes back if something surfaces it — create the
    // follow-up task now rather than relying on someone remembering.
    if (status === 'nurture' && saved.nurtureUntil) {
      await this.tasks
        .create(
          {
            title: `Follow up with ${saved.firstName} ${saved.lastName}`.trim(),
            description: 'Nurture follow-up from lead qualification.',
            dueAt: saved.nurtureUntil.toISOString(),
            priority: undefined,
          },
          { userId: params.actorUserId, role: params.role },
        )
        .catch(() => undefined);
    }

    return this.toResult(saved, config, missingRequired);
  }

  /** Nurture leads whose wait has elapsed — the "resurface" queue. */
  async listDueNurture(role: UserRole): Promise<Customer[]> {
    await this.assertEnabled(role);
    const all = await this.customerRepo.find({
      where: { qualificationStatus: 'nurture' },
      take: 500,
    });
    const now = new Date();
    return all.filter((c) => c.nurtureUntil !== null && c.nurtureUntil <= now);
  }

  private async load(customerId: string): Promise<Customer> {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    return customer;
  }

  private toResult(
    customer: Customer,
    config: QualificationConfig,
    missingRequired: string[],
  ): QualificationResult {
    return {
      customerId: customer.id,
      status: (customer.qualificationStatus ??
        'unqualified') as QualificationStatus,
      score: customer.qualificationScore,
      qualifiedThreshold: config.qualifiedThreshold,
      answers: customer.qualificationAnswers ?? {},
      disqualificationReason: customer.disqualificationReason,
      qualifiedAt: customer.qualifiedAt
        ? customer.qualifiedAt.toISOString()
        : null,
      nurtureUntil: customer.nurtureUntil
        ? customer.nurtureUntil.toISOString()
        : null,
      missingRequired,
    };
  }
}
