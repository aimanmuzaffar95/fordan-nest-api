import type { BillingSettings } from './billing-settings.types';

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  defaultTaxRatePercent: 10,
  paymentInstructions: null,
  invoiceFooterNote: null,
};
