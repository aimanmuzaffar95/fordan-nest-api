import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  invoice: Invoice;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  quantity: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  unitPrice: string;

  @Column({ type: 'numeric', precision: 5, scale: 4, default: 0 })
  taxRate: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  lineSubtotal: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  lineTax: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  lineTotal: string;

  @Column({ type: 'int', default: 0 })
  position: number;
}
