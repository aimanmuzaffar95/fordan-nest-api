import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoginDto } from '../auth/dto/login.dto';
import { GetScheduleQueryDto } from '../schedule/dto/get-schedule-query.dto';
import { FindJobsQueryDto } from '../jobs/dto/find-jobs-query.dto';
import { CreateJobTextEntryDto } from '../jobs/dto/create-job-text-entry.dto';
import { ClockInDto } from '../attendance/dto/clock-in.dto';
import { ClockOutDto } from '../attendance/dto/clock-out.dto';
import { ListMyAvailabilityQueryDto } from '../availability/dto/list-availability-query.dto';
import { PutAvailabilityDto } from '../availability/dto/put-availability.dto';
import { ListMyAttendanceSessionsQueryDto } from '../attendance/dto/list-attendance-sessions-query.dto';
import { StaffMobileFixturesService } from './staff-mobile-fixtures.service';

/**
 * Dev-only HTTP fixtures mirroring staff-mobile paths. Mount point:
 * `/api/dev/staff-mobile-fixtures/v1/*`
 *
 * No JWT — enable only with `STAFF_MOBILE_FIXTURES_ENABLED=true`.
 */
@ApiTags('Dev — staff mobile fixtures')
@Controller('dev/staff-mobile-fixtures/v1')
export class StaffMobileFixturesController {
  constructor(private readonly fixtures: StaffMobileFixturesService) {}

  @Get('_meta')
  @ApiOperation({ summary: 'Describe this fixture server (URLs, sample IDs)' })
  meta() {
    return this.fixtures.meta();
  }

  @Post('_reset')
  @ApiOperation({
    summary: 'Reset mutable fixture state (notes, attendance, availability)',
  })
  reset() {
    this.fixtures.reset();
    return { ok: true };
  }

  @Post('auth/login')
  @ApiOperation({ summary: 'Fixture login (accepts any valid body shape)' })
  login(@Body() dto: LoginDto) {
    void dto.username;
    return this.fixtures.login();
  }

  @Get('auth/me')
  @ApiOperation({ summary: 'Fixture installer profile' })
  me() {
    return this.fixtures.me();
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Fixture schedule' })
  schedule(@Query() query: GetScheduleQueryDto) {
    return this.fixtures.schedule(query);
  }

  @Get('jobs')
  @ApiOperation({
    summary: 'Fixture job list (page 1 = two jobs; page > 1 empty)',
  })
  jobs(@Query() query: FindJobsQueryDto) {
    return this.fixtures.jobs(query);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Fixture job detail' })
  jobDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.fixtures.jobDetail(id);
  }

  @Post('jobs/:id/notes')
  @ApiOperation({ summary: 'Append fixture note' })
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobTextEntryDto,
  ) {
    return this.fixtures.addNote(id, dto);
  }

  @Post('jobs/:id/internal-comments')
  @ApiOperation({ summary: 'Append fixture internal comment' })
  addInternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobTextEntryDto,
  ) {
    return this.fixtures.addInternal(id, dto);
  }

  @Get('attendance/me/session')
  @ApiOperation({ summary: 'Fixture open attendance session' })
  attendanceSession() {
    return this.fixtures.getOpenSession();
  }

  @Get('attendance/me/sessions')
  @ApiOperation({ summary: 'Fixture attendance history (inclusive from/to)' })
  attendanceSessions(@Query() query: ListMyAttendanceSessionsQueryDto) {
    return this.fixtures.listMySessions(query);
  }

  @Post('attendance/clock-in')
  @ApiOperation({ summary: 'Fixture clock in' })
  clockIn(@Body() dto: ClockInDto) {
    return this.fixtures.clockIn(dto);
  }

  @Post('attendance/clock-out')
  @ApiOperation({ summary: 'Fixture clock out' })
  clockOut(@Body() dto: ClockOutDto) {
    return this.fixtures.clockOut(dto);
  }

  @Get('availability/me')
  @ApiOperation({ summary: 'Fixture availability list' })
  availabilityMine(@Query() query: ListMyAvailabilityQueryDto) {
    return this.fixtures.listMyAvailability(query);
  }

  @Put('availability/me')
  @ApiOperation({
    summary: 'Fixture availability replace (same rules as production)',
  })
  availabilityPut(@Body() dto: PutAvailabilityDto) {
    return this.fixtures.putMyAvailability(dto);
  }
}
