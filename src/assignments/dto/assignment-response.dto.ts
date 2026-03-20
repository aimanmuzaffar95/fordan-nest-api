import { Assignment } from '../entities/assignment.entity';

export class AssignmentResponseDto {
  id: string;
  jobId: string;
  teamId: string;
  staffUserId: string;
  scheduledDate: string;
  slot: string;
  locked: boolean;
  lockedAt: Date | null;
  lockedByUserId: string | null;
  lockReason: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(a: Assignment): AssignmentResponseDto {
    return {
      id: a.id,
      jobId: a.jobId,
      teamId: a.teamId,
      staffUserId: a.staffUserId,
      scheduledDate: a.scheduledDate,
      slot: a.slot,
      locked: a.locked,
      lockedAt: a.lockedAt,
      lockedByUserId: a.lockedByUserId,
      lockReason: a.lockReason,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
