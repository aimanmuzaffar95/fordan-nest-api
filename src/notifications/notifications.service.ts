import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import {
  NotificationResponseDto,
  NotificationsListResponseDto,
} from './dto/notification-response.dto';

export type NotificationPayload = {
  type: string;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
};

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toResponseDto(notification: Notification): NotificationResponseDto {
  const metadata =
    notification.metadata &&
    typeof notification.metadata === 'object' &&
    !Array.isArray(notification.metadata)
      ? { ...notification.metadata }
      : notification.metadata;

  if (metadata && typeof metadata === 'object' && 'dedupeKey' in metadata) {
    delete metadata['dedupeKey'];
  }

  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body ?? null,
    metadata: metadata ?? null,
    readAt: toIsoString(notification.readAt),
    createdAt: notification.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepo: Repository<Notification>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async sendToUser(
    userId: string,
    payload: NotificationPayload,
  ): Promise<Notification | null> {
    const normalizedPayload = this.normalizePayload(payload);
    if (normalizedPayload.dedupeKey) {
      const duplicate = await this.findUnreadDuplicate(
        userId,
        normalizedPayload.type,
        normalizedPayload.dedupeKey,
      );
      if (duplicate) {
        return duplicate;
      }
    }

    const notification = this.notificationsRepo.create({
      userId,
      type: normalizedPayload.type,
      title: normalizedPayload.title,
      body: normalizedPayload.body,
      metadata: normalizedPayload.metadata,
      readAt: null,
    });

    return this.notificationsRepo.save(notification);
  }

  async sendToUsers(
    userIds: string[],
    payload: NotificationPayload,
  ): Promise<Notification[]> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return [];
    }

    const notifications = await Promise.all(
      uniqueUserIds.map((userId) => this.sendToUser(userId, payload)),
    );

    return notifications.filter(
      (notification): notification is Notification => notification !== null,
    );
  }

  async sendToRole(
    role: UserRole,
    payload: NotificationPayload,
    options?: { excludeUserIds?: string[] },
  ): Promise<Notification[]> {
    const excludedIds = new Set(options?.excludeUserIds ?? []);
    const users = await this.usersRepo.find({
      where: {
        role,
        active: true,
        deletedAt: IsNull(),
      },
      select: ['id'],
    });

    return this.sendToUsers(
      users.map((user) => user.id).filter((userId) => !excludedIds.has(userId)),
      payload,
    );
  }

  async getForUser(
    userId: string,
    query: GetNotificationsQueryDto,
  ): Promise<NotificationsListResponseDto> {
    const status = query.unread ? 'unread' : (query.status ?? 'all');
    const limit = query.limit ?? 10;

    const where =
      status === 'unread' ? { userId, readAt: IsNull() } : { userId };

    const [items, total] = await this.notificationsRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return {
      items: items.map(toResponseDto),
      total,
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationsRepo.count({
      where: { userId, readAt: IsNull() },
    });
  }

  async markAllReadForUser(userId: string): Promise<{ markedRead: number }> {
    const unreadNotifications = await this.notificationsRepo.find({
      where: { userId, readAt: IsNull() },
      select: ['id'],
    });

    if (unreadNotifications.length === 0) {
      return { markedRead: 0 };
    }

    await this.notificationsRepo.update(
      { id: In(unreadNotifications.map((notification) => notification.id)) },
      { readAt: new Date() },
    );

    return { markedRead: unreadNotifications.length };
  }

  async markReadForUser(
    notificationId: string,
    userId: string,
  ): Promise<NotificationResponseDto> {
    const notification = await this.notificationsRepo.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.readAt === null) {
      notification.readAt = new Date();
      await this.notificationsRepo.save(notification);
    }

    return toResponseDto(notification);
  }

  private normalizePayload(payload: NotificationPayload) {
    const metadata = payload.metadata ? { ...payload.metadata } : null;
    const dedupeKey = payload.dedupeKey?.trim() || null;
    if (dedupeKey) {
      const nextMetadata = metadata ?? {};
      nextMetadata['dedupeKey'] = dedupeKey;
      return {
        ...payload,
        body: payload.body ?? null,
        metadata: nextMetadata,
        dedupeKey,
      };
    }

    return {
      ...payload,
      body: payload.body ?? null,
      metadata,
      dedupeKey: null,
    };
  }

  private async findUnreadDuplicate(
    userId: string,
    type: string,
    dedupeKey: string,
  ): Promise<Notification | null> {
    const candidates = await this.notificationsRepo.find({
      where: {
        userId,
        type,
        readAt: IsNull(),
        metadata: Not(IsNull()),
      },
      order: { createdAt: 'DESC' },
      take: 25,
    });

    return (
      candidates.find((notification) => {
        const metadata = notification.metadata;
        if (!metadata || typeof metadata !== 'object') {
          return false;
        }

        return metadata['dedupeKey'] === dedupeKey;
      }) ?? null
    );
  }
}
