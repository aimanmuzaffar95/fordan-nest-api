import { Injectable, Logger } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import type { CustomerMessagingTemplates } from '../customer-messaging/customer-messaging.types';
import { renderTemplate } from './templates/template.renderer';

export type QuotationEmailLineItem = {
  label: string;
  subtitle: string;
  quantity: number;
  proposalUnitPrice: string;
  lineTotal: string;
};

@Injectable()
export class CustomerMessagingRendererService {
  private readonly log = new Logger(CustomerMessagingRendererService.name);

  constructor(private readonly runtimeSettings: RuntimeSettingsService) {}

  private async templates(): Promise<{
    templates: CustomerMessagingTemplates;
    brandLogoUrl: string | null;
  }> {
    const s = await this.runtimeSettings.getSettings();
    const logoUrl =
      typeof s.crmAppearanceSettings.logoUrl === 'string' &&
      s.crmAppearanceSettings.logoUrl.trim()
        ? s.crmAppearanceSettings.logoUrl.trim()
        : null;
    return { templates: s.customerMessagingTemplates, brandLogoUrl: logoUrl };
  }

  private compile(template: string, ctx: Record<string, unknown>): string {
    return Handlebars.compile(template)(ctx);
  }

  private nlToBr(s: string): string {
    return s.replace(/\n/g, '<br />');
  }

  /** Inserts compiled `emailSignatureHtml` before `</body>` when allowed. */
  private appendGlobalEmailSignature(
    html: string,
    full: CustomerMessagingTemplates,
    append: boolean | undefined,
    ctx: Record<string, unknown>,
  ): string {
    if (append === false) {
      return html;
    }
    const raw = (full.emailSignatureHtml ?? '').trim();
    if (!raw) {
      return html;
    }
    let compiled: string;
    try {
      compiled = Handlebars.compile(raw)(ctx);
    } catch (err) {
      this.log.warn(
        `emailSignatureHtml Handlebars compile failed: ${(err as Error)?.message ?? err}`,
      );
      return html;
    }
    const block = `<div class="crm-email-signature" style="margin-top:24px;">${compiled}</div>`;
    const lower = html.toLowerCase();
    const idx = lower.lastIndexOf('</body>');
    if (idx !== -1) {
      return html.slice(0, idx) + block + html.slice(idx);
    }
    return html + block;
  }

  private baseCtx(
    theme: CustomerMessagingTemplates['quotationEmail'],
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      brandName: theme.brandName,
      brandLogoUrl: extra['brandLogoUrl'] ?? null,
      currentYear: new Date().getFullYear(),
      ...extra,
    };
  }

  private sigCtx(
    s: CustomerMessagingTemplates['signatureRequestEmail'],
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      brandName: s.brandName,
      brandLogoUrl: extra['brandLogoUrl'] ?? null,
      currentYear: new Date().getFullYear(),
      ...extra,
    };
  }

  async renderQuotationCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    projectAddress: string;
    systemTypeLabel: string;
    systemSizeLabel: string;
    batterySizeLabel: string;
    proposalItems: QuotationEmailLineItem[];
    proposalTotal: string;
  }): Promise<{ subject: string; html: string }> {
    const { templates, brandLogoUrl } = await this.templates();
    const { quotationEmail: q } = templates;
    const ctx = this.baseCtx(q, {
      brandLogoUrl,
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      projectAddress: input.projectAddress,
      systemTypeLabel: input.systemTypeLabel,
      systemSizeLabel: input.systemSizeLabel,
      batterySizeLabel: input.batterySizeLabel,
    });

    const subject = this.compile(q.subjectTemplate, ctx).trim();
    let html = renderTemplate('quotation-branded', {
      primaryHex: q.primaryHex,
      heroAccentHex: q.heroAccentHex,
      heroBgHex: q.heroBgHex,
      heroLeadHex: q.heroLeadHex,
      bodyTextHex: q.bodyTextHex,
      bodyMutedHex: q.bodyMutedHex,
      cardBgHex: q.cardBgHex,
      borderHex: q.borderHex,
      totalBarBgHex: q.totalBarBgHex,
      totalBarLabelHex: q.totalBarLabelHex,
      pageBgHex: q.pageBgHex,
      brandHeaderName: q.brandName,
      brandLogoUrl,
      footerBrandName: q.footerBrandName,
      compiledKicker: this.compile(q.kickerTemplate, ctx),
      compiledHeroTitle: this.compile(q.heroTitleTemplate, ctx),
      compiledHeroIntro: this.compile(q.heroIntroTemplate, ctx),
      compiledIntroParagraph: this.compile(q.introParagraphTemplate, ctx),
      compiledNext1: this.compile(q.nextStep1Template, ctx),
      compiledNext2: this.compile(q.nextStep2Template, ctx),
      compiledNext3: this.compile(q.nextStep3Template, ctx),
      compiledFooterLine1: this.compile(q.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(q.footerLine2Template, ctx),
      orderNumber: input.orderNumber,
      systemTypeLabel: input.systemTypeLabel,
      systemSizeLabel: input.systemSizeLabel,
      batterySizeLabel: input.batterySizeLabel,
      proposalItems: input.proposalItems,
      proposalTotal: input.proposalTotal,
    });

    html = this.appendGlobalEmailSignature(
      html,
      templates,
      q.appendEmailSignature,
      ctx,
    );
    return { subject, html };
  }

  async renderSignatureRequestCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    signingUrl: string;
    referenceCode: string;
  }): Promise<{ subject: string; html: string }> {
    const { templates, brandLogoUrl } = await this.templates();
    const { signatureRequestEmail: s } = templates;
    const ctx = this.sigCtx(s, {
      brandLogoUrl,
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      signingUrl: input.signingUrl,
      referenceCode: input.referenceCode,
    });

    const subject = this.compile(s.subjectTemplate, {
      brandName: s.brandName,
      orderNumber: input.orderNumber,
      currentYear: new Date().getFullYear(),
      customerName: input.customerName,
      signingUrl: input.signingUrl,
      referenceCode: input.referenceCode,
    }).trim();

    let html = renderTemplate('signature-request-branded', {
      primaryHex: s.primaryHex,
      heroAccentHex: s.heroAccentHex,
      heroBgHex: s.heroBgHex,
      heroLeadHex: s.heroLeadHex,
      bodyTextHex: s.bodyTextHex,
      bodyMutedHex: s.bodyMutedHex,
      cardBgHex: s.cardBgHex,
      borderHex: s.borderHex,
      pageBgHex: s.pageBgHex,
      brandHeaderName: s.brandName,
      brandLogoUrl,
      compiledKicker: this.compile(s.kickerTemplate, ctx),
      compiledHeroTitle: this.compile(s.heroTitleTemplate, ctx),
      compiledHeroIntro: this.compile(s.heroIntroTemplate, ctx),
      ctaLabel: s.ctaLabel,
      signingUrl: input.signingUrl,
      referenceCode: input.referenceCode,
      compiledFooterLine1: this.compile(s.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(s.footerLine2Template, ctx),
    });

    html = this.appendGlobalEmailSignature(
      html,
      templates,
      s.appendEmailSignature,
      ctx,
    );
    return { subject, html };
  }

  async resolveQuotationPdfCopy(input: {
    customerName: string;
    orderNumber: string;
  }): Promise<{
    brandName: string;
    primaryHex: string;
    headline: string;
    thankYou: string;
    footerNote: string;
  }> {
    const { templates } = await this.templates();
    const { quotationPdf: p } = templates;
    const ctx = {
      brandName: p.brandName,
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      currentYear: new Date().getFullYear(),
    };
    return {
      brandName: p.brandName,
      primaryHex: p.primaryHex,
      headline: this.compile(p.headlineTemplate, ctx),
      thankYou: this.compile(p.thankYouTemplate, ctx),
      footerNote: this.compile(p.footerNoteTemplate, ctx),
    };
  }

  async renderInvoiceSentCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    invoiceNumber: string;
    invoiceTotal: string;
    invoiceDueDate: string;
  }): Promise<{ subject: string; html: string }> {
    const { templates, brandLogoUrl } = await this.templates();
    const t = templates.invoiceSentEmail;
    const ctx = {
      brandName: t.brandName,
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      invoiceNumber: input.invoiceNumber,
      invoiceTotal: input.invoiceTotal,
      invoiceDueDate: input.invoiceDueDate,
      currentYear: new Date().getFullYear(),
    };
    const subject = this.compile(t.subjectTemplate, ctx).trim();
    const compiledBody = this.compile(t.bodyTemplate, ctx);
    const ctaUrl =
      t.ctaUrlTemplate && t.ctaUrlTemplate.trim()
        ? this.compile(t.ctaUrlTemplate, ctx).trim()
        : null;

    let html = renderTemplate('simple-branded', {
      primaryHex: t.primaryHex,
      heroAccentHex: t.heroAccentHex,
      heroBgHex: t.heroBgHex,
      heroLeadHex: t.heroLeadHex,
      bodyTextHex: t.bodyTextHex,
      bodyMutedHex: t.bodyMutedHex,
      cardBgHex: t.cardBgHex,
      borderHex: t.borderHex,
      totalBarBgHex: t.totalBarBgHex,
      totalBarLabelHex: t.totalBarLabelHex,
      pageBgHex: t.pageBgHex,
      brandHeaderName: t.brandName,
      brandLogoUrl,
      footerBrandName: t.footerBrandName,
      compiledKicker: this.compile(t.kickerTemplate, ctx),
      compiledHeroTitle: this.compile(t.heroTitleTemplate, ctx),
      compiledHeroIntro: this.compile(t.heroIntroTemplate, ctx),
      compiledBodyHtml: this.nlToBr(compiledBody),
      ctaLabel: t.ctaLabel,
      ctaUrl,
      compiledFooterLine1: this.compile(t.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(t.footerLine2Template, ctx),
    });

    html = this.appendGlobalEmailSignature(
      html,
      templates,
      t.appendEmailSignature,
      ctx,
    );
    return { subject, html };
  }

  async renderPaymentReceiptCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    invoiceNumber: string;
    paymentAmount: string;
    paymentDate: string;
  }): Promise<{ subject: string; html: string }> {
    const { templates, brandLogoUrl } = await this.templates();
    const t = templates.paymentReceiptEmail;
    const ctx = {
      brandName: t.brandName,
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      invoiceNumber: input.invoiceNumber,
      paymentAmount: input.paymentAmount,
      paymentDate: input.paymentDate,
      currentYear: new Date().getFullYear(),
    };
    const subject = this.compile(t.subjectTemplate, ctx).trim();
    const compiledBody = this.compile(t.bodyTemplate, ctx);
    const ctaUrl =
      t.ctaUrlTemplate && t.ctaUrlTemplate.trim()
        ? this.compile(t.ctaUrlTemplate, ctx).trim()
        : null;

    let html = renderTemplate('simple-branded', {
      primaryHex: t.primaryHex,
      heroAccentHex: t.heroAccentHex,
      heroBgHex: t.heroBgHex,
      heroLeadHex: t.heroLeadHex,
      bodyTextHex: t.bodyTextHex,
      bodyMutedHex: t.bodyMutedHex,
      cardBgHex: t.cardBgHex,
      borderHex: t.borderHex,
      totalBarBgHex: t.totalBarBgHex,
      totalBarLabelHex: t.totalBarLabelHex,
      pageBgHex: t.pageBgHex,
      brandHeaderName: t.brandName,
      brandLogoUrl,
      footerBrandName: t.footerBrandName,
      compiledKicker: this.compile(t.kickerTemplate, ctx),
      compiledHeroTitle: this.compile(t.heroTitleTemplate, ctx),
      compiledHeroIntro: this.compile(t.heroIntroTemplate, ctx),
      compiledBodyHtml: this.nlToBr(compiledBody),
      ctaLabel: t.ctaLabel,
      ctaUrl,
      compiledFooterLine1: this.compile(t.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(t.footerLine2Template, ctx),
    });

    html = this.appendGlobalEmailSignature(
      html,
      templates,
      t.appendEmailSignature,
      ctx,
    );
    return { subject, html };
  }

  async renderOverdueReminderCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    invoiceNumber: string;
    invoiceTotal: string;
    invoiceDueDate: string;
  }): Promise<{ subject: string; html: string }> {
    const { templates, brandLogoUrl } = await this.templates();
    const t = templates.overdueReminderEmail;
    const ctx = {
      brandName: t.brandName,
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      invoiceNumber: input.invoiceNumber,
      invoiceTotal: input.invoiceTotal,
      invoiceDueDate: input.invoiceDueDate,
      currentYear: new Date().getFullYear(),
    };
    const subject = this.compile(t.subjectTemplate, ctx).trim();
    const compiledBody = this.compile(t.bodyTemplate, ctx);
    const ctaUrl =
      t.ctaUrlTemplate && t.ctaUrlTemplate.trim()
        ? this.compile(t.ctaUrlTemplate, ctx).trim()
        : null;

    let html = renderTemplate('simple-branded', {
      primaryHex: t.primaryHex,
      heroAccentHex: t.heroAccentHex,
      heroBgHex: t.heroBgHex,
      heroLeadHex: t.heroLeadHex,
      bodyTextHex: t.bodyTextHex,
      bodyMutedHex: t.bodyMutedHex,
      cardBgHex: t.cardBgHex,
      borderHex: t.borderHex,
      totalBarBgHex: t.totalBarBgHex,
      totalBarLabelHex: t.totalBarLabelHex,
      pageBgHex: t.pageBgHex,
      brandHeaderName: t.brandName,
      brandLogoUrl,
      footerBrandName: t.footerBrandName,
      compiledKicker: this.compile(t.kickerTemplate, ctx),
      compiledHeroTitle: this.compile(t.heroTitleTemplate, ctx),
      compiledHeroIntro: this.compile(t.heroIntroTemplate, ctx),
      compiledBodyHtml: this.nlToBr(compiledBody),
      ctaLabel: t.ctaLabel,
      ctaUrl,
      compiledFooterLine1: this.compile(t.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(t.footerLine2Template, ctx),
    });

    html = this.appendGlobalEmailSignature(
      html,
      templates,
      t.appendEmailSignature,
      ctx,
    );
    return { subject, html };
  }

  async renderJobStatusCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    jobStatusLabel: string;
    jobStatusBody: string;
  }): Promise<{ subject: string; html: string }> {
    const { templates, brandLogoUrl } = await this.templates();
    const t = templates.jobStatusEmail;
    const ctx = {
      brandName: t.brandName,
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      jobStatusLabel: input.jobStatusLabel,
      jobStatusBody: input.jobStatusBody,
      currentYear: new Date().getFullYear(),
    };
    const subject = this.compile(t.subjectTemplate, ctx).trim();
    const compiledBody = this.compile(t.bodyTemplate, ctx);
    const ctaUrl =
      t.ctaUrlTemplate && t.ctaUrlTemplate.trim()
        ? this.compile(t.ctaUrlTemplate, ctx).trim()
        : null;

    let html = renderTemplate('simple-branded', {
      primaryHex: t.primaryHex,
      heroAccentHex: t.heroAccentHex,
      heroBgHex: t.heroBgHex,
      heroLeadHex: t.heroLeadHex,
      bodyTextHex: t.bodyTextHex,
      bodyMutedHex: t.bodyMutedHex,
      cardBgHex: t.cardBgHex,
      borderHex: t.borderHex,
      totalBarBgHex: t.totalBarBgHex,
      totalBarLabelHex: t.totalBarLabelHex,
      pageBgHex: t.pageBgHex,
      brandHeaderName: t.brandName,
      brandLogoUrl,
      footerBrandName: t.footerBrandName,
      compiledKicker: this.compile(t.kickerTemplate, ctx),
      compiledHeroTitle: this.compile(t.heroTitleTemplate, ctx),
      compiledHeroIntro: this.compile(t.heroIntroTemplate, ctx),
      compiledBodyHtml: this.nlToBr(compiledBody),
      ctaLabel: t.ctaLabel,
      ctaUrl,
      compiledFooterLine1: this.compile(t.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(t.footerLine2Template, ctx),
    });

    html = this.appendGlobalEmailSignature(
      html,
      templates,
      t.appendEmailSignature,
      ctx,
    );
    return { subject, html };
  }
}
