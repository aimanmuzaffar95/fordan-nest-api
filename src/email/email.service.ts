import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  EMAIL_PROVIDER,
  type IEmailProvider,
} from './providers/email-provider.interface';
import { renderTemplate, htmlToText } from './templates/template.renderer';
import type { SendEmailDto } from './dto/send-email.dto';
import { EmailTracking } from './email-tracking.entity';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    @InjectRepository(EmailTracking)
    private readonly trackingRepo: Repository<EmailTracking>,
  ) {}

  private getPublicApiBaseUrl(): string | null {
    const base = process.env.PUBLIC_API_BASE_URL?.trim() ?? '';
    if (!base) return null;
    return base.replace(/\/+$/, '');
  }

  private appendOpenPixel(html: string, messageId: string): string {
    const base = this.getPublicApiBaseUrl();
    if (!base) return html;
    const url = `${base}/public/email-open/${messageId}.gif`;
    const pixel = `<img src="${url}" alt="" width="1" height="1" style="display:none !important; width:1px; height:1px;" />`;

    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixel}</body>`);
    }
    return `${html}${pixel}`;
  }

  /** Awaitable send — use when you need to know it succeeded. */
  async send(dto: SendEmailDto): Promise<void> {
    let html = dto.html;

    if (dto.template) {
      html = renderTemplate(dto.template, dto.context ?? {});
    }

    if (dto.attachments && dto.attachments.length > 10) {
      throw new BadRequestException(
        'A maximum of 10 attachments are allowed per email',
      );
    }

    const messageId = randomUUID();
    if (html) {
      html = this.appendOpenPixel(html, messageId);
    }
    const text = dto.text ?? (html ? htmlToText(html) : undefined);

    // Persist tracking row even if SMTP later fails (so we can diagnose delivery attempts).
    try {
      const to = Array.isArray(dto.to) ? dto.to.join(', ') : dto.to;
      await this.trackingRepo.save(
        this.trackingRepo.create({
          messageId,
          to,
          subject: dto.subject,
          sentAt: null,
          firstOpenedAt: null,
          lastOpenedAt: null,
          openCount: 0,
        }),
      );
    } catch {
      // Ignore tracking DB failures — never block email sends.
    }

    if (!(await this.provider.isConfigured())) {
      throw new ServiceUnavailableException({
        message:
          'Email delivery is unavailable because SMTP is not configured. Set host and port under Settings → Mail, or set SMTP_HOST (and related) in the API environment.',
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }

    try {
      await this.provider.send({
        to: dto.to,
        subject: dto.subject,
        html,
        text,
        replyTo: dto.replyTo,
        attachments: dto.attachments,
      });

      try {
        await this.trackingRepo.update({ messageId }, { sentAt: new Date() });
      } catch {
        // ignore
      }
    } catch (error: unknown) {
      const recipient = Array.isArray(dto.to) ? dto.to.join(', ') : dto.to;
      const details =
        error instanceof Error ? (error.stack ?? error.message) : String(error);

      this.logger.error(
        `Email delivery failed via SMTP to ${recipient}: "${dto.subject}"`,
        details,
      );

      throw new ServiceUnavailableException({
        message:
          'Email delivery failed. Check SMTP credentials, sender identity, host, port, and connectivity.',
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }
  }

  /** Fire-and-forget — use when email is secondary to the request. Errors are logged, never thrown. */
  fireAndForget(dto: SendEmailDto): void {
    void this.send(dto).catch((err: unknown) => {
      const recipient = Array.isArray(dto.to) ? dto.to.join(', ') : dto.to;
      this.logger.error(
        `Failed to send email to ${recipient}: "${dto.subject}"`,
        err,
      );
    });
  }

  async recordOpen(messageIdRaw: string): Promise<void> {
    const messageId = messageIdRaw?.trim();
    if (!messageId) return;
    const now = new Date();

    // Only update if it exists (don't create arbitrary rows from the public endpoint).
    const row = await this.trackingRepo.findOne({ where: { messageId } });
    if (!row) return;

    await this.trackingRepo.update(
      { messageId },
      {
        firstOpenedAt: row.firstOpenedAt ?? now,
        lastOpenedAt: now,
        openCount: (row.openCount ?? 0) + 1,
      },
    );
  }

  async getTracking(messageId: string): Promise<EmailTracking | null> {
    const id = messageId?.trim();
    if (!id) return null;
    return this.trackingRepo.findOne({ where: { messageId: id } });
  }

  async listTracking(limit = 50): Promise<EmailTracking[]> {
    const safeLimit =
      Number.isFinite(limit) && limit > 0 && limit <= 200 ? limit : 50;
    return this.trackingRepo.find({
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });
  }
}
