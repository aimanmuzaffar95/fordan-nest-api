import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
import { Alert } from '../alerts/entities/alert.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { SystemAuditModule } from '../system-audit/system-audit.module';
import { MobileController } from './mobile.controller';
import { MobileDashboardService } from './mobile-dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, Alert, Invoice]),
    SystemAuditModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
  ],
  controllers: [MobileController],
  providers: [MobileDashboardService, JwtAuthGuard, RolesGuard],
})
export class MobileModule {}
