import { BadRequestException } from '@nestjs/common';
import { DEFAULT_DOCUMENT_NUMBERING_SETTINGS } from './document-numbering.defaults';
import type { DocumentNumberingSettings } from './document-numbering.types';

function normalizePrefix(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim().toUpperCase();
  if (!t) return fallback;
  // Keep it conservative: letters/numbers/dash only.
  const normalized = t.replace(/[^A-Z0-9-]/g, '');
  return normalized || fallback;
}

function normalizeNext(v: unknown, fallback: number): number {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export function normalizeDocumentNumberingSettings(
  s: DocumentNumberingSettings,
): DocumentNumberingSettings {
  const def = DEFAULT_DOCUMENT_NUMBERING_SETTINGS;
  return {
    ...s,
    orderPrefix: normalizePrefix(s.orderPrefix, def.orderPrefix),
    invoicePrefix: normalizePrefix(s.invoicePrefix, def.invoicePrefix),
    orderNextNumber: normalizeNext(s.orderNextNumber, def.orderNextNumber),
    invoiceNextNumber: normalizeNext(
      s.invoiceNextNumber,
      def.invoiceNextNumber,
    ),
  };
}

export function validateDocumentNumberingSettings(
  s: DocumentNumberingSettings,
): void {
  const prefixOk = (p: string) =>
    typeof p === 'string' &&
    p.length >= 1 &&
    p.length <= 20 &&
    /^[A-Z0-9-]+$/.test(p);
  const nextOk = (n: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 999999999;

  if (!prefixOk(s.orderPrefix)) {
    throw new BadRequestException(
      'documentNumberingSettings.orderPrefix must be 1..20 chars (A-Z, 0-9, -)',
    );
  }
  if (!nextOk(s.orderNextNumber)) {
    throw new BadRequestException(
      'documentNumberingSettings.orderNextNumber must be an integer 1..999999999',
    );
  }
  if (!prefixOk(s.invoicePrefix)) {
    throw new BadRequestException(
      'documentNumberingSettings.invoicePrefix must be 1..20 chars (A-Z, 0-9, -)',
    );
  }
  if (!nextOk(s.invoiceNextNumber)) {
    throw new BadRequestException(
      'documentNumberingSettings.invoiceNextNumber must be an integer 1..999999999',
    );
  }
}
