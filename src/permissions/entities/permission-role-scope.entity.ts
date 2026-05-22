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
import type {
  PermissionScopeResource,
  PermissionScopeValue,
} from '../permission-catalog';
import { PermissionRoleProfile } from './permission-role-profile.entity';

@Entity('permission_role_scopes')
@Unique(['profileId', 'resource'])
export class PermissionRoleScope {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PermissionRoleProfile, (profile) => profile.scopes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'profileId' })
  profile: PermissionRoleProfile;

  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'varchar', length: 40 })
  resource: PermissionScopeResource;

  @Column({ type: 'varchar', length: 40 })
  scope: PermissionScopeValue;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
