import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AdminSettings } from '../runtime-settings/admin-settings.entity';
import type { IEmailProvider } from './providers/email-provider.interface';
import { SmtpProvider } from './providers/smtp.provider';

const logger = new Logger('EmailProviderFactory');

export function createEmailProvider(
  adminSettingsRepo: Repository<AdminSettings>,
): IEmailProvider {
  const raw = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (raw && raw !== 'smtp') {
    throw new Error(
      `Unsupported EMAIL_PROVIDER "${raw}". SMTP is the only supported provider. Set EMAIL_PROVIDER=smtp or leave it unset.`,
    );
  }

  logger.log('Email provider: SMTP');
  return new SmtpProvider(adminSettingsRepo);
}
