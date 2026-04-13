import type { CustomerMessagingTemplates } from './customer-messaging.types';

/** Baseline layout/colors matching legacy static templates. */
export const DEFAULT_CUSTOMER_MESSAGING_TEMPLATES: CustomerMessagingTemplates =
  {
    quotationEmail: {
      primaryHex: '#855300',
      heroAccentHex: '#ffddb8',
      heroBgHex: '#2d3133',
      heroLeadHex: 'rgba(239,241,243,0.84)',
      bodyTextHex: '#191c1e',
      bodyMutedHex: '#534434',
      cardBgHex: '#f7f9fb',
      borderHex: '#eceef0',
      totalBarBgHex: '#855300',
      totalBarLabelHex: '#ffddb8',
      pageBgHex: '#f2f4f6',
      subjectTemplate: 'Your {{brandName}} quotation for {{orderNumber}}',
      brandName: 'Fordan Solar',
      kickerTemplate: 'Quotation document',
      heroTitleTemplate: 'Your solar project quotation is ready.',
      heroIntroTemplate:
        'Hi {{customerName}}, we have finalized the saved proposal configuration for your project at {{projectAddress}}.',
      introParagraphTemplate:
        'Thank you for choosing {{brandName}}. Below is the current quotation generated from your confirmed proposal configuration in our CRM.',
      nextStep1Template:
        'Review the quotation details and the attached PDF copy.',
      nextStep2Template:
        'Reply to this email if you would like any changes to the equipment mix or pricing.',
      nextStep3Template:
        'Once approved, our team will guide you through contract signing and the next project milestones.',
      footerBrandName: 'Fordan Solar',
      footerLine1Template:
        '© {{currentYear}} {{brandName}}. All rights reserved.',
      footerLine2Template:
        'This quotation email was generated from the saved proposal configuration in {{brandName}} CRM.',
    },
    signatureRequestEmail: {
      primaryHex: '#855300',
      heroAccentHex: '#ffddb8',
      heroBgHex: '#2d3133',
      heroLeadHex: 'rgba(239,241,243,0.84)',
      bodyTextHex: '#191c1e',
      bodyMutedHex: '#534434',
      cardBgHex: '#f7f9fb',
      borderHex: '#eceef0',
      totalBarBgHex: '#855300',
      totalBarLabelHex: '#ffddb8',
      pageBgHex: '#f2f4f6',
      subjectTemplate: 'Sign your {{brandName}} quotation — {{orderNumber}}',
      brandName: 'Fordan Solar',
      kickerTemplate: 'E-signature',
      heroTitleTemplate: 'Please sign your quotation',
      heroIntroTemplate:
        'Hi {{customerName}}, use the secure link below to review and electronically sign your quotation for order {{orderNumber}}.',
      ctaLabel: 'Open signing page',
      footerBrandName: 'Fordan Solar',
      footerLine1Template:
        '© {{currentYear}} {{brandName}}. This link is personal to you; do not forward if you did not request it.',
      footerLine2Template:
        'If the button does not work, use the plain URL shown below.',
    },
    quotationPdf: {
      brandName: 'Fordan Solar',
      primaryHex: '#855300',
      headlineTemplate: 'Solar project quotation for {{customerName}}',
      thankYouTemplate:
        'Thank you for considering {{brandName}}. This quotation has been prepared using the saved proposal configuration for your project.',
      footerNoteTemplate:
        'This quotation is generated from the saved proposal configuration in {{brandName}} CRM. Please contact our team if you would like any adjustments before moving forward.',
    },
  };
