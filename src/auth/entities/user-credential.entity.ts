import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_credentials')
export class UserCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  // Bumped whenever the password changes (self-service or admin reset), so
  // access tokens minted before the change fail verification in the guard.
  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  @OneToOne(() => User, (user) => user.credential, {
    onDelete: 'CASCADE',
    eager: true,
  })
  @JoinColumn()
  user: User;
}
