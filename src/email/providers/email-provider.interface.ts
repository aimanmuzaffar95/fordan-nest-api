import type { EmailProviderCapabilities } from './email-provider-capabilities.type';
import type { EmailOptions } from '../types/email-options.type';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface IEmailProvider {
  readonly capabilities: EmailProviderCapabilities;
  send(options: EmailOptions): Promise<void>;
}
