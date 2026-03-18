import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { InstallerService } from './installer.service';

const isInstallerEnabled = () =>
  (process.env.INSTALLER_ENABLED ?? 'false').toLowerCase() === 'true';

@Controller('installer')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InstallerController {
  constructor(private readonly installer: InstallerService) {}

  private assertEnabled() {
    if (!isInstallerEnabled()) {
      throw new ForbiddenException('Installer endpoints are disabled.');
    }
  }

  @Get('status')
  @AdminOnly()
  async status() {
    this.assertEnabled();
    return this.installer.status();
  }

  @Get('runs')
  @AdminOnly()
  async runs() {
    this.assertEnabled();
    return {
      activeRun: (await this.installer.status()).activeRun,
      runs: this.installer.listRuns(),
    };
  }

  @Get('runs/:id')
  @AdminOnly()
  run(@Param('id') id: string) {
    this.assertEnabled();
    return this.installer.getRun(id);
  }

  @Get('logs/:id')
  @AdminOnly()
  async log(@Param('id') id: string) {
    this.assertEnabled();
    return { text: await this.installer.getRunLog(id) };
  }

  @Post('setup')
  @AdminOnly()
  async setup() {
    this.assertEnabled();
    const rec = await this.installer.setup();
    return { runId: rec.id };
  }

  @Post('upgrade')
  @AdminOnly()
  async upgrade(
    @Body()
    body: {
      env?: string;
      remoteSubmodules?: boolean;
      checks?: boolean;
    },
  ) {
    this.assertEnabled();
    const rec = await this.installer.upgrade({
      env: body.env || 'dev',
      remoteSubmodules: body.remoteSubmodules,
      checks: body.checks,
    });
    return { runId: rec.id };
  }

  @Post('migrate')
  @AdminOnly()
  async migrate() {
    this.assertEnabled();
    const rec = await this.installer.migrate();
    return { runId: rec.id };
  }

  @Post('restart-web')
  @AdminOnly()
  async restartWeb() {
    this.assertEnabled();
    const rec = await this.installer.restartWeb();
    return { runId: rec.id };
  }

  @Post('seed')
  @AdminOnly()
  async seed() {
    this.assertEnabled();
    const rec = await this.installer.seed();
    return { runId: rec.id };
  }
}
