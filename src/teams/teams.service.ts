import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamResponseDto } from './dto/team-response.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { Team } from './entities/team.entity';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teamsRepo: Repository<Team>,
  ) {}

  async list(): Promise<{ items: TeamResponseDto[] }> {
    const rows = await this.teamsRepo.find({
      order: { name: 'ASC' },
    });
    return { items: rows.map((t) => TeamResponseDto.fromEntity(t)) };
  }

  async getOne(id: string): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOne({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');
    return TeamResponseDto.fromEntity(team);
  }

  async create(dto: CreateTeamDto): Promise<TeamResponseDto> {
    const dup = await this.teamsRepo.findOne({
      where: { name: dto.name },
    });
    if (dup) {
      throw new ConflictException('Team name already exists');
    }

    const saved = await this.teamsRepo.save(
      this.teamsRepo.create({
        name: dto.name,
        dailyCapacityKw: dto.dailyCapacityKw.toString(),
      }),
    );
    return TeamResponseDto.fromEntity(saved);
  }

  async update(id: string, dto: UpdateTeamDto): Promise<TeamResponseDto> {
    const team = await this.teamsRepo.findOne({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');

    if (dto.name === undefined && dto.dailyCapacityKw === undefined) {
      throw new BadRequestException('No fields to update');
    }

    if (dto.name !== undefined && dto.name !== team.name) {
      const dup = await this.teamsRepo.findOne({ where: { name: dto.name } });
      if (dup) {
        throw new ConflictException('Team name already exists');
      }
      team.name = dto.name;
    }
    if (dto.dailyCapacityKw !== undefined) {
      team.dailyCapacityKw = dto.dailyCapacityKw.toString();
    }

    const saved = await this.teamsRepo.save(team);
    return TeamResponseDto.fromEntity(saved);
  }

  async remove(id: string): Promise<{ id: string }> {
    const team = await this.teamsRepo.findOne({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');
    await this.teamsRepo.remove(team);
    return { id };
  }
}
