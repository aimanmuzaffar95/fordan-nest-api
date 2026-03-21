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

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;
  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToOne(() => UserCredential, (credential) => credential.user)
  credential: UserCredential;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
