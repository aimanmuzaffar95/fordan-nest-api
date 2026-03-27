import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Note } from '../notes/entities/note.entity';
import { UserRole } from '../users/entities/user-role.enum';

const META_PREFIX = '__FORDAN_LEAD_META__';

export type PublicLeadMetaV1 = {
  v: 1;
  formSlug: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  pageReferrer?: string;
  selfReportedSource?: string;
};

type InsightsViewer = {
  userId: string;
  role: UserRole;
};

function parseMetaLine(body: string): PublicLeadMetaV1 | null {
  const line = body.split('\n')[0]?.trim() ?? '';
  if (!line.startsWith(META_PREFIX)) return null;
  try {
    const raw = line.slice(META_PREFIX.length);
    const j = JSON.parse(raw) as PublicLeadMetaV1;
    if (j && j.v === 1 && typeof j.formSlug === 'string') return j;
  } catch {
    /* ignore */
  }
  return null;
}

/** Older public-lead notes without `__FORDAN_LEAD_META__` first line. */
function parseLegacyPublicLeadBody(body: string): PublicLeadMetaV1 | null {
  if (!body.includes('Lead source: public web form')) return null;
  const trimmed = body.trimStart();
  if (trimmed.startsWith(META_PREFIX)) return null;

  const formMatch =
    body.match(/\bForm:\s*([^|]+?)(?=\s*\|)/)?.[1]?.trim() ??
    body.match(/\bForm:\s*(\S+)/)?.[1]?.trim();
  const formSlug = formMatch || 'unknown';

  const utmSource =
    body.match(/utm_source:\s*([^|]+)/)?.[1]?.trim() ||
    body.match(/utm_source:\s*(\S+)/)?.[1]?.trim();
  const utmMedium = body.match(/utm_medium:\s*([^|]+)/)?.[1]?.trim();
  const utmCampaign = body.match(/utm_campaign:\s*([^|]+)/)?.[1]?.trim();
  const selfReportedSource = body
    .match(/Heard about us:\s*([^|]+)/)?.[1]
    ?.trim();

  return {
    v: 1,
    formSlug,
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
    ...(selfReportedSource ? { selfReportedSource } : {}),
  };
}

@Injectable()
export class LeadCaptureInsightsService {
  constructor(
    @InjectRepository(Note)
    private readonly notesRepo: Repository<Note>,
  ) {}

  async getInsights(viewer?: InsightsViewer) {
    const prefixLen = META_PREFIX.length;

    // Avoid SQL LIKE on raw prefix: `_` is a single-char wildcard in LIKE.
    const qb = this.notesRepo.createQueryBuilder('n').where(
      new Brackets((qb) => {
        qb.where('SUBSTRING(n.body, 1, :prefixLen) = :prefix', {
          prefixLen,
          prefix: META_PREFIX,
        }).orWhere('n.body LIKE :legacy', {
          legacy: '%Lead source: public web form%',
        });
      }),
    );

    if (viewer?.role === UserRole.MANAGER) {
      qb.innerJoin('n.job', 'job_scope').andWhere(
        'job_scope.managerId = :managerUserId',
        { managerUserId: viewer.userId },
      );
    }

    const notes = await qb.orderBy('n.createdAt', 'DESC').take(800).getMany();

    const byFormSlug: Record<string, number> = {};
    const byUtmSource: Record<string, number> = {};
    const byUtmCampaign: Record<string, number> = {};
    const bySelfReported: Record<string, number> = {};
    const recent: Array<{
      jobId: string;
      createdAt: string;
      meta: PublicLeadMetaV1;
    }> = [];

    for (const n of notes) {
      const meta = parseMetaLine(n.body) ?? parseLegacyPublicLeadBody(n.body);
      if (!meta) continue;

      byFormSlug[meta.formSlug] = (byFormSlug[meta.formSlug] ?? 0) + 1;
      if (meta.utmSource) {
        byUtmSource[meta.utmSource] = (byUtmSource[meta.utmSource] ?? 0) + 1;
      }
      if (meta.utmCampaign) {
        byUtmCampaign[meta.utmCampaign] =
          (byUtmCampaign[meta.utmCampaign] ?? 0) + 1;
      }
      if (meta.selfReportedSource) {
        bySelfReported[meta.selfReportedSource] =
          (bySelfReported[meta.selfReportedSource] ?? 0) + 1;
      }
      if (recent.length < 25) {
        recent.push({
          jobId: n.jobId,
          createdAt:
            n.createdAt instanceof Date
              ? n.createdAt.toISOString()
              : String(n.createdAt),
          meta,
        });
      }
    }

    const total = Object.values(byFormSlug).reduce((a, b) => a + b, 0);

    return {
      totalSubmissions: total,
      byFormSlug,
      byUtmSource,
      byUtmCampaign,
      bySelfReported,
      recent,
      metaFormat: `${META_PREFIX}{"v":1,"formSlug":"…",…}` as const,
    };
  }
}
