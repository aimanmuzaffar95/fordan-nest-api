import {
  Column,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
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

  @DeleteDateColumn({ nullable: true })
  deletedAt: Date | null;

  @OneToOne(() => UserCredential, (credential) => credential.user)
  credential: UserCredential;
}
