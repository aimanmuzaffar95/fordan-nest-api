import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
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

type InvoiceViewer = {
  userId: string;
  role: UserRole;
};

type InvoiceActivityInput = {
  type: string;
  description: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class InvoicesService {
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
  ) {}

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

    if (viewer?.role === UserRole.MANAGER && !dto.jobId) {
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
    invoice.notes = dto.notes ?? null;
    invoice.terms = dto.terms ?? null;
    invoice.invoiceNumber = await this.generateInvoiceNumber();

    const items: InvoiceItem[] = [];
    let subtotal = 0;
    let taxTotal = 0;

    dto.items.forEach((itemDto, index) => {
      const quantity = parseFloat(itemDto.quantity);
      const unitPrice = parseFloat(itemDto.unitPrice);
      const taxRate = itemDto.taxRate ? parseFloat(itemDto.taxRate) : 0;

      const lineSubtotal = quantity * unitPrice;
      const lineTax = lineSubtotal * taxRate;
      const lineTotal = lineSubtotal + lineTax;

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

    const savedInvoice = await this.invoicesRepo.save(invoice);
    await this.appendActivity(
      savedInvoice,
      {
        type: 'invoice_created',
        description: `Invoice ${savedInvoice.invoiceNumber} created as draft`,
        payload: {
          invoiceNumber: savedInvoice.invoiceNumber,
          total: savedInvoice.total,
          currency: savedInvoice.currency,
          status: savedInvoice.status,
        },
      },
      viewer?.userId,
    );

    return this.getOne(savedInvoice.id, viewer);
  }

  async recordPayment(
    id: string,
    dto: RecordPaymentDto,
    viewer?: InvoiceViewer,
  ): Promise<Invoice> {
    // Load only what we need to update invoice totals.
    // Avoid re-saving the whole entity graph (relations) since that can trigger
    // TypeORM cascade/serialization edge cases.
    const invoice = await this.findInvoiceEntityOrFail(id, viewer);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot record payment on cancelled invoice',
      );
    }

    const amount = parseFloat(dto.amount);
    const total = parseFloat(invoice.total);
    const alreadyPaid = parseFloat(invoice.amountPaid);
    const newPaid = alreadyPaid + amount;

    if (newPaid - total > 0.0001) {
      throw new BadRequestException('Payment would exceed invoice total');
    }

    const payment = this.paymentsRepo.create({
      invoiceId: invoice.id,
      amount: amount.toFixed(2),
      paymentDate: dto.paymentDate,
      method: dto.method,
      reference: dto.reference ?? null,
      notes: dto.notes ?? null,
    });

    await this.paymentsRepo.save(payment);

    const updatedAmountPaid = newPaid.toFixed(2);
    const updatedStatus =
      Math.abs(newPaid - total) < 0.0001
        ? InvoiceStatus.PAID
        : InvoiceStatus.PARTIALLY_PAID;

    await this.invoicesRepo.update(id, {
      amountPaid: updatedAmountPaid,
      status: updatedStatus,
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

  async cancel(
    id: string,
    dto: CancelInvoiceDto,
    viewer?: InvoiceViewer,
  ): Promise<Invoice> {
    const invoice = await this.findInvoiceEntityOrFail(id, viewer);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      return this.getOne(id, viewer);
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

  private async generateInvoiceNumber(): Promise<string> {
    // Simple sequential pattern: INV-YYYYMMDD-XXXX
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    for (let i = 0; i < 5; i += 1) {
      const randomPart = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
      const candidate = `INV-${datePart}-${randomPart}`;
      const exists = await this.invoicesRepo.findOne({
        where: { invoiceNumber: candidate },
      });
      if (!exists) return candidate;
    }

    throw new Error('Failed to generate unique invoice number');
  }

  private applyViewerScope(
    qb: SelectQueryBuilder<Invoice>,
    viewer?: InvoiceViewer,
  ) {
    if (viewer?.role !== UserRole.MANAGER) {
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
  ): Promise<void> {
    const auditRow = this.invoiceActivitiesRepo.create({
      invoiceId: invoice.id,
      jobId: invoice.jobId ?? null,
      type: activity.type,
      description: activity.description,
      payload: activity.payload,
      createdByUserId: createdByUserId ?? null,
    });
    await this.invoiceActivitiesRepo.save(auditRow);

    if (!invoice.jobId) {
      return;
    }

    const timelineEvent = this.timelineEventsRepo.create({
      jobId: invoice.jobId,
      type: activity.type,
      payload: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        ...activity.payload,
      },
      createdByUserId: createdByUserId ?? null,
    });
    await this.timelineEventsRepo.save(timelineEvent);
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
