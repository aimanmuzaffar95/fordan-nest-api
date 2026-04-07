import {
  Body,
  Controller,
  Get,
  Param,
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
import { CreateInverterDto } from './dto/create-inverter.dto';
import { InverterResponseDto } from './dto/inverter-response.dto';
import { UpdateInverterDto } from './dto/update-inverter.dto';
import { InvertersService } from './inverters.service';

@ApiTags('Equipment')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('equipment/inverters')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvertersController {
  constructor(private readonly inverters: InvertersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List inverter catalog items',
    description:
      'Returns the persisted inverter catalog used by the Equipment screens. **Admin** and **manager** can read; **installer** is excluded.',
  })
  @ApiOkResponse({
    description: 'Returns `{ items }` in the standard `data` envelope.',
  })
  @ApiForbiddenResponse({
    description: '**403** — installers cannot read the equipment catalog.',
  })
  list(): Promise<{ items: InverterResponseDto[] }> {
    return this.inverters.list();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Create inverter catalog item',
    description:
      'Creates a persisted inverter catalog row. **Admin** and **manager** can create; duplicate `brand + model` pairs are rejected.',
  })
  @ApiCreatedResponse({
    description: 'Inverter created (**201**).',
  })
  @ApiConflictResponse({
    description:
      '**409** — an inverter with the same `brand + model` already exists.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — only **admin** or **manager** may create inverter catalog items.',
  })
  create(@Body() dto: CreateInverterDto): Promise<InverterResponseDto> {
    return this.inverters.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update inverter catalog item',
    description:
      'Updates an existing persisted inverter catalog row. **Admin** and **manager** can update.',
  })
  @ApiOkResponse({
    description: 'Inverter updated (**200**).',
  })
  @ApiConflictResponse({
    description:
      '**409** — an inverter with the same `brand + model` already exists.',
  })
  @ApiNotFoundResponse({
    description: '**404** — inverter item was not found.',
  })
  @ApiForbiddenResponse({
    description:
      '**403** — only **admin** or **manager** may update inverter catalog items.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInverterDto,
  ): Promise<InverterResponseDto> {
    return this.inverters.update(id, dto);
  }
}
