import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificationsService } from './notifications.service';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import {
  NotificationResponseDto,
  NotificationsListResponseDto,
  NotificationUnreadCountResponseDto,
} from './dto/notification-response.dto';

type AuthRequest = Request & { user?: { sub?: string } };

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications for the authenticated user',
  })
  @ApiOkResponse({ type: NotificationsListResponseDto })
  findAll(
    @Query() query: GetNotificationsQueryDto,
    @Req() req: AuthRequest,
  ): Promise<NotificationsListResponseDto> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }

    return this.notificationsService.getForUser(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Get unread notification count for the authenticated user',
  })
  @ApiOkResponse({ type: NotificationUnreadCountResponseDto })
  async getUnreadCount(
    @Req() req: AuthRequest,
  ): Promise<NotificationUnreadCountResponseDto> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }

    return {
      unreadCount: await this.notificationsService.getUnreadCount(userId),
    };
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark all unread notifications as read for the authenticated user',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        markedRead: { type: 'number', example: 3 },
      },
    },
  })
  markAllRead(@Req() req: AuthRequest): Promise<{ markedRead: number }> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }

    return this.notificationsService.markAllReadForUser(userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a notification as read for the authenticated user',
  })
  @ApiOkResponse({ type: NotificationResponseDto })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<NotificationResponseDto> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }

    return this.notificationsService.markReadForUser(id, userId);
  }
}
