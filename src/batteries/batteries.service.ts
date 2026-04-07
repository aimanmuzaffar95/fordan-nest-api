import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBatteryDto } from './dto/create-battery.dto';
import { BatteryResponseDto } from './dto/battery-response.dto';
import { UpdateBatteryDto } from './dto/update-battery.dto';
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
        defaultUnitPrice: dto.defaultUnitPrice.toFixed(2),
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

  async update(id: string, dto: UpdateBatteryDto): Promise<BatteryResponseDto> {
    const current = await this.batteriesRepo.findOne({ where: { id } });
    if (!current) {
      throw new NotFoundException('Battery not found');
    }

    const brand = dto.brand ?? current.brand;
    const model = dto.model ?? current.model;
    const duplicate = await this.batteriesRepo
      .createQueryBuilder('battery')
      .where('LOWER(battery.brand) = LOWER(:brand)', { brand })
      .andWhere('LOWER(battery.model) = LOWER(:model)', { model })
      .andWhere('battery.id != :id', { id: current.id })
      .getOne();

    if (duplicate) {
      throw new ConflictException(
        'A battery with this brand and model already exists',
      );
    }

    const saved = await this.batteriesRepo.save({
      ...current,
      brand,
      model,
      capacityKwh:
        typeof dto.capacityKwh === 'number'
          ? dto.capacityKwh.toFixed(2)
          : current.capacityKwh,
      defaultUnitPrice:
        typeof dto.defaultUnitPrice === 'number'
          ? dto.defaultUnitPrice.toFixed(2)
          : current.defaultUnitPrice,
      stockStatus: dto.stockStatus ?? current.stockStatus,
      voltage:
        typeof dto.voltage === 'number'
          ? dto.voltage.toFixed(2)
          : dto.voltage === undefined
            ? current.voltage
            : null,
      chemistry:
        dto.chemistry === undefined
          ? current.chemistry
          : (dto.chemistry ?? null),
      cycleLife:
        dto.cycleLife === undefined
          ? current.cycleLife
          : (dto.cycleLife ?? null),
      warrantyYears:
        dto.warrantyYears === undefined
          ? current.warrantyYears
          : (dto.warrantyYears ?? null),
      notes: dto.notes === undefined ? current.notes : (dto.notes ?? null),
    });

    return BatteryResponseDto.fromEntity(saved);
  }
}
