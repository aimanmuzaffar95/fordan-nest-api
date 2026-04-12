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

export type QuotationEmailTemplateConfig = BrandColorsHex & {
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

export type SignatureRequestEmailTemplateConfig = BrandColorsHex & {
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

export type QuotationPdfTemplateConfig = {
  brandName: string;
  primaryHex: string;
  headlineTemplate: string;
  thankYouTemplate: string;
  footerNoteTemplate: string;
};

export type CustomerMessagingTemplates = {
  quotationEmail: QuotationEmailTemplateConfig;
  signatureRequestEmail: SignatureRequestEmailTemplateConfig;
  quotationPdf: QuotationPdfTemplateConfig;
};
