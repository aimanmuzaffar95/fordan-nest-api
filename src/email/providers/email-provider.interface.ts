import type { EmailOptions } from '../types/email-options.type';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface IEmailProvider {
  send(options: EmailOptions): Promise<void>;
}
