import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CompletePublicSignatureDto } from './dto/complete-public-signature.dto';
import { JobSignatureService } from './job-signature.service';
import { DeclineProposalDto } from '../proposals/dto/proposal.dto';

@ApiTags('Public e-sign')
@Controller('public/sign')
@UseGuards(ThrottlerGuard)
// This is the internet-facing, unauthenticated part of the e-sign/proposal
// surface — it must not share the public-lead bucket (12 req/60s), which a
// single normal customer page load (session + view + PDF) already spends a
// quarter of before signing/accepting/declining anything.
@SkipThrottle({ default: true })
@Throttle({ 'public-sign': {} })
export class PublicSignatureController {
  constructor(private readonly signatures: JobSignatureService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Public signing session metadata',
    description:
      'No JWT. Returns minimal job context for the signing page. **404** when the token is unknown or no longer valid.',
  })
  getSession(@Param('token') token: string) {
    return this.signatures.getPublicSession(token);
  }

  @Get(':token/quotation.pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Stream quotation PDF (public token)',
    description:
      'Same quotation PDF used for signing. **Inline** display in the browser. **404** when the link is invalid, expired, or cancelled.',
  })
  async quotationPdf(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.signatures.getPublicQuotationPdf(token);
    const safeName =
      filename.replace(/[\r\n"]/g, '_').trim() || 'quotation.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    return new StreamableFile(buffer);
  }

  @Get(':token/signed.pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Stream signed quotation PDF (public token)',
    description:
      'Available after **`/complete`**. **404** until signed or if the link is invalid.',
  })
  async signedPdf(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentLength, contentType, filename } =
      await this.signatures.getPublicSignedPdfStream(token);
    const safeName = filename.replace(/[\r\n"]/g, '_').trim() || 'signed.pdf';
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    } else {
      res.setHeader('Content-Type', 'application/pdf');
    }
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', String(contentLength));
    }
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    return new StreamableFile(stream);
  }

  @Get(':token/proposal.pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Stream the sent proposal PDF (public token)',
    description:
      'Streams the **exact** PDF stored when the proposal was sent — never a live regeneration — so the customer always sees precisely what they were emailed, even if the design or pricing changed afterwards. **404** for quotation-source tokens, unknown/expired tokens, or before the PDF is available.',
  })
  async proposalPdf(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentLength, contentType, filename } =
      await this.signatures.getPublicProposalPdf(token);
    const safeName = filename.replace(/[\r\n"]/g, '_').trim() || 'proposal.pdf';
    res.setHeader('Content-Type', contentType || 'application/pdf');
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', String(contentLength));
    }
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    return new StreamableFile(stream);
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline a proposal (public token)',
    description:
      'Customer-facing decline for a proposal signing link — captures an optional reason, cancels the signing link, and moves the `ProposalVersion` to `declined`. **404** for quotation-source tokens or unknown/expired links. **400** if the proposal was already accepted.',
  })
  declineProposal(
    @Param('token') token: string,
    @Body() dto: DeclineProposalDto,
  ) {
    return this.signatures.declinePublicProposal(token, dto.reason ?? null);
  }

  @Post(':token/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark signing link as viewed',
    description:
      'Idempotent when already viewed. **404** for invalid/expired tokens.',
  })
  recordView(@Param('token') token: string) {
    return this.signatures.recordPublicView(token);
  }

  @Post(':token/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete signing (PNG signature + consent)',
    description:
      'Merges signature into the quotation PDF, stores a job file, sets `contractSigned`, and appends timeline events.',
  })
  complete(
    @Param('token') token: string,
    @Body() dto: CompletePublicSignatureDto,
    @Req() req: Request,
  ) {
    return this.signatures.completePublicSign(token, dto, req);
  }
}
