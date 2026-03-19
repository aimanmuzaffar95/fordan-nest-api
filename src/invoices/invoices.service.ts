import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { InvoiceStatus } from './entities/invoice-status.enum';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepo: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private readonly itemsRepo: Repository<InvoiceItem>,
    @InjectRepository(InvoicePayment)
    private readonly paymentsRepo: Repository<InvoicePayment>,
    @InjectRepository(Customer)
    private readonly customersRepo: Repository<Customer>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
  ) {}

  async list(query: QueryInvoicesDto) {
    const qb = this.invoicesRepo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.customer', 'customer')
      .orderBy('invoice.issueDate', 'DESC');

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

  async getOne(id: string) {
    const invoice = await this.invoicesRepo.findOne({
      where: { id },
      relations: ['customer', 'items', 'payments'],
      order: {
        items: {
          position: 'ASC',
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async create(dto: CreateInvoiceDto): Promise<Invoice> {
    // v0.3+: invoices can be linked to an order/job. If `jobId` is provided,
    // we derive `customerId` from the job to keep backend source-of-truth.
    let derivedCustomerId: string | undefined = dto.customerId;
    let derivedJobId: string | null = null;

    if (dto.jobId) {
      const job = await this.jobsRepo.findOne({ where: { id: dto.jobId } });
      if (!job) {
        throw new BadRequestException('Job not found');
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

    return this.invoicesRepo.save(invoice);
  }

  async recordPayment(id: string, dto: RecordPaymentDto): Promise<Invoice> {
    // Load only what we need to update invoice totals.
    // Avoid re-saving the whole entity graph (relations) since that can trigger
    // TypeORM cascade/serialization edge cases.
    const invoice = await this.invoicesRepo.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
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

    // Re-fetch the full graph so the UI always gets items/payments/customer.
    return this.getOne(id);
  }

  async send(id: string): Promise<Invoice> {
    const invoice = await this.invoicesRepo.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot send cancelled invoice');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      return invoice;
    }

    invoice.status = InvoiceStatus.SENT;
    invoice.sentAt = new Date();

    return this.invoicesRepo.save(invoice);
  }

  async cancel(id: string, dto: CancelInvoiceDto): Promise<Invoice> {
    const invoice = await this.invoicesRepo.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      return invoice;
    }

    invoice.status = InvoiceStatus.CANCELLED;
    invoice.cancelledAt = new Date();
    invoice.cancelReason = dto.reason;

    return this.invoicesRepo.save(invoice);
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
}
