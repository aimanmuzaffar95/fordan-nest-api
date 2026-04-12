import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EMAIL_PROVIDER,
  type IEmailProvider,
} from './providers/email-provider.interface';
import { renderTemplate, htmlToText } from './templates/template.renderer';
import type { SendEmailDto } from './dto/send-email.dto';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
  ) {}

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

    const text = dto.text ?? (html ? htmlToText(html) : undefined);

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
}
