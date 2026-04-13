import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { uploadFileFilter } from '../files/upload-file-filter';
import { UploadedBinaryFile } from '../files/uploaded-binary-file.type';
import { UserRole } from '../users/entities/user-role.enum';
import { AttendanceService } from './attendance.service';
import { AttendanceLocationDto } from './dto/attendance-location.dto';

type AuthenticatedRequest = Request & {
  user?: {
    sub?: string;
    role?: UserRole;
  };
};

const ATTENDANCE_PHOTO_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const ATTENDANCE_PHOTO_MAX_SIZE_BYTES = 5 * 1024 * 1024;

@ApiTags('Attendance')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs/:jobId/attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('clock-in')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Clock in to a job',
    description:
      'Installer-only. Requires a direct assignment on the target job. Rejects with **409** when the installer already has an open attendance record on any job.',
  })
  @ApiCreatedResponse({ description: 'Attendance clock-in saved.' })
  @ApiForbiddenResponse({
    description: 'Authenticated installer is not assigned to this job.',
  })
  @ApiConflictResponse({
    description: 'Installer already has an open attendance record elsewhere.',
  })
  clockIn(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: AttendanceLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;

    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }

    return this.attendanceService.clockIn(jobId, dto, { userId, role });
  }

  @Post('clock-out')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Clock out of a job',
    description:
      'Installer-only. Closes the installer’s open attendance record for the target job.',
  })
  @ApiOkResponse({ description: 'Attendance clock-out saved.' })
  @ApiNotFoundResponse({
    description:
      'No open attendance record exists for this installer on the job.',
  })
  clockOut(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: AttendanceLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;

    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }

    return this.attendanceService.clockOut(jobId, dto, { userId, role });
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List attendance records for a job',
    description:
      'Admin/manager only. Returns newest-first records with computed `durationMinutes` and open/completed status.',
  })
  @ApiOkResponse({ description: 'Attendance records for the job.' })
  @ApiNotFoundResponse({ description: 'Job not found or not visible.' })
  listForJob(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;

    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }

    return this.attendanceService.listForJob(jobId, { userId, role });
  }

  @Get('me')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get my attendance status for a job',
    description:
      'Installer-only. Requires a direct assignment on the target job and returns `clocked_in`, `clocked_out`, or `not_started`.',
  })
  @ApiOkResponse({ description: 'Current installer attendance state.' })
  @ApiForbiddenResponse({
    description: 'Authenticated installer is not assigned to this job.',
  })
  getMyStatus(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;

    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }

    return this.attendanceService.getMyStatus(jobId, { userId, role });
  }
}

@ApiTags('Attendance')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendancePhotoController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post(':attendanceId/photo')
  @Roles(UserRole.INSTALLER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: ATTENDANCE_PHOTO_MAX_SIZE_BYTES,
      },
      fileFilter: uploadFileFilter(ATTENDANCE_PHOTO_ALLOWED_MIME_TYPES),
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an attendance photo',
    description:
      'Installer-only. Uploads or replaces the optional photo attached to the installer’s own attendance record. Accepted types: JPEG, PNG, WEBP. Max size 5MB.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        photoUrl: {
          type: 'string',
          example: '/api/attendance/uuid/photo',
        },
      },
    },
  })
  @ApiForbiddenResponse({
    description:
      'Authenticated installer does not own the target attendance record.',
  })
  @ApiNotFoundResponse({ description: 'Attendance record not found.' })
  uploadPhoto(
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @UploadedFile() file: UploadedBinaryFile | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;

    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return this.attendanceService.uploadPhoto(attendanceId, file, {
      userId,
      role,
    });
  }

  @Get(':attendanceId/photo')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Download an attendance photo',
    description:
      'Streams the attendance photo through the API so access stays behind JWT + RBAC.',
  })
  @ApiOkResponse({ description: 'Binary image stream.' })
  @ApiNotFoundResponse({
    description:
      'Attendance record or attendance photo was not found, or the record is outside the authenticated user scope.',
  })
  @Header('Cache-Control', 'private, no-store')
  async downloadPhoto(
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const userId = req.user?.sub;
    const role = req.user?.role;

    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    const download = await this.attendanceService.getPhotoDownload(
      attendanceId,
      {
        userId,
        role,
      },
    );

    if (download.file.contentType) {
      res.setHeader('Content-Type', download.file.contentType);
    }
    if (download.contentLength !== undefined) {
      res.setHeader('Content-Length', String(download.contentLength));
    }

    return new StreamableFile(download.stream);
  }
}
