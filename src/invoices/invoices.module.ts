import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { User } from '../users/entities/user.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceActivity } from './entities/invoice-activity.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
    RuntimeSettingsModule,
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceActivity,
      InvoiceItem,
      InvoicePayment,
      Customer,
      Job,
      TimelineEvent,
      User,
    ]),
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
