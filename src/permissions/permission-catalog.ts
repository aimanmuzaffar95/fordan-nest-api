import { UserRole } from '../users/entities/user-role.enum';

export const PERMISSION_KEYS = [
  'job:view',
  'job:create',
  'job:update',
  'job:financials:view',
  'job:pipeline:update',
  'job:proposal:view',
  'job:proposal:update',
  'job:quotation:send',
  'job:signature:view',
  'job:signature:create',
  'job:file:view',
  'job:file:upload',
  'job:note:create',
  'job:internal_comment:create',
  'customer:create',
  'customer:view',
  'customer:update',
  'customer:timeline:view',
  'customer:job:create',
  'assignment:view',
  'assignment:manage',
  'assignment:lock',
  'schedule:view',
  'invoice:view',
  'invoice:create',
  'invoice:send',
  'invoice:record_payment',
  'invoice:cancel',
  'invoice:notes',
  'invoice:remind_overdue',
  'staff:view',
  'staff:create',
  'staff:update',
  'staff:delete',
  'staff:password_reset',
  'staff_role:view',
  'staff_role:manage',
  'employee_role:view',
  'employee_role:manage',
  'settings:view',
  'reports:view_own',
  'reports:view_all',
  'compliance:template:view',
  'compliance:template:manage',
  'compliance:submission:view',
  'compliance:submission:create',
  'meter:view',
  'meter:update',
  'meter:file:view',
  'meter:file:upload',
  'attendance:self:clock',
  'attendance:self:view',
  'attendance:view',
  'attendance:photo:upload',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);

export type PermissionGroup =
  | 'jobs'
  | 'customers'
  | 'assignments'
  | 'schedule'
  | 'invoices'
  | 'staff'
  | 'settings'
  | 'reports'
  | 'compliance'
  | 'attendance';

export type PermissionCatalogItem = {
  key: PermissionKey;
  group: PermissionGroup;
  label: string;
  description: string;
};

export const PERMISSION_CATALOG: PermissionCatalogItem[] = [
  {
    key: 'job:view',
    group: 'jobs',
    label: 'View jobs',
    description: 'List and open jobs within the resolved job scope.',
  },
  {
    key: 'job:create',
    group: 'jobs',
    label: 'Create jobs',
    description: 'Create jobs when customer visibility is also allowed.',
  },
  {
    key: 'job:update',
    group: 'jobs',
    label: 'Edit jobs',
    description: 'Edit non-pipeline job fields on visible jobs.',
  },
  {
    key: 'job:financials:view',
    group: 'jobs',
    label: 'View job financials',
    description: 'View pricing, deposits, invoice status, and payment fields.',
  },
  {
    key: 'job:pipeline:update',
    group: 'jobs',
    label: 'Move pipeline stages',
    description: 'Move jobs through the operational pipeline.',
  },
  {
    key: 'job:proposal:view',
    group: 'jobs',
    label: 'View proposals',
    description: 'View proposal configuration and quotation PDFs.',
  },
  {
    key: 'job:proposal:update',
    group: 'jobs',
    label: 'Edit proposals',
    description: 'Update proposal equipment and pricing configuration.',
  },
  {
    key: 'job:quotation:send',
    group: 'jobs',
    label: 'Send quotations',
    description: 'Send quotation emails to customers.',
  },
  {
    key: 'job:signature:view',
    group: 'jobs',
    label: 'View signature requests',
    description: 'View e-signature requests for visible jobs.',
  },
  {
    key: 'job:signature:create',
    group: 'jobs',
    label: 'Create signature requests',
    description: 'Create customer signing links for visible jobs.',
  },
  {
    key: 'job:file:view',
    group: 'jobs',
    label: 'View job files',
    description: 'List and download files on visible jobs.',
  },
  {
    key: 'job:file:upload',
    group: 'jobs',
    label: 'Upload job files',
    description: 'Upload files on visible jobs.',
  },
  {
    key: 'job:note:create',
    group: 'jobs',
    label: 'Add job notes',
    description: 'Create customer-visible notes on visible jobs.',
  },
  {
    key: 'job:internal_comment:create',
    group: 'jobs',
    label: 'Add internal comments',
    description: 'Create internal comments on visible jobs.',
  },
  {
    key: 'customer:create',
    group: 'customers',
    label: 'Create customers',
    description: 'Create new customer or lead records.',
  },
  {
    key: 'customer:view',
    group: 'customers',
    label: 'View customers',
    description: 'Browse, search, and open customers within scope.',
  },
  {
    key: 'customer:update',
    group: 'customers',
    label: 'Edit customers',
    description: 'Update customers within scope.',
  },
  {
    key: 'customer:timeline:view',
    group: 'customers',
    label: 'View customer timeline',
    description: 'View customer activity timelines within scope.',
  },
  {
    key: 'customer:job:create',
    group: 'customers',
    label: 'Create customer jobs',
    description: 'Create jobs under visible customers.',
  },
  {
    key: 'assignment:view',
    group: 'assignments',
    label: 'View assignments',
    description: 'View installer assignments on visible jobs.',
  },
  {
    key: 'assignment:manage',
    group: 'assignments',
    label: 'Manage assignments',
    description: 'Add, remove, and reassign installers on visible jobs.',
  },
  {
    key: 'assignment:lock',
    group: 'assignments',
    label: 'Lock assignments',
    description: 'Lock or unlock scheduled assignments.',
  },
  {
    key: 'schedule:view',
    group: 'schedule',
    label: 'View schedule',
    description: 'View schedule rows within the resolved schedule scope.',
  },
  {
    key: 'invoice:view',
    group: 'invoices',
    label: 'View invoices',
    description: 'View invoices within scope.',
  },
  {
    key: 'invoice:create',
    group: 'invoices',
    label: 'Create invoices',
    description: 'Create invoices for visible jobs.',
  },
  {
    key: 'invoice:send',
    group: 'invoices',
    label: 'Send invoices',
    description: 'Send invoices to customers.',
  },
  {
    key: 'invoice:record_payment',
    group: 'invoices',
    label: 'Record payments',
    description: 'Record invoice payments.',
  },
  {
    key: 'invoice:cancel',
    group: 'invoices',
    label: 'Cancel invoices',
    description: 'Cancel invoices.',
  },
  {
    key: 'invoice:notes',
    group: 'invoices',
    label: 'Add invoice notes',
    description: 'Add notes to invoices.',
  },
  {
    key: 'invoice:remind_overdue',
    group: 'invoices',
    label: 'Send overdue reminders',
    description: 'Send overdue invoice reminders.',
  },
  {
    key: 'staff:view',
    group: 'staff',
    label: 'View staff',
    description: 'View staff directory and profiles.',
  },
  {
    key: 'staff:create',
    group: 'staff',
    label: 'Create staff',
    description: 'Create staff accounts.',
  },
  {
    key: 'staff:update',
    group: 'staff',
    label: 'Edit staff',
    description: 'Update staff accounts.',
  },
  {
    key: 'staff:delete',
    group: 'staff',
    label: 'Delete staff',
    description: 'Soft-delete staff accounts.',
  },
  {
    key: 'staff:password_reset',
    group: 'staff',
    label: 'Reset staff passwords',
    description: 'Issue temporary staff passwords.',
  },
  {
    key: 'staff_role:view',
    group: 'staff',
    label: 'View technical roles',
    description: 'View technical staff roles.',
  },
  {
    key: 'staff_role:manage',
    group: 'staff',
    label: 'Manage technical roles',
    description: 'Create and update technical staff roles.',
  },
  {
    key: 'employee_role:view',
    group: 'staff',
    label: 'View non-technical roles',
    description: 'View non-technical employee roles.',
  },
  {
    key: 'employee_role:manage',
    group: 'staff',
    label: 'Manage non-technical roles',
    description: 'Create and update non-technical employee roles.',
  },
  {
    key: 'settings:view',
    group: 'settings',
    label: 'View settings',
    description: 'View selected runtime settings.',
  },
  {
    key: 'reports:view_own',
    group: 'reports',
    label: 'View scoped reports',
    description: 'View reports for permitted jobs or managed work.',
  },
  {
    key: 'reports:view_all',
    group: 'reports',
    label: 'View company-wide reports',
    description: 'View company-wide reporting and KPIs.',
  },
  {
    key: 'compliance:template:view',
    group: 'compliance',
    label: 'View compliance templates',
    description: 'View compliance form templates.',
  },
  {
    key: 'compliance:template:manage',
    group: 'compliance',
    label: 'Manage compliance templates',
    description: 'Create and edit compliance form templates.',
  },
  {
    key: 'compliance:submission:view',
    group: 'compliance',
    label: 'View compliance submissions',
    description: 'View job compliance form submissions.',
  },
  {
    key: 'compliance:submission:create',
    group: 'compliance',
    label: 'Create compliance submissions',
    description: 'Submit compliance forms on visible jobs.',
  },
  {
    key: 'meter:view',
    group: 'compliance',
    label: 'View meter applications',
    description: 'View pre-meter and post-meter applications.',
  },
  {
    key: 'meter:update',
    group: 'compliance',
    label: 'Update meter applications',
    description: 'Update meter statuses.',
  },
  {
    key: 'meter:file:view',
    group: 'compliance',
    label: 'View meter files',
    description: 'View meter application files.',
  },
  {
    key: 'meter:file:upload',
    group: 'compliance',
    label: 'Upload meter files',
    description: 'Upload meter application files.',
  },
  {
    key: 'attendance:self:clock',
    group: 'attendance',
    label: 'Clock in/out',
    description: 'Clock in and out for assigned jobs.',
  },
  {
    key: 'attendance:self:view',
    group: 'attendance',
    label: 'View own attendance',
    description: 'View own job attendance state.',
  },
  {
    key: 'attendance:view',
    group: 'attendance',
    label: 'View attendance',
    description: 'View attendance rows for visible jobs.',
  },
  {
    key: 'attendance:photo:upload',
    group: 'attendance',
    label: 'Upload attendance photos',
    description: 'Upload photos for own attendance rows.',
  },
];

export type PermissionScopeResource =
  | 'job'
  | 'customer'
  | 'schedule'
  | 'invoice';
export type PermissionScopeValue = 'all' | 'own' | 'managed' | 'self';

export const SCOPE_VALUES: Record<
  PermissionScopeResource,
  PermissionScopeValue[]
> = {
  job: ['all', 'own'],
  customer: ['all', 'own'],
  schedule: ['all', 'managed', 'self'],
  invoice: ['all', 'managed'],
};

export const FIXED_ADMIN_CAPABILITIES = [
  'permissions:manage',
  'settings:edit',
  'settings:branding:upload',
  'settings:audit_log:view',
  'settings:billing:edit',
  'settings:document_numbering:edit',
  'settings:smtp:edit',
] as const;

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<UserRole, PermissionKey[]> = {
  [UserRole.ADMIN]: [...PERMISSION_KEYS],
  [UserRole.MANAGER]: [
    'job:view',
    'job:create',
    'job:update',
    'job:financials:view',
    'job:pipeline:update',
    'job:proposal:view',
    'job:proposal:update',
    'job:quotation:send',
    'job:signature:view',
    'job:signature:create',
    'job:file:view',
    'job:file:upload',
    'job:note:create',
    'job:internal_comment:create',
    'customer:create',
    'customer:view',
    'customer:update',
    'customer:timeline:view',
    'customer:job:create',
    'assignment:view',
    'assignment:manage',
    'schedule:view',
    'invoice:view',
    'invoice:create',
    'invoice:send',
    'invoice:record_payment',
    'invoice:cancel',
    'invoice:notes',
    'invoice:remind_overdue',
    'staff:view',
    'staff_role:view',
    'employee_role:view',
    'settings:view',
    'reports:view_own',
    'compliance:template:view',
    'compliance:submission:view',
    'compliance:submission:create',
    'meter:view',
    'meter:update',
    'meter:file:view',
    'meter:file:upload',
    'attendance:view',
  ],
  [UserRole.INSTALLER]: [
    'job:view',
    'job:pipeline:update',
    'job:file:view',
    'job:file:upload',
    'job:note:create',
    'job:proposal:view',
    'customer:create',
    'assignment:view',
    'schedule:view',
    'compliance:template:view',
    'compliance:submission:view',
    'compliance:submission:create',
    // GET /settings is @Roles(...INSTALLER) and both mobile apps read it
    // from their settings screens; the response carries no secrets.
    'settings:view',
    'attendance:self:clock',
    'attendance:self:view',
    'attendance:photo:upload',
  ],
  [UserRole.EMPLOYEE]: [],
};

export const DEFAULT_SCOPES_BY_ROLE: Record<
  UserRole,
  Partial<Record<PermissionScopeResource, PermissionScopeValue>>
> = {
  [UserRole.ADMIN]: {
    job: 'all',
    customer: 'all',
    schedule: 'all',
    invoice: 'all',
  },
  [UserRole.MANAGER]: {
    job: 'own',
    customer: 'own',
    schedule: 'managed',
    invoice: 'managed',
  },
  [UserRole.INSTALLER]: {
    job: 'own',
    customer: 'own',
    schedule: 'self',
  },
  [UserRole.EMPLOYEE]: {},
};

export const isPermissionKey = (value: string): value is PermissionKey =>
  PERMISSION_KEY_SET.has(value);

export const isScopeResource = (
  value: string,
): value is PermissionScopeResource =>
  value === 'job' ||
  value === 'customer' ||
  value === 'schedule' ||
  value === 'invoice';

export const isScopeValueAllowed = (
  resource: PermissionScopeResource,
  value: string,
): value is PermissionScopeValue =>
  SCOPE_VALUES[resource].includes(value as PermissionScopeValue);
