import {
  Body,
  StreamableFile,
  Res,
  Header,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Request, Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CustomerPortalService } from './customer-portal.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

export class PortalTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class PortalMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class IssuePortalTokenDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  ttlDays?: number;
}

/** Staff-side portal link management. */
@ApiTags('Customer portal')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class CustomerPortalAdminController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Post(':jobId/portal-link')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('job:update')
  @ApiOperation({
    summary: 'Issue a customer portal link for a job',
    description:
      'Returns the plaintext token exactly once — only its hash is stored, so it can never be retrieved again. Scoped to this one job.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  issue(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: IssuePortalTokenDto,
    @Req() req: AuthRequest,
  ) {
    return this.portal.issueToken(jobId, viewerOf(req), dto.ttlDays);
  }

  @Post(':jobId/portal-link/revoke')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('job:update')
  @ApiOperation({ summary: 'Revoke every live portal link for a job' })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  revoke(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: AuthRequest,
  ) {
    return this.portal.revokeAllForJob(jobId, viewerOf(req));
  }
}

/**
 * The public, unauthenticated portal surface.
 *
 * Throttled, and every failure returns the same 404 so the endpoint cannot be
 * used to enumerate valid tokens.
 */
@ApiTags('Customer portal (public)')
@Controller('public/portal')
// There is no global APP_GUARD, so `@Throttle` alone is inert — every public
// controller has to mount the guard itself (see public-leads, public-signature).
@UseGuards(ThrottlerGuard)
export class CustomerPortalPublicController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Get('status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Customer-facing job status for a portal token',
    description:
      'No authentication. Returns a deliberately coarse, plain-language view — no pricing, staff names, or internal stage names.',
  })
  status(@Query('token') token: string) {
    return this.portal.statusForToken(token ?? '');
  }

  @Get('design')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Roof design summary for the dashboard (null when none drawn)',
  })
  design(@Query('token') token: string) {
    return this.portal.designForToken(token ?? '');
  }

  @Get('design/render.png')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Roof render with the planned panels' })
  async render(@Query('token') token: string, @Res() res: Response) {
    const png = await this.portal.renderForToken(token ?? '');
    if (!png) {
      res
        .status(404)
        .json({ success: false, statusCode: 404, message: 'Not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    // The portal page on the web origin embeds this as <img>; helmet's
    // default CORP (same-origin) makes the browser drop it (same fix as the
    // public branding assets, BUG-9).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(png);
  }

  @Get('documents')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Proposal / quote availability, invoices and shared files for this job',
  })
  documents(@Query('token') token: string) {
    return this.portal.documentsForToken(token ?? '');
  }

  @Get('documents/proposal.pdf')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Latest sent proposal PDF' })
  async proposalPdf(@Query('token') token: string, @Res() res: Response) {
    const { pdfBuffer, attachmentFilename } =
      await this.portal.proposalPdfForToken(token ?? '');
    this.sendPdf(res, pdfBuffer, attachmentFilename);
  }

  @Get('documents/quote.pdf')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Quotation PDF' })
  async quotePdf(@Query('token') token: string, @Res() res: Response) {
    const { pdfBuffer, attachmentFilename } =
      await this.portal.quotePdfForToken(token ?? '');
    this.sendPdf(res, pdfBuffer, attachmentFilename);
  }

  private sendPdf(res: Response, pdfBuffer: Buffer, filename: string) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename.replace(/[\r\n"]/g, '_')}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdfBuffer);
  }

  @Get('documents/files/:fileId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Download a file staff shared with the customer' })
  @Header('Cache-Control', 'private, no-store')
  async file(
    @Query('token') token: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const download = await this.portal.fileForToken(token ?? '', fileId);
    const name = (
      download.file.displayName ??
      download.file.originalName ??
      'download'
    ).replace(/[\r\n"]/g, '_');
    res.setHeader(
      'Content-Type',
      download.file.contentType ?? 'application/octet-stream',
    );
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    if (download.contentLength) {
      res.setHeader('Content-Length', String(download.contentLength));
    }
    return new StreamableFile(download.stream);
  }

  @Get('tickets')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Tickets the customer raised (or staff replied to) for this job',
    description:
      'No authentication. Replies only — internal notes and staff identities are never exposed.',
  })
  tickets(@Query('token') token: string) {
    return this.portal.ticketsForToken(token ?? '');
  }

  @Post('tickets')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Customer raises a ticket for this job' })
  createTicket(@Query('token') token: string, @Body() dto: PortalTicketDto) {
    return this.portal.createTicketForToken(token ?? '', dto.subject, dto.body);
  }

  @Post('tickets/:ticketId/messages')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Customer replies on a ticket (reopens it if it was solved)',
  })
  reply(
    @Query('token') token: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: PortalMessageDto,
  ) {
    return this.portal.replyForToken(token ?? '', ticketId, dto.body);
  }
}
