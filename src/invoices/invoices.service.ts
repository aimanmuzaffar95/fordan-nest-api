import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { AddInvoiceNoteDto } from './dto/add-invoice-note.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { Invoice } from './entities/invoice.entity';
import { InvoiceActivity } from './entities/invoice-activity.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { InvoiceStatus } from './entities/invoice-status.enum';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';
import { EmailService } from '../email/email.service';
import { CustomerMessagingRendererService } from '../email/customer-messaging-renderer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';

type InvoiceViewer = {
  userId: string;
  role: UserRole;
  invoiceScope?: 'all' | 'managed';
};

type InvoiceActivityInput = {
  type: string;
  description: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepo: Repository<Invoice>,
    @InjectRepository(InvoiceActivity)
    private readonly invoiceActivitiesRepo: Repository<InvoiceActivity>,
    @InjectRepository(InvoicePayment)
    private readonly paymentsRepo: Repository<InvoicePayment>,
    @InjectRepository(Customer)
    private readonly customersRepo: Repository<Customer>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(TimelineEvent)
    private readonly timelineEventsRepo: Repository<TimelineEvent>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly docNumbers: DocumentNumberingService,
    private readonly email: EmailService,
    private readonly customerMessaging: CustomerMessagingRendererService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Notify admins + the job's manager that an invoice is fully paid. Never throws. */
  private async notifyInvoicePaid(
    invoice: Invoice,
    amountPaid: string,
    actorUserId?: string,
  ): Promise<void> {
    try {
      const job = invoice.jobId
        ? await this.jobsRepo.findOne({ where: { id: invoice.jobId } })
        : null;
      const payload = {
        type: NOTIFICATION_TYPE.INVOICE_PAID,
        title: 'Invoice paid',
        body: `Invoice ${invoice.invoiceNumber} fully paid ($${amountPaid})`,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          jobId: invoice.jobId,
          orderNumber: job?.orderNumber ?? null,
        },
        dedupeKey: `invoice-paid:${invoice.id}:admins`,
      };
      await this.notifications.sendToRole(UserRole.ADMIN, payload, {
        excludeUserIds: actorUserId ? [actorUserId] : [],
      });
      if (job?.managerId && job.managerId !== actorUserId) {
        await this.notifications.sendToUser(job.managerId, {
          ...payload,
          dedupeKey: `invoice-paid:${invoice.id}:manager`,
        });
      }
    } catch (err) {
      this.logger.warn(`invoice-paid notification failed: ${String(err)}`);
    }
  }

  async list(query: QueryInvoicesDto, viewer?: InvoiceViewer) {
    const qb = this.invoicesRepo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.customer', 'customer')
      .orderBy('invoice.issueDate', 'DESC');
    this.applyViewerScope(qb, viewer);

    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    }
    if (query.customerId) {
      qb.andWhere('invoice.customerId = :customerId', {
        customerId: query.customerId,
      });
    }
    if (query.fromDate) {
      qb.andWhere('invoice.issueDate >= :fromDate', {
        fromDate: query.fromDate,
      });
    }
    if (query.toDate) {
      qb.andWhere('invoice.issueDate <= :toDate', {
        toDate: query.toDate,
      });
    }
    if (query.search) {
      qb.andWhere(
        '(invoice.invoiceNumber ILIKE :search OR customer.firstName ILIKE :search OR customer.lastName ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async getOne(id: string, viewer?: InvoiceViewer) {
    const qb = this.invoicesRepo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.customer', 'customer')
      .leftJoinAndSelect('invoice.items', 'items')
      .leftJoinAndSelect('invoice.payments', 'payments')
      .leftJoinAndSelect('invoice.activities', 'activities')
      .leftJoinAndSelect('activities.createdByUser', 'activityActor')
      .where('invoice.id = :id', { id })
      .orderBy('items.position', 'ASC')
      .addOrderBy('activities.createdAt', 'DESC')
      .addOrderBy('payments.createdAt', 'DESC');
    this.applyViewerScope(qb, viewer);
    const invoice = await qb.getOne();
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async create(
    dto: CreateInvoiceDto,
    viewer?: InvoiceViewer,
  ): Promise<Invoice> {
    // v0.3+: invoices can be linked to an order/job. If `jobId` is provided,
    // we derive `customerId` from the job to keep backend source-of-truth.
    let derivedCustomerId: string | undefined = dto.customerId;
    let derivedJobId: string | null = null;

    if (
      viewer?.role === UserRole.MANAGER &&
      viewer.invoiceScope !== 'all' &&
      !dto.jobId
    ) {
      throw new BadRequestException(
        'Managers can only create invoices for jobs assigned to them',
      );
    }

    if (dto.jobId) {
      const job = await this.jobsRepo.findOne({ where: { id: dto.jobId } });
      if (!job) {
        throw new BadRequestException('Job not found');
      }
      if (
        viewer?.role === UserRole.MANAGER &&
        viewer.invoiceScope !== 'all' &&
        job.managerId !== viewer.userId
      ) {
        throw new NotFoundException('Job not found');
      }

      derivedCustomerId = job.customerId;
      derivedJobId = job.id;
    }

    if (!derivedCustomerId) {
      throw new BadRequestException('customerId or jobId must be provided');
    }

    const customer = await this.customersRepo.findOne({
      where: { id: derivedCustomerId },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Invoice must have at least one item');
    }

    const invoice = new Invoice();
    invoice.customer = customer;
    invoice.customerId = customer.id;
    invoice.jobId = derivedJobId;
    invoice.currency = dto.currency;
    invoice.issueDate = dto.issueDate;
    invoice.dueDate = dto.dueDate;
    invoice.status = InvoiceStatus.DRAFT;
    invoice.invoiceType = dto.type ?? 'custom';
    invoice.notes = dto.notes ?? null;
    invoice.terms = dto.terms ?? null;
    invoice.invoiceNumber = await this.docNumbers.allocateNextInvoiceNumber();

    const items: InvoiceItem[] = [];
    let subtotal = 0;
    let taxTotal = 0;

    dto.items.forEach((itemDto, index) => {
      const quantity = parseFloat(itemDto.quantity);
      const unitPrice = parseFloat(itemDto.unitPrice);
      const taxRate = itemDto.taxRate ? parseFloat(itemDto.taxRate) : 0;

      // Round each line to 2 decimals BEFORE accumulating so the header
      // totals equal the sum of the rounded per-line amounts shown to the
      // customer (round-then-sum), avoiding a cent drift from summing raw
      // floats and rounding once at the end (BE-INV-02).
      const roundMoney = (value: number) => Math.round(value * 100) / 100;
      const lineSubtotal = roundMoney(quantity * unitPrice);
      const lineTax = roundMoney(lineSubtotal * taxRate);
      const lineTotal = roundMoney(lineSubtotal + lineTax);

      subtotal += lineSubtotal;
      taxTotal += lineTax;

      const item = new InvoiceItem();
      item.description = itemDto.description;
      item.quantity = quantity.toFixed(2);
      item.unitPrice = unitPrice.toFixed(2);
      item.taxRate = taxRate.toFixed(4);
      item.lineSubtotal = lineSubtotal.toFixed(2);
      item.lineTax = lineTax.toFixed(2);
      item.lineTotal = lineTotal.toFixed(2);
      item.position = index;
      items.push(item);
    });

    invoice.subtotal = subtotal.toFixed(2);
    invoice.taxTotal = taxTotal.toFixed(2);
    invoice.total = (subtotal + taxTotal).toFixed(2);
    invoice.amountPaid = '0.00';
    invoice.items = items;

    // Invoice + items + creation activity + timeline event commit atomically
    // (API-06): a failure in any write rolls back the whole creation instead
    // of leaving an invoice without its audit trail.
    const savedInvoice = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Invoice).save(invoice);
      await this.appendActivity(
        saved,
        {
          type: 'invoice_created',
          description: `Invoice ${saved.invoiceNumber} created as draft`,
          payload: {
            invoiceNumber: saved.invoiceNumber,
            total: saved.total,
            currency: saved.currency,
            status: saved.status,
          },
        },
        viewer?.userId,
        manager,
      );
      return saved;
    });

    return this.getOne(savedInvoice.id, viewer);
  }

  async recordPayment(
    id: string,
    dto: RecordPaymentDto,
    viewer?: InvoiceViewer,
  ): Promise<Invoice> {
    // Viewer scoping + 404 first (read-only, outside the row lock).
    await this.findInvoiceEntityOrFail(id, viewer);

    const amount = parseFloat(dto.amount);

    // Atomic payment recording: lock the invoice row, recompute amountPaid
    // from the persisted payment rows and apply the overpay guard while the
    // lock is held so concurrent payments cannot race or silently overpay.
    const { invoice, payment, updatedAmountPaid, updatedStatus } =
      await this.dataSource.transaction(async (manager) => {
        const invoicesRepo = manager.getRepository(Invoice);
        const paymentsRepo = manager.getRepository(InvoicePayment);

        const lockedInvoice = await invoicesRepo.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedInvoice) {
          throw new NotFoundException('Invoice not found');
        }
        if (lockedInvoice.status === InvoiceStatus.CANCELLED) {
          throw new BadRequestException(
            'Cannot record payment on cancelled invoice',
          );
        }

        const total = parseFloat(lockedInvoice.total);
        const paidRow = await paymentsRepo
          .createQueryBuilder('payment')
          .select('COALESCE(SUM(payment.amount), 0)', 'sum')
          .where('payment.invoiceId = :invoiceId', {
            invoiceId: lockedInvoice.id,
          })
          .getRawOne<{ sum: string }>();
        const alreadyPaid = parseFloat(paidRow?.sum ?? '0');
        const newPaid = alreadyPaid + amount;

        if (newPaid - total > 0.0001) {
          throw new BadRequestException('Payment would exceed invoice total');
        }

        const savedPayment = await paymentsRepo.save(
          paymentsRepo.create({
            invoiceId: lockedInvoice.id,
            amount: amount.toFixed(2),
            paymentDate: dto.paymentDate,
            method: dto.method,
            reference: dto.reference ?? null,
            notes: dto.notes ?? null,
          }),
        );

        const amountPaid = newPaid.toFixed(2);
        const status =
          Math.abs(newPaid - total) < 0.0001
            ? InvoiceStatus.PAID
            : InvoiceStatus.PARTIALLY_PAID;

        await invoicesRepo.update(id, { amountPaid, status });

        return {
          invoice: lockedInvoice,
          payment: savedPayment,
          updatedAmountPaid: amountPaid,
          updatedStatus: status,
        };
      });

    const activityInvoice = {
      ...invoice,
      amountPaid: updatedAmountPaid,
      status: updatedStatus,
    } as Invoice;
    await this.appendActivity(
      activityInvoice,
      {
        type: 'invoice_payment_recorded',
        description: `Payment recorded (${dto.method}) for ${amount.toFixed(2)}`,
        payload: {
          paymentId: payment.id,
          amount: payment.amount,
          paymentDate: payment.paymentDate,
          method: payment.method,
          reference: payment.reference,
          resultingAmountPaid: updatedAmountPaid,
          resultingStatus: updatedStatus,
        },
      },
      viewer?.userId,
    );

    if (updatedStatus === InvoiceStatus.PAID) {
      await this.appendActivity(
        activityInvoice,
        {
          type: 'invoice_paid',
          description: `Invoice ${invoice.invoiceNumber} marked fully paid`,
          payload: {
            amountPaid: updatedAmountPaid,
            paidAt: new Date().toISOString(),
          },
        },
        viewer?.userId,
      );
      await this.notifyInvoicePaid(invoice, updatedAmountPaid, viewer?.userId);

      // Customer payment receipt (best-effort). The payment row is already
      // committed — a failed receipt email must not make the recorded payment
      // look failed to the caller.
      try {
        const full = await this.invoicesRepo.findOne({
          where: { id: invoice.id },
          relations: { customer: true, job: true },
        });
        const customerEmail =
          full?.customer?.email && full.customer.email.trim()
            ? full.customer.email.trim()
            : null;
        if (full && customerEmail) {
          const { subject, html } =
            await this.customerMessaging.renderPaymentReceiptCustomerEmail({
              customerName:
                `${full.customer.firstName ?? ''} ${full.customer.lastName ?? ''}`.trim() ||
                'Customer',
              orderNumber: full.job?.orderNumber ?? '',
              invoiceNumber: full.invoiceNumber,
              paymentAmount: `${payment.amount} ${full.currency}`,
              paymentDate: payment.paymentDate,
            });
          await this.email.send({ to: customerEmail, subject, html });
        }
      } catch (emailErr) {
        this.logger.warn(
          `Payment receipt email failed for invoice ${invoice.id}: ${String(emailErr)}`,
        );
      }
    }

    // Re-fetch the full graph so the UI always gets items/payments/customer.
    return this.getOne(id, viewer);
  }

  async send(id: string, viewer?: InvoiceViewer): Promise<Invoice> {
    const invoice = await this.findInvoiceEntityOrFail(id, viewer);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot send cancelled invoice');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      return this.getOne(id, viewer);
    }

    // Deliver the customer email BEFORE persisting SENT — "sent" must mean
    // delivered (or no recipient on file). A failed delivery leaves the
    // invoice in its current status so the 503 matches reality.
    try {
      const full = await this.invoicesRepo.findOne({
        where: { id: invoice.id },
        relations: { customer: true, job: true },
      });
      const customerEmail =
        full?.customer?.email && full.customer.email.trim()
          ? full.customer.email.trim()
          : null;
      if (full && customerEmail) {
        const due = full.dueDate ?? '';
        const { subject, html } =
          await this.customerMessaging.renderInvoiceSentCustomerEmail({
            customerName:
              `${full.customer.firstName ?? ''} ${full.customer.lastName ?? ''}`.trim() ||
              'Customer',
            orderNumber: full.job?.orderNumber ?? '',
            invoiceNumber: full.invoiceNumber,
            invoiceTotal: `${full.total} ${full.currency}`,
            invoiceDueDate: due,
          });
        await this.email.send({ to: customerEmail, subject, html });
      }
    } catch {
      throw new ServiceUnavailableException({
        message: 'Email delivery failed. Invoice was not sent to customer.',
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }

    invoice.status = InvoiceStatus.SENT;
    invoice.sentAt = new Date();
    await this.invoicesRepo.save(invoice);
    await this.appendActivity(
      invoice,
      {
        type: 'invoice_sent',
        description: `Invoice ${invoice.invoiceNumber} marked as sent`,
        payload: {
          invoiceNumber: invoice.invoiceNumber,
          sentAt: invoice.sentAt.toISOString(),
        },
      },
      viewer?.userId,
    );

    return this.getOne(id, viewer);
  }

  async sendOverdueReminder(id: string, viewer?: InvoiceViewer): Promise<void> {
    const invoice = await this.invoicesRepo.findOne({
      where: { id },
      relations: { customer: true, job: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (viewer?.role === UserRole.MANAGER && viewer.invoiceScope !== 'all') {
      this.assertManagerJobAccess(invoice.job, viewer.userId);
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot remind cancelled invoice');
    }
    const customerEmail =
      invoice.customer?.email && invoice.customer.email.trim()
        ? invoice.customer.email.trim()
        : null;
    if (!customerEmail) {
      throw new BadRequestException('Customer email is missing');
    }
    try {
      const { subject, html } =
        await this.customerMessaging.renderOverdueReminderCustomerEmail({
          customerName:
            `${invoice.customer.firstName ?? ''} ${invoice.customer.lastName ?? ''}`.trim() ||
            'Customer',
          orderNumber: invoice.job?.orderNumber ?? '',
          invoiceNumber: invoice.invoiceNumber,
          invoiceTotal: `${invoice.total} ${invoice.currency}`,
          invoiceDueDate: invoice.dueDate ?? '',
        });
      await this.email.send({ to: customerEmail, subject, html });
    } catch {
      throw new ServiceUnavailableException({
        message: 'Email delivery failed. Overdue reminder was not delivered.',
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }
    await this.appendActivity(
      invoice,
      {
        type: 'invoice_reminder_sent',
        description: `Overdue payment reminder emailed to ${customerEmail}`,
        payload: { to: customerEmail },
      },
      viewer?.userId,
    );
  }

  private assertManagerJobAccess(job: Job | null | undefined, userId: string) {
    if (!job) {
      throw new ForbiddenException('Manager access requires a job scope');
    }
    if (job.managerId !== userId) {
      throw new ForbiddenException('You do not have access to this invoice');
    }
  }

  async cancel(
    id: string,
    dto: CancelInvoiceDto,
    viewer?: InvoiceViewer,
  ): Promise<Invoice> {
    const invoice = await this.findInvoiceEntityOrFail(id, viewer);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      return this.getOne(id, viewer);
    }

    // Reports exclude CANCELLED invoices, so cancelling one with recorded
    // payments would silently erase collected revenue from the books while
    // the payment rows remain.
    if (Number(invoice.amountPaid ?? 0) > 0) {
      throw new BadRequestException(
        'Cannot cancel an invoice with recorded payments — remove or refund the payments first.',
      );
    }

    invoice.status = InvoiceStatus.CANCELLED;
    invoice.cancelledAt = new Date();
    invoice.cancelReason = dto.reason;
    await this.invoicesRepo.save(invoice);
    await this.appendActivity(
      invoice,
      {
        type: 'invoice_cancelled',
        description: `Invoice ${invoice.invoiceNumber} cancelled`,
        payload: {
          reason: dto.reason,
          cancelledAt: invoice.cancelledAt.toISOString(),
        },
      },
      viewer?.userId,
    );

    return this.getOne(id, viewer);
  }

  async addNote(
    id: string,
    dto: AddInvoiceNoteDto,
    viewer?: InvoiceViewer,
  ): Promise<Invoice> {
    const invoice = await this.findInvoiceEntityOrFail(id, viewer);
    const now = new Date();
    const actorName = await this.getActorDisplayName(viewer?.userId);
    const stampedNote = `[${now.toISOString()}] ${actorName}: ${dto.note.trim()}`;
    invoice.terms = invoice.terms
      ? `${invoice.terms}\n${stampedNote}`
      : stampedNote;
    await this.invoicesRepo.save(invoice);

    await this.appendActivity(
      invoice,
      {
        type: 'invoice_note_added',
        description: 'Internal invoice note added',
        payload: {
          note: dto.note.trim(),
        },
      },
      viewer?.userId,
    );

    return this.getOne(id, viewer);
  }

  private applyViewerScope(
    qb: SelectQueryBuilder<Invoice>,
    viewer?: InvoiceViewer,
  ) {
    if (viewer?.role !== UserRole.MANAGER || viewer.invoiceScope === 'all') {
      return qb;
    }

    return qb.innerJoin(
      'invoice.job',
      'job_scope',
      'job_scope.managerId = :managerUserId',
      { managerUserId: viewer.userId },
    );
  }

  private async findInvoiceEntityOrFail(id: string, viewer?: InvoiceViewer) {
    const qb = this.invoicesRepo
      .createQueryBuilder('invoice')
      .where('invoice.id = :id', { id });
    this.applyViewerScope(qb, viewer);
    const invoice = await qb.getOne();

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  private async appendActivity(
    invoice: Invoice,
    activity: InvoiceActivityInput,
    createdByUserId?: string,
    manager?: EntityManager,
  ): Promise<void> {
    const activitiesRepo = manager
      ? manager.getRepository(InvoiceActivity)
      : this.invoiceActivitiesRepo;
    const timelineRepo = manager
      ? manager.getRepository(TimelineEvent)
      : this.timelineEventsRepo;

    const auditRow = activitiesRepo.create({
      invoiceId: invoice.id,
      jobId: invoice.jobId ?? null,
      type: activity.type,
      description: activity.description,
      payload: activity.payload,
      createdByUserId: createdByUserId ?? null,
    });
    await activitiesRepo.save(auditRow);

    if (!invoice.jobId) {
      return;
    }

    const timelineEvent = timelineRepo.create({
      jobId: invoice.jobId,
      type: activity.type,
      payload: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        ...activity.payload,
      },
      createdByUserId: createdByUserId ?? null,
    });
    await timelineRepo.save(timelineEvent);
  }

  private async getActorDisplayName(userId?: string): Promise<string> {
    if (!userId) {
      return 'Unknown user';
    }
    const actor = await this.usersRepo.findOne({
      where: { id: userId },
      select: ['id', 'firstName', 'lastName'],
    });
    if (!actor) {
      return userId;
    }
    const fullName = `${actor.firstName} ${actor.lastName}`.trim();
    return fullName || userId;
  }
}
