import { Logger } from '@nestjs/common';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';

/**
 * Postmark provider.
 *
 * To activate:
 *   1. npm install postmark
 *   2. Set EMAIL_PROVIDER=postmark and POSTMARK_SERVER_TOKEN in your .env
 *   3. Replace the stub below with the real SDK call
 */
export class PostmarkProvider implements IEmailProvider {
  private readonly logger = new Logger(PostmarkProvider.name);

  async send(_options: EmailOptions): Promise<void> {
    // TODO: implement
    // import { ServerClient } from 'postmark';
    // const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!);
    // await client.sendEmail({ From, To, Subject, HtmlBody, TextBody });
    this.logger.warn('PostmarkProvider is not yet implemented');
  }
}
