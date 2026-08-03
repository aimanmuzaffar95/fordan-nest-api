import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { SiteSurvey, SurveyStatus } from './entities/site-survey.entity';
import { UpsertSurveyDto } from './dto/upsert-survey.dto';

@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(SiteSurvey)
    private readonly surveyRepo: Repository<SiteSurvey>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    private readonly settings: RuntimeSettingsService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'surveyObject', role)) {
      throw new ForbiddenException(
        'Site surveys are not enabled for your role',
      );
    }
  }

  /** Installers only see jobs assigned to them; managers, jobs they manage. */
  private async assertJobInScope(
    jobId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<Job> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (viewer.role === UserRole.ADMIN) return job;
    if (viewer.role === UserRole.MANAGER) {
      if (job.managerId !== viewer.userId) {
        throw new ForbiddenException('That job is not one of yours');
      }
      return job;
    }
    if (job.assignedStaffUserId !== viewer.userId) {
      throw new ForbiddenException('That job is not assigned to you');
    }
    return job;
  }

  async listForJob(
    jobId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<SiteSurvey[]> {
    await this.assertEnabled(viewer.role);
    await this.assertJobInScope(jobId, viewer);
    return this.surveyRepo.find({
      where: { jobId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Create or update a survey.
   *
   * Idempotent on `clientRequestId` so the mobile offline queue can replay a
   * submission after a dropped connection without creating a second survey —
   * the same guarantee the attendance clock queue already relies on.
   */
  async upsert(
    jobId: string,
    dto: UpsertSurveyDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<SiteSurvey> {
    await this.assertEnabled(viewer.role);
    await this.assertJobInScope(jobId, viewer);

    let survey: SiteSurvey | null = null;
    if (dto.id) {
      survey = await this.surveyRepo.findOne({ where: { id: dto.id, jobId } });
      if (!survey) throw new NotFoundException(`Survey ${dto.id} not found`);
    } else if (dto.clientRequestId) {
      survey = await this.surveyRepo.findOne({
        where: { jobId, clientRequestId: dto.clientRequestId },
      });
    }

    if (!survey) {
      survey = this.surveyRepo.create({
        jobId,
        status: SurveyStatus.SCHEDULED,
        clientRequestId: dto.clientRequestId ?? null,
      });
    }

    // Copy only what the caller actually sent, so a partial field-app sync
    // never blanks findings captured earlier.
    const assignable: Array<keyof UpsertSurveyDto & keyof SiteSurvey> = [
      'status',
      'outcome',
      'assignedUserId',
      'roofType',
      'roofAgeYears',
      'roofPitchDegrees',
      'roofOrientationDegrees',
      'storeys',
      'roofConditionAcceptable',
      'shadingLevel',
      'shadingNotes',
      'phaseType',
      'switchboardUpgradeRequired',
      'switchboardNotes',
      'mainSwitchRatingAmps',
      'cableRunMetres',
      'accessDifficulty',
      'scaffoldRequired',
      'craneRequired',
      'accessNotes',
      'outcomeNotes',
      'photoFileIds',
      'extra',
    ];
    for (const field of assignable) {
      const value = dto[field as keyof UpsertSurveyDto];
      if (value !== undefined) {
        (survey as unknown as Record<string, unknown>)[field] = value;
      }
    }

    // Numerics are stored as strings by the driver; normalise at the boundary.
    if (dto.usableRoofAreaSqm !== undefined) {
      survey.usableRoofAreaSqm =
        dto.usableRoofAreaSqm === null ? null : String(dto.usableRoofAreaSqm);
    }
    if (dto.remediationCost !== undefined) {
      survey.remediationCost =
        dto.remediationCost === null ? null : String(dto.remediationCost);
    }
    if (dto.scheduledAt !== undefined) {
      survey.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    }

    // Timestamps follow status, so the field app only has to send a status.
    if (dto.status === SurveyStatus.IN_PROGRESS && !survey.startedAt) {
      survey.startedAt = new Date();
    }
    if (
      (dto.status === SurveyStatus.COMPLETED ||
        dto.status === SurveyStatus.FAILED) &&
      !survey.completedAt
    ) {
      survey.completedAt = new Date();
      survey.completedByUserId = viewer.userId;
    }

    return this.surveyRepo.save(survey);
  }

  async findOne(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<SiteSurvey> {
    await this.assertEnabled(viewer.role);
    const survey = await this.surveyRepo.findOne({ where: { id } });
    if (!survey) throw new NotFoundException(`Survey ${id} not found`);
    await this.assertJobInScope(survey.jobId, viewer);
    return survey;
  }
}
