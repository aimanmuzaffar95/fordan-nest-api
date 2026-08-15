import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { SolarPanelStockStatus } from '../solar-panels/entities/solar-panel-stock-status.enum';
import { RoofDesign } from './entities/roof-design.entity';
import { RoofDesignDocDto } from './dto/roof-design.dto';
import {
  findSelfIntersection,
  InsetPolygonError,
  insetPolygon,
  isValidPolygon,
  panelRectangle,
  polygonFullyInsideAny,
  polygonsOverlap,
} from './roof-geometry.util';
import type {
  LocalPoint,
  RoofDesignDoc,
  RoofDesignRecord,
} from './types/roof-design-doc.type';

const MAX_ARRAYS = 4;
/** Fallback panel physical size (mm) — spec §2, used when the catalog row has no widthMm/heightMm. */
const FALLBACK_PANEL_WIDTH_MM = 1134;
const FALLBACK_PANEL_HEIGHT_MM = 1762;

@Injectable()
export class RoofDesignService {
  constructor(
    @InjectRepository(RoofDesign)
    private readonly roofDesignRepo: Repository<RoofDesign>,
    @InjectRepository(SolarPanel)
    private readonly solarPanelRepo: Repository<SolarPanel>,
  ) {}

  async getForJob(jobId: string): Promise<RoofDesignRecord | null> {
    const record = await this.roofDesignRepo.findOne({ where: { jobId } });
    if (!record) return null;
    return this.toRecord(record);
  }

  async upsert(
    jobId: string,
    dto: RoofDesignDocDto,
    updatedByUserId: string,
  ): Promise<RoofDesignRecord> {
    await this.validateDoc(dto);

    const existing = await this.roofDesignRepo.findOne({ where: { jobId } });
    const doc = dto as unknown as RoofDesignDoc;

    if (existing) {
      existing.doc = doc;
      existing.updatedByUserId = updatedByUserId;
      const saved = await this.roofDesignRepo.save(existing);
      return this.toRecord(saved);
    }

    const created = this.roofDesignRepo.create({
      jobId,
      doc,
      updatedByUserId,
      renderFileId: null,
    });
    const saved = await this.roofDesignRepo.save(created);
    return this.toRecord(saved);
  }

  async setRenderFile(jobId: string, fileId: string): Promise<void> {
    const record = await this.roofDesignRepo.findOne({ where: { jobId } });
    if (!record) {
      throw new NotFoundException(
        'No roof design exists for this job yet — save a design before rendering',
      );
    }
    record.renderFileId = fileId;
    await this.roofDesignRepo.save(record);
  }

  /**
   * Panel physical size in metres, honouring `widthMm`/`heightMm` when set,
   * falling back to the spec default (§2) otherwise. Exported for reuse by
   * the render/simulation paths.
   */
  panelSizeMetres(panel: Pick<SolarPanel, 'widthMm' | 'heightMm'> | null): {
    widthM: number;
    heightM: number;
  } {
    const widthMm = panel?.widthMm ?? FALLBACK_PANEL_WIDTH_MM;
    const heightMm = panel?.heightMm ?? FALLBACK_PANEL_HEIGHT_MM;
    return { widthM: widthMm / 1000, heightM: heightMm / 1000 };
  }

  /**
   * Resolves true panel physical size (metres) for every distinct
   * `panelModelId` referenced by `doc.arrays`, falling back to the spec §2
   * default when a model has no `widthMm`/`heightMm`. Shared by the render
   * composite (item 1) and the proposal PDF's server-side fallback, so both
   * draw panels at the same size this service validates against — a single
   * DB round trip per document rather than each caller re-querying
   * `SolarPanel`.
   */
  async resolvePanelSizesForDoc(
    doc: Pick<RoofDesignDoc, 'arrays'>,
  ): Promise<Map<string, { widthM: number; heightM: number }>> {
    const panelModelIds = Array.from(
      new Set(doc.arrays.map((a) => a.panelModelId)),
    );
    const panels =
      panelModelIds.length > 0
        ? await this.solarPanelRepo.find({ where: { id: In(panelModelIds) } })
        : [];
    const panelsById = new Map(panels.map((p) => [p.id, p]));
    const result = new Map<string, { widthM: number; heightM: number }>();
    for (const modelId of panelModelIds) {
      result.set(
        modelId,
        this.panelSizeMetres(panelsById.get(modelId) ?? null),
      );
    }
    return result;
  }

  /**
   * Service-level validation beyond `class-validator`'s structural checks —
   * §3 of the spec. Called on every `PUT`.
   */
  async validateDoc(dto: RoofDesignDocDto): Promise<void> {
    if (dto.arrays.length > MAX_ARRAYS) {
      this.fail('A design may contain at most 4 arrays.');
    }

    for (const obstruction of dto.obstructions) {
      if (!isValidPolygon(obstruction.polygon)) {
        const crossing = findSelfIntersection(
          obstruction.polygon as LocalPoint[],
        );
        this.fail(
          `Obstruction "${obstruction.id}" polygon must be a simple, non-self-intersecting shape with at least 3 points.` +
            this.describeCrossing(crossing),
        );
      }
    }

    const panelModelIds = Array.from(
      new Set(dto.arrays.map((a) => a.panelModelId)),
    );
    const panels =
      panelModelIds.length > 0
        ? await this.solarPanelRepo.find({ where: { id: In(panelModelIds) } })
        : [];
    const panelsById = new Map(panels.map((p) => [p.id, p]));

    for (const arr of dto.arrays) {
      const arrCrossing = findSelfIntersection(arr.polygon as LocalPoint[]);
      if (!isValidPolygon(arr.polygon)) {
        this.fail(
          `Array "${arr.name}" polygon must be a simple, non-self-intersecting shape with at least 3 points.` +
            this.describeCrossing(arrCrossing),
        );
      }
      if (arrCrossing) {
        this.fail(
          `Array "${arr.name}" polygon self-intersects.` +
            this.describeCrossing(arrCrossing),
        );
      }

      const panel = panelsById.get(arr.panelModelId);
      if (!panel) {
        this.fail(
          `Array "${arr.name}" references panelModelId "${arr.panelModelId}", which does not resolve to a known panel.`,
        );
      }
      if (panel && panel.stockStatus === SolarPanelStockStatus.DISCONTINUED) {
        this.fail(`Array "${arr.name}" references a discontinued panel model.`);
      }

      let buildableAreas: LocalPoint[][];
      try {
        buildableAreas = insetPolygon(
          arr.polygon as LocalPoint[],
          arr.setbackM,
        );
      } catch (err) {
        if (err instanceof InsetPolygonError) {
          this.fail(
            `Array "${arr.name}" cannot honour a ${arr.setbackM}m setback on this roof plane — ${err.message}`,
          );
        }
        throw err;
      }
      const { widthM, heightM } = this.panelSizeMetres(panel ?? null);
      const rectangles = arr.panels.map((placement) => ({
        placement,
        rect: panelRectangle(
          placement.cx,
          placement.cy,
          widthM,
          heightM,
          placement.rotationDegrees,
        ),
      }));

      for (const { placement, rect } of rectangles) {
        if (!placement.enabled) continue;
        if (!polygonFullyInsideAny(rect, buildableAreas)) {
          this.fail(
            `Panel "${placement.id}" in array "${arr.name}" is not fully inside the roof plane after the ${arr.setbackM}m setback.`,
          );
        }
      }

      for (let i = 0; i < rectangles.length; i++) {
        if (!rectangles[i].placement.enabled) continue;
        for (let j = i + 1; j < rectangles.length; j++) {
          if (!rectangles[j].placement.enabled) continue;
          if (polygonsOverlap(rectangles[i].rect, rectangles[j].rect)) {
            this.fail(
              `Panels "${rectangles[i].placement.id}" and "${rectangles[j].placement.id}" in array "${arr.name}" overlap.`,
            );
          }
        }
        for (const obstruction of dto.obstructions) {
          if (
            polygonsOverlap(
              rectangles[i].rect,
              obstruction.polygon as LocalPoint[],
            )
          ) {
            this.fail(
              `Panel "${rectangles[i].placement.id}" in array "${arr.name}" overlaps obstruction "${obstruction.id}".`,
            );
          }
        }
      }
    }
  }

  /** Renders a crossing-edge description ("edge N x edge M ...") for actionable self-intersection errors on large polygons. */
  private describeCrossing(
    crossing: ReturnType<typeof findSelfIntersection>,
  ): string {
    if (!crossing) return '';
    const fmt = (p: LocalPoint) => `(${p.x}, ${p.y})`;
    return (
      ` Edge ${crossing.edgeAIndex} [${fmt(crossing.edgeA[0])} -> ${fmt(crossing.edgeA[1])}]` +
      ` crosses edge ${crossing.edgeBIndex} [${fmt(crossing.edgeB[0])} -> ${fmt(crossing.edgeB[1])}].`
    );
  }

  private fail(message: string): never {
    throw new UnprocessableEntityException({
      message,
      code: 'VALIDATION_ERROR',
    });
  }

  private toRecord(entity: RoofDesign): RoofDesignRecord {
    return {
      jobId: entity.jobId,
      doc: entity.doc,
      updatedAt: entity.updatedAt.toISOString(),
      updatedByUserId: entity.updatedByUserId,
      renderFileId: entity.renderFileId,
    };
  }
}
