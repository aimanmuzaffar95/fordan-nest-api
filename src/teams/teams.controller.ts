import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamsService } from './teams.service';

@ApiTags('Teams')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('teams')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List teams',
    description:
      'Ordered by name. **Installer** may read teams (e.g. capacity context for `users.teamId`). Mutations are **admin/manager**; **delete** is **admin** only.',
  })
  list() {
    return this.teams.list();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({ summary: 'Get team by id' })
  @ApiNotFoundResponse({ description: 'Unknown team id.' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.getOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create team' })
  @ApiCreatedResponse({ description: 'Team created (**201**).' })
  @ApiForbiddenResponse({
    description: '**403** — `installer` cannot create teams.',
  })
  create(@Body() dto: CreateTeamDto) {
    return this.teams.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update team' })
  @ApiNotFoundResponse({ description: 'Unknown team id.' })
  @ApiForbiddenResponse({
    description: '**403** — `installer` cannot update teams.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    return this.teams.update(id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @ApiOperation({
    summary: 'Delete team',
    description:
      '**Admin only.** Related `assignments` rows are removed (CASCADE). Ensure jobs/users are reassigned if needed. Response is **200** with `{ id }` in the standard `data` envelope.',
  })
  @ApiOkResponse({
    description: 'Returns `{ id }` of the deleted team in `data`.',
  })
  @ApiNotFoundResponse({ description: 'Unknown team id.' })
  @ApiForbiddenResponse({
    description: '**403** — only **admin** may delete teams.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.remove(id);
  }
}
