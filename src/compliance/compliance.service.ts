import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Job } from '../jobs/entities/job.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { JobCecItemTick } from './entities/job-cec-item-tick.entity';
import { File as FileEntity } from '../files/entities/file.entity';
import { In } from 'typeorm';
import {
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_PHASES,
  ComplianceEvidenceDto,
  EVIDENCE_SOURCES,
} from './dto/compliance-field.dto';
import type {
  ComplianceFieldDto,
  CreateComplianceTemplateDto,
  UpdateComplianceTemplateDto,
} from './dto/compliance-field.dto';
import type { SubmitJobComplianceDto } from './dto/submit-job-compliance.dto';
import { ComplianceFormTemplate } from './entities/compliance-form-template.entity';
import { JobComplianceSubmission } from './entities/job-compliance-submission.entity';

export type ComplianceViewer = { userId: string; role: UserRole };

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export type NormalizedEvidenceRule = {
  required: boolean;
  sources: EvidenceSource[];
  min: number;
  max: number;
};
export const DEFAULT_EVIDENCE_RULE: NormalizedEvidenceRule = {
  required: false,
  sources: ['camera', 'gallery', 'document'],
  min: 0,
  max: 20,
};

export type NormalizedComplianceField = {
  key: string;
  label: string;
  type: 'text' | 'checkbox' | 'date';
  required: boolean;
};

// PNG files begin with this 8-byte signature (\x89 P N G \r \n \x1a \n).
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPngDataUrlSignature(raw: string): void {
  const trimmed = raw.trim();
  const m = /^data:image\/png;base64,(.+)$/i.exec(trimmed);
  if (!m) {
    throw new BadRequestException('Signature must be a PNG data URL');
  }
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 400) {
    throw new BadRequestException('Signature image is too small');
  }
  // Verify the actual PNG magic bytes, not just the declared MIME prefix —
  // the data URL label is caller-controlled and trivially spoofed.
  if (!buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new BadRequestException('Signature is not a valid PNG image');
  }
}

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(ComplianceFormTemplate)
    private readonly templatesRepo: Repository<ComplianceFormTemplate>,
    @InjectRepository(JobComplianceSubmission)
    private readonly submissionsRepo: Repository<JobComplianceSubmission>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
    @InjectRepository(JobCecItemTick)
    private readonly cecTicksRepo: Repository<JobCecItemTick>,
    @InjectRepository(FileEntity)
    private readonly filesRepo: Repository<FileEntity>,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  /** Manual CEC checklist tick state for a job (config-defined string item ids). */
  async listChecklistTicks(
    jobId: string,
    viewer: ComplianceViewer,
  ): Promise<{
    items: Array<{
      itemId: string;
      done: boolean;
      doneAt: string | null;
      doneByUserId: string | null;
    }>;
  }> {
    await this.assertJobAccess(jobId, viewer);
    const rows = await this.cecTicksRepo.find({ where: { jobId } });
    return {
      items: rows.map((r) => ({
        itemId: r.itemId,
        done: r.done,
        doneAt: r.doneAt ? r.doneAt.toISOString() : null,
        doneByUserId: r.doneByUserId,
      })),
    };
  }

  async setChecklistTick(
    jobId: string,
    itemId: string,
    done: boolean,
    viewer: ComplianceViewer,
  ): Promise<{
    itemId: string;
    done: boolean;
    doneAt: string | null;
    doneByUserId: string | null;
  }> {
    if (!/^[a-z0-9_-]{1,64}$/.test(itemId)) {
      throw new BadRequestException('Invalid checklist item id');
    }
    await this.assertJobAccess(jobId, viewer);
    const existing = await this.cecTicksRepo.findOne({
      where: { jobId, itemId },
    });
    const row = existing ?? this.cecTicksRepo.create({ jobId, itemId });
    row.done = done;
    row.doneAt = done ? new Date() : null;
    row.doneByUserId = done ? viewer.userId : null;
    const saved = await this.cecTicksRepo.save(row);
    return {
      itemId: saved.itemId,
      done: saved.done,
      doneAt: saved.doneAt ? saved.doneAt.toISOString() : null,
      doneByUserId: saved.doneByUserId,
    };
  }

  normalizeFields(raw: unknown): NormalizedComplianceField[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException('At least one field is required');
    }
    if (raw.length > 40) {
      throw new BadRequestException('Too many fields (max 40)');
    }
    const keys = new Set<string>();
    const out: NormalizedComplianceField[] = [];
    for (const row of raw) {
      const f = row as ComplianceFieldDto;
      if (!f || typeof f.key !== 'string' || typeof f.label !== 'string') {
        throw new BadRequestException('Invalid field definition');
      }
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(f.key)) {
        throw new BadRequestException(`Invalid field key: ${f.key}`);
      }
      if (keys.has(f.key)) {
        throw new BadRequestException(`Duplicate field key: ${f.key}`);
      }
      keys.add(f.key);
      if (!['text', 'checkbox', 'date'].includes(f.type)) {
        throw new BadRequestException(`Invalid type for field ${f.key}`);
      }
      out.push({
        key: f.key,
        label: f.label.trim().slice(0, 500),
        type: f.type,
        required: Boolean(f.required),
      });
    }
    return out;
  }

  private normalizeEvidence(
    raw: unknown,
  ): NormalizedEvidenceRule {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_EVIDENCE_RULE };
    const r = raw as Partial<ComplianceEvidenceDto>;
    const sources = (Array.isArray(r.sources) ? r.sources : []).filter(
      (x): x is EvidenceSource =>
        (EVIDENCE_SOURCES as readonly string[]).includes(String(x)),
    );
    const required = Boolean(r.required);
    const min = Math.max(
      required ? 1 : 0,
      Math.min(20, Math.trunc(Number(r.min ?? (required ? 1 : 0)) || 0)),
    );
    const max = Math.max(
      min,
      Math.min(50, Math.trunc(Number(r.max ?? 20) || 20)),
    );
    return {
      required,
      sources: sources.length ? sources : [...DEFAULT_EVIDENCE_RULE.sources],
      min,
      max,
    };
  }

  private normalizeCategory(v: unknown): string {
    return (COMPLIANCE_CATEGORIES as readonly string[]).includes(String(v))
      ? String(v)
      : 'checklist';
  }

  private normalizePhase(v: unknown): string {
    return (COMPLIANCE_PHASES as readonly string[]).includes(String(v))
      ? String(v)
      : 'any';
  }

  async listTemplates(
    viewer: ComplianceViewer,
    includeInactive: boolean,
  ): Promise<{
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      fields: NormalizedComplianceField[];
      category: string;
      phase: string;
      instructions: string | null;
      evidence: NormalizedEvidenceRule;
      active: boolean;
      sortOrder: number;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const qb = this.templatesRepo
      .createQueryBuilder('t')
      .orderBy('t.sortOrder', 'ASC');
    if (viewer.role !== UserRole.ADMIN || !includeInactive) {
      qb.andWhere('t.active = :active', { active: true });
    }
    const rows = await qb.addOrderBy('t.name', 'ASC').getMany();
    return {
      items: rows.flatMap((r) => {
        try {
          const fields = this.normalizeFields(r.fields);
          return [
            {
              id: r.id,
              name: r.name,
              description: r.description,
              fields,
              category: this.normalizeCategory(r.category),
              phase: this.normalizePhase(r.phase),
              instructions: r.instructions ?? null,
              evidence: this.normalizeEvidence(r.evidence),
              active: r.active,
              sortOrder: r.sortOrder,
              createdAt: r.createdAt.toISOString(),
              updatedAt: r.updatedAt.toISOString(),
            },
          ];
        } catch {
          /* Skip corrupt rows so GET /compliance/templates never returns 400 */
          return [];
        }
      }),
    };
  }

  async createTemplate(
    dto: CreateComplianceTemplateDto,
  ): Promise<{ id: string }> {
    const fields = this.normalizeFields(dto.fields);
    const row = this.templatesRepo.create({
      name: dto.name.trim(),
      description: dto.description?.trim() ? dto.description.trim() : null,
      fields,
      category: this.normalizeCategory(dto.category),
      phase: this.normalizePhase(dto.phase),
      instructions: dto.instructions?.trim() ? dto.instructions.trim() : null,
      evidence: dto.evidence ? this.normalizeEvidence(dto.evidence) : null,
      active: dto.active !== false,
      sortOrder:
        dto.sortOrder !== undefined && Number.isFinite(dto.sortOrder)
          ? Math.trunc(dto.sortOrder)
          : 0,
    });
    const saved = await this.templatesRepo.save(row);
    return { id: saved.id };
  }

  async updateTemplate(
    id: string,
    dto: UpdateComplianceTemplateDto,
  ): Promise<void> {
    const row = await this.templatesRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Template not found');
    }
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.description !== undefined) {
      row.description =
        dto.description === null || dto.description.trim() === ''
          ? null
          : dto.description.trim();
    }
    if (dto.fields !== undefined) {
      row.fields = this.normalizeFields(dto.fields);
    }
    if (dto.category !== undefined)
      row.category = this.normalizeCategory(dto.category);
    if (dto.phase !== undefined) row.phase = this.normalizePhase(dto.phase);
    if (dto.instructions !== undefined) {
      row.instructions = dto.instructions?.trim()
        ? dto.instructions.trim()
        : null;
    }
    if (dto.evidence !== undefined) {
      row.evidence = dto.evidence ? this.normalizeEvidence(dto.evidence) : null;
    }
    if (dto.active !== undefined) row.active = dto.active;
    if (dto.sortOrder !== undefined && Number.isFinite(dto.sortOrder)) {
      row.sortOrder = Math.trunc(dto.sortOrder);
    }
    await this.templatesRepo.save(row);
  }

  async listSubmissionsForJob(
    jobId: string,
    viewer: ComplianceViewer,
  ): Promise<{
    items: Array<{
      id: string;
      templateId: string;
      templateName: string;
      answers: Record<string, unknown>;
      hasSignature: boolean;
      completedAt: string;
      completedByUserId: string | null;
      phase: string;
      category: string;
      evidence: Array<{
        id: string;
        name: string;
        contentType: string | null;
        downloadPath: string;
      }>;
    }>;
  }> {
    await this.assertJobAccess(jobId, viewer);
    const rows = await this.submissionsRepo.find({
      where: { jobId },
      relations: { template: true },
      order: { completedAt: 'DESC' },
    });
    const ids = rows.flatMap((r) => r.evidenceFileIds ?? []);
    const files = ids.length
      ? await this.filesRepo.find({ where: { id: In(ids) } })
      : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        templateId: r.templateId,
        templateName: r.template?.name ?? 'Form',
        answers: r.answers,
        hasSignature: Boolean(r.signaturePngBase64),
        completedAt: r.completedAt.toISOString(),
        completedByUserId: r.completedByUserId,
        phase: this.normalizePhase(r.template?.phase),
        category: this.normalizeCategory(r.template?.category),
        evidence: (r.evidenceFileIds ?? [])
          .map((id) => byId.get(id))
          .filter((f): f is FileEntity => Boolean(f))
          .map((f) => ({
            id: f.id,
            name: f.displayName?.trim() || f.originalName?.trim() || 'Evidence',
            contentType: f.contentType,
            downloadPath: `/jobs/${jobId}/files/${f.id}/download`,
          })),
      })),
    };
  }

  async submitForJob(
    jobId: string,
    dto: SubmitJobComplianceDto,
    viewer: ComplianceViewer,
  ): Promise<{ id: string }> {
    await this.assertJobAccess(jobId, viewer);
    const settings = await this.runtimeSettings.getSettings();
    const requireSig = settings.complianceRequireSignature;

    const template = await this.templatesRepo.findOne({
      where: { id: dto.templateId },
    });
    if (!template || !template.active) {
      throw new NotFoundException('Template not found');
    }
    const fields = this.normalizeFields(template.fields);
    const existing = await this.submissionsRepo.findOne({
      where: { jobId, templateId: dto.templateId },
    });
    if (existing) {
      throw new ConflictException(
        'This compliance form was already submitted for this job',
      );
    }

    const answers = this.validateAnswers(fields, dto.answers);

    let signature: string | null = null;
    if (requireSig) {
      if (!dto.signaturePngBase64?.trim()) {
        throw new BadRequestException('Signature is required for this form');
      }
      assertPngDataUrlSignature(dto.signaturePngBase64);
      signature = dto.signaturePngBase64.trim();
    } else if (dto.signaturePngBase64?.trim()) {
      assertPngDataUrlSignature(dto.signaturePngBase64);
      signature = dto.signaturePngBase64.trim();
    }

    const rule = this.normalizeEvidence(template.evidence);
    const evidenceIds = [...new Set(dto.evidenceFileIds ?? [])];
    if (evidenceIds.length < rule.min) {
      throw new BadRequestException(
        rule.min === 1
          ? 'Attach at least one piece of evidence (photo or document)'
          : `Attach at least ${rule.min} pieces of evidence`,
      );
    }
    if (evidenceIds.length > rule.max) {
      throw new BadRequestException(
        `At most ${rule.max} evidence files allowed`,
      );
    }
    if (evidenceIds.length > 0) {
      const files = await this.filesRepo.find({
        where: { id: In(evidenceIds), ownerType: 'job', ownerId: jobId },
      });
      if (files.length !== evidenceIds.length) {
        throw new BadRequestException(
          'Evidence files must be uploaded to this job first',
        );
      }
      const allowsImage =
        rule.sources.includes('camera') || rule.sources.includes('gallery');
      const allowsDocument = rule.sources.includes('document');
      for (const f of files) {
        const isImage = (f.contentType ?? '').startsWith('image/');
        if (isImage && !allowsImage) {
          throw new BadRequestException(
            `${f.displayName ?? 'A file'} is an image but this form only accepts documents`,
          );
        }
        if (!isImage && !allowsDocument) {
          throw new BadRequestException(
            `${f.displayName ?? 'A file'} is a document but this form only accepts photos`,
          );
        }
      }
    }

    const now = new Date();
    const saved = await this.submissionsRepo.save(
      this.submissionsRepo.create({
        jobId,
        templateId: template.id,
        answers,
        signaturePngBase64: signature,
        evidenceFileIds: evidenceIds.length ? evidenceIds : null,
        completedAt: now,
        completedByUserId: viewer.userId,
      }),
    );

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId,
        type: 'compliance_form_submitted',
        payload: {
          submissionId: saved.id,
          templateId: template.id,
          templateName: template.name,
          phase: this.normalizePhase(template.phase),
          completedAt: now.toISOString(),
          signed: Boolean(signature),
          evidenceCount: evidenceIds.length,
        },
        createdByUserId: viewer.userId,
      }),
    );

    return { id: saved.id };
  }

  private validateAnswers(
    fields: NormalizedComplianceField[],
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = raw[f.key];
      const emptyString = typeof v === 'string' && v.trim() === '';
      if (f.required && (v === undefined || v === null || emptyString)) {
        throw new BadRequestException(`Missing required field: ${f.label}`);
      }
      if (v === undefined || v === null || emptyString) {
        continue;
      }
      if (f.type === 'checkbox') {
        if (typeof v !== 'boolean') {
          throw new BadRequestException(`Invalid value for ${f.label}`);
        }
        out[f.key] = v;
        continue;
      }
      if (f.type === 'date') {
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          throw new BadRequestException(`Invalid date for ${f.label}`);
        }
        out[f.key] = v;
        continue;
      }
      if (typeof v !== 'string') {
        throw new BadRequestException(`Invalid value for ${f.label}`);
      }
      const t = v.trim().slice(0, 4000);
      out[f.key] = t;
    }
    for (const k of Object.keys(raw)) {
      if (!fields.some((f) => f.key === k)) {
        throw new BadRequestException(`Unknown field: ${k}`);
      }
    }
    return out;
  }

  private async assertJobAccess(
    jobId: string,
    viewer: ComplianceViewer,
  ): Promise<void> {
    const job = await this.jobsRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    if (viewer.role === UserRole.ADMIN) {
      return;
    }
    if (viewer.role === UserRole.MANAGER) {
      if (job.managerId !== viewer.userId) {
        throw new NotFoundException('Job not found');
      }
      return;
    }
    if (viewer.role === UserRole.INSTALLER) {
      if (job.assignedStaffUserId === viewer.userId) {
        return;
      }
      const cnt = await this.assignmentsRepo.count({
        where: { jobId: job.id, staffUserId: viewer.userId },
      });
      if (cnt > 0) {
        return;
      }
      throw new NotFoundException('Job not found');
    }
    throw new NotFoundException('Job not found');
  }
}
