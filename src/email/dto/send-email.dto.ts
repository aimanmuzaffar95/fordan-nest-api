export interface SendEmailDto {
  to: string | string[];
  subject: string;
  /** Handlebars template name (without .hbs extension) */
  template?: string;
  /** Context passed to the template */
  context?: Record<string, unknown>;
  /** Raw HTML — used when no template is specified */
  html?: string;
  /** Plain text fallback — auto-generated from html if omitted */
  text?: string;
  replyTo?: string;
}
