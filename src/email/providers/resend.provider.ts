import { Logger } from '@nestjs/common';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';

/**
 * Resend provider.
 *
 * To activate:
 *   1. npm install resend
 *   2. Set EMAIL_PROVIDER=resend and RESEND_API_KEY in your .env
 *   3. Replace the stub below with the real SDK call
 */
export class ResendProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendProvider.name);

  send(options: EmailOptions): Promise<void> {
    void options;
    // TODO: implement
    // import { Resend } from 'resend';
    // const resend = new Resend(process.env.RESEND_API_KEY);
    // await resend.emails.send({ from, to, subject, html, text });
    this.logger.warn('ResendProvider is not yet implemented');
    return Promise.resolve();
  }
}
