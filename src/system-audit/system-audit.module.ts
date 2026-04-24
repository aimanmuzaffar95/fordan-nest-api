import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemAuditLog } from './entities/system-audit-log.entity';
import { SystemAuditLogService } from './system-audit-log.service';
import { AuditLogController } from './audit-log.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SystemAuditLog])],
  controllers: [AuditLogController],
  providers: [SystemAuditLogService],
  exports: [SystemAuditLogService],
})
export class SystemAuditModule {}
