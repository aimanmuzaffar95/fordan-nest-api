import { BadRequestException } from '@nestjs/common';
import type { CustomerMessagingTemplates } from './customer-messaging.types';

const CSS_COLOR_RE =
  /^(#[0-9A-Fa-f]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*[\d.]+)?\s*\))$/;

const trim = (s: string, max: number, label: string): string => {
  const t = s.trim();
  if (t.length > max) {
    throw new BadRequestException(`${label} must be at most ${max} characters`);
  }
  return t;
};

function assertColor(value: string, label: string): void {
  const v = value.trim();
  if (!CSS_COLOR_RE.test(v)) {
    throw new BadRequestException(
      `${label} must be a #RRGGBB hex color or rgba(...) value`,
    );
  }
}

function assertOptionalBoolean(
  value: unknown,
  path: string,
): asserts value is boolean | undefined {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${path} must be a boolean`);
  }
}

export function validateCustomerMessagingTemplates(
  t: CustomerMessagingTemplates,
): void {
  t.emailSignatureHtml = trim(
    String(t.emailSignatureHtml ?? ''),
    24_000,
    'emailSignatureHtml',
  );

  const qc = t.quotationEmail;
  const sc = t.signatureRequestEmail;
  const pc = t.quotationPdf;
  const simple = [
    ['invoiceSentEmail', t.invoiceSentEmail],
    ['paymentReceiptEmail', t.paymentReceiptEmail],
    ['overdueReminderEmail', t.overdueReminderEmail],
    ['jobStatusEmail', t.jobStatusEmail],
  ] as const;

  assertOptionalBoolean(
    qc.appendEmailSignature,
    'quotationEmail.appendEmailSignature',
  );
  assertOptionalBoolean(
    sc.appendEmailSignature,
    'signatureRequestEmail.appendEmailSignature',
  );
  for (const [key, cfg] of simple) {
    assertOptionalBoolean(
      cfg.appendEmailSignature,
      `${key}.appendEmailSignature`,
    );
  }

  for (const [label, hex] of [
    ['quotationEmail.primaryHex', qc.primaryHex],
    ['quotationEmail.heroAccentHex', qc.heroAccentHex],
    ['quotationEmail.heroBgHex', qc.heroBgHex],
    ['quotationEmail.heroLeadHex', qc.heroLeadHex],
    ['quotationEmail.bodyTextHex', qc.bodyTextHex],
    ['quotationEmail.bodyMutedHex', qc.bodyMutedHex],
    ['quotationEmail.cardBgHex', qc.cardBgHex],
    ['quotationEmail.borderHex', qc.borderHex],
    ['quotationEmail.totalBarBgHex', qc.totalBarBgHex],
    ['quotationEmail.totalBarLabelHex', qc.totalBarLabelHex],
    ['quotationEmail.pageBgHex', qc.pageBgHex],
  ] as const) {
    assertColor(hex, label);
  }

  for (const [label, hex] of [
    ['signatureRequestEmail.primaryHex', sc.primaryHex],
    ['signatureRequestEmail.heroAccentHex', sc.heroAccentHex],
    ['signatureRequestEmail.heroBgHex', sc.heroBgHex],
    ['signatureRequestEmail.heroLeadHex', sc.heroLeadHex],
    ['signatureRequestEmail.bodyTextHex', sc.bodyTextHex],
    ['signatureRequestEmail.bodyMutedHex', sc.bodyMutedHex],
    ['signatureRequestEmail.cardBgHex', sc.cardBgHex],
    ['signatureRequestEmail.borderHex', sc.borderHex],
    ['signatureRequestEmail.totalBarBgHex', sc.totalBarBgHex],
    ['signatureRequestEmail.totalBarLabelHex', sc.totalBarLabelHex],
    ['signatureRequestEmail.pageBgHex', sc.pageBgHex],
  ] as const) {
    assertColor(hex, label);
  }

  assertColor(pc.primaryHex, 'quotationPdf.primaryHex');

  for (const [key, cfg] of simple) {
    for (const [label, hex] of [
      [`${key}.primaryHex`, cfg.primaryHex],
      [`${key}.heroAccentHex`, cfg.heroAccentHex],
      [`${key}.heroBgHex`, cfg.heroBgHex],
      [`${key}.heroLeadHex`, cfg.heroLeadHex],
      [`${key}.bodyTextHex`, cfg.bodyTextHex],
      [`${key}.bodyMutedHex`, cfg.bodyMutedHex],
      [`${key}.cardBgHex`, cfg.cardBgHex],
      [`${key}.borderHex`, cfg.borderHex],
      [`${key}.totalBarBgHex`, cfg.totalBarBgHex],
      [`${key}.totalBarLabelHex`, cfg.totalBarLabelHex],
      [`${key}.pageBgHex`, cfg.pageBgHex],
    ] as const) {
      assertColor(hex, label);
    }

    cfg.subjectTemplate = trim(
      cfg.subjectTemplate,
      200,
      `${key}.subjectTemplate`,
    );
    cfg.brandName = trim(cfg.brandName, 120, `${key}.brandName`);
    cfg.kickerTemplate = trim(cfg.kickerTemplate, 120, `${key}.kickerTemplate`);
    cfg.heroTitleTemplate = trim(
      cfg.heroTitleTemplate,
      200,
      `${key}.heroTitleTemplate`,
    );
    cfg.heroIntroTemplate = trim(
      cfg.heroIntroTemplate,
      2000,
      `${key}.heroIntroTemplate`,
    );
    cfg.bodyTemplate = trim(cfg.bodyTemplate, 4000, `${key}.bodyTemplate`);
    cfg.ctaLabel =
      cfg.ctaLabel === null
        ? null
        : trim(cfg.ctaLabel, 80, `${key}.ctaLabel`);
    cfg.ctaUrlTemplate =
      cfg.ctaUrlTemplate === null
        ? null
        : trim(cfg.ctaUrlTemplate, 1000, `${key}.ctaUrlTemplate`);
    cfg.footerBrandName = trim(
      cfg.footerBrandName,
      120,
      `${key}.footerBrandName`,
    );
    cfg.footerLine1Template = trim(
      cfg.footerLine1Template,
      500,
      `${key}.footerLine1Template`,
    );
    cfg.footerLine2Template = trim(
      cfg.footerLine2Template,
      500,
      `${key}.footerLine2Template`,
    );
  }

  qc.subjectTemplate = trim(
    qc.subjectTemplate,
    200,
    'quotationEmail.subjectTemplate',
  );
  qc.brandName = trim(qc.brandName, 120, 'quotationEmail.brandName');
  qc.kickerTemplate = trim(
    qc.kickerTemplate,
    120,
    'quotationEmail.kickerTemplate',
  );
  qc.heroTitleTemplate = trim(
    qc.heroTitleTemplate,
    200,
    'quotationEmail.heroTitleTemplate',
  );
  qc.heroIntroTemplate = trim(
    qc.heroIntroTemplate,
    2000,
    'quotationEmail.heroIntroTemplate',
  );
  qc.introParagraphTemplate = trim(
    qc.introParagraphTemplate,
    2000,
    'quotationEmail.introParagraphTemplate',
  );
  qc.nextStep1Template = trim(
    qc.nextStep1Template,
    500,
    'quotationEmail.nextStep1Template',
  );
  qc.nextStep2Template = trim(
    qc.nextStep2Template,
    500,
    'quotationEmail.nextStep2Template',
  );
  qc.nextStep3Template = trim(
    qc.nextStep3Template,
    500,
    'quotationEmail.nextStep3Template',
  );
  qc.footerBrandName = trim(
    qc.footerBrandName,
    120,
    'quotationEmail.footerBrandName',
  );
  qc.footerLine1Template = trim(
    qc.footerLine1Template,
    500,
    'quotationEmail.footerLine1Template',
  );
  qc.footerLine2Template = trim(
    qc.footerLine2Template,
    500,
    'quotationEmail.footerLine2Template',
  );

  sc.subjectTemplate = trim(
    sc.subjectTemplate,
    200,
    'signatureRequestEmail.subjectTemplate',
  );
  sc.brandName = trim(sc.brandName, 120, 'signatureRequestEmail.brandName');
  sc.kickerTemplate = trim(
    sc.kickerTemplate,
    120,
    'signatureRequestEmail.kickerTemplate',
  );
  sc.heroTitleTemplate = trim(
    sc.heroTitleTemplate,
    200,
    'signatureRequestEmail.heroTitleTemplate',
  );
  sc.heroIntroTemplate = trim(
    sc.heroIntroTemplate,
    2000,
    'signatureRequestEmail.heroIntroTemplate',
  );
  sc.ctaLabel = trim(sc.ctaLabel, 80, 'signatureRequestEmail.ctaLabel');
  sc.footerBrandName = trim(
    sc.footerBrandName,
    120,
    'signatureRequestEmail.footerBrandName',
  );
  sc.footerLine1Template = trim(
    sc.footerLine1Template,
    500,
    'signatureRequestEmail.footerLine1Template',
  );
  sc.footerLine2Template = trim(
    sc.footerLine2Template,
    500,
    'signatureRequestEmail.footerLine2Template',
  );

  pc.brandName = trim(pc.brandName, 120, 'quotationPdf.brandName');
  pc.headlineTemplate = trim(
    pc.headlineTemplate,
    200,
    'quotationPdf.headlineTemplate',
  );
  pc.thankYouTemplate = trim(
    pc.thankYouTemplate,
    2000,
    'quotationPdf.thankYouTemplate',
  );
  pc.footerNoteTemplate = trim(
    pc.footerNoteTemplate,
    2000,
    'quotationPdf.footerNoteTemplate',
  );
}
