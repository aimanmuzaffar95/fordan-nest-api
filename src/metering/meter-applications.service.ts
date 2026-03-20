import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeterApplication } from './entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UpdateMeterApplicationDto } from './dto/update-meter-application.dto';

@Injectable()
export class MeterApplicationsService {
  constructor(
    @InjectRepository(MeterApplication)
    private readonly meterRepo: Repository<MeterApplication>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
  ) {}

  async updateStatus(
    id: string,
    dto: UpdateMeterApplicationDto,
    actorUserId: string,
  ): Promise<MeterApplication> {
    const row = await this.meterRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Meter application not found');
    }

    if (dto.status === 'rejected') {
      const reason = dto.rejectionReason?.trim();
      if (!reason) {
        throw new BadRequestException(
          'rejectionReason is required when status is rejected',
        );
      }
    }

    const previousStatus = row.status;
    const today = new Date().toISOString().slice(0, 10);

    row.status = dto.status;
    if (dto.status === 'approved') {
      row.approvalDate = today;
      row.approvedByUserId = actorUserId;
      row.rejectedAt = null;
      row.rejectedByUserId = null;
      row.rejectionReason = null;
    } else if (dto.status === 'rejected') {
      row.rejectedAt = today;
      row.rejectedByUserId = actorUserId;
      row.rejectionReason = dto.rejectionReason!.trim();
      row.approvalDate = null;
      row.approvedByUserId = null;
    } else {
      row.approvalDate = null;
      row.approvedByUserId = null;
      row.rejectedAt = null;
      row.rejectedByUserId = null;
      row.rejectionReason = null;
    }

    const saved = await this.meterRepo.save(row);

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: saved.jobId,
        type: 'meter_status_change',
        payload: {
          meterApplicationId: saved.id,
          meterType: saved.type,
          previousStatus,
          status: saved.status,
          rejectionReason: saved.rejectionReason,
        },
        createdByUserId: actorUserId,
      }),
    );

    return saved;
  }
}
