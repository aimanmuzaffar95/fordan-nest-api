import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { FindCustomersQueryDto } from './dto/find-customers-query.dto';
import { SearchCustomersQueryDto } from './dto/search-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';
import { JobsService } from '../jobs/jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateJobDto } from '../jobs/dto/create-job.dto';

@ApiTags('Customers')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly jobs: JobsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Create customer',
    description:
      '**Roles:** `admin`, `manager`, `installer`. Use this for field staff capturing a new lead. List/search/update and creating jobs under a customer still require **admin** or **manager**.',
  })
  @ApiCreatedResponse({
    description: 'Customer created (Nest default **201 Created**).',
  })
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List customers (paginated)',
    description: '**Roles:** `admin`, `manager` only.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — `installer` and other roles cannot browse the full customer list.',
  })
  findAll(@Query() query: FindCustomersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.customersService.findAll(page, limit);
  }

  @Get('search')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Search customers',
    description: '**Roles:** `admin`, `manager` only.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — `installer` cannot search the global customer directory.',
  })
  search(@Query() query: SearchCustomersQueryDto) {
    return this.customersService.search(query.q, query.page, query.limit);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Get customer by id',
    description: '**Roles:** `admin`, `manager` only.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — `installer` cannot fetch arbitrary customer records by id.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update customer',
    description: '**Roles:** `admin`, `manager` only.',
  })
  @ApiForbiddenResponse({
    description: '**403** — `installer` cannot update customer records.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, dto);
  }

  @Post(':customerId/jobs')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Create job for customer',
    description:
      '**Roles:** `admin`, `manager` only. Creates the job and seed meter rows (see contract).',
  })
  @ApiCreatedResponse({
    description:
      'Job created (**201**). Meter applications may be created with the job.',
  })
  @ApiForbiddenResponse({
    description: '**403** — `installer` cannot create jobs via this endpoint.',
  })
  createJob(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateJobDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.createJob(customerId, dto, role, userId);
  }
}
