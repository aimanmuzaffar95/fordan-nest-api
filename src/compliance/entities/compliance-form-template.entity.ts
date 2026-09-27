import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('compliance_form_templates')
export class ComplianceFormTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** JSON array of { key, label, type, required? } validated in service */
  @Column({ type: 'json' })
  fields: unknown;

  /** checklist | sop | training | safety — how the item is presented and grouped. */
  @Column({ type: 'varchar', length: 20, default: 'checklist' })
  category: string;

  /** pre_install | install | post_install | handover | any — which job phase it belongs to. */
  @Column({ type: 'varchar', length: 20, default: 'any' })
  phase: string;

  /** Long-form guidance shown before the form (SOP steps, training notes). Plain text / markdown-lite. */
  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  /**
   * Evidence rules: `{ required, sources: ('camera'|'gallery'|'document')[], min, max }`.
   * Null = evidence optional, any source.
   */
  @Column({ type: 'json', nullable: true })
  evidence: unknown;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
