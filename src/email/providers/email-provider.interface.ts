import type { EmailOptions } from '../types/email-options.type';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface IEmailProvider {
  isConfigured(): Promise<boolean>;
  send(options: EmailOptions): Promise<void>;
}
