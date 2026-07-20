import { UserRole } from '../../users/entities/user-role.enum';
import { JobAuditAction } from '../job-audit-action.enum';
import { JobSystemType } from '../job-system-type.enum';
import { JobAuditValue } from '../types/job-audit-value.type';

export type JobDetailCustomerDto = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string | null;
};

export type JobDetailJobDto = {
  id: string;
  orderNumber: string;
  customerId: string;
  systemType: JobSystemType;
  jobStatus: string;
  pipelineStage: string;
  pipelinePosition: number;
  systemSizeKw: string | null;
  batterySizeKwh: string | null;
  projectPrice: string | null;
  contractSigned: boolean;
  depositAmount: string | null;
  depositPaid: boolean;
  depositDate: string | null;
  installDate: string | null;
  scheduledDate: string | null;
  scheduledSlot: string | null;
  managerId: string | null;
  assignedStaffUserId: string | null;
  invoiceStatus: string | null;
  invoiceDate: string | null;
  invoiceDueDate: string | null;
  paidDate: string | null;
  lostAt: Date | null;
  lostReason: string | null;
  lostByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobDetailPersonDto = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
};

export type JobDetailAssignmentDto = {
  id: string;
  scheduledDate: string;
  slot: string;
  locked: boolean;
  lockedAt: Date | null;
  lockReason: string | null;
  installer: JobDetailPersonDto | null;
};

export type JobDetailFinancialsDto = {
  depositPaidAmount: string;
  remainingAmount: string | null;
};

export type JobDetailTimelineActorDto = {
  id: string;
  firstName: string;
  lastName: string;
  role: UserRole;
};

export type JobDetailTextEntryActorDto = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
};

export type JobDetailTextEntryDto = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: JobDetailTextEntryActorDto | null;
};

export type JobDetailTimelineItemDto = {
  id: string;
  source: 'audit' | 'event';
  eventType: string;
  action: JobAuditAction | string | null;
  field: string | null;
  oldValue: JobAuditValue | null;
  newValue: JobAuditValue | null;
  metadata: JobAuditValue | null;
  payload: JobAuditValue | null;
  createdAt: Date;
  performedBy: JobDetailTimelineActorDto | null;
  createdByName: string;
  description: string;
};

export type JobDetailResponseDto = {
  job: JobDetailJobDto;
  customer: JobDetailCustomerDto | null;
  manager: JobDetailPersonDto | null;
  assignedStaffUser: JobDetailPersonDto | null;
  installerAssignments: JobDetailAssignmentDto[];
  financials: JobDetailFinancialsDto | null;
  notes: JobDetailTextEntryDto[];
  internalComments: JobDetailTextEntryDto[];
  timeline: JobDetailTimelineItemDto[];
};
