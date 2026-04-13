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
    quotationEmail: { ...base.quotationEmail, ...s.quotationEmail },
    signatureRequestEmail: {
      ...base.signatureRequestEmail,
      ...s.signatureRequestEmail,
    },
    quotationPdf: { ...base.quotationPdf, ...s.quotationPdf },
  };
}

export function deepMergeMessagingPatch(
  current: CustomerMessagingTemplates,
  patch: unknown,
): CustomerMessagingTemplates {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException(
      'customerMessagingTemplates must be an object',
    );
  }
  const p = patch as Partial<CustomerMessagingTemplates>;
  return {
    quotationEmail: { ...current.quotationEmail, ...p.quotationEmail },
    signatureRequestEmail: {
      ...current.signatureRequestEmail,
      ...p.signatureRequestEmail,
    },
    quotationPdf: { ...current.quotationPdf, ...p.quotationPdf },
  };
}
