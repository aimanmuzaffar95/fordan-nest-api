import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  list(@Query() query: QueryInvoicesDto) {
    return this.invoices.list(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getOne(@Param('id') id: string) {
    return this.invoices.getOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto);
  }

  @Post(':id/send')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  send(@Param('id') id: string) {
    return this.invoices.send(id);
  }

  @Post(':id/payments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto) {
    return this.invoices.recordPayment(id, dto);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  cancel(@Param('id') id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoices.cancel(id, dto);
  }
}
