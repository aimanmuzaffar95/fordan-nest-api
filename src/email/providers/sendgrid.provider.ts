import { Logger } from '@nestjs/common';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';

/**
 * SendGrid provider.
 *
 * To activate:
 *   1. npm install @sendgrid/mail
 *   2. Set EMAIL_PROVIDER=sendgrid and SENDGRID_API_KEY in your .env
 *   3. Replace the stub below with the real SDK call
 */
export class SendGridProvider implements IEmailProvider {
  private readonly logger = new Logger(SendGridProvider.name);

  async send(_options: EmailOptions): Promise<void> {
    // TODO: implement
    // import sgMail from '@sendgrid/mail';
    // sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
    // await sgMail.send({ to, from, subject, html, text });
    this.logger.warn('SendGridProvider is not yet implemented');
  }
}
