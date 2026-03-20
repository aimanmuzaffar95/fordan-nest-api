import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserCredential } from '../../auth/entities/user-credential.entity';
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

  @Column({ type: 'varchar', length: 20, default: UserRole.INSTALLER })
  role: UserRole;

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
