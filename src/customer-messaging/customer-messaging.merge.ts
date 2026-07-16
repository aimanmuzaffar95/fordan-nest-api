import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CUSTOMER_MESSAGING_TEMPLATES } from './customer-messaging.defaults';
import type { CustomerMessagingTemplates } from './customer-messaging.types';

function cloneDefaults(): CustomerMessagingTemplates {
  return JSON.parse(
    JSON.stringify(DEFAULT_CUSTOMER_MESSAGING_TEMPLATES),
  ) as CustomerMessagingTemplates;
}

/** Merge stored JSON from DB with code defaults (forward-compatible). */
export function mergeCustomerMessagingTemplates(
  stored: unknown,
): CustomerMessagingTemplates {
  const base = cloneDefaults();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return base;
  }
  const s = stored as Partial<CustomerMessagingTemplates>;
  return {
    emailSignatureHtml:
      typeof s.emailSignatureHtml === 'string'
        ? s.emailSignatureHtml
        : base.emailSignatureHtml,
    quotationEmail: { ...base.quotationEmail, ...s.quotationEmail },
    signatureRequestEmail: {
      ...base.signatureRequestEmail,
      ...s.signatureRequestEmail,
    },
    quotationPdf: { ...base.quotationPdf, ...s.quotationPdf },
    invoiceSentEmail: { ...base.invoiceSentEmail, ...s.invoiceSentEmail },
    paymentReceiptEmail: {
      ...base.paymentReceiptEmail,
      ...s.paymentReceiptEmail,
    },
    overdueReminderEmail: {
      ...base.overdueReminderEmail,
      ...s.overdueReminderEmail,
    },
    jobStatusEmail: { ...base.jobStatusEmail, ...s.jobStatusEmail },
  };
}

const KNOWN_MESSAGING_KEYS = new Set<keyof CustomerMessagingTemplates>([
  'emailSignatureHtml',
  'quotationEmail',
  'signatureRequestEmail',
  'quotationPdf',
  'invoiceSentEmail',
  'paymentReceiptEmail',
  'overdueReminderEmail',
  'jobStatusEmail',
]);

export function deepMergeMessagingPatch(
  current: CustomerMessagingTemplates,
  patch: unknown,
): CustomerMessagingTemplates {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException(
      'customerMessagingTemplates must be an object',
    );
  }
  // Reject unknown top-level keys so a typo fails loudly instead of being
  // silently dropped by the whitelist merge below.
  const unknownKeys = Object.keys(patch).filter(
    (key) => !KNOWN_MESSAGING_KEYS.has(key as keyof CustomerMessagingTemplates),
  );
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `Unknown customerMessagingTemplates key(s): ${unknownKeys.join(', ')}`,
    );
  }
  const p = patch as Partial<CustomerMessagingTemplates>;
  return {
    emailSignatureHtml:
      p.emailSignatureHtml !== undefined
        ? String(p.emailSignatureHtml)
        : current.emailSignatureHtml,
    quotationEmail: { ...current.quotationEmail, ...p.quotationEmail },
    signatureRequestEmail: {
      ...current.signatureRequestEmail,
      ...p.signatureRequestEmail,
    },
    quotationPdf: { ...current.quotationPdf, ...p.quotationPdf },
    invoiceSentEmail: { ...current.invoiceSentEmail, ...p.invoiceSentEmail },
    paymentReceiptEmail: {
      ...current.paymentReceiptEmail,
      ...p.paymentReceiptEmail,
    },
    overdueReminderEmail: {
      ...current.overdueReminderEmail,
      ...p.overdueReminderEmail,
    },
    jobStatusEmail: { ...current.jobStatusEmail, ...p.jobStatusEmail },
  };
}
