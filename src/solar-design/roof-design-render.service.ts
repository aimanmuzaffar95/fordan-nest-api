import { BadRequestException, Injectable } from '@nestjs/common';
import { FilesService } from '../files/files.service';
import { RoofDesignService } from './roof-design.service';
import { RoofDesignRenderCompositeService } from './roof-design-render-composite.service';

const MAX_RENDER_BYTES = 8 * 1024 * 1024;
const DATA_URL_PREFIX = /^data:image\/png;base64,/;
/** PNG signature (first 8 bytes of every valid PNG file, per the spec). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_COMPOSITE_WIDTH_PX = 1200;
const DEFAULT_COMPOSITE_HEIGHT_PX = 800;

export type StoreRenderInput = {
  /** Browser-captured PNG (fast path). */
  pngBase64?: string;
  /** Requested composite dimensions when falling back to server-side stitching. */
  widthPx?: number;
  heightPx?: number;
};

@Injectable()
export class RoofDesignRenderService {
  constructor(
    private readonly files: FilesService,
    private readonly roofDesigns: RoofDesignService,
    private readonly composite: RoofDesignRenderCompositeService,
  ) {}

  private decodeBase64Png(pngBase64: string): Buffer {
    const raw = pngBase64.replace(DATA_URL_PREFIX, '').trim();
    if (!raw) {
      throw new BadRequestException('pngBase64 is required');
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('pngBase64 is not valid base64');
    }
    if (buffer.length === 0) {
      throw new BadRequestException('pngBase64 decoded to an empty file');
    }
    if (buffer.length > MAX_RENDER_BYTES) {
      throw new BadRequestException(
        `Render exceeds the ${MAX_RENDER_BYTES / (1024 * 1024)}MB limit`,
      );
    }
    // Never trust the declared content type / data-URL prefix alone — verify
    // the actual bytes are a PNG before persisting it as `image/png`.
    if (
      buffer.length < PNG_MAGIC.length ||
      !buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
    ) {
      throw new BadRequestException('pngBase64 is not a valid PNG file');
    }
    return buffer;
  }

  /**
   * Stores the render for the proposal PDF and links it onto the saved
   * design. `pngBase64` (browser capture) is the fast path; when absent —
   * because the client reported `not-ready`/`cors-blocked` — falls back to
   * the server-side tile composite (§6), which always succeeds as long as
   * imagery is reachable.
   */
  async storeRender(
    jobId: string,
    input: StoreRenderInput,
    uploadedByUserId: string,
  ): Promise<{ fileId: string }> {
    let buffer: Buffer;

    if (input.pngBase64) {
      buffer = this.decodeBase64Png(input.pngBase64);
    } else {
      const design = await this.roofDesigns.getForJob(jobId);
      if (!design) {
        throw new BadRequestException(
          'Cannot composite a render before the roof design has been saved',
        );
      }
      const panelSizeByModelId = await this.roofDesigns.resolvePanelSizesForDoc(
        design.doc,
      );
      buffer = await this.composite.composite(
        design.doc,
        design.doc.imagery.zoom,
        input.widthPx ?? DEFAULT_COMPOSITE_WIDTH_PX,
        input.heightPx ?? DEFAULT_COMPOSITE_HEIGHT_PX,
        panelSizeByModelId,
      );
    }

    const savedFile = await this.files.persistJobGeneratedPdf({
      jobId,
      buffer,
      displayName: 'Roof design render',
      kind: 'roof_design_render',
      contentType: 'image/png',
      uploadedByUserId,
      timelineActorUserId: uploadedByUserId,
    });

    await this.roofDesigns.setRenderFile(jobId, savedFile.id);

    return { fileId: savedFile.id };
  }
}
