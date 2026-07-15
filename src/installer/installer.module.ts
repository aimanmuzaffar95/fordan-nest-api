import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
import { AuthModule } from '../auth/auth.module';
import { InstallerController } from './installer.controller';
import { InstallerPublicController } from './installer-public.controller';
import { InstallerService } from './installer.service';
import { DatabaseSetupService } from './database-setup.service';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    AuthModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
  ],
  controllers: [InstallerController, InstallerPublicController],
  providers: [InstallerService, DatabaseSetupService, RolesGuard],
})
export class InstallerModule {}
