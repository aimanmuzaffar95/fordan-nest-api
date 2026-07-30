import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('employee_forms')
export class EmployeeForm {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  surname: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  driversLicenseNo: string | null;

  @Column({ type: 'varchar', length: 30 })
  phoneMobile: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phoneHome: string | null;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  // text columns below (not varchar): employee_forms' combined inline varchar
  // width exceeded MariaDB's 8126-byte row cap, failing every table rebuild.
  @Column({ type: 'text', nullable: true })
  homeAddress: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  suburb: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  postcode: string | null;

  @Column({ type: 'text', nullable: true })
  accountName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  bsb: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  accountNo: string | null;

  @Column({ type: 'boolean', default: false })
  hasSuperannuation: boolean;

  @Column({ type: 'text', nullable: true })
  superFundName: string | null;

  @Column({ type: 'text', nullable: true })
  superMemberNumber: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  emergencyContactName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  emergencyContactRelationship: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  emergencyContactPhoneMobile: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  emergencyContactPhoneHome: string | null;

  @Column({ type: 'text', nullable: true })
  emergencyContactAddress: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  submittedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
