import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserCredential } from '../../auth/entities/user-credential.entity';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { EmployeeRole } from '../../staff/entities/employee-role.entity';
import { StaffRole } from '../../staff/entities/staff-role.entity';
import { UserRole } from './user-role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  emailAddress: string;

  @Column({ type: 'varchar', length: 30 })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  identificationNumber: string | null;

  @Column({ type: 'varchar', length: 20, default: UserRole.INSTALLER })
  role: UserRole;

  @ManyToOne(() => StaffRole, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'staffRoleId' })
  staffRole: StaffRole | null;

  @Column({ type: 'uuid', nullable: true })
  staffRoleId: string | null;

  @ManyToOne(() => EmployeeRole, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'employeeRoleId' })
  employeeRole: EmployeeRole | null;

  @Column({ type: 'uuid', nullable: true })
  employeeRoleId: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  deletedAt: Date | null;
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /**
   * Temporary admin access for a MANAGER. While this is in the future the
   * user is treated as ADMIN everywhere (JWT guard, permission resolution,
   * /auth/me). Null or past = plain manager. See users/temporary-admin.util.ts.
   */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  adminUntil: Date | null;

  @OneToOne(() => UserCredential, (credential) => credential.user)
  credential: UserCredential;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
