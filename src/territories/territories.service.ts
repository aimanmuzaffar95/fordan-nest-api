import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { TerritoryMember } from './entities/territory-member.entity';
import { RoutingStrategy, Territory } from './entities/territory.entity';
import {
  CreateTerritoryDto,
  TerritoryMemberDto,
  UpdateTerritoryDto,
} from './dto/territory.dto';

export type TerritoryResponse = {
  id: string;
  name: string;
  description: string | null;
  postcodes: string[];
  regions: string[];
  routingStrategy: RoutingStrategy;
  ownerUserId: string | null;
  reassignAfterHours: number | null;
  priority: number;
  active: boolean;
  members: Array<{
    userId: string;
    userName: string | null;
    weight: number;
    active: boolean;
    assignedCount: number;
    lastAssignedAt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class TerritoriesService {
  constructor(
    @InjectRepository(Territory)
    private readonly territoryRepo: Repository<Territory>,
    @InjectRepository(TerritoryMember)
    private readonly memberRepo: Repository<TerritoryMember>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly settings: RuntimeSettingsService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'territoryRouting', role)) {
      throw new ForbiddenException(
        'Territory routing is not enabled for your role',
      );
    }
  }

  async list(role: UserRole): Promise<TerritoryResponse[]> {
    await this.assertEnabled(role);
    const territories = await this.territoryRepo.find({
      order: { priority: 'ASC', name: 'ASC' },
    });
    if (territories.length === 0) return [];
    return Promise.all(territories.map((t) => this.toResponse(t)));
  }

  async findOne(id: string, role: UserRole): Promise<TerritoryResponse> {
    await this.assertEnabled(role);
    const territory = await this.territoryRepo.findOne({ where: { id } });
    if (!territory) throw new NotFoundException(`Territory ${id} not found`);
    return this.toResponse(territory);
  }

  async create(
    dto: CreateTerritoryDto,
    role: UserRole,
  ): Promise<TerritoryResponse> {
    await this.assertEnabled(role);
    await this.assertOwnerValid(dto);

    const territory = await this.territoryRepo.save(
      this.territoryRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        postcodes: dto.postcodes ?? [],
        regions: dto.regions ?? [],
        routingStrategy: dto.routingStrategy ?? RoutingStrategy.ROUND_ROBIN,
        ownerUserId: dto.ownerUserId ?? null,
        reassignAfterHours: dto.reassignAfterHours ?? null,
        priority: dto.priority ?? 100,
        active: dto.active ?? true,
        rotationCursor: 0,
      }),
    );

    if (dto.members?.length) {
      await this.replaceMembers(territory.id, dto.members);
    }
    return this.toResponse(territory);
  }

  async update(
    id: string,
    dto: UpdateTerritoryDto,
    role: UserRole,
  ): Promise<TerritoryResponse> {
    await this.assertEnabled(role);
    const territory = await this.territoryRepo.findOne({ where: { id } });
    if (!territory) throw new NotFoundException(`Territory ${id} not found`);
    await this.assertOwnerValid(dto);

    if (dto.name !== undefined) territory.name = dto.name;
    if (dto.description !== undefined) territory.description = dto.description;
    if (dto.postcodes !== undefined) territory.postcodes = dto.postcodes;
    if (dto.regions !== undefined) territory.regions = dto.regions;
    if (dto.routingStrategy !== undefined) {
      territory.routingStrategy = dto.routingStrategy;
    }
    if (dto.ownerUserId !== undefined) territory.ownerUserId = dto.ownerUserId;
    if (dto.reassignAfterHours !== undefined) {
      territory.reassignAfterHours = dto.reassignAfterHours;
    }
    if (dto.priority !== undefined) territory.priority = dto.priority;
    if (dto.active !== undefined) territory.active = dto.active;

    const saved = await this.territoryRepo.save(territory);
    if (dto.members !== undefined) {
      await this.replaceMembers(id, dto.members);
    }
    return this.toResponse(saved);
  }

  async remove(id: string, role: UserRole): Promise<{ deleted: true }> {
    await this.assertEnabled(role);
    const territory = await this.territoryRepo.findOne({ where: { id } });
    if (!territory) throw new NotFoundException(`Territory ${id} not found`);
    // Soft delete: routing events reference the territory by id and must stay
    // readable after it's retired.
    await this.territoryRepo.softDelete({ id });
    return { deleted: true };
  }

  /**
   * Replace the member list wholesale. Members carry rotation counters, so an
   * unchanged member keeps its `assignedCount` — otherwise every edit would
   * silently reset the weighted strategy's fairness baseline.
   */
  private async replaceMembers(
    territoryId: string,
    members: TerritoryMemberDto[],
  ): Promise<void> {
    const userIds = members.map((m) => m.userId);
    if (new Set(userIds).size !== userIds.length) {
      throw new BadRequestException(
        'A user may appear only once per territory',
      );
    }
    if (userIds.length > 0) {
      const found = await this.userRepo.find({
        where: { id: In(userIds), active: true },
        select: { id: true },
      });
      if (found.length !== userIds.length) {
        throw new BadRequestException(
          'One or more territory members are not active users',
        );
      }
    }

    const existing = await this.memberRepo.find({ where: { territoryId } });
    const byUserId = new Map(existing.map((m) => [m.userId, m]));

    const keepIds = new Set<string>();
    for (const member of members) {
      const current = byUserId.get(member.userId);
      if (current) {
        current.weight = member.weight ?? current.weight;
        current.active = member.active ?? current.active;
        await this.memberRepo.save(current);
        keepIds.add(current.id);
      } else {
        const created = await this.memberRepo.save(
          this.memberRepo.create({
            territoryId,
            userId: member.userId,
            weight: member.weight ?? 1,
            active: member.active ?? true,
            assignedCount: 0,
          }),
        );
        keepIds.add(created.id);
      }
    }

    const toDelete = existing.filter((m) => !keepIds.has(m.id));
    if (toDelete.length > 0) {
      await this.memberRepo.delete({ id: In(toDelete.map((m) => m.id)) });
    }
  }

  private async assertOwnerValid(
    dto: CreateTerritoryDto | UpdateTerritoryDto,
  ): Promise<void> {
    if (
      dto.routingStrategy === RoutingStrategy.OWNER_ONLY &&
      !dto.ownerUserId
    ) {
      throw new BadRequestException(
        'ownerUserId is required when routingStrategy is owner_only',
      );
    }
    if (dto.ownerUserId) {
      const owner = await this.userRepo.findOne({
        where: { id: dto.ownerUserId, active: true },
        select: { id: true },
      });
      if (!owner) {
        throw new BadRequestException('ownerUserId is not an active user');
      }
    }
  }

  private async toResponse(territory: Territory): Promise<TerritoryResponse> {
    const members = await this.memberRepo.find({
      where: { territoryId: territory.id },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    return {
      id: territory.id,
      name: territory.name,
      description: territory.description,
      postcodes: territory.postcodes ?? [],
      regions: territory.regions ?? [],
      routingStrategy: territory.routingStrategy,
      ownerUserId: territory.ownerUserId,
      reassignAfterHours: territory.reassignAfterHours,
      priority: territory.priority,
      active: territory.active,
      members: members.map((m) => ({
        userId: m.userId,
        userName: m.user
          ? `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || null
          : null,
        weight: m.weight,
        active: m.active,
        assignedCount: m.assignedCount,
        lastAssignedAt: m.lastAssignedAt
          ? m.lastAssignedAt.toISOString()
          : null,
      })),
      createdAt: territory.createdAt.toISOString(),
      updatedAt: territory.updatedAt.toISOString(),
    };
  }
}
