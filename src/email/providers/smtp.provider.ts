import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Repository } from 'typeorm';
import {
  AdminSettings,
  ADMIN_SETTINGS_SINGLETON_ID,
} from '../../runtime-settings/admin-settings.entity';
import { envBool } from '../../common/env.util';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';

type ResolvedSmtp = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string } | undefined;
  fromAddr: string;
  fromName: string;
};

export class SmtpProvider implements IEmailProvider {
  private readonly logger = new Logger(SmtpProvider.name);
  private transporter: Transporter | null = null;
  private cacheKey: string | null = null;

  readonly capabilities = {
    attachments: true,
  };

  constructor(private readonly adminSettingsRepo: Repository<AdminSettings>) {}

  async isConfigured(): Promise<boolean> {
    const cfg = await this.resolveConfig();
    return cfg !== null;
  }

  private async resolveConfig(): Promise<ResolvedSmtp | null> {
    const row = await this.adminSettingsRepo.findOne({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });

    const host = row?.smtpHost?.trim() || process.env.SMTP_HOST?.trim() || '';
    if (!host) {
      return null;
    }

    const portRaw =
      row?.smtpPort ??
      (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587);
    const port =
      Number.isFinite(portRaw) && portRaw > 0
        ? Math.floor(Number(portRaw))
        : 587;

    let secure: boolean;
    if (row?.smtpSecure === true || row?.smtpSecure === false) {
      secure = row.smtpSecure;
    } else if (process.env.SMTP_SECURE !== undefined) {
      secure = envBool(process.env.SMTP_SECURE, false);
    } else {
      secure = port === 465;
    }

    const user = row?.smtpUser?.trim() || process.env.SMTP_USER?.trim() || '';
    const pass = row?.smtpPass?.trim() || process.env.SMTP_PASS?.trim() || '';

    const fromAddr =
      row?.mailFrom?.trim() ||
      process.env.MAIL_FROM?.trim() ||
      process.env.SMTP_USER?.trim() ||
      'noreply@localhost';
    const fromName =
      row?.mailFromName?.trim() || process.env.MAIL_FROM_NAME?.trim() || '';

    return {
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      fromAddr,
      fromName,
    };
  }

  private async getTransporter(): Promise<Transporter | null> {
    const cfg = await this.resolveConfig();
    if (!cfg) {
      return null;
    }

    const key = [
      cfg.host,
      cfg.port,
      cfg.secure,
      cfg.auth?.user ?? '',
      cfg.auth?.pass ?? '',
    ].join('\u0001');

    if (this.cacheKey !== key) {
      this.transporter = null;
      this.cacheKey = key;
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.auth,
      });
    }

    return this.transporter;
  }

  private async formatFromHeader(): Promise<string> {
    const cfg = await this.resolveConfig();
    if (!cfg) {
      return 'noreply@localhost';
    }
    return cfg.fromName ? `${cfg.fromName} <${cfg.fromAddr}>` : cfg.fromAddr;
  }

  async send(options: EmailOptions): Promise<void> {
    const tx = await this.getTransporter();
    if (!tx) {
      throw new Error('SMTP is not configured');
    }

    const from = await this.formatFromHeader();

    await tx.sendMail({
      from,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      attachments: options.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    });

    const recipient = Array.isArray(options.to)
      ? `${options.to.length} recipient(s)`
      : options.to;
    this.logger.log(
      `Email sent via SMTP to ${recipient}: "${options.subject}"`,
    );
  }
}
