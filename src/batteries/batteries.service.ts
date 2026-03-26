import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBatteryDto } from './dto/create-battery.dto';
import { BatteryResponseDto } from './dto/battery-response.dto';
import { Battery } from './entities/battery.entity';

@Injectable()
export class BatteriesService {
  constructor(
    @InjectRepository(Battery)
    private readonly batteriesRepo: Repository<Battery>,
  ) {}

  async list(): Promise<{ items: BatteryResponseDto[] }> {
    const rows = await this.batteriesRepo.find({
      order: { createdAt: 'DESC', brand: 'ASC', model: 'ASC' },
    });

    return {
      items: rows.map((battery) => BatteryResponseDto.fromEntity(battery)),
    };
  }

  async create(dto: CreateBatteryDto): Promise<BatteryResponseDto> {
    const duplicate = await this.batteriesRepo
      .createQueryBuilder('battery')
      .where('LOWER(battery.brand) = LOWER(:brand)', { brand: dto.brand })
      .andWhere('LOWER(battery.model) = LOWER(:model)', { model: dto.model })
      .getOne();

    if (duplicate) {
      throw new ConflictException(
        'A battery with this brand and model already exists',
      );
    }

    const saved = await this.batteriesRepo.save(
      this.batteriesRepo.create({
        brand: dto.brand,
        model: dto.model,
        capacityKwh: dto.capacityKwh.toFixed(2),
        stockStatus: dto.stockStatus,
        voltage:
          typeof dto.voltage === 'number' ? dto.voltage.toFixed(2) : null,
        chemistry: dto.chemistry ?? null,
        cycleLife: dto.cycleLife ?? null,
        warrantyYears: dto.warrantyYears ?? null,
        notes: dto.notes ?? null,
      }),
    );

    return BatteryResponseDto.fromEntity(saved);
  }
}
