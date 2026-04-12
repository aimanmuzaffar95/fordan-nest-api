import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';
import {
  RuntimeSettingsService,
  type RuntimeSmtpConfig,
} from '../../runtime-settings/runtime-settings.service';

type SmtpConfigSnapshot = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailFrom: string;
  mailFromName: string;
};

@Injectable()
export class SmtpProvider implements IEmailProvider {
  private readonly logger = new Logger(SmtpProvider.name);
  private transporter: Transporter | null = null;
  private configSnapshot: SmtpConfigSnapshot | null = null;

  constructor(
    private readonly runtimeSettingsService: RuntimeSettingsService,
  ) {}

  async isConfigured(): Promise<boolean> {
    const config = await this.runtimeSettingsService.getSmtpConfig();
    return config.configured;
  }

  private async getTransporter(): Promise<Transporter | null> {
    const config = await this.runtimeSettingsService.getSmtpConfig();
    if (!config.configured) {
      this.transporter = null;
      this.configSnapshot = null;
      return null;
    }

    const nextSnapshot = this.toSnapshot(config);

    if (
      this.transporter &&
      this.configSnapshot &&
      this.isSameSnapshot(this.configSnapshot, nextSnapshot)
    ) {
      return this.transporter;
    }

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    this.configSnapshot = nextSnapshot;

    return this.transporter;
  }

  async send(options: EmailOptions): Promise<void> {
    const config = await this.runtimeSettingsService.getSmtpConfig();
    const tx = await this.getTransporter();
    if (!tx) {
      throw new Error('SMTP is not configured');
    }

    await tx.sendMail({
      from: `${config.mailFromName} <${config.mailFrom}>`,
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

  private toSnapshot(config: Extract<RuntimeSmtpConfig, { configured: true }>) {
    return {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      pass: config.pass,
      mailFrom: config.mailFrom,
      mailFromName: config.mailFromName,
    };
  }

  private isSameSnapshot(
    current: SmtpConfigSnapshot,
    next: SmtpConfigSnapshot,
  ): boolean {
    return (
      current.host === next.host &&
      current.port === next.port &&
      current.secure === next.secure &&
      current.user === next.user &&
      current.pass === next.pass &&
      current.mailFrom === next.mailFrom &&
      current.mailFromName === next.mailFromName
    );
  }
}
