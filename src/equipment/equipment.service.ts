import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateEquipmentItemDto } from './dto/create-equipment-item.dto';
import { UpdateEquipmentItemDto } from './dto/update-equipment-item.dto';
import { EquipmentItem } from './entities/equipment-item.entity';

type EquipmentResponse = {
  id: string;
  name: string;
  category: string;
  sku: string;
  stock: number;
  unit: string;
  low: boolean;
};

@Injectable()
export class EquipmentService {
  constructor(
    @InjectRepository(EquipmentItem)
    private readonly repo: Repository<EquipmentItem>,
  ) {}

  async findAll(category?: string): Promise<{ items: EquipmentResponse[] }> {
    const rows = await this.repo.find({
      where: category ? { category } : {},
      order: { name: 'ASC' },
    });
    return { items: rows.map((r) => this.toResponse(r)) };
  }

  async findOne(id: string): Promise<EquipmentResponse> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Equipment item not found');
    return this.toResponse(row);
  }

  async create(dto: CreateEquipmentItemDto): Promise<EquipmentResponse> {
    const saved = await this.repo.save(
      this.repo.create({
        name: dto.name,
        category: dto.category,
        sku: dto.sku,
        stock: dto.stock ?? 0,
        unit: dto.unit ?? 'unit',
        lowStockThreshold: dto.lowStockThreshold ?? 5,
      }),
    );
    return this.toResponse(saved);
  }

  async update(
    id: string,
    dto: UpdateEquipmentItemDto,
  ): Promise<EquipmentResponse> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Equipment item not found');
    Object.assign(row, dto);
    const saved = await this.repo.save(row);
    return this.toResponse(saved);
  }

  private toResponse(row: EquipmentItem): EquipmentResponse {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      sku: row.sku,
      stock: row.stock,
      unit: row.unit,
      low: row.stock <= row.lowStockThreshold,
    };
  }
}
