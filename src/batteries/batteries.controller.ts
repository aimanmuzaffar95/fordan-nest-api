import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { UserRole } from '../users/entities/user-role.enum';
import { BatteriesService } from './batteries.service';
import { CreateBatteryDto } from './dto/create-battery.dto';
import { BatteryResponseDto } from './dto/battery-response.dto';
import { UpdateBatteryDto } from './dto/update-battery.dto';

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
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Create battery catalog item',
    description:
      'Creates a persisted battery catalog row. **Admin** and **manager** can create; duplicate `brand + model` pairs are rejected.',
  })
  @ApiCreatedResponse({
    description: 'Battery created (**201**).',
  })
  @ApiConflictResponse({
    description:
      '**409** — a battery with the same `brand + model` already exists.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — only **admin** or **manager** may create battery catalog items.',
  })
  create(@Body() dto: CreateBatteryDto): Promise<BatteryResponseDto> {
    return this.batteries.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update battery catalog item',
    description:
      'Updates an existing persisted battery catalog row. **Admin** and **manager** can update.',
  })
  @ApiOkResponse({
    description: 'Battery updated (**200**).',
  })
  @ApiConflictResponse({
    description:
      '**409** — a battery with the same `brand + model` already exists.',
  })
  @ApiNotFoundResponse({
    description: '**404** — battery item was not found.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — only **admin** or **manager** may update battery catalog items.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBatteryDto,
  ): Promise<BatteryResponseDto> {
    return this.batteries.update(id, dto);
  }
}
