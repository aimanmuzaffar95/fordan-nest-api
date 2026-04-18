import type { DocumentNumberingSettings } from './document-numbering.types';

export const DEFAULT_DOCUMENT_NUMBERING_SETTINGS: DocumentNumberingSettings = {
  orderPrefix: 'ORD-',
  orderNextNumber: 1001,
  invoicePrefix: 'INV-',
  invoiceNextNumber: 1001,
};
