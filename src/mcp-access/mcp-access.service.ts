import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { McpAccessKey } from './entities/mcp-access-key.entity';
import { CreateMcpAccessKeyDto } from './dto/create-mcp-access-key.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';

const KEY_PREFIX = 'fcrm_mcp_';

export type McpAccessKeyView = {
  id: string;
  name: string;
  displayHint: string;
  boundUserId: string;
  boundUserName: string;
  boundUserRole: UserRole | null;
  allowWrites: boolean;
  active: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type McpKeyPrincipal = {
  keyId: string;
  user: User;
  allowWrites: boolean;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class McpAccessService {
  constructor(
    @InjectRepository(McpAccessKey)
    private readonly keysRepo: Repository<McpAccessKey>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async create(
    dto: CreateMcpAccessKeyDto,
    actorUserId: string,
  ): Promise<{ plaintextKey: string; key: McpAccessKeyView }> {
    const boundUser = await this.usersRepo.findOne({
      where: { id: dto.boundUserId, deletedAt: IsNull() },
    });
    if (!boundUser) {
      throw new BadRequestException('Bound user not found');
    }
    if (boundUser.active === false) {
      throw new BadRequestException('Bound user is inactive');
    }

    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      const parsed = new Date(dto.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('expiresAt is not a valid date');
      }
      if (parsed.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      expiresAt = parsed;
    }

    // 48 hex chars of entropy — the plaintext is returned once and never stored.
    const secret = randomBytes(24).toString('hex');
    const plaintextKey = `${KEY_PREFIX}${secret}`;
    const displayHint = `${KEY_PREFIX}${secret.slice(0, 6)}…${secret.slice(-4)}`;

    const saved = await this.keysRepo.save(
      this.keysRepo.create({
        name: dto.name.trim(),
        tokenHash: sha256(plaintextKey),
        displayHint,
        boundUserId: boundUser.id,
        allowWrites: dto.allowWrites === true,
        active: true,
        expiresAt,
        createdByUserId: actorUserId,
      }),
    );

    return {
      plaintextKey,
      key: this.toView(saved, boundUser),
    };
  }

  async list(): Promise<{ items: McpAccessKeyView[] }> {
    const keys = await this.keysRepo.find({ order: { createdAt: 'DESC' } });
    const userIds = [...new Set(keys.map((k) => k.boundUserId))];
    const users = userIds.length
      ? await this.usersRepo.find({ where: { id: In(userIds) } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: keys.map((k) => this.toView(k, byId.get(k.boundUserId) ?? null)),
    };
  }

  async revoke(id: string, actorUserId: string): Promise<McpAccessKeyView> {
    const key = await this.keysRepo.findOne({ where: { id } });
    if (!key) {
      throw new NotFoundException('MCP access key not found');
    }
    if (key.active) {
      key.active = false;
      key.revokedAt = new Date();
      key.revokedByUserId = actorUserId;
      await this.keysRepo.save(key);
    }
    const boundUser = await this.usersRepo.findOne({
      where: { id: key.boundUserId },
    });
    return this.toView(key, boundUser);
  }

  /**
   * Validate a presented raw key and resolve its principal. Throws (never
   * returns null) on any failure so callers surface a clean 401. Bumps
   * lastUsedAt on success.
   */
  async authenticate(rawKey: string): Promise<McpKeyPrincipal> {
    if (typeof rawKey !== 'string' || !rawKey.startsWith(KEY_PREFIX)) {
      throw new BadRequestException('Invalid MCP key');
    }
    const key = await this.keysRepo.findOne({
      where: { tokenHash: sha256(rawKey) },
    });
    if (!key || !key.active) {
      throw new BadRequestException('Invalid or revoked MCP key');
    }
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('MCP key has expired');
    }
    const user = await this.usersRepo.findOne({
      where: { id: key.boundUserId, deletedAt: IsNull() },
    });
    if (!user || user.active === false) {
      throw new BadRequestException('MCP key bound account is unavailable');
    }

    key.lastUsedAt = new Date();
    await this.keysRepo.save(key);

    return { keyId: key.id, user, allowWrites: key.allowWrites };
  }

  private toView(key: McpAccessKey, boundUser: User | null): McpAccessKeyView {
    return {
      id: key.id,
      name: key.name,
      displayHint: key.displayHint,
      boundUserId: key.boundUserId,
      boundUserName: boundUser
        ? `${boundUser.firstName ?? ''} ${boundUser.lastName ?? ''}`.trim() ||
          '(unknown)'
        : '(deleted user)',
      boundUserRole: boundUser ? boundUser.role : null,
      allowWrites: key.allowWrites,
      active: key.active,
      expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
      lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
      createdAt:
        key.createdAt instanceof Date
          ? key.createdAt.toISOString()
          : String(key.createdAt),
      revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
    };
  }
}
