import type { EmailOptions } from '../types/email-options.type';
import type { EmailProviderCapabilities } from './email-provider-capabilities.type';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface IEmailProvider {
  readonly capabilities: EmailProviderCapabilities;
  isConfigured(): Promise<boolean>;
  send(options: EmailOptions): Promise<void>;
}
