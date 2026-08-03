import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { File as FileEntity } from '../files/entities/file.entity';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import {
  requiredCategoriesForStage,
  type DocumentTaxonomyConfig,
} from './document-taxonomy.config';

export type DocumentComplianceReport = {
  jobId: string;
  stage: string;
  satisfied: Array<{ categoryId: string; label: string; fileCount: number }>;
  missing: Array<{ categoryId: string; label: string }>;
  complete: boolean;
};

@Injectable()
export class DocumentTaxonomyService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepo: Repository<FileEntity>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    private readonly settings: RuntimeSettingsService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'documentTaxonomy', role)) {
      throw new ForbiddenException(
        'The document taxonomy is not enabled for your role',
      );
    }
  }

  async getConfig(role: UserRole): Promise<DocumentTaxonomyConfig> {
    await this.assertEnabled(role);
    return this.settings.getDocumentTaxonomy();
  }

  /**
   * Categorise a file.
   *
   * For a versioned category the new file becomes the current version and any
   * previous current file is superseded — never deleted, because compliance
   * history has to remain reconstructable.
   */
  async classify(
    fileId: string,
    params: { categoryId: string | null; tags?: string[] },
    role: UserRole,
  ): Promise<FileEntity> {
    await this.assertEnabled(role);
    const config = await this.settings.getDocumentTaxonomy();

    const file = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);

    if (params.categoryId === null) {
      file.categoryId = null;
      file.versionNumber = null;
      file.isCurrentVersion = true;
      if (params.tags !== undefined) file.tags = params.tags;
      return this.fileRepo.save(file);
    }

    const category = config.categories.find((c) => c.id === params.categoryId);
    if (!category) {
      throw new BadRequestException(
        `Unknown document category "${params.categoryId}"`,
      );
    }

    const siblings = await this.fileRepo.find({
      where: {
        ownerType: file.ownerType,
        ownerId: file.ownerId,
        categoryId: category.id,
      },
    });
    const others = siblings.filter((f) => f.id !== file.id);

    if (category.versioned) {
      const highest = others.reduce(
        (max, f) => Math.max(max, f.versionNumber ?? 0),
        0,
      );
      file.versionNumber = highest + 1;
      file.isCurrentVersion = true;
      const superseded = others.filter((f) => f.isCurrentVersion);
      if (superseded.length > 0) {
        await this.fileRepo.save(
          superseded.map((f) => ({ ...f, isCurrentVersion: false })),
        );
      }
    } else {
      file.versionNumber = null;
      file.isCurrentVersion = true;
    }

    file.categoryId = category.id;
    if (params.tags !== undefined) {
      file.tags = params.tags
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    }
    return this.fileRepo.save(file);
  }

  /** Which required documents a job is missing for its current stage. */
  async complianceForJob(
    jobId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<DocumentComplianceReport> {
    await this.assertEnabled(viewer.role);
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (viewer.role === UserRole.MANAGER && job.managerId !== viewer.userId) {
      throw new ForbiddenException('That job is not one of yours');
    }

    const config = await this.settings.getDocumentTaxonomy();
    const required = requiredCategoriesForStage(config, job.pipelineStage);

    const files = await this.fileRepo.find({ where: { ownerId: jobId } });
    const countsByCategory = new Map<string, number>();
    for (const file of files) {
      if (!file.categoryId) continue;
      countsByCategory.set(
        file.categoryId,
        (countsByCategory.get(file.categoryId) ?? 0) + 1,
      );
    }

    const satisfied: DocumentComplianceReport['satisfied'] = [];
    const missing: DocumentComplianceReport['missing'] = [];
    for (const category of required) {
      const count = countsByCategory.get(category.id) ?? 0;
      if (count > 0) {
        satisfied.push({
          categoryId: category.id,
          label: category.label,
          fileCount: count,
        });
      } else {
        missing.push({ categoryId: category.id, label: category.label });
      }
    }

    return {
      jobId,
      stage: job.pipelineStage,
      satisfied,
      missing,
      complete: missing.length === 0,
    };
  }
}
