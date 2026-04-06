import { Logger } from '@nestjs/common';
import type { IEmailProvider } from './email-provider.interface';
import type { EmailOptions } from '../types/email-options.type';

/**
 * AWS SES provider.
 *
 * To activate:
 *   1. npm install @aws-sdk/client-ses  (note: @aws-sdk/client-s3 is already installed)
 *   2. Set EMAIL_PROVIDER=ses and AWS_SES_REGION in your .env
 *      AWS credentials are read from env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
 *      or from the EC2 instance role automatically.
 *   3. Replace the stub below with the real SDK call
 */
export class SesProvider implements IEmailProvider {
  private readonly logger = new Logger(SesProvider.name);
  readonly capabilities = {
    implemented: false,
    configured: Boolean(process.env.AWS_SES_REGION?.trim()),
    attachments: false,
  };

  send(options: EmailOptions): Promise<void> {
    void options;
    // TODO: implement
    // import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
    // const client = new SESClient({ region: process.env.AWS_SES_REGION });
    // await client.send(new SendEmailCommand({ ... }));
    this.logger.warn('SesProvider is not yet implemented');
    return Promise.resolve();
  }
}
