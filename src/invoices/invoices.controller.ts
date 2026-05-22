import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PermissionKey } from '../permissions/permission-catalog';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { AddInvoiceNoteDto } from './dto/add-invoice-note.dto';

@ApiTags('Invoices')
@ApiBearerAuth('JWT')
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async list(
    @Query() query: QueryInvoicesDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(req, 'invoice:view');
    return this.invoices.list(query, viewer);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getOne(
    @Param('id') id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(req, 'invoice:view');
    return this.invoices.getOne(id, viewer);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async create(
    @Body() dto: CreateInvoiceDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(req, 'invoice:create');
    return this.invoices.create(dto, viewer);
  }

  @Post(':id/send')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async send(
    @Param('id') id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(req, 'invoice:send');
    return this.invoices.send(id, viewer);
  }

  @Post(':id/payments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(
      req,
      'invoice:record_payment',
    );
    return this.invoices.recordPayment(id, dto, viewer);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(req, 'invoice:cancel');
    return this.invoices.cancel(id, dto, viewer);
  }

  @Post(':id/notes')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async addNote(
    @Param('id') id: string,
    @Body() dto: AddInvoiceNoteDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(req, 'invoice:notes');
    return this.invoices.addNote(id, dto, viewer);
  }

  @Post(':id/remind-overdue')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async remindOverdue(
    @Param('id') id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeInvoiceAction(
      req,
      'invoice:remind_overdue',
    );
    await this.invoices.sendOverdueReminder(id, viewer);
    return { ok: true };
  }

  private async authorizeInvoiceAction(
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
    return {
      userId,
      role,
      invoiceScope:
        effective.scopes.invoice === 'all'
          ? ('all' as const)
          : ('managed' as const),
    };
  }
}
