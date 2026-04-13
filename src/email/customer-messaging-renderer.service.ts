import { Injectable } from '@nestjs/common';
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
  constructor(private readonly runtimeSettings: RuntimeSettingsService) {}

  private async templates(): Promise<CustomerMessagingTemplates> {
    const s = await this.runtimeSettings.getSettings();
    return s.customerMessagingTemplates;
  }

  private compile(template: string, ctx: Record<string, unknown>): string {
    return Handlebars.compile(template)(ctx);
  }

  private baseCtx(
    theme: CustomerMessagingTemplates['quotationEmail'],
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      brandName: theme.brandName,
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
    const { quotationEmail: q } = await this.templates();
    const ctx = this.baseCtx(q, {
      customerName: input.customerName,
      orderNumber: input.orderNumber,
      projectAddress: input.projectAddress,
      systemTypeLabel: input.systemTypeLabel,
      systemSizeLabel: input.systemSizeLabel,
      batterySizeLabel: input.batterySizeLabel,
    });

    const subject = this.compile(q.subjectTemplate, ctx).trim();
    const html = renderTemplate('quotation-branded', {
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

    return { subject, html };
  }

  async renderSignatureRequestCustomerEmail(input: {
    customerName: string;
    orderNumber: string;
    signingUrl: string;
    referenceCode: string;
  }): Promise<{ subject: string; html: string }> {
    const { signatureRequestEmail: s } = await this.templates();
    const ctx = this.sigCtx(s, {
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

    const html = renderTemplate('signature-request-branded', {
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
      compiledKicker: this.compile(s.kickerTemplate, ctx),
      compiledHeroTitle: this.compile(s.heroTitleTemplate, ctx),
      compiledHeroIntro: this.compile(s.heroIntroTemplate, ctx),
      ctaLabel: s.ctaLabel,
      signingUrl: input.signingUrl,
      referenceCode: input.referenceCode,
      compiledFooterLine1: this.compile(s.footerLine1Template, ctx),
      compiledFooterLine2: this.compile(s.footerLine2Template, ctx),
    });

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
    const { quotationPdf: p } = await this.templates();
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
}
