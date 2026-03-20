import { Team } from '../entities/team.entity';

export class TeamResponseDto {
  id: string;
  name: string;
  dailyCapacityKw: number;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: Team): TeamResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      dailyCapacityKw: Number(entity.dailyCapacityKw),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
