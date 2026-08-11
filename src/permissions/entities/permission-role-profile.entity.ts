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

/**
 * Which structural constraints a profile is held to
 * (`PermissionsService#isInstallerFamily`). `'installer'`-family profiles
 * are locked to `job=own`/`schedule=self` and cannot receive `invoice:*`
 * keys; `'office'`-family profiles have no such ceiling. Only meaningful for
 * `kind = 'staff_role'` — builtin profiles derive their family from
 * `builtinRole` directly, without needing this column populated.
 */
export type PermissionRoleProfileFamily = 'installer' | 'office';

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

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  family: PermissionRoleProfileFamily | null;

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
