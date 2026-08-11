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
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateSolarPanelDto } from './dto/create-solar-panel.dto';
import { SolarPanelResponseDto } from './dto/solar-panel-response.dto';
import { UpdateSolarPanelDto } from './dto/update-solar-panel.dto';
import { SolarPanelsService } from './solar-panels.service';

@ApiTags('Equipment')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('equipment/panels')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class SolarPanelsController {
  constructor(private readonly solarPanels: SolarPanelsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('equipment:view')
  @ApiOperation({
    summary: 'List solar panel catalog items',
    description:
      'Returns the persisted solar panel catalog used by the Equipment screens. **Admin** and **manager** can read; **installer** is excluded.',
  })
  @ApiOkResponse({
    description: 'Returns `{ items }` in the standard `data` envelope.',
  })
  @ApiForbiddenResponse({
    description: '**403** — installers cannot read the equipment catalog.',
  })
  list(): Promise<{ items: SolarPanelResponseDto[] }> {
    return this.solarPanels.list();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('equipment:manage')
  @ApiOperation({
    summary: 'Create solar panel catalog item',
    description:
      'Creates a persisted solar panel catalog row. **Admin** and **manager** can create; duplicate `brand + model` pairs are rejected.',
  })
  @ApiCreatedResponse({
    description: 'Solar panel created (**201**).',
  })
  @ApiConflictResponse({
    description:
      '**409** — a solar panel with the same `brand + model` already exists.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — only **admin** or **manager** may create solar panel catalog items.',
  })
  create(@Body() dto: CreateSolarPanelDto): Promise<SolarPanelResponseDto> {
    return this.solarPanels.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('equipment:manage')
  @ApiOperation({
    summary: 'Update solar panel catalog item',
    description:
      'Updates an existing persisted solar panel catalog row. **Admin** and **manager** can update.',
  })
  @ApiOkResponse({
    description: 'Solar panel updated (**200**).',
  })
  @ApiConflictResponse({
    description:
      '**409** — a solar panel with the same `brand + model` already exists.',
  })
  @ApiNotFoundResponse({
    description: '**404** — solar panel item was not found.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — only **admin** or **manager** may update solar panel catalog items.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSolarPanelDto,
  ): Promise<SolarPanelResponseDto> {
    return this.solarPanels.update(id, dto);
  }
}
