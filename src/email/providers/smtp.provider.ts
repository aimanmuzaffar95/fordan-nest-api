import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';
import { envBool } from '../../common/env.util';

export class SmtpProvider implements IEmailProvider {
  private readonly logger = new Logger(SmtpProvider.name);
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter | null {
    const host = process.env.SMTP_HOST?.trim();
    if (!host) return null;
    if (this.transporter) return this.transporter;

    const port = Number(process.env.SMTP_PORT ?? '587');
    const secure = envBool(process.env.SMTP_SECURE, port === 465);
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    return this.transporter;
  }

  private getFromHeader(): string {
    const addr =
      process.env.MAIL_FROM?.trim() ??
      process.env.SMTP_USER?.trim() ??
      'noreply@localhost';
    const name = process.env.MAIL_FROM_NAME?.trim();
    return name ? `${name} <${addr}>` : addr;
  }

  async send(options: EmailOptions): Promise<void> {
    const tx = this.getTransporter();
    if (!tx) {
      this.logger.warn('SMTP not configured — email skipped');
      return;
    }

    await tx.sendMail({
      from: this.getFromHeader(),
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    const recipient = Array.isArray(options.to)
      ? `${options.to.length} recipient(s)`
      : options.to;
    this.logger.log(
      `Email sent via SMTP to ${recipient}: "${options.subject}"`,
    );
  }
}
