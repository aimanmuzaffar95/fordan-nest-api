/** Persisted + API payload: branded customer quotation / e-sign emails and quotation PDF. */

export type BrandColorsHex = {
  primaryHex: string;
  heroAccentHex: string;
  heroBgHex: string;
  heroLeadHex: string;
  bodyTextHex: string;
  bodyMutedHex: string;
  cardBgHex: string;
  borderHex: string;
  totalBarBgHex: string;
  totalBarLabelHex: string;
  pageBgHex: string;
};

/** When false, the global `emailSignatureHtml` block is not appended for this email type. */
export type EmailSignatureToggle = {
  appendEmailSignature?: boolean;
};

export type QuotationEmailTemplateConfig = BrandColorsHex &
  EmailSignatureToggle & {
  subjectTemplate: string;
  brandName: string;
  kickerTemplate: string;
  heroTitleTemplate: string;
  heroIntroTemplate: string;
  introParagraphTemplate: string;
  nextStep1Template: string;
  nextStep2Template: string;
  nextStep3Template: string;
  footerBrandName: string;
  footerLine1Template: string;
  footerLine2Template: string;
};

export type SignatureRequestEmailTemplateConfig = BrandColorsHex &
  EmailSignatureToggle & {
  subjectTemplate: string;
  brandName: string;
  kickerTemplate: string;
  heroTitleTemplate: string;
  heroIntroTemplate: string;
  ctaLabel: string;
  footerBrandName: string;
  footerLine1Template: string;
  footerLine2Template: string;
};

export type SimpleBrandedEmailTemplateConfig = BrandColorsHex &
  EmailSignatureToggle & {
  subjectTemplate: string;
  brandName: string;
  kickerTemplate: string;
  heroTitleTemplate: string;
  heroIntroTemplate: string;
  bodyTemplate: string;
  /** Optional CTA button */
  ctaLabel: string | null;
  ctaUrlTemplate: string | null;
  footerBrandName: string;
  footerLine1Template: string;
  footerLine2Template: string;
};

export type QuotationPdfTemplateConfig = {
  brandName: string;
  primaryHex: string;
  headlineTemplate: string;
  thankYouTemplate: string;
  footerNoteTemplate: string;
};

export type CustomerMessagingTemplates = {
  /**
   * Raw HTML appended inside outgoing customer emails (before `</body>`) when the
   * template’s `appendEmailSignature` is not false. Compiled with Handlebars using the
   * same context as the rest of that email (e.g. `{{brandName}}`, `{{customerName}}`).
   */
  emailSignatureHtml: string;
  quotationEmail: QuotationEmailTemplateConfig;
  signatureRequestEmail: SignatureRequestEmailTemplateConfig;
  quotationPdf: QuotationPdfTemplateConfig;
  invoiceSentEmail: SimpleBrandedEmailTemplateConfig;
  paymentReceiptEmail: SimpleBrandedEmailTemplateConfig;
  overdueReminderEmail: SimpleBrandedEmailTemplateConfig;
  jobStatusEmail: SimpleBrandedEmailTemplateConfig;
};
