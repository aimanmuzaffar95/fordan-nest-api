import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { DocumentTaxonomyService } from './document-taxonomy.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

export class ClassifyFileDto {
  /** Pass null to clear the category. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null ? null : typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  tags?: string[];
}

@ApiTags('Documents')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentTaxonomyController {
  constructor(private readonly taxonomy: DocumentTaxonomyService) {}

  @Get('document-taxonomy')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get document categories and suggested tags',
    description:
      'Edit in Settings (`PATCH /settings` with `documentTaxonomy`).',
  })
  config(@Req() req: AuthRequest) {
    return this.taxonomy.getConfig(viewerOf(req).role);
  }

  @Patch('files/:id/classify')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Assign a category and tags to a file',
    description:
      'For a versioned category the file becomes the current version and the previous current file is superseded (kept, not deleted).',
  })
  @ApiParam({ name: 'id', description: 'File UUID' })
  classify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClassifyFileDto,
    @Req() req: AuthRequest,
  ) {
    return this.taxonomy.classify(
      id,
      {
        categoryId: dto.categoryId === undefined ? null : dto.categoryId,
        tags: dto.tags,
      },
      viewerOf(req).role,
    );
  }

  @Get('jobs/:jobId/document-compliance')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Required documents still missing for a job’s stage',
    description:
      'Requirements apply cumulatively — a job that jumped ahead still reports the earlier paperwork as missing.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  compliance(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: AuthRequest,
  ) {
    return this.taxonomy.complianceForJob(jobId, viewerOf(req));
  }
}
