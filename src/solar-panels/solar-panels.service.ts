import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSolarPanelDto } from './dto/create-solar-panel.dto';
import { SolarPanelResponseDto } from './dto/solar-panel-response.dto';
import { SolarPanel } from './entities/solar-panel.entity';

@Injectable()
export class SolarPanelsService {
  constructor(
    @InjectRepository(SolarPanel)
    private readonly solarPanelsRepo: Repository<SolarPanel>,
  ) {}

  async list(): Promise<{ items: SolarPanelResponseDto[] }> {
    const rows = await this.solarPanelsRepo.find({
      order: { createdAt: 'DESC', brand: 'ASC', model: 'ASC' },
    });

    return {
      items: rows.map((panel) => SolarPanelResponseDto.fromEntity(panel)),
    };
  }

  async create(dto: CreateSolarPanelDto): Promise<SolarPanelResponseDto> {
    const duplicate = await this.solarPanelsRepo
      .createQueryBuilder('panel')
      .where('LOWER(panel.brand) = LOWER(:brand)', { brand: dto.brand })
      .andWhere('LOWER(panel.model) = LOWER(:model)', { model: dto.model })
      .getOne();

    if (duplicate) {
      throw new ConflictException(
        'A solar panel with this brand and model already exists',
      );
    }

    const saved = await this.solarPanelsRepo.save(
      this.solarPanelsRepo.create({
        brand: dto.brand,
        model: dto.model,
        wattage: dto.wattage.toFixed(2),
        stockStatus: dto.stockStatus,
        efficiency:
          typeof dto.efficiency === 'number' ? dto.efficiency.toFixed(2) : null,
        dimensions: dto.dimensions ?? null,
        weightKg:
          typeof dto.weightKg === 'number' ? dto.weightKg.toFixed(2) : null,
        warrantyYears: dto.warrantyYears ?? null,
        notes: dto.notes ?? null,
      }),
    );

    return SolarPanelResponseDto.fromEntity(saved);
  }
}
