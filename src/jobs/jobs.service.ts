import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from './entities/job.entity';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
  ) {}

  async list(query: FindJobsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.jobsRepo
      .createQueryBuilder('job')
      .orderBy('job.createdAt', 'DESC');

    if (query.customerId) {
      qb.andWhere('job.customerId = :customerId', {
        customerId: query.customerId,
      });
    }

    if (typeof query.contractSigned === 'boolean') {
      qb.andWhere('job.contractSigned = :contractSigned', {
        contractSigned: query.contractSigned,
      });
    }

    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getOne(id: string) {
    const job = await this.jobsRepo.findOne({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }
}
