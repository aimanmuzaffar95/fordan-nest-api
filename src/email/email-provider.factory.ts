import { Logger } from '@nestjs/common';
import type { IEmailProvider } from './providers/email-provider.interface';
import { SmtpProvider } from './providers/smtp.provider';
import { SendGridProvider } from './providers/sendgrid.provider';
import { ResendProvider } from './providers/resend.provider';
import { SesProvider } from './providers/ses.provider';
import { MailgunProvider } from './providers/mailgun.provider';
import { PostmarkProvider } from './providers/postmark.provider';

type EmailProviderName =
  | 'smtp'
  | 'sendgrid'
  | 'resend'
  | 'ses'
  | 'mailgun'
  | 'postmark';

const logger = new Logger('EmailProviderFactory');

export function createEmailProvider(): IEmailProvider {
  const raw = process.env.EMAIL_PROVIDER?.trim().toLowerCase() ?? 'smtp';
  const name = raw as EmailProviderName;

  switch (name) {
    case 'sendgrid':
      logger.log('Email provider: SendGrid');
      return new SendGridProvider();
    case 'resend':
      logger.log('Email provider: Resend');
      return new ResendProvider();
    case 'ses':
      logger.log('Email provider: AWS SES');
      return new SesProvider();
    case 'mailgun':
      logger.log('Email provider: Mailgun');
      return new MailgunProvider();
    case 'postmark':
      logger.log('Email provider: Postmark');
      return new PostmarkProvider();
    case 'smtp':
    default:
      if (name !== 'smtp') {
        logger.warn(`Unknown EMAIL_PROVIDER "${raw}", falling back to SMTP`);
      } else {
        logger.log('Email provider: SMTP');
      }
      return new SmtpProvider();
  }
}
