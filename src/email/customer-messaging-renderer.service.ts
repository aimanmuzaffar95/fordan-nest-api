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
    // Constrain to the same 600px column as the templates so the signature
    // lines up with the email card instead of spanning the full page bg.
    const block = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 12px 24px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;"><tr><td class="crm-email-signature" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;text-align:left;">${compiled}</td></tr></table></td></tr></table>`;
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

  /**
   * The customer-facing solar proposal email (P6, `solar-design-studio.md`
   * §5). Reuses the `quotationEmail` brand theme (colors/logo/footer are
   * already configured in Settings → Templates) but the copy is its own —
   * this is the moment a homeowner who just had a rep at their house opens
   * their inbox, so it leads with the numbers that matter to them (system
   * size, annual savings, payback), not "please find attached".
   */
  async renderProposalSentCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    systemSizeLabel: string;
    annualSavingsLabel: string;
    paybackLabel: string;
    offsetPercentLabel: string;
    /**
     * True when the headline numbers were computed on a fallback regional
     * irradiance estimate rather than real site data (simulation warning
     * `climate-data-unavailable`). Must never be silently dropped — the
     * copy below is the only place these numbers reach the customer.
     */
    provisional: boolean;
    viewProposalUrl: string;
  }): Promise<{ subject: string; html: string }> {
    const { templates, brandLogoUrl } = await this.templates();
    const q = templates.quotationEmail;
    const firstName = input.customerName.split(' ')[0] || input.customerName;
    const ctx = {
      brandName: q.brandName,
      customerName: input.customerName,
      firstName,
      orderNumber: input.orderNumber,
      systemSizeLabel: input.systemSizeLabel,
      annualSavingsLabel: input.annualSavingsLabel,
      paybackLabel: input.paybackLabel,
      offsetPercentLabel: input.offsetPercentLabel,
      currentYear: new Date().getFullYear(),
    };

    const subject = `Your ${input.systemSizeLabel} solar proposal is ready, ${firstName}`;

    const numbersIntro = input.provisional
      ? `Here's what your new solar system looks like on your roof, with early estimated numbers behind it:`
      : `Here's what your new solar system looks like on your roof, with real numbers behind it:`;
    const numbersLine = input.provisional
      ? `<strong>${input.systemSizeLabel}</strong> system, provisionally projected to save you <strong>${input.annualSavingsLabel} in year one</strong>, with a payback of roughly <strong>${input.paybackLabel}</strong> and covering about <strong>${input.offsetPercentLabel} of your usage</strong> — these figures are estimates and will be refined once site-specific data is available.`
      : `<strong>${input.systemSizeLabel}</strong> system, projected to save you <strong>${input.annualSavingsLabel} in year one</strong>, with a payback of roughly <strong>${input.paybackLabel}</strong> and covering about <strong>${input.offsetPercentLabel} of your usage</strong>.`;
    const bodyHtml = [
      numbersIntro,
      numbersLine,
      `Take a look through the full proposal — the design, production estimate, equipment, and pricing are all inside. When you're ready, you can accept it right from that page.`,
    ].join('<br /><br />');

    let html = renderTemplate('simple-branded', {
      primaryHex: q.primaryHex,
      heroAccentHex: q.heroAccentHex,
      heroBgHex: q.heroBgHex,
      heroLeadHex: q.heroLeadHex,
      bodyTextHex: q.bodyTextHex,
      bodyMutedHex: q.bodyMutedHex,
      cardBgHex: q.cardBgHex,
      borderHex: q.borderHex,
      pageBgHex: q.pageBgHex,
      brandHeaderName: q.brandName,
      brandLogoUrl,
      footerBrandName: q.footerBrandName,
      compiledKicker: 'Your solar proposal',
      compiledHeroTitle: `${input.systemSizeLabel} for your home`,
      compiledHeroIntro: input.provisional
        ? `Estimated to save ${input.annualSavingsLabel} in year one (provisional) — take a look and let us know when you're ready.`
        : `Projected to save ${input.annualSavingsLabel} in year one — take a look and let us know when you're ready.`,
      compiledBodyHtml: bodyHtml,
      ctaLabel: 'View your proposal',
      ctaUrl: input.viewProposalUrl,
      compiledFooterLine1: this.compile(q.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(q.footerLine2Template, ctx),
    });

    html = this.appendGlobalEmailSignature(
      html,
      templates,
      q.appendEmailSignature,
      ctx,
    );
    return { subject, html };
  }
}
