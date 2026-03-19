import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { FindCustomersQueryDto } from './dto/find-customers-query.dto';
import { SearchCustomersQueryDto } from './dto/search-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UserRole } from '../users/entities/user-role.enum';
import { CustomersService } from './customers.service';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindCustomersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.customersService.findAll(page, limit);
  }

  @Get('search')
  search(@Query() query: SearchCustomersQueryDto) {
    return this.customersService.search(query.q, query.page, query.limit);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, dto);
  }
}
