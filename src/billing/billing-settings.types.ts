export type BillingSettings = {
  /** Default tax rate for new invoices (e.g. 10 for GST). */
  defaultTaxRatePercent: number;
  /** Default payment instructions shown on invoices (future: PDF/email templates). */
  paymentInstructions: string | null;
  /** Default footer note shown on invoices (future: PDF/email templates). */
  invoiceFooterNote: string | null;
};
