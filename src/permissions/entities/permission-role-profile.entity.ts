import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StaffRole } from '../../staff/entities/staff-role.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { PermissionRoleGrant } from './permission-role-grant.entity';
import { PermissionRoleScope } from './permission-role-scope.entity';

export type PermissionRoleProfileKind = 'builtin' | 'staff_role';

@Entity('permission_role_profiles')
export class PermissionRoleProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  kind: PermissionRoleProfileKind;

  @Column({ type: 'varchar', length: 20, nullable: true, unique: true })
  builtinRole: UserRole | null;

  @ManyToOne(() => StaffRole, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffRoleId' })
  staffRole: StaffRole | null;

  @Column({ type: 'uuid', nullable: true, unique: true })
  staffRoleId: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: false })
  immutable: boolean;

  @OneToMany(() => PermissionRoleGrant, (grant) => grant.profile)
  grants: PermissionRoleGrant[];

  @OneToMany(() => PermissionRoleScope, (scope) => scope.profile)
  scopes: PermissionRoleScope[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
