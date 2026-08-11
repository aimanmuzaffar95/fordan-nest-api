import {
  Body,
  Controller,
  Delete,
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
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CustomerNotesService } from './customer-notes.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateCustomerNoteDto } from './dto/customer-note.dto';
import { FindCustomersQueryDto } from './dto/find-customers-query.dto';
import { SearchCustomersQueryDto } from './dto/search-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { GeocodeCustomerAddressQueryDto } from './dto/geocode-customer-address-query.dto';
import { CustomersService } from './customers.service';
import { JobsService } from '../jobs/jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateJobDto } from '../jobs/dto/create-job.dto';
import { PermissionsService } from '../permissions/permissions.service';
import type { PermissionKey } from '../permissions/permission-catalog';

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
    private readonly permissions: PermissionsService,
    private readonly notes: CustomerNotesService,
  ) {}

  private async authorizeCustomerAction(
    req: Request & { user?: { sub?: string; role?: UserRole } },
    permission: PermissionKey,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }

    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, permission);
    const customerScope: 'all' | 'own' =
      effective.scopes.customer === 'all' ? 'all' : 'own';
    const jobScope: 'all' | 'own' =
      effective.scopes.job === 'all' ? 'all' : 'own';
    const canViewPii = this.permissions.hasPermission(
      effective,
      'customer:pii:view',
    );

    return {
      userId,
      role,
      customerScope,
      jobScope,
      canViewPii,
    };
  }

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
  async create(
    @Body() dto: CreateCustomerDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    await this.authorizeCustomerAction(req, 'customer:create');
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
  async findAll(
    @Query() query: FindCustomersQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(req, 'customer:view');
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.customersService.findAll(page, limit, {
      userId: viewer.userId,
      role: viewer.role,
      customerScope: viewer.customerScope,
      canViewPii: viewer.canViewPii,
    });
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
  async search(
    @Query() query: SearchCustomersQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(req, 'customer:view');
    return this.customersService.search(query.q, query.page, query.limit, {
      userId: viewer.userId,
      role: viewer.role,
      customerScope: viewer.customerScope,
      canViewPii: viewer.canViewPii,
    });
  }

  @Get(':id/timeline')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Get customer activity timeline',
    description:
      '**Roles:** `admin`, `manager` only. Returns events sorted newest-first.',
  })
  async getTimeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(
      req,
      'customer:timeline:view',
    );
    return this.customersService.getTimeline(id, viewer);
  }

  @Get('geocode')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Geocode a customer address',
    description:
      '**Roles:** `admin`, `manager` only. Proxies address geocoding through the API for customer detail map previews.',
  })
  @ApiQuery({
    name: 'address',
    required: true,
    description: 'Street address to geocode (max 255 chars).',
  })
  async geocodeAddress(
    @Query() query: GeocodeCustomerAddressQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    await this.authorizeCustomerAction(req, 'customer:view');
    return this.customersService.geocodeAddress(query.address);
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
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(req, 'customer:view');
    return this.customersService.findOne(id, {
      userId: viewer.userId,
      role: viewer.role,
      customerScope: viewer.customerScope,
      canViewPii: viewer.canViewPii,
    });
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
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(req, 'customer:update');
    return this.customersService.update(id, dto, viewer);
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
  async createJob(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateJobDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(
      req,
      'customer:job:create',
    );
    const effective = await this.permissions.getEffectiveForUser(viewer.userId);
    this.permissions.assertPermission(effective, 'job:create');
    await this.customersService.findOne(customerId, viewer);
    return this.jobs.createJob(customerId, dto, viewer.role, viewer.userId);
  }

  // ─── Notes ────────────────────────────────────────────────────────────────

  @Get(':id/notes')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Notes on a customer',
    description:
      '**Roles:** `admin`, `manager` only — matches customer detail read access. Pinned notes sort first, then newest-first.',
  })
  async listNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(req, 'customer:view');
    return this.notes.listForCustomer(id, viewer);
  }

  @Post(':id/notes')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Add a note to a customer',
    description:
      '**Roles:** `admin`, `manager` only. Author is always the authenticated principal.',
  })
  @ApiCreatedResponse({ description: 'Note created.' })
  async createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerNoteDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(req, 'customer:update');
    return this.notes.create(id, dto, viewer);
  }

  @Delete('notes/:noteId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Delete a customer note',
    description: '**Roles:** `admin` only (enforced in service).',
  })
  @ApiForbiddenResponse({
    description: '**403** — only admins may delete customer notes.',
  })
  async removeNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeCustomerAction(req, 'customer:update');
    return this.notes.remove(noteId, viewer);
  }
}
