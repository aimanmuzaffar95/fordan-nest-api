import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import type { PermissionKey } from '../permission-catalog';
import { PermissionRoleProfile } from './permission-role-profile.entity';

@Entity('permission_role_grants')
@Unique(['profileId', 'permissionKey'])
export class PermissionRoleGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PermissionRoleProfile, (profile) => profile.grants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'profileId' })
  profile: PermissionRoleProfile;

  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'varchar', length: 120 })
  permissionKey: PermissionKey;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
