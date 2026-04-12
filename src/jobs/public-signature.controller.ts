import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CompletePublicSignatureDto } from './dto/complete-public-signature.dto';
import { JobSignatureService } from './job-signature.service';

@ApiTags('Public e-sign')
@Controller('public/sign')
@UseGuards(ThrottlerGuard)
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
