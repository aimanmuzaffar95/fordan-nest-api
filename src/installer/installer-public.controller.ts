import {
  Controller,
  Get,
  Post,
  Headers,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { DatabaseSetupService } from './database-setup.service';
import { InstallerService } from './installer.service';

/**
 * Public **Setup API** (not the installer user role): unauthenticated DB bootstrap for fresh environments
 * (e.g. staging) where no admin user exists yet.
 * GET is gated by INSTALLER_PUBLIC_DATABASE_STATE=true.
 * POST actions require header X-Installer-Setup-Token matching INSTALLER_SETUP_TOKEN (min 16 chars).
 */
@ApiTags('Setup (public)')
@Controller('installer/public')
export class InstallerPublicController {
  constructor(
    private readonly databaseSetup: DatabaseSetupService,
    private readonly installer: InstallerService,
  ) {}

  @Get('database-state')
  @ApiOperation({ summary: 'DB readiness (404 if public setup disabled)' })
  async databaseState() {
    if (!this.databaseSetup.isPublicDatabaseStateEnabled()) {
      throw new NotFoundException();
    }
    return this.databaseSetup.getPublicDatabaseState();
  }

  @Post('migrations')
  @ApiSecurity('installer-setup-token')
  @ApiOperation({ summary: 'Run migrations (requires setup token header)' })
  async runMigrations(
    @Headers('x-installer-setup-token') token: string | undefined,
  ) {
    if (!this.databaseSetup.isPublicDatabaseStateEnabled()) {
      throw new NotFoundException();
    }
    this.databaseSetup.assertSetupToken(token);
    const rec = await this.installer.migrate();
    return { runId: rec.id };
  }

  @Post('seed')
  @ApiSecurity('installer-setup-token')
  @ApiOperation({ summary: 'Run seed (requires setup token header)' })
  async runSeed(@Headers('x-installer-setup-token') token: string | undefined) {
    if (!this.databaseSetup.isPublicDatabaseStateEnabled()) {
      throw new NotFoundException();
    }
    this.databaseSetup.assertSetupToken(token);
    const rec = await this.installer.seed();
    return { runId: rec.id };
  }

  @Get('runs/:id/log')
  @ApiSecurity('installer-setup-token')
  @ApiOperation({ summary: 'Setup run log (requires setup token header)' })
  async runLog(
    @Param('id') id: string,
    @Headers('x-installer-setup-token') token: string | undefined,
  ) {
    if (!this.databaseSetup.isPublicDatabaseStateEnabled()) {
      throw new NotFoundException();
    }
    this.databaseSetup.assertSetupToken(token);
    return { text: await this.installer.getRunLog(id) };
  }
}
