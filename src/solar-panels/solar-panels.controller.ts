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
import { CreateSolarPanelDto } from './dto/create-solar-panel.dto';
import { SolarPanelResponseDto } from './dto/solar-panel-response.dto';
import { SolarPanelsService } from './solar-panels.service';

@ApiTags('Equipment')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('equipment/panels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SolarPanelsController {
  constructor(private readonly solarPanels: SolarPanelsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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
  @AdminOnly()
  @ApiOperation({
    summary: 'Create solar panel catalog item',
    description:
      'Creates a persisted solar panel catalog row. **Admin only.** Duplicate `brand + model` pairs are rejected.',
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
      '**403** — only **admin** may create solar panel catalog items.',
  })
  create(@Body() dto: CreateSolarPanelDto): Promise<SolarPanelResponseDto> {
    return this.solarPanels.create(dto);
  }
}
