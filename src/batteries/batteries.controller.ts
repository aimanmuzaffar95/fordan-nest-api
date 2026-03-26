import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { BatteriesService } from './batteries.service';
import { CreateBatteryDto } from './dto/create-battery.dto';
import { BatteryResponseDto } from './dto/battery-response.dto';

@ApiTags('Equipment')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('equipment/batteries')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BatteriesController {
  constructor(private readonly batteries: BatteriesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List battery catalog items',
    description:
      'Returns the persisted battery catalog used by the Equipment screens. **Admin** and **manager** can read; **installer** is excluded.',
  })
  @ApiOkResponse({
    description: 'Returns `{ items }` in the standard `data` envelope.',
  })
  @ApiForbiddenResponse({
    description: '**403** — installers cannot read the equipment catalog.',
  })
  list(): Promise<{ items: BatteryResponseDto[] }> {
    return this.batteries.list();
  }

  @Post()
  @AdminOnly()
  @ApiOperation({
    summary: 'Create battery catalog item',
    description:
      'Creates a persisted battery catalog row. **Admin only.** Duplicate `brand + model` pairs are rejected.',
  })
  @ApiCreatedResponse({
    description: 'Battery created (**201**).',
  })
  @ApiConflictResponse({
    description:
      '**409** — a battery with the same `brand + model` already exists.',
  })
  @ApiForbiddenResponse({
    description: '**403** — only **admin** may create battery catalog items.',
  })
  create(@Body() dto: CreateBatteryDto): Promise<BatteryResponseDto> {
    return this.batteries.create(dto);
  }
}
