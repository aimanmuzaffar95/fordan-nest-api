import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateInverterDto } from './dto/create-inverter.dto';
import { InverterResponseDto } from './dto/inverter-response.dto';
import { UpdateInverterDto } from './dto/update-inverter.dto';
import { Inverter } from './entities/inverter.entity';

@Injectable()
export class InvertersService {
  constructor(
    @InjectRepository(Inverter)
    private readonly invertersRepo: Repository<Inverter>,
  ) {}

  async list(): Promise<{ items: InverterResponseDto[] }> {
    const rows = await this.invertersRepo.find({
      order: { createdAt: 'DESC', brand: 'ASC', model: 'ASC' },
    });

    return {
      items: rows.map((inverter) => InverterResponseDto.fromEntity(inverter)),
    };
  }

  async create(dto: CreateInverterDto): Promise<InverterResponseDto> {
    const duplicate = await this.invertersRepo
      .createQueryBuilder('inverter')
      .where('LOWER(inverter.brand) = LOWER(:brand)', { brand: dto.brand })
      .andWhere('LOWER(inverter.model) = LOWER(:model)', { model: dto.model })
      .getOne();

    if (duplicate) {
      throw new ConflictException(
        'An inverter with this brand and model already exists',
      );
    }

    const saved = await this.invertersRepo.save(
      this.invertersRepo.create({
        brand: dto.brand,
        model: dto.model,
        capacityKw: dto.capacityKw.toFixed(2),
        defaultUnitPrice: dto.defaultUnitPrice.toFixed(2),
        stockStatus: dto.stockStatus,
        inverterType: dto.inverterType ?? null,
        phases: dto.phases ?? null,
        efficiency:
          typeof dto.efficiency === 'number' ? dto.efficiency.toFixed(2) : null,
        warrantyYears: dto.warrantyYears ?? null,
        notes: dto.notes ?? null,
      }),
    );

    return InverterResponseDto.fromEntity(saved);
  }

  async update(
    id: string,
    dto: UpdateInverterDto,
  ): Promise<InverterResponseDto> {
    const current = await this.invertersRepo.findOne({ where: { id } });
    if (!current) {
      throw new NotFoundException('Inverter not found');
    }

    const brand = dto.brand ?? current.brand;
    const model = dto.model ?? current.model;
    const duplicate = await this.invertersRepo
      .createQueryBuilder('inverter')
      .where('LOWER(inverter.brand) = LOWER(:brand)', { brand })
      .andWhere('LOWER(inverter.model) = LOWER(:model)', { model })
      .andWhere('inverter.id != :id', { id: current.id })
      .getOne();

    if (duplicate) {
      throw new ConflictException(
        'An inverter with this brand and model already exists',
      );
    }

    const saved = await this.invertersRepo.save({
      ...current,
      brand,
      model,
      capacityKw:
        typeof dto.capacityKw === 'number'
          ? dto.capacityKw.toFixed(2)
          : current.capacityKw,
      defaultUnitPrice:
        typeof dto.defaultUnitPrice === 'number'
          ? dto.defaultUnitPrice.toFixed(2)
          : current.defaultUnitPrice,
      stockStatus: dto.stockStatus ?? current.stockStatus,
      inverterType:
        dto.inverterType === undefined
          ? current.inverterType
          : (dto.inverterType ?? null),
      phases: dto.phases === undefined ? current.phases : (dto.phases ?? null),
      efficiency:
        typeof dto.efficiency === 'number'
          ? dto.efficiency.toFixed(2)
          : dto.efficiency === undefined
            ? current.efficiency
            : null,
      warrantyYears:
        dto.warrantyYears === undefined
          ? current.warrantyYears
          : (dto.warrantyYears ?? null),
      notes: dto.notes === undefined ? current.notes : (dto.notes ?? null),
    });

    return InverterResponseDto.fromEntity(saved);
  }
}
