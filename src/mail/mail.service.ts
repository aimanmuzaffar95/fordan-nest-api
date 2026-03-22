import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const envBool = (v: string | undefined, fallback = false): boolean => {
  if (v === undefined) return fallback;
  const s = v.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
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
      auth:
        user && pass
          ? {
              user,
              pass,
            }
          : undefined,
    });
    return this.transporter;
  }

  private getFromAddress(): string | null {
    const from = process.env.MAIL_FROM?.trim();
    if (from) return from;
    const user = process.env.SMTP_USER?.trim();
    return user || null;
  }

  private getFromHeader(): string {
    const addr = this.getFromAddress() ?? 'noreply@localhost';
    const name = process.env.MAIL_FROM_NAME?.trim();
    return name ? `${name} <${addr}>` : addr;
  }

  private parseNotifyList(): string[] {
    const raw = process.env.LEAD_NOTIFY_EMAILS?.trim();
    if (!raw) return [];
    return raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  async sendPublicLeadInternal(params: {
    notifyEmails: string[];
    subject: string;
    text: string;
  }): Promise<void> {
    const tx = this.getTransporter();
    const from = this.getFromHeader();
    if (!tx || !params.notifyEmails.length) {
      if (!tx && params.notifyEmails.length) {
        this.logger.warn(
          'LEAD_NOTIFY_EMAILS set but SMTP_HOST missing — skipping internal lead email',
        );
      }
      return;
    }
    await tx.sendMail({
      from,
      to: params.notifyEmails.join(', '),
      subject: params.subject,
      text: params.text,
    });
    this.logger.log(
      `Internal lead notification sent to ${params.notifyEmails.length} recipient(s)`,
    );
  }

  async sendPublicLeadConfirmation(params: {
    to: string;
    firstName: string;
  }): Promise<void> {
    const tx = this.getTransporter();
    if (!tx) {
      this.logger.warn('Confirmation email skipped — SMTP not configured');
      return;
    }
    const from = this.getFromHeader();
    const subject =
      process.env.PUBLIC_LEAD_CONFIRMATION_SUBJECT?.trim() ||
      'We received your enquiry';
    const rawBody =
      process.env.PUBLIC_LEAD_CONFIRMATION_BODY?.trim() ||
      `Hi ${params.firstName},\n\nThanks for contacting us. A member of our team will be in touch soon.\n\n— Fordan Solar`;
    const text = rawBody.replace(/\{firstName\}/g, params.firstName);
    await tx.sendMail({
      from,
      to: params.to,
      subject,
      text,
    });
    this.logger.log(`Lead confirmation email sent to ${params.to}`);
  }

  /** Fire-and-forget after public lead create; never throws to caller. */
  notifyPublicLeadCreated(payload: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    suburb?: string;
    postcode?: string;
    systemIntent: string;
    customerId: string;
    jobId: string;
  }): void {
    const notify = this.parseNotifyList();
    const lines = [
      'New lead from public web form',
      '',
      `Name: ${payload.firstName} ${payload.lastName}`,
      `Email: ${payload.email}`,
      `Phone: ${payload.phone}`,
      `Suburb: ${payload.suburb ?? '—'}`,
      `Postcode: ${payload.postcode ?? '—'}`,
      `Interest: ${payload.systemIntent}`,
      '',
      `Customer ID: ${payload.customerId}`,
      `Job ID: ${payload.jobId}`,
    ];
    const text = lines.join('\n');

    void this.sendPublicLeadInternal({
      notifyEmails: notify,
      subject: `New web lead: ${payload.firstName} ${payload.lastName}`,
      text,
    }).catch((err: unknown) => {
      this.logger.error('Internal lead email failed', err);
    });

    if (envBool(process.env.PUBLIC_LEAD_SEND_CONFIRMATION_EMAIL, false)) {
      void this.sendPublicLeadConfirmation({
        to: payload.email,
        firstName: payload.firstName,
      }).catch((err: unknown) => {
        this.logger.error('Lead confirmation email failed', err);
      });
    }
  }
}
