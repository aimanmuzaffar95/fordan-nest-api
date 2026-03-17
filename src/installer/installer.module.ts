import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { InstallerController } from './installer.controller';
import { InstallerService } from './installer.service';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    AuthModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
  ],
  controllers: [InstallerController],
  providers: [InstallerService, RolesGuard],
})
export class InstallerModule {}
