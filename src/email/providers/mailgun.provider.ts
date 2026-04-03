import { Logger } from '@nestjs/common';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';

/**
 * Mailgun provider.
 *
 * To activate:
 *   1. npm install mailgun.js form-data
 *   2. Set EMAIL_PROVIDER=mailgun, MAILGUN_API_KEY, and MAILGUN_DOMAIN in your .env
 *   3. Replace the stub below with the real SDK call
 */
export class MailgunProvider implements IEmailProvider {
  private readonly logger = new Logger(MailgunProvider.name);

  send(options: EmailOptions): Promise<void> {
    void options;
    // TODO: implement
    // import Mailgun from 'mailgun.js';
    // import FormData from 'form-data';
    // const mg = new Mailgun(FormData).client({ username: 'api', key: process.env.MAILGUN_API_KEY! });
    // await mg.messages.create(process.env.MAILGUN_DOMAIN!, { from, to, subject, html, text });
    this.logger.warn('MailgunProvider is not yet implemented');
    return Promise.resolve();
  }
}
