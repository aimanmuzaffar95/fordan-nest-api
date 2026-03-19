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
  customerId: string;
  systemType: JobSystemType;
  jobStatus: string;
  systemSizeKw: string | null;
  batterySizeKwh: string | null;
  projectPrice: string | null;
  contractSigned: boolean;
  depositAmount: string;
  depositPaid: boolean;
  depositDate: string | null;
  installDate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobDetailTimelineActorDto = {
  id: string;
  firstName: string;
  lastName: string;
  role: UserRole;
};

export type JobDetailTimelineItemDto = {
  id: string;
  action: JobAuditAction;
  field: string | null;
  oldValue: JobAuditValue | null;
  newValue: JobAuditValue | null;
  metadata: JobAuditValue | null;
  createdAt: Date;
  performedBy: JobDetailTimelineActorDto | null;
  description: string;
};

export type JobDetailResponseDto = {
  job: JobDetailJobDto;
  customer: JobDetailCustomerDto | null;
  timeline: JobDetailTimelineItemDto[];
};
