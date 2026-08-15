import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { SimulationResult } from '../solar-design/simulation';
import {
  DEFAULT_DAILY_SUPPLY_CHARGE,
  DEFAULT_DISCOUNT_RATE_PERCENT,
  DEFAULT_FEED_IN_TARIFF_PER_KWH,
  DEFAULT_IMPORT_TARIFF_PER_KWH,
  DEFAULT_TARIFF_ESCALATION_PERCENT,
} from '../solar-design/simulation';
import { ARRAY_PALETTE } from '../solar-design/array-palette';
import {
  formatAzimuth,
  formatKw,
  makeCurrencyFormatter,
  registerPdfFonts,
  sanitizeDeep,
  sanitizeForPdf,
  sanitizeWithFallback,
  truncate,
  UI_FONT,
  UI_FONT_BOLD,
  UI_FONT_OBLIQUE,
} from './roof-proposal-format.util';

export type RoofProposalLineItem = {
  label: string;
  subtitle: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type RoofProposalArrayRow = {
  id: string;
  name: string;
  tiltDegrees: number;
  azimuthDegrees: number;
  panelCount: number;
  dcKw: number;
  annualKwh: number;
};

export type RoofProposalEquipmentRow = {
  name: string;
  subtitle: string;
  quantity: number;
  specLines: string[];
};

export type RoofProposalPricingMode = 'cash' | 'loan' | 'lease' | 'ppa';

export type BuildRoofProposalPdfArgs = {
  attachmentFilename: string;

  // Branding — identical pipeline to the quotation PDF.
  pdfBrandName: string;
  pdfPrimaryHex: string;
  pdfHeadline: string;
  pdfThankYou: string;
  pdfFooterNote: string;
  currency: string;
  logoImageBytes?: Buffer;

  // Customer / job.
  customerName: string;
  customerAddress: string;
  orderNumber: string;
  systemTypeLabel: string;

  // Roof render (page 1 + page 4). Undefined -> clean degraded layout.
  renderImageBytes?: Buffer;
  renderAttribution?: string;
  renderDegradedReason?: string;
  // False when `renderImageBytes` is a bare satellite composite with no
  // roof outline/array overlay drawn on it (current server-side fallback
  // tier) — true for the browser-captured render, which always includes
  // the design. Undefined is treated the same as false (safest default: we
  // never claim a design overlay exists unless we know it does).
  renderHasDesignOverlay?: boolean;

  arrays: RoofProposalArrayRow[];
  simulation: SimulationResult;

  monthlyBillBefore: number | null;

  pricingMode: RoofProposalPricingMode;
  // Round 8: true when a priced `ProposalVersion` exists but its frozen
  // `systemSnapshot` no longer matches the live roof design (panels added
  // or removed since it was priced) — the caller has already responded by
  // treating this the same as "no real price" for every commercial figure
  // (`totalPrice` etc. below are `null` whenever this is true), so this
  // flag exists purely to let the document say *why* in its own words
  // rather than the generic "not finalised yet" copy, which would be
  // actively misleading here (a real price *was* agreed — it just no
  // longer matches what's being shown).
  priceStaleSinceDesignChange?: boolean;
  // Round 9: true when there is no live agreed price specifically because
  // the only version we have was once priced but is no longer a live offer
  // (declined by the customer, or expired) rather than because it was never
  // priced at all — "pricing has not been finalised yet" is the wrong
  // message for that case (it was finalised; it just isn't current), so
  // this lets the document say the accurate thing instead.
  priceDeclinedOrExpired?: boolean;
  totalPrice: number | null;
  depositAmount: number | null;
  rebateAmount: number | null;
  interestRatePercent: number | null;
  termMonths: number | null;
  monthlyPayment: number | null;
  ppaRatePerKwh: number | null;
  lineItems: RoofProposalLineItem[];

  equipmentPanels: RoofProposalEquipmentRow[];
  equipmentInverters: RoofProposalEquipmentRow[];
  equipmentBatteries: RoofProposalEquipmentRow[];

  // Round 10: only populated (all three, together) when
  // `simulation.financial.tariffSource === 'customer'` — mirrors that
  // field's own "both legs real or neither counts" rule, so the savings
  // page never has to re-derive or second-guess which case it's in.
  customerImportTariffPerKwh?: number | null;
  customerFeedInTariffPerKwh?: number | null;
  customerDailySupplyCharge?: number | null;
};

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Distinct, colour-blind-tolerant palette for up to 4 arrays, imported from
 * `../solar-design/array-palette.ts` — the single source of truth shared
 * with the server-side render composite, so "row N -> shape on the image"
 * stays true by construction rather than by a comment asking two files to
 * be kept in sync by hand. Spaced by perceived luminance (roughly 25+
 * points apart on a 0-255 scale — navy 58.7, teal 86.3, green 110.7, amber
 * 135.4 — verified by rendering to greyscale) so swatches stay
 * distinguishable on a black-and-white printer, not just on screen. Each
 * array is *also* drawn with a distinct swatch shape (see `ARRAY_SHAPES`)
 * so two arrays are never relying on hue/luminance alone to be told apart.
 */
const ARRAY_SHAPES = ['square', 'circle', 'triangle', 'diamond'] as const;

const INK = '#111827';
const MUTED = '#4b5563';
const FAINT = '#9ca3af';
const HAIRLINE = '#e5e7eb';
const TOTAL_PAGES = 10;

type Doc = PDFKit.PDFDocument;

@Injectable()
export class RoofProposalPdfService {
  async buildProposalPdf(rawArgs: BuildRoofProposalPdfArgs): Promise<Buffer> {
    // Strip any character our embedded font can't draw (CJK, most emoji,
    // etc.) *before* layout — never after, since PDFKit's default
    // WinAnsi-only text path corrupts everything following an unsupported
    // character rather than dropping just that glyph. Binary fields
    // (logo/image bytes) pass through `sanitizeDeep` untouched.
    const args = sanitizeDeep(rawArgs);
    // `customerName` drives the cover page and page 2's opening sentence
    // ("<name>, here is your system at a glance."). If it sanitised down to
    // nothing (e.g. an all-CJK name against a font with no glyphs for it),
    // fall back to the order number, or a generic greeting, rather than
    // shipping a blank cover / a bare leading comma.
    args.customerName = sanitizeWithFallback(
      rawArgs.customerName,
      rawArgs.orderNumber
        ? `Order ${sanitizeForPdf(rawArgs.orderNumber)}`
        : 'Valued Customer',
    );
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        bufferPages: true,
        info: {
          Title: args.attachmentFilename,
          Author: `${args.pdfBrandName} CRM`,
          Subject: 'Solar proposal',
        },
      });
      registerPdfFonts(doc);
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer | Uint8Array | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const money = makeCurrencyFormatter(args.currency);

      const ctx: PageCtx = {
        doc,
        args,
        money,
        pageWidth:
          doc.page.width - doc.page.margins.left - doc.page.margins.right,
        contentRight: doc.page.width - doc.page.margins.right,
        contentBottom: doc.page.height - doc.page.margins.bottom,
      };

      drawCoverPage(ctx);
      drawExecutiveSummaryPage(ctx);
      drawEnergyTodayPage(ctx);
      drawRoofDesignPage(ctx);
      drawProductionPage(ctx);
      drawSavingsPage(ctx);
      drawEquipmentPage(ctx);
      drawEnvironmentPage(ctx);
      drawInvestmentPage(ctx);
      drawNextStepsPage(ctx);

      // Footer (page number + brand note) drawn last across every buffered
      // page so page count is known and every page — including the cover —
      // gets a consistent footer.
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i += 1) {
        doc.switchToPage(pageRange.start + i);
        drawFooter(ctx, i + 1);
      }

      doc.end();
    });
  }
}

type PageCtx = {
  doc: Doc;
  args: BuildRoofProposalPdfArgs;
  money: (v: number) => string;
  pageWidth: number;
  contentRight: number;
  contentBottom: number;
};

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function drawHeader(ctx: PageCtx, pageTitle: string): number {
  const { doc, args } = ctx;
  const headerY = 40;
  const headerX = doc.page.margins.left;
  const logoMaxH = 28;
  let brandTextX = headerX;

  if (args.logoImageBytes) {
    try {
      doc.image(args.logoImageBytes, headerX, headerY - 4, {
        fit: [140, logoMaxH],
        valign: 'center',
      });
      brandTextX = headerX + 150;
    } catch {
      brandTextX = headerX;
    }
  }

  doc
    .fillColor(args.pdfPrimaryHex)
    .font(UI_FONT_BOLD)
    .fontSize(14)
    .text(truncate(args.pdfBrandName, 34), brandTextX, headerY, {
      width: ctx.pageWidth - (brandTextX - headerX) - 160,
      height: 18,
      lineBreak: false,
      ellipsis: true,
    });

  doc
    .fillColor(INK)
    .font(UI_FONT_BOLD)
    .fontSize(11)
    .text(pageTitle.toUpperCase(), ctx.contentRight - 220, headerY + 2, {
      width: 220,
      height: 14,
      align: 'right',
      lineBreak: false,
      ellipsis: true,
    });

  const lineY = headerY + 30;
  doc
    .moveTo(doc.page.margins.left, lineY)
    .lineTo(ctx.contentRight, lineY)
    .strokeColor(HAIRLINE)
    .lineWidth(1)
    .stroke();

  return lineY + 18;
}

function drawFooter(ctx: PageCtx, pageNumber: number): void {
  const { doc, args } = ctx;
  const y = doc.page.height - doc.page.margins.bottom + 14;
  // Writing inside the bottom margin band would otherwise trip PDFKit's
  // automatic page-break logic (it treats anything below
  // `page.margins.bottom` as overflow and silently inserts a new page).
  // Neutralise the bottom margin for the duration of this write so the
  // footer lands in the margin without spawning extra pages.
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .fontSize(7.5)
    .font(UI_FONT)
    .fillColor(FAINT)
    .text(truncate(args.pdfFooterNote, 140), doc.page.margins.left, y, {
      width: ctx.pageWidth * 0.7,
      height: 10,
      lineBreak: false,
      ellipsis: true,
    });
  doc.text(`Page ${pageNumber} of ${TOTAL_PAGES}`, ctx.contentRight - 120, y, {
    width: 120,
    align: 'right',
    lineBreak: false,
  });
  doc.page.margins.bottom = originalBottomMargin;
}

function sectionHeading(ctx: PageCtx, text: string, y: number): number {
  ctx.doc
    .fillColor(ctx.args.pdfPrimaryHex)
    .font(UI_FONT_BOLD)
    .fontSize(13)
    .text(text, ctx.doc.page.margins.left, y, { width: ctx.pageWidth });
  return ctx.doc.y + 8;
}

/** A labelled metric card — the vocabulary a Pylon-style summary page uses. */
function drawMetricCard(
  ctx: PageCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string | null,
): void {
  const { doc } = ctx;
  doc.roundedRect(x, y, w, h, 6).fillColor('#f9fafb').fill();
  doc
    .fontSize(8.5)
    .font(UI_FONT)
    .fillColor(MUTED)
    .text(label.toUpperCase(), x + 12, y + 10, { width: w - 24 });
  // Long values (e.g. "120 months (10.0 yrs)") don't fit a single 17pt line
  // in a grid card — drop to a smaller size and let them wrap onto the two
  // lines the card has room for, instead of truncating useful detail. Decide
  // by measuring the actual rendered width at 17pt against the card's
  // available width, not a fixed character count — a short-looking value
  // with a wide unit suffix (e.g. "USD 0.000/kWh") was previously getting
  // ellipsis-truncated mid-unit ("USD 0.000/…") because a 13-character
  // string was assumed to always fit.
  const availableWidth = w - 24;
  const isLongValue =
    !!value &&
    doc.font(UI_FONT_BOLD).fontSize(17).widthOfString(value) > availableWidth;
  const valueFontSize = value ? (isLongValue ? 12 : 17) : 11;
  doc
    .fontSize(valueFontSize)
    .font(UI_FONT_BOLD)
    .fillColor(value ? INK : FAINT);
  if (value && isLongValue) {
    doc.text(value, x + 12, y + 28, { width: w - 24 });
  } else {
    doc.text(value ?? 'Not available', x + 12, y + 26, {
      width: w - 24,
      height: value ? 22 : 14,
      lineBreak: false,
      ellipsis: true,
    });
  }
}

/**
 * Draws one per-array legend/table swatch. Colour alone doesn't survive a
 * black-and-white printer reliably (see `ARRAY_PALETTE`), so each array
 * also gets a distinct shape — a reader can match a row to the roof render
 * by outline alone even in greyscale.
 */
function drawArraySwatch(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number,
  color: string,
  shape: (typeof ARRAY_SHAPES)[number],
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  doc.fillColor(color);
  switch (shape) {
    case 'circle':
      doc.circle(cx, cy, size / 2).fill();
      break;
    case 'triangle':
      doc.polygon([cx, y], [x + size, y + size], [x, y + size]).fill();
      break;
    case 'diamond':
      doc.polygon([cx, y], [x + size, cy], [cx, y + size], [x, cy]).fill();
      break;
    case 'square':
    default:
      doc.rect(x, y, size, size).fill();
      break;
  }
}

// ---------------------------------------------------------------------------
// Chart primitives (PDFKit vector only — no chart library, no headless browser)
// ---------------------------------------------------------------------------

type BarSeries = { label: string; color: string; values: number[] };

/** Grouped/overlaid bar chart with a left value axis and bottom category axis. Reads correctly in greyscale (distinct fills + a legend). */
function drawGroupedBarChart(
  ctx: PageCtx,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    categories: string[];
    series: BarSeries[];
    valueFormatter: (v: number) => string;
    yAxisLabel: string;
  },
): void {
  const { doc } = ctx;
  const {
    x,
    y,
    width,
    height,
    categories,
    series,
    valueFormatter,
    yAxisLabel,
  } = opts;
  const axisLeft = x + 44;
  const axisBottom = y + height - 20;
  const axisTop = y + 10;
  const plotWidth = x + width - axisLeft;

  const maxValue =
    Math.max(1, ...series.flatMap((s) => s.values.map((v) => v || 0))) * 1.15;

  // Gridlines + y-axis labels (4 bands).
  doc.fontSize(7).font(UI_FONT).fillColor(FAINT);
  const bands = 4;
  for (let i = 0; i <= bands; i += 1) {
    const gy = axisBottom - (i / bands) * (axisBottom - axisTop);
    doc
      .moveTo(axisLeft, gy)
      .lineTo(axisLeft + plotWidth, gy)
      .strokeColor(i === 0 ? '#d1d5db' : '#f0f1f3')
      .lineWidth(0.75)
      .stroke();
    doc.text(valueFormatter((maxValue * i) / bands), x, gy - 3, {
      width: axisLeft - x - 6,
      align: 'right',
      lineBreak: false,
    });
  }

  doc
    .save()
    .rotate(-90, { origin: [x + 8, y + height / 2] })
    .fontSize(7)
    .fillColor(FAINT)
    .text(yAxisLabel, x - 60 + 8, y + height / 2 - 4, {
      width: 120,
      align: 'center',
      lineBreak: false,
    })
    .restore();

  const groupWidth = plotWidth / categories.length;
  const barGap = 2;
  const barWidth = Math.max(
    2,
    (groupWidth - barGap * (series.length + 1)) / Math.max(1, series.length),
  );

  categories.forEach((cat, catIdx) => {
    const groupX = axisLeft + catIdx * groupWidth;
    series.forEach((s, seriesIdx) => {
      const value = s.values[catIdx] ?? 0;
      const barHeight = (value / maxValue) * (axisBottom - axisTop);
      const barX = groupX + barGap + seriesIdx * (barWidth + barGap);
      doc
        .rect(barX, axisBottom - barHeight, barWidth, barHeight)
        .fillColor(s.color)
        .fill();
    });
    doc
      .fontSize(6.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(cat, groupX, axisBottom + 4, {
        width: groupWidth,
        align: 'center',
        lineBreak: false,
      });
  });

  doc
    .moveTo(axisLeft, axisBottom)
    .lineTo(axisLeft + plotWidth, axisBottom)
    .strokeColor('#9ca3af')
    .lineWidth(1)
    .stroke();

  // Legend.
  let legendX = axisLeft;
  const legendY = y + height + 16;
  series.forEach((s) => {
    doc.rect(legendX, legendY, 8, 8).fillColor(s.color).fill();
    doc
      .fontSize(8)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(s.label, legendX + 12, legendY - 1, { lineBreak: false });
    legendX += 12 + doc.widthOfString(s.label) + 20;
  });
}

/**
 * Round 4: the finance page had only a table and a line — the one thing a
 * homeowner actually wants at a glance, "what have I paid vs. what have I
 * gotten back," took reading numbers to answer. A stacked bar of cumulative
 * cost against cumulative savings at a handful of year markers answers it
 * instantly, so this reuses the same vector-drawing approach as
 * `drawGroupedBarChart`/`drawCashflowChart` but stacks each category's
 * series instead of placing them side by side.
 */
function drawStackedBarChart(
  ctx: PageCtx,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    categories: string[];
    series: BarSeries[];
    valueFormatter: (v: number) => string;
  },
): void {
  const { doc } = ctx;
  const { x, y, width, height, categories, series, valueFormatter } = opts;
  // A currency-formatted value (e.g. "A$243,727") is wider than the 44pt
  // gutter `drawGroupedBarChart` uses for plain numbers, and this chart's
  // values run into six figures over a 25-year cashflow — that combination
  // wrapped the axis label onto two lines and collided with the rotated
  // axis title. Use a wider gutter and drop the redundant rotated title
  // (the legend below already names both series) instead.
  const axisLeft = x + 68;
  const axisBottom = y + height - 20;
  const axisTop = y + 10;
  const plotWidth = x + width - axisLeft;

  const stackTotals = categories.map((_, catIdx) =>
    series.reduce((sum, s) => sum + (s.values[catIdx] ?? 0), 0),
  );
  const maxValue = Math.max(1, ...stackTotals) * 1.15;

  // Gridlines + y-axis labels (4 bands).
  doc.fontSize(7).font(UI_FONT).fillColor(FAINT);
  const bands = 4;
  for (let i = 0; i <= bands; i += 1) {
    const gy = axisBottom - (i / bands) * (axisBottom - axisTop);
    doc
      .moveTo(axisLeft, gy)
      .lineTo(axisLeft + plotWidth, gy)
      .strokeColor(i === 0 ? '#d1d5db' : '#f0f1f3')
      .lineWidth(0.75)
      .stroke();
    doc.text(valueFormatter((maxValue * i) / bands), x, gy - 3, {
      width: axisLeft - x - 8,
      align: 'right',
      lineBreak: false,
    });
  }

  const groupWidth = plotWidth / categories.length;
  const barWidth = Math.min(40, groupWidth * 0.55);

  categories.forEach((cat, catIdx) => {
    const groupX = axisLeft + catIdx * groupWidth + (groupWidth - barWidth) / 2;
    let stackedSoFar = 0;
    series.forEach((s) => {
      const value = s.values[catIdx] ?? 0;
      const barHeight = (value / maxValue) * (axisBottom - axisTop);
      doc
        .rect(
          groupX,
          axisBottom - stackedSoFar - barHeight,
          barWidth,
          barHeight,
        )
        .fillColor(s.color)
        .fill();
      stackedSoFar += barHeight;
    });
    doc
      .fontSize(6.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(cat, groupX - (groupWidth - barWidth) / 2, axisBottom + 4, {
        width: groupWidth,
        align: 'center',
        lineBreak: false,
      });
  });

  doc
    .moveTo(axisLeft, axisBottom)
    .lineTo(axisLeft + plotWidth, axisBottom)
    .strokeColor('#9ca3af')
    .lineWidth(1)
    .stroke();

  // Legend.
  let legendX = axisLeft;
  const legendY = y + height + 16;
  series.forEach((s) => {
    doc.rect(legendX, legendY, 8, 8).fillColor(s.color).fill();
    doc
      .fontSize(8)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(s.label, legendX + 12, legendY - 1, { lineBreak: false });
    legendX += 12 + doc.widthOfString(s.label) + 20;
  });
}

/** 25-year cumulative cashflow line, with the payback (zero-crossing) year marked. */
function drawCashflowChart(
  ctx: PageCtx,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    cashflow: Array<{ year: number; cumulative: number }>;
    money: (v: number) => string;
    paybackYears: number | null;
    color: string;
  },
): void {
  const { doc } = ctx;
  const { x, y, width, height, cashflow, money, paybackYears, color } = opts;
  if (cashflow.length === 0) return;

  const axisLeft = x + 56;
  const axisBottom = y + height - 20;
  const axisTop = y + 10;
  const plotWidth = x + width - axisLeft;

  const values = cashflow.map((c) => c.cumulative);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  // A genuinely flat line (e.g. an all-zero cashflow) has maxValue ===
  // minValue. Flooring the range to 1 there used to synthesise a fake
  // $0-to-$1 scale so the axis printed "$0, $0, $0, $1, $1" — five labels
  // implying variation across a line that has none. Draw a single "$0"
  // (or whatever the flat value is) gridline instead of a fabricated band.
  const isFlat = maxValue === minValue;
  const range = isFlat ? 1 : maxValue - minValue;

  const toY = (v: number) =>
    axisBottom - ((v - minValue) / range) * (axisBottom - axisTop);
  const toX = (idx: number) =>
    axisLeft + (idx / Math.max(1, cashflow.length - 1)) * plotWidth;

  // Gridlines / axis labels.
  doc.fontSize(7).font(UI_FONT).fillColor(FAINT);
  if (isFlat) {
    const gy = toY(minValue);
    doc
      .moveTo(axisLeft, gy)
      .lineTo(axisLeft + plotWidth, gy)
      .strokeColor('#f0f1f3')
      .lineWidth(0.75)
      .stroke();
    doc.text(money(minValue), x, gy - 3, {
      width: axisLeft - x - 6,
      align: 'right',
      lineBreak: false,
    });
  } else {
    const bands = 4;
    for (let i = 0; i <= bands; i += 1) {
      const value = minValue + (range * i) / bands;
      const gy = toY(value);
      doc
        .moveTo(axisLeft, gy)
        .lineTo(axisLeft + plotWidth, gy)
        .strokeColor('#f0f1f3')
        .lineWidth(0.75)
        .stroke();
      doc.text(money(value), x, gy - 3, {
        width: axisLeft - x - 6,
        align: 'right',
        lineBreak: false,
      });
    }
  }

  // Zero line, emphasised.
  if (minValue < 0 && maxValue > 0) {
    const zeroY = toY(0);
    doc
      .moveTo(axisLeft, zeroY)
      .lineTo(axisLeft + plotWidth, zeroY)
      .strokeColor('#9ca3af')
      .lineWidth(1)
      .stroke();
  }

  // Cumulative line.
  doc.strokeColor(color).lineWidth(1.75);
  cashflow.forEach((point, idx) => {
    const px = toX(idx);
    const py = toY(point.cumulative);
    if (idx === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  });
  doc.stroke();

  // Payback marker.
  if (
    paybackYears !== null &&
    Number.isFinite(paybackYears) &&
    paybackYears > 0 &&
    paybackYears <= cashflow[cashflow.length - 1].year
  ) {
    const idx = paybackYears - 1;
    const px = toX(Math.max(0, Math.min(idx, cashflow.length - 1)));
    const py = toY(0);
    doc.circle(px, py, 3.5).fillColor(ctx.args.pdfPrimaryHex).fill();
    // A white backing plate keeps the label legible where it would otherwise
    // cross the sloped cashflow line or the zero gridline.
    const labelText = `Payback ~${paybackYears.toFixed(1)}y`;
    const labelY = py - 32;
    doc
      .rect(px - 42, labelY - 2, 84, 13)
      .fillColor('#ffffff')
      .fill();
    doc
      .fontSize(8)
      .font(UI_FONT_BOLD)
      .fillColor(ctx.args.pdfPrimaryHex)
      .text(labelText, px - 40, labelY, {
        width: 80,
        align: 'center',
        lineBreak: false,
      });
  }

  // X-axis year ticks (every 5 years).
  cashflow.forEach((point, idx) => {
    if (point.year % 5 !== 0 && idx !== 0 && idx !== cashflow.length - 1)
      return;
    doc
      .fontSize(6.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(`Y${point.year}`, toX(idx) - 10, axisBottom + 4, {
        width: 20,
        align: 'center',
        lineBreak: false,
      });
  });

  doc
    .moveTo(axisLeft, axisBottom)
    .lineTo(axisLeft + plotWidth, axisBottom)
    .strokeColor('#9ca3af')
    .lineWidth(1)
    .stroke();
}

// ---------------------------------------------------------------------------
// Roof render (shared by page 1 + page 4)
// ---------------------------------------------------------------------------

function drawRoofRenderBox(
  ctx: PageCtx,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { doc, args } = ctx;
  doc.save();
  doc.roundedRect(x, y, w, h, 8).clip();

  if (args.renderImageBytes) {
    try {
      doc.image(args.renderImageBytes, x, y, {
        cover: [w, h],
        align: 'center',
        valign: 'center',
      });
      doc.restore();
      doc
        .roundedRect(x, y, w, h, 8)
        .strokeColor(HAIRLINE)
        .lineWidth(1)
        .stroke();
      // §5/§6: a bare satellite photo with no roof outline/array overlay
      // looks identical to a fully-designed render, but the customer can't
      // match anything on it to the array table below. Never present it as
      // if it were the system design — caption it truthfully instead.
      if (!args.renderHasDesignOverlay) {
        doc
          .roundedRect(x, y, w, 20, 8)
          .fillColor(INK)
          .fillOpacity(0.72)
          .fill()
          .fillOpacity(1);
        doc
          .fontSize(7.5)
          .font(UI_FONT_BOLD)
          .fillColor('#ffffff')
          .text(
            'Aerial reference photo — system layout shown in the array table below',
            x + 8,
            y + 6,
            { width: w - 16, height: 10, lineBreak: false, ellipsis: true },
          );
      } else if (args.renderAttribution) {
        doc
          .fontSize(6.5)
          .font(UI_FONT)
          .fillColor('#ffffff')
          .text(args.renderAttribution, x + 8, y + h - 16, {
            width: w - 16,
            height: 9,
            lineBreak: false,
            ellipsis: true,
          });
      }
      return;
    } catch {
      // Fall through to the degraded layout below.
    }
  }

  doc.restore();
  // Non-negotiable: never a blank box or a red X. When there's no aerial
  // render, replace it with a *real* schematic built from the arrays we
  // actually designed — not a small centred icon floating in a grey field.
  // On a data-light job (one array) this still reads as a deliberately
  // designed summary card rather than an empty placeholder.
  //
  // Round 6, item 3: the plain flat-grey card with two thin outlines read
  // as "imagery failed" rather than "here is a real design summary" — give
  // it a proper header band (matching the brand colour, like every other
  // section header in this document) and a headline system-size stat, so
  // the page reads as content that was designed to be there, not a fallback.
  const headerHeight = 34;
  doc
    .roundedRect(x, y, w, h, 8)
    .fillColor('#f9fafb')
    .fill()
    .roundedRect(x, y, w, h, 8)
    .strokeColor(HAIRLINE)
    .lineWidth(1)
    .stroke();
  doc.save();
  doc.roundedRect(x, y, w, headerHeight, 8).clip();
  doc.rect(x, y, w, headerHeight).fillColor(INK).fill();
  doc.restore();

  const dcKw = args.simulation.system.dcKw;
  doc
    .fontSize(9.5)
    .font(UI_FONT_BOLD)
    .fillColor('#ffffff')
    .text('YOUR SYSTEM LAYOUT', x + 20, y + 12, { characterSpacing: 0.5 });
  doc
    .fontSize(9.5)
    .font(UI_FONT_BOLD)
    .fillColor('#ffffff')
    .text(`${dcKw.toFixed(1)} kW total`, x + 20, y + 12, {
      width: w - 40,
      align: 'right',
    });

  drawArraySchematicPanel(
    doc,
    args,
    x + 20,
    y + headerHeight + 16,
    w - 40,
    h - headerHeight - 60,
  );

  // Round 4: this path is only reachable when both the browser capture and
  // the server composite genuinely failed (a transient imagery outage), not
  // the ordinary case — so the caption should read like a deliberate,
  // confident design choice ("here is your system, drawn to scale") rather
  // than an apology for a missing photo. `renderDegradedReason` (a real,
  // specific failure explanation) still takes priority when set.
  doc
    .fontSize(8.5)
    .font(UI_FONT)
    .fillColor(FAINT)
    .text(
      args.renderDegradedReason ??
        'Your system, drawn to scale — array sizes are proportional to installed capacity.',
      x + 20,
      y + h - 30,
      { width: w - 40, align: 'center' },
    );
}

/**
 * Draws a data-driven schematic of every array (rectangle sized by its
 * share of total panel count, coloured + shaped per `ARRAY_PALETTE`, and
 * labelled with tilt/azimuth/panel count) in place of a bare aerial photo.
 * Real supporting content, not filler — the same numbers as the page 4
 * array table, just visualised.
 */
function drawArraySchematicPanel(
  doc: PDFKit.PDFDocument,
  args: BuildRoofProposalPdfArgs,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const arrays = args.arrays;
  if (arrays.length === 0) return;
  const totalPanels = arrays.reduce((s, a) => s + a.panelCount, 0) || 1;
  const gap = 14;
  const cardW = (w - gap * (arrays.length - 1)) / arrays.length;

  arrays.forEach((arr, idx) => {
    const cx = x + idx * (cardW + gap);
    const color = ARRAY_PALETTE[idx % ARRAY_PALETTE.length];
    const shape = ARRAY_SHAPES[idx % ARRAY_SHAPES.length];
    const share = arr.panelCount / totalPanels;
    // Card height scales with the array's share of the system, so a
    // dominant single array (or a lone array on a small job) still fills
    // most of the panel height rather than sitting in a slim sliver.
    const cardH = h * (0.55 + 0.45 * share);
    const cardY = y + (h - cardH);

    doc
      .roundedRect(cx, cardY, cardW, cardH, 6)
      .fillColor('#ffffff')
      .fill()
      .roundedRect(cx, cardY, cardW, cardH, 6)
      .strokeColor(color)
      .lineWidth(1.5)
      .stroke();

    drawArraySwatch(doc, cx + 10, cardY + 10, 9, color, shape);
    doc
      .fontSize(8.5)
      .font(UI_FONT_BOLD)
      .fillColor(INK)
      .text(truncate(arr.name, 20), cx + 24, cardY + 9, {
        width: cardW - 32,
        height: 11,
        lineBreak: false,
        ellipsis: true,
      });

    const detailY = cardY + cardH - 46;
    doc
      .fontSize(7.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(
        `${arr.panelCount} panels · ${arr.dcKw.toFixed(1)} kW`,
        cx + 10,
        detailY,
        {
          width: cardW - 20,
        },
      )
      .text(
        `${arr.tiltDegrees.toFixed(0)}° tilt · ${formatAzimuth(arr.azimuthDegrees)}`,
        cx + 10,
        detailY + 12,
        { width: cardW - 20 },
      );
  });
}

// ---------------------------------------------------------------------------
// Page 1 — cover
// ---------------------------------------------------------------------------

function drawCoverPage(ctx: PageCtx): void {
  const { doc, args, money } = ctx;
  const left = doc.page.margins.left;

  // Round 5, item 1 — P1 fix: `simulation.financial` is *never* null. When
  // no real quote exists, `computeFinancials` (financial.ts) silently
  // falls back to `dcWatts * DEFAULT_INSTALLED_COST_PER_WATT` — a
  // placeholder assumption its own module doc names as such — and still
  // produces a confident-looking ROI/payback/savings figure. Page 9 already
  // knows the difference (`args.totalPrice != null` gates its priced vs.
  // "pricing not finalised" branches); the cover must use the exact same
  // signal, not "is the number present," because the fallback path never
  // produces a missing number, only a fabricated one dressed as a real one.
  const hasRealPrice = args.totalPrice != null;

  // Round 4: a homeowner opening this PDF decides how they feel in about
  // three seconds — the money figures (when real) or the roof design (when
  // not) are what earns the next three, so they lead the page, not name/
  // address the homeowner already knows.
  // Brand banner — kept short so the roof render can dominate the page,
  // per round 5's "make the roof the hero" direction.
  const bannerHeight = 64;
  doc
    .rect(0, 0, doc.page.width, bannerHeight)
    .fillColor(args.pdfPrimaryHex)
    .fill();

  if (args.logoImageBytes) {
    try {
      doc.image(args.logoImageBytes, left, 14, {
        fit: [150, 34],
        valign: 'center',
      });
    } catch {
      // Ignore — fall through to text brand.
    }
  }
  doc
    .fillColor('#ffffff')
    .font(UI_FONT_BOLD)
    .fontSize(args.logoImageBytes ? 10.5 : 16)
    .text(
      truncate(args.pdfBrandName, args.logoImageBytes ? 40 : 30),
      args.logoImageBytes ? left + 162 : left,
      args.logoImageBytes ? 20 : 16,
      {
        width: ctx.pageWidth - (args.logoImageBytes ? 162 : 0),
        height: args.logoImageBytes ? 13 : 20,
        lineBreak: false,
        ellipsis: true,
      },
    );
  doc
    .fillColor('#ffffff')
    .font(UI_FONT)
    .fontSize(9)
    .text('Solar system proposal', left, args.logoImageBytes ? 38 : 38, {
      lineBreak: false,
    });

  // The hero: this customer's own roof, drawn large — the thing a stock
  // photo can't be. One number leads; the other two support it in a single
  // band directly under the image, rather than three identical grey tiles
  // competing for attention above it.
  const statBandHeight = 96;
  // The unpriced sentence below the identity line wraps to ~2 lines at this
  // width, unlike the single-line italic disclaimer it replaces — reserve
  // enough room for it up front so it isn't pushed past `contentBottom`
  // (which silently drops it off the page rather than visibly overflowing).
  // The stale-price and declined/expired variants are longer still (wrap to
  // up to 3 lines) — same page-overflow trap round 5 already got bitten by
  // once, so they get their own, larger reservation rather than reusing the
  // 2-line unpriced budget.
  const identityHeight = hasRealPrice
    ? 62
    : args.priceStaleSinceDesignChange || args.priceDeclinedOrExpired
      ? 102
      : 88;
  const heroTop = bannerHeight + 16;
  const heroHeight = Math.max(
    220,
    ctx.contentBottom - heroTop - statBandHeight - identityHeight,
  );
  drawRoofRenderBox(ctx, left, heroTop, ctx.pageWidth, heroHeight);

  const bandTop = heroTop + heroHeight;
  doc.rect(0, bandTop, doc.page.width, statBandHeight).fillColor(INK).fill();

  const fin = args.simulation.financial;
  const dcKw = args.simulation.system.dcKw;
  const totalPanels = args.arrays.reduce((sum, a) => sum + a.panelCount, 0);

  // Leading figure: the single most persuasive real number available. A
  // fabricated ROI is never that number — when there's no real price, the
  // system itself (verified, not estimated) leads instead, and the two
  // supporting stats stay non-financial too, so nothing on this band is a
  // placeholder wearing a confident font size.
  const leading = hasRealPrice
    ? { label: 'Estimated year 1 savings', value: money(fin.year1Savings) }
    : { label: 'Your custom system size', value: `${dcKw.toFixed(1)} kW` };
  const supporting: Array<[string, string]> = hasRealPrice
    ? [
        ['25-year ROI', `${Math.round(fin.roiPercent)}%`],
        ['Est. payback', `${fin.paybackYears.toFixed(1)} yrs`],
      ]
    : [
        ['Panels', `${totalPanels}`],
        ['System type', args.systemTypeLabel],
      ];

  doc
    .fillColor('#d1d5db')
    .font(UI_FONT_BOLD)
    .fontSize(9)
    .text(leading.label.toUpperCase(), left, bandTop + 16, {
      characterSpacing: 0.3,
      lineBreak: false,
    });
  doc
    .fillColor('#ffffff')
    .font(UI_FONT_BOLD)
    .fontSize(34)
    .text(leading.value, left, bandTop + 30, {
      width: ctx.pageWidth * 0.55,
      height: 42,
      lineBreak: false,
      ellipsis: true,
    });

  const supportX = left + ctx.pageWidth * 0.6;
  const supportW = ctx.pageWidth * 0.4;
  supporting.forEach(([label, value], idx) => {
    const sy = bandTop + 18 + idx * 34;
    doc
      .fillColor('#d1d5db')
      .font(UI_FONT)
      .fontSize(8)
      .text(label.toUpperCase(), supportX, sy, {
        width: supportW,
        characterSpacing: 0.2,
        lineBreak: false,
      });
    doc
      .fillColor('#ffffff')
      .font(UI_FONT_BOLD)
      .fontSize(14)
      .text(value, supportX, sy + 11, {
        width: supportW,
        height: 16,
        lineBreak: false,
        ellipsis: true,
      });
  });

  // Identity line, and — when pricing isn't final — an explicit, unmissable
  // statement to that effect. This is deliberately its own full-weight
  // sentence, not a small italic caption: the italic disclaimer this page
  // used to carry only covered the *tariff* assumption, never the fact that
  // the cost basis itself is a placeholder, which is the actual P1 here.
  let y = bandTop + statBandHeight + 16;
  doc
    .fillColor(INK)
    .font(UI_FONT_BOLD)
    .fontSize(13)
    .text(truncate(args.customerName, 60), left, y, {
      width: ctx.pageWidth,
      height: 17,
      lineBreak: false,
      ellipsis: true,
    });
  y += 17;
  doc
    .fillColor(MUTED)
    .font(UI_FONT)
    .fontSize(9.5)
    .text(
      `${truncate(args.customerAddress, 60) || 'Address on file'}  ·  ${dcKw.toFixed(1)} kW ${args.systemTypeLabel}  ·  Order #${args.orderNumber}`,
      left,
      y,
      { width: ctx.pageWidth, height: 12, lineBreak: false, ellipsis: true },
    );
  y += 15;

  if (!hasRealPrice) {
    doc
      .fontSize(9)
      .font(UI_FONT_BOLD)
      .fillColor(args.pdfPrimaryHex)
      .text(
        args.priceStaleSinceDesignChange
          ? 'This system has changed since it was priced — the quoted figures no longer match the design shown here. Please contact your consultant for an updated price.'
          : args.priceDeclinedOrExpired
            ? 'This proposal was previously priced but that offer is no longer current — see page 9, or contact your consultant for an updated quote.'
            : 'Pricing for this proposal has not been finalised yet — see page 9 for full investment details once your consultant confirms the quote.',
        left,
        y,
        { width: ctx.pageWidth },
      );
  } else {
    doc
      .fontSize(7.5)
      .font(UI_FONT_OBLIQUE)
      .fillColor(FAINT)
      .text(
        'Estimates based on typical utility rates and system performance — see page 2 for details.',
        left,
        y,
        { width: ctx.pageWidth, lineBreak: false },
      );
  }
}

// ---------------------------------------------------------------------------
// Page 2 — executive summary
// ---------------------------------------------------------------------------

function drawExecutiveSummaryPage(ctx: PageCtx): void {
  const { doc, args, money } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Executive summary');
  const left = doc.page.margins.left;

  doc
    .fillColor(INK)
    .font(UI_FONT)
    .fontSize(10.5)
    .text(
      `${args.customerName}, here is your system at a glance. ${args.pdfThankYou}`.trim(),
      left,
      y,
      { width: ctx.pageWidth },
    );
  y = doc.y + 20;

  const sim = args.simulation;
  const cardGap = 12;
  const cardW = (ctx.pageWidth - cardGap * 2) / 3;
  const cardH = 58;
  const metrics: Array<[string, string | null]> = [
    ['System size', `${sim.system.dcKw.toFixed(1)} kW DC`],
    [
      'Annual production',
      `${Math.round(sim.production.annualKwh).toLocaleString('en-US')} kWh`,
    ],
    [
      'Energy offset',
      sim.offset.offsetPercent != null
        ? `${sim.offset.offsetPercent.toFixed(0)}%`
        : null,
    ],
    [
      'Year 1 savings',
      sim.financial.year1Savings != null
        ? money(sim.financial.year1Savings)
        : null,
    ],
    [
      'Net investment',
      sim.financial.netCost != null ? money(sim.financial.netCost) : null,
    ],
    [
      'Estimated payback',
      sim.financial.paybackYears != null &&
      Number.isFinite(sim.financial.paybackYears)
        ? `${sim.financial.paybackYears.toFixed(1)} years`
        : null,
    ],
  ];
  metrics.forEach(([label, value], idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    drawMetricCard(
      ctx,
      left + col * (cardW + cardGap),
      y + row * (cardH + cardGap),
      cardW,
      cardH,
      label,
      value,
    );
  });
  y += 2 * (cardH + cardGap) + 10;

  y = sectionHeading(ctx, 'What this means for you', y);
  const bullets: string[] = [];
  bullets.push(
    `Your ${sim.system.dcKw.toFixed(1)} kW system is expected to produce ${Math.round(
      sim.production.annualKwh,
    ).toLocaleString('en-US')} kWh in its first year — about ${
      sim.production.performanceRatio != null
        ? `${(sim.production.performanceRatio * 100).toFixed(0)}%`
        : 'a strong'
    } of the system's theoretical potential.`,
  );
  if (sim.offset.offsetPercent != null) {
    bullets.push(
      `That covers approximately ${sim.offset.offsetPercent.toFixed(0)}% of your household's annual usage.`,
    );
  }
  if (
    sim.financial.paybackYears != null &&
    Number.isFinite(sim.financial.paybackYears)
  ) {
    bullets.push(
      `At current rates, the system is projected to pay for itself in around ${sim.financial.paybackYears.toFixed(
        1,
      )} years, then continue delivering savings for the rest of its life.`,
    );
  }
  bullets.forEach((line) => {
    doc
      .fillColor(INK)
      .font(UI_FONT)
      .fontSize(10)
      .text(`•  ${line}`, left, y, { width: ctx.pageWidth });
    y = doc.y + 8;
  });

  if (sim.warnings.some((w) => w.tone === 'warning' || w.tone === 'error')) {
    y += 6;
    doc
      .fontSize(8.5)
      .font(UI_FONT_OBLIQUE)
      .fillColor(MUTED)
      .text(
        'Your design has notes flagged for review by your consultant — see your coordinator for details.',
        left,
        y,
        { width: ctx.pageWidth },
      );
    y = doc.y + 8;
  }

  // Long-run financial detail — genuine simulation output that otherwise
  // never appears anywhere in the proposal, not filler.
  y += 20;
  y = sectionHeading(ctx, 'Long-term outlook', y);
  const cardW2 = (ctx.pageWidth - 24) / 3;
  const longTermCards: Array<[string, string | null]> = [
    [
      '25-year ROI',
      sim.financial.roiPercent != null
        ? `${sim.financial.roiPercent.toFixed(0)}%`
        : null,
    ],
    [
      'Self-sufficiency',
      sim.offset.selfSufficiencyPercent != null
        ? `${sim.offset.selfSufficiencyPercent.toFixed(0)}%`
        : null,
    ],
    [
      'Net present value',
      sim.financial.npv != null ? money(sim.financial.npv) : null,
    ],
  ];
  longTermCards.forEach(([label, value], idx) => {
    drawMetricCard(
      ctx,
      left + idx * (cardW2 + 12),
      y,
      cardW2,
      64,
      label,
      value,
    );
  });
  y += 64 + 16;
  doc
    .fontSize(8)
    .font(UI_FONT)
    .fillColor(FAINT)
    .text(
      'ROI and net present value are estimates over a 25-year system life at the assumed utility escalation rate; actual results will vary with usage, rates and maintenance.',
      left,
      y,
      { width: ctx.pageWidth },
    );
}

// ---------------------------------------------------------------------------
// Page 3 — your energy today
// ---------------------------------------------------------------------------

function drawEnergyTodayPage(ctx: PageCtx): void {
  const { doc, args, money } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Your energy today');
  const left = doc.page.margins.left;
  const sim = args.simulation;

  const cardGap = 12;
  const cardW = (ctx.pageWidth - cardGap * 2) / 3;
  const cardH = 54;
  const items: Array<[string, string | null]> = [
    [
      'Current monthly bill',
      args.monthlyBillBefore != null ? money(args.monthlyBillBefore) : null,
    ],
    [
      'Annual usage',
      sim.consumption.annualKwh != null
        ? `${Math.round(sim.consumption.annualKwh).toLocaleString('en-US')} kWh`
        : null,
    ],
    [
      // Not "Import rate" — nothing upstream of this proposal-generation
      // path currently persists a per-job tariff (the design studio's live
      // simulate() call accepts one as an ephemeral request field, but it
      // is never saved against the job/roof design), so that card was a
      // permanent "Not available" with no route to ever being filled in.
      // Average daily usage is derived from the same `annualKwh` this page
      // already shows and is always available whenever that is.
      'Average daily usage',
      sim.consumption.annualKwh != null
        ? `${(sim.consumption.annualKwh / 365).toFixed(1)} kWh/day`
        : null,
    ],
  ];
  items.forEach(([label, value], idx) => {
    drawMetricCard(
      ctx,
      left + idx * (cardW + cardGap),
      y,
      cardW,
      cardH,
      label,
      value,
    );
  });
  y += cardH + 24;

  y = sectionHeading(ctx, 'Monthly consumption', y);
  doc
    .fontSize(9)
    .font(UI_FONT)
    .fillColor(MUTED)
    .text(
      sim.consumption.source === 'bill'
        ? 'Based on your utility bill history.'
        : sim.consumption.source === 'interval'
          ? 'Based on interval meter data.'
          : 'Estimated from your household profile — replace with a bill for a more precise figure.',
      left,
      y,
      { width: ctx.pageWidth },
    );
  y = doc.y + 10;

  const chartHeight = 320;
  drawGroupedBarChart(ctx, {
    x: left,
    y,
    width: ctx.pageWidth,
    height: chartHeight,
    categories: MONTH_LABELS,
    series: [
      {
        label: 'Consumption',
        color: MUTED,
        values: sim.consumption.monthlyKwh,
      },
    ],
    valueFormatter: (v) => `${Math.round(v)}`,
    yAxisLabel: 'kWh',
  });
  y += chartHeight + 56;

  const peakIdx = sim.consumption.monthlyKwh.reduce(
    (best, v, i) => (v > sim.consumption.monthlyKwh[best] ? i : best),
    0,
  );
  const lowIdx = sim.consumption.monthlyKwh.reduce(
    (best, v, i) => (v < sim.consumption.monthlyKwh[best] ? i : best),
    0,
  );
  y = sectionHeading(ctx, 'What this means for sizing', y);
  const lowVal = sim.consumption.monthlyKwh[lowIdx];
  const peakVal = sim.consumption.monthlyKwh[peakIdx];
  const swingText =
    lowVal > 0
      ? `about ${Math.round((peakVal / lowVal - 1) * 100)}% above your lightest month, ${MONTH_LABELS[lowIdx]}. `
      : `well above your lightest month, ${MONTH_LABELS[lowIdx]}. `;
  doc
    .fontSize(9)
    .font(UI_FONT)
    .fillColor(MUTED)
    .text(
      `Your household's heaviest month is ${MONTH_LABELS[peakIdx]}, at ${Math.round(peakVal).toLocaleString('en-US')} kWh — ` +
        swingText +
        `The system on the following pages is sized against this full 12-month profile, not just the annual total, so seasonal swings like this are already accounted for.`,
      left,
      y,
      { width: ctx.pageWidth },
    );
}

// ---------------------------------------------------------------------------
// Page 4 — your roof & system design
// ---------------------------------------------------------------------------

function drawRoofDesignPage(ctx: PageCtx): void {
  const { doc, args } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Your roof & system design');
  const left = doc.page.margins.left;

  const renderHeight = 200;
  drawRoofRenderBox(ctx, left, y, ctx.pageWidth, renderHeight);
  y += renderHeight + 20;

  y = sectionHeading(ctx, 'Array details', y);

  const columns = [
    { key: 'swatch', label: '', width: 14 },
    { key: 'name', label: 'Array', width: ctx.pageWidth * 0.24 - 14 },
    { key: 'tilt', label: 'Tilt', width: ctx.pageWidth * 0.13 },
    { key: 'azimuth', label: 'Facing', width: ctx.pageWidth * 0.2 },
    { key: 'panels', label: 'Panels', width: ctx.pageWidth * 0.13 },
    { key: 'kw', label: 'kW DC', width: ctx.pageWidth * 0.1 },
    { key: 'kwh', label: 'Annual kWh', width: ctx.pageWidth * 0.2 },
  ] as const;

  const drawRow = (
    values: Record<string, string>,
    rowY: number,
    opts: {
      header?: boolean;
      swatchColor?: string;
      swatchShape?: (typeof ARRAY_SHAPES)[number];
    },
  ) => {
    let x = left;
    columns.forEach((col) => {
      if (col.key === 'swatch') {
        if (opts.swatchColor) {
          drawArraySwatch(
            doc,
            x + 2,
            rowY + 2,
            8,
            opts.swatchColor,
            opts.swatchShape ?? 'square',
          );
        }
      } else {
        doc
          .font(opts.header ? UI_FONT_BOLD : UI_FONT)
          .fontSize(9)
          .fillColor(opts.header ? ctx.args.pdfPrimaryHex : INK)
          .text(values[col.key] ?? '', x, rowY, {
            width: col.width - 6,
            height: 12,
            lineBreak: false,
            ellipsis: true,
          });
      }
      x += col.width;
    });
  };

  drawRow(
    {
      name: 'Array',
      tilt: 'Tilt',
      azimuth: 'Facing',
      panels: 'Panels',
      kw: 'kW DC',
      kwh: 'Annual kWh',
    },
    y,
    { header: true },
  );
  y += 14;
  doc
    .moveTo(left, y)
    .lineTo(ctx.contentRight, y)
    .strokeColor(HAIRLINE)
    .lineWidth(1)
    .stroke();
  y += 8;

  args.arrays.forEach((arr, idx) => {
    const color = ARRAY_PALETTE[idx % ARRAY_PALETTE.length];
    const shape = ARRAY_SHAPES[idx % ARRAY_SHAPES.length];
    drawRow(
      {
        name: truncate(arr.name, 26),
        tilt: `${arr.tiltDegrees.toFixed(0)}°`,
        azimuth: formatAzimuth(arr.azimuthDegrees),
        panels: String(arr.panelCount),
        kw: arr.dcKw.toFixed(2),
        kwh: `${Math.round(arr.annualKwh).toLocaleString('en-US')}`,
      },
      y,
      { swatchColor: color, swatchShape: shape },
    );
    y += 20;
  });

  if (args.arrays.length === 0) {
    doc
      .fontSize(9)
      .font(UI_FONT_OBLIQUE)
      .fillColor(MUTED)
      .text('No roof arrays have been drawn for this design yet.', left, y);
    return;
  }

  y += 24;
  y = sectionHeading(ctx, 'What shapes this design', y);
  // `climateDataSourceLabel` on the simulation result is a full, standalone
  // sentence ("Provisional estimate from a regional latitude-band
  // average — not measured for this address; treat as a rough guide
  // only."), not a noun phrase — splicing it into the middle of another
  // sentence produced a capitalised word mid-clause and a stray "., " on
  // nearly every first proposal (the fallback-estimate path is the
  // cache-miss default). Use a short inline phrase here instead, and — only
  // for the fallback-estimate case, where a homeowner genuinely benefits
  // from knowing it — show the engine's full sentence as its own separate
  // caveat line afterward.
  const climateSource = args.simulation.production.climateDataSource;
  const climateSourcePhrase =
    climateSource === 'real'
      ? 'real satellite-derived irradiance for this location'
      : climateSource === 'override'
        ? 'a supplied irradiance override'
        : 'a regional latitude-band irradiance estimate';
  doc
    .fontSize(9)
    .font(UI_FONT)
    .fillColor(MUTED)
    .text(
      `Production estimates use ${climateSourcePhrase}, adjusted for ` +
        'the real-world losses below — the gap between nameplate DC capacity and the annual kWh figures on this proposal.',
      left,
      y,
      { width: ctx.pageWidth },
    );
  y = doc.y + 6;
  if (climateSource === 'fallback-estimate') {
    doc
      .fontSize(8)
      .font(UI_FONT_OBLIQUE)
      .fillColor(FAINT)
      .text(args.simulation.production.climateDataSourceLabel, left, y, {
        width: ctx.pageWidth,
      });
    y = doc.y + 10;
  }
  y += 10;

  const lossStack = args.simulation.production.lossStack;
  const lossItems: Array<[string, number]> = [
    ['Soiling (dust, dirt, debris)', lossStack.soilingPercent],
    ['Shading (weighted average)', lossStack.shadingPercentWeightedAvg],
    ['Module mismatch', lossStack.mismatchPercent],
    ['DC wiring', lossStack.wiringPercent],
    ['Connections', lossStack.connectionsPercent],
    ['Light-induced degradation', lossStack.lightInducedDegradationPercent],
    ['Nameplate tolerance', lossStack.nameplatePercent],
    ['System availability', lossStack.availabilityPercent],
    ['Temperature', lossStack.temperaturePercent],
    ['Inverter conversion', lossStack.inverterPercent],
  ];
  const maxLoss = Math.max(...lossItems.map(([, v]) => v), 1);
  const rowH = 18;
  const labelW = ctx.pageWidth * 0.42;
  const barW = ctx.pageWidth - labelW - 46;

  lossItems.forEach(([label, value], idx) => {
    const rowY = y + idx * rowH;
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(label, left, rowY + 3, {
        width: labelW - 8,
        height: 11,
        lineBreak: false,
        ellipsis: true,
      });
    const barX = left + labelW;
    doc
      .rect(barX, rowY + 2, barW, 8)
      .fillColor(HAIRLINE)
      .fill();
    doc
      .rect(barX, rowY + 2, Math.max(2, (value / maxLoss) * barW), 8)
      .fillColor(args.pdfPrimaryHex)
      .fill();
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(INK)
      .text(`${value.toFixed(1)}%`, barX + barW + 6, rowY + 3, {
        width: 36,
      });
  });
}

// ---------------------------------------------------------------------------
// Page 5 — production
// ---------------------------------------------------------------------------

function drawProductionPage(ctx: PageCtx): void {
  const { doc, args } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Production');
  const left = doc.page.margins.left;
  const sim = args.simulation;

  const cardGap = 12;
  const cardW = (ctx.pageWidth - cardGap * 2) / 3;
  const cardH = 54;
  const items: Array<[string, string | null]> = [
    [
      'Specific yield',
      sim.production.specificYieldKwhPerKwp != null
        ? `${Math.round(sim.production.specificYieldKwhPerKwp)} kWh/kWp`
        : null,
    ],
    [
      'Performance ratio',
      sim.production.performanceRatio != null
        ? `${(sim.production.performanceRatio * 100).toFixed(0)}%`
        : null,
    ],
    [
      'Year-1 degradation',
      `${sim.production.firstYearDegradationPercent.toFixed(1)}%`,
    ],
  ];
  items.forEach(([label, value], idx) => {
    drawMetricCard(
      ctx,
      left + idx * (cardW + cardGap),
      y,
      cardW,
      cardH,
      label,
      value,
    );
  });
  y += cardH + 24;

  y = sectionHeading(ctx, 'Production vs. consumption', y);
  drawGroupedBarChart(ctx, {
    x: left,
    y,
    width: ctx.pageWidth,
    height: 210,
    categories: MONTH_LABELS,
    series: [
      {
        label: 'Production',
        color: args.pdfPrimaryHex,
        values: sim.production.monthlyKwh,
      },
      {
        label: 'Consumption',
        color: MUTED,
        values: sim.consumption.monthlyKwh,
      },
    ],
    valueFormatter: (v) => `${Math.round(v)}`,
    yAxisLabel: 'kWh',
  });
}

// ---------------------------------------------------------------------------
// Page 6 — savings & payback
// ---------------------------------------------------------------------------

function drawSavingsPage(ctx: PageCtx): void {
  const { doc, args, money } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Savings & payback');
  const left = doc.page.margins.left;
  const sim = args.simulation;

  // Round 10: this banner used to fire unconditionally, because no caller
  // on this path ever supplied a per-customer tariff — there was nowhere on
  // the job/customer to configure one, so every figure genuinely rested on
  // the engine's defaults and the disclaimer was always accurate. Now that
  // `roof-proposal.service.ts` reads a customer's captured import/feed-in/
  // supply-charge rates when both are present, that disclaimer would be a
  // false one half the time — undersells figures actually grounded in the
  // customer's own bill. Mirrors `climateDataSource`'s pattern: branch on
  // the engine's own `tariffSource` flag rather than re-deriving "did we
  // have real rates" locally, so this can't drift out of sync with what
  // `computeFinancials` actually used.
  // Defensive on top of the `tariffSource` flag: if the caller ever reports
  // `'customer'` without actually attaching both rates (a contract
  // violation elsewhere), fall back to the honest "standard assumptions"
  // copy rather than rendering `$undefined/kWh`.
  const usedCustomerTariff =
    sim.financial.tariffSource === 'customer' &&
    args.customerImportTariffPerKwh != null &&
    args.customerFeedInTariffPerKwh != null;
  doc.roundedRect(left, y, ctx.pageWidth, 46, 6).fillColor('#fffbeb').fill();
  doc
    .fontSize(8.5)
    .font(UI_FONT)
    .fillColor('#92400e')
    .text(
      usedCustomerTariff
        ? // Escalation and discount-rate assumptions aren't captured
          // per-customer anywhere in the schema (only import/feed-in/supply
          // are) — so only claim what's actually true; those two stay
          // standard-assumption figures, stated as such rather than
          // silently folded into "your rates".
          `These figures use the electricity rates you provided — $${args.customerImportTariffPerKwh!.toFixed(2)}/kWh import, $${args.customerFeedInTariffPerKwh!.toFixed(2)}/kWh feed-in${args.customerDailySupplyCharge != null ? `, $${args.customerDailySupplyCharge.toFixed(2)}/day supply charge` : ''} — check these against your bill. Long-term rate escalation (${DEFAULT_TARIFF_ESCALATION_PERCENT}%/yr) and the NPV discount rate (${DEFAULT_DISCOUNT_RATE_PERCENT}%) still use standard industry assumptions, not a figure you provided.`
        : `These figures assume typical utility rates — $${DEFAULT_IMPORT_TARIFF_PER_KWH.toFixed(2)}/kWh import, $${DEFAULT_FEED_IN_TARIFF_PER_KWH.toFixed(2)}/kWh feed-in, $${DEFAULT_DAILY_SUPPLY_CHARGE.toFixed(2)}/day supply charge, ${DEFAULT_TARIFF_ESCALATION_PERCENT}%/yr rate escalation, ${DEFAULT_DISCOUNT_RATE_PERCENT}% discount rate — not a rate you provided. If your actual utility rates differ, ask your consultant to re-run this proposal with them.`,
      left + 12,
      y + 8,
      { width: ctx.pageWidth - 24 },
    );
  y += 46 + 18;

  const cardGap = 12;
  const cardW = (ctx.pageWidth - cardGap * 2) / 3;
  const cardH = 54;
  const items: Array<[string, string | null]> = [
    [
      'Bill before solar',
      sim.financial.monthlyBillBefore != null
        ? money(sim.financial.monthlyBillBefore)
        : null,
    ],
    ['Bill after solar', money(sim.financial.monthlyBillAfter)],
    [
      'Estimated payback',
      sim.financial.paybackYears != null &&
      Number.isFinite(sim.financial.paybackYears)
        ? `${sim.financial.paybackYears.toFixed(1)} years`
        : null,
    ],
  ];
  items.forEach(([label, value], idx) => {
    drawMetricCard(
      ctx,
      left + idx * (cardW + cardGap),
      y,
      cardW,
      cardH,
      label,
      value,
    );
  });
  y += cardH + 24;

  y = sectionHeading(ctx, '25-year cumulative cashflow', y);
  drawCashflowChart(ctx, {
    x: left,
    y,
    width: ctx.pageWidth,
    height: 210,
    cashflow: sim.financial.cashflow,
    money,
    paybackYears: Number.isFinite(sim.financial.paybackYears)
      ? sim.financial.paybackYears
      : null,
    color: args.pdfPrimaryHex,
  });
  y += 210 + 44;

  if (y < ctx.contentBottom - 90) {
    y = sectionHeading(ctx, 'Selected years', y);
    const milestoneYears = [1, 5, 10, 15, 20, 25];
    const colWidth = ctx.pageWidth / milestoneYears.length;
    milestoneYears.forEach((yr, idx) => {
      const entry = sim.financial.cashflow.find((c) => c.year === yr);
      const x = left + idx * colWidth;
      doc
        .fontSize(8)
        .font(UI_FONT)
        .fillColor(MUTED)
        .text(`Year ${yr}`, x, y, { width: colWidth - 6, lineBreak: false });
      doc
        .fontSize(10)
        .font(UI_FONT_BOLD)
        .fillColor(INK)
        .text(entry ? money(entry.cumulative) : '—', x, y + 12, {
          width: colWidth - 6,
          lineBreak: false,
        });
    });
  }
}

// ---------------------------------------------------------------------------
// Page 7 — equipment
// ---------------------------------------------------------------------------

function drawEquipmentIcon(
  doc: Doc,
  kind: 'panel' | 'inverter' | 'battery',
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  doc.save();
  doc.strokeColor(color).lineWidth(1.4);
  if (kind === 'panel') {
    doc.rect(x, y, size, size * 0.7).stroke();
    const cols = 3;
    const rows = 2;
    for (let c = 1; c < cols; c += 1) {
      doc
        .moveTo(x + (size / cols) * c, y)
        .lineTo(x + (size / cols) * c, y + size * 0.7)
        .stroke();
    }
    for (let r = 1; r < rows; r += 1) {
      doc
        .moveTo(x, y + (size * 0.7 * r) / rows)
        .lineTo(x + size, y + (size * 0.7 * r) / rows)
        .stroke();
    }
  } else if (kind === 'inverter') {
    doc.roundedRect(x, y, size * 0.7, size * 0.7, 4).stroke();
    doc
      .moveTo(x + size * 0.12, y + size * 0.35)
      .lineTo(x + size * 0.28, y + size * 0.35)
      .lineTo(x + size * 0.34, y + size * 0.18)
      .lineTo(x + size * 0.4, y + size * 0.52)
      .lineTo(x + size * 0.46, y + size * 0.35)
      .lineTo(x + size * 0.58, y + size * 0.35)
      .stroke();
  } else {
    doc.roundedRect(x, y, size * 0.5, size * 0.75, 3).stroke();
    doc
      .rect(x + size * 0.18, y - size * 0.06, size * 0.14, size * 0.06)
      .fillColor(color)
      .fill();
  }
  doc.restore();
}

function drawEquipmentSection(
  ctx: PageCtx,
  title: string,
  kind: 'panel' | 'inverter' | 'battery',
  rows: RoofProposalEquipmentRow[],
  y: number,
): number {
  const { doc, args } = ctx;
  const left = doc.page.margins.left;
  if (rows.length === 0) return y;

  y = sectionHeading(ctx, title, y);
  rows.forEach((row) => {
    const cardH = 46;
    doc
      .roundedRect(left, y, ctx.pageWidth, cardH, 6)
      .fillColor('#f9fafb')
      .fill();
    drawEquipmentIcon(doc, kind, left + 14, y + 8, 28, args.pdfPrimaryHex);
    doc
      .fontSize(10)
      .font(UI_FONT_BOLD)
      .fillColor(INK)
      .text(truncate(row.name, 48), left + 56, y + 8, {
        width: ctx.pageWidth * 0.5,
        height: 13,
        lineBreak: false,
        ellipsis: true,
      });
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(truncate(row.specLines.join('  ·  '), 90), left + 56, y + 22, {
        width: ctx.pageWidth * 0.55,
        height: 11,
        lineBreak: false,
        ellipsis: true,
      });
    doc
      .fontSize(10)
      .font(UI_FONT_BOLD)
      .fillColor(INK)
      .text(`Qty ${row.quantity}`, ctx.contentRight - 80, y + 16, {
        width: 80,
        align: 'right',
        lineBreak: false,
      });
    y += cardH + 8;
  });
  return y + 10;
}

function drawEquipmentPage(ctx: PageCtx): void {
  const { doc, args } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Equipment');

  y = drawEquipmentSection(
    ctx,
    'Solar panels',
    'panel',
    args.equipmentPanels,
    y,
  );
  y = drawEquipmentSection(
    ctx,
    'Inverters',
    'inverter',
    args.equipmentInverters,
    y,
  );
  y = drawEquipmentSection(
    ctx,
    'Battery storage',
    'battery',
    args.equipmentBatteries,
    y,
  );

  if (
    args.equipmentPanels.length === 0 &&
    args.equipmentInverters.length === 0 &&
    args.equipmentBatteries.length === 0
  ) {
    doc
      .fontSize(9)
      .font(UI_FONT_OBLIQUE)
      .fillColor(MUTED)
      .text(
        'Equipment selection has not been finalised for this job yet.',
        doc.page.margins.left,
        y,
      );
    return;
  }

  // Warranty coverage summary — genuine, derived from the manufacturer
  // warranty years already printed on each equipment line above (never
  // fabricated), just rolled up so the customer doesn't have to compare
  // each row by hand.
  const left = doc.page.margins.left;
  const allRows = [
    ...args.equipmentPanels,
    ...args.equipmentInverters,
    ...args.equipmentBatteries,
  ];
  const warrantyYears: number[] = [];
  for (const row of allRows) {
    for (const line of row.specLines) {
      const match = /(\d+)\s*yr warranty/i.exec(line);
      if (match) warrantyYears.push(Number(match[1]));
    }
  }
  if (warrantyYears.length > 0) {
    const minYr = Math.min(...warrantyYears);
    const maxYr = Math.max(...warrantyYears);
    y += 20;
    y = sectionHeading(ctx, 'Warranty coverage', y);
    const summary =
      minYr === maxYr
        ? `Every component in this system carries a manufacturer warranty of ${minYr} years.`
        : `Manufacturer warranties across this system range from ${minYr} to ${maxYr} years, depending on the component — see each item above for its specific term.`;
    doc
      .fontSize(9.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(summary, left, y, { width: ctx.pageWidth });
    y = doc.y + 18;
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(FAINT)
      .text(
        'Warranty terms are set by each manufacturer and are separate from any installation workmanship warranty in your contract.',
        left,
        y,
        { width: ctx.pageWidth },
      );
  }
}

// ---------------------------------------------------------------------------
// Page 8 — environmental impact
// ---------------------------------------------------------------------------

function drawEnvironmentPage(ctx: PageCtx): void {
  const { doc, args } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Environmental impact');
  const left = doc.page.margins.left;
  const env = args.simulation.environment;

  doc
    .fontSize(10.5)
    .font(UI_FONT)
    .fillColor(INK)
    .text(
      "Every kilowatt-hour your system produces is a kilowatt-hour the grid does not have to generate from fossil fuels. Over the system's life, that adds up.",
      left,
      y,
      { width: ctx.pageWidth },
    );
  y = doc.y + 26;

  const cardGap = 14;
  const cardW = (ctx.pageWidth - cardGap * 2) / 3;
  const cardH = 110;
  const items: Array<{ label: string; value: string | null; sub: string }> = [
    {
      label: 'CO2 avoided / year',
      value:
        env.co2AvoidedTonnesPerYear != null
          ? `${env.co2AvoidedTonnesPerYear.toFixed(1)} t`
          : null,
      sub: 'tonnes of CO2e',
    },
    {
      label: 'Trees equivalent',
      value:
        env.treesEquivalent != null
          ? `${Math.round(env.treesEquivalent).toLocaleString('en-US')}`
          : null,
      sub: 'mature trees / year',
    },
    {
      label: 'Cars off the road',
      value: env.carsEquivalent != null ? env.carsEquivalent.toFixed(1) : null,
      sub: 'average passenger vehicles / year',
    },
  ];
  items.forEach((item, idx) => {
    const x = left + idx * (cardW + cardGap);
    doc.roundedRect(x, y, cardW, cardH, 8).fillColor('#f9fafb').fill();
    doc
      .fontSize(26)
      .font(UI_FONT_BOLD)
      .fillColor(item.value ? args.pdfPrimaryHex : FAINT)
      .text(item.value ?? '—', x + 14, y + 22, {
        width: cardW - 28,
        lineBreak: false,
      });
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(item.sub, x + 14, y + 58, { width: cardW - 28 });
    doc
      .fontSize(9)
      .font(UI_FONT_BOLD)
      .fillColor(INK)
      .text(item.label, x + 14, y + 86, {
        width: cardW - 28,
        height: 12,
        lineBreak: false,
        ellipsis: true,
      });
  });
  y += cardH + 28;

  if (env.co2AvoidedTonnes25y != null) {
    doc
      .fontSize(11)
      .font(UI_FONT_BOLD)
      .fillColor(INK)
      .text(
        `Over 25 years, that's approximately ${env.co2AvoidedTonnes25y.toFixed(0)} tonnes of CO2e avoided.`,
        left,
        y,
        { width: ctx.pageWidth },
      );
  }
}

// ---------------------------------------------------------------------------
// Page 9 — investment & finance
// ---------------------------------------------------------------------------

function drawLineItemsTable(ctx: PageCtx, y: number): number {
  const { doc, args, money } = ctx;
  const left = doc.page.margins.left;
  if (args.lineItems.length === 0) return y;

  y = sectionHeading(ctx, 'Itemised investment', y);
  doc
    .fontSize(8.5)
    .font(UI_FONT_BOLD)
    .fillColor(args.pdfPrimaryHex)
    .text('Item', left, y, { width: ctx.pageWidth * 0.5, lineBreak: false });
  doc.text('Qty', left + ctx.pageWidth * 0.55, y, {
    width: 40,
    align: 'right',
    lineBreak: false,
  });
  doc.text('Line total', left + ctx.pageWidth * 0.75, y, {
    width: ctx.pageWidth * 0.25,
    align: 'right',
    lineBreak: false,
  });
  y += 14;
  doc
    .moveTo(left, y)
    .lineTo(ctx.contentRight, y)
    .strokeColor(HAIRLINE)
    .stroke();
  y += 8;

  args.lineItems.forEach((item) => {
    if (y > ctx.contentBottom - 20) return; // guard against a runaway snapshot overflowing the page
    const label = item.subtitle
      ? `${item.label} — ${item.subtitle}`
      : item.label;
    doc
      .fontSize(9)
      .font(UI_FONT)
      .fillColor(INK)
      .text(truncate(label, 70), left, y, {
        width: ctx.pageWidth * 0.5,
        height: 12,
        lineBreak: false,
        ellipsis: true,
      });
    doc.text(String(item.quantity), left + ctx.pageWidth * 0.55, y, {
      width: 40,
      align: 'right',
      lineBreak: false,
    });
    doc.text(money(item.lineTotal), left + ctx.pageWidth * 0.75, y, {
      width: ctx.pageWidth * 0.25,
      align: 'right',
      lineBreak: false,
    });
    y += 16;
  });
  return y + 10;
}

function drawInvestmentPage(ctx: PageCtx): void {
  const { doc, args, money } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Investment & finance');
  const left = doc.page.margins.left;

  const modeLabel: Record<RoofProposalPricingMode, string> = {
    cash: 'Cash purchase',
    loan: 'Financed (loan)',
    lease: 'Solar lease',
    ppa: 'Power purchase agreement (PPA)',
  };
  doc
    .fontSize(11)
    .font(UI_FONT_BOLD)
    .fillColor(args.pdfPrimaryHex)
    .text(modeLabel[args.pricingMode], left, y);
  y = doc.y + 16;

  const cardGap = 12;
  const cardW = (ctx.pageWidth - cardGap * 2) / 3;
  const cardH = 54;

  let cards: Array<[string, string | null]> = [];
  if (args.pricingMode === 'cash') {
    cards = [
      ['System price', args.totalPrice != null ? money(args.totalPrice) : null],
      [
        'Rebates applied',
        args.rebateAmount != null ? money(args.rebateAmount) : null,
      ],
      [
        'Deposit due today',
        args.depositAmount != null ? money(args.depositAmount) : null,
      ],
    ];
  } else if (args.pricingMode === 'loan') {
    cards = [
      [
        'Amount financed',
        args.totalPrice != null ? money(args.totalPrice) : null,
      ],
      [
        'Term',
        args.termMonths != null
          ? `${args.termMonths} months (${(args.termMonths / 12).toFixed(1)} yrs)`
          : null,
      ],
      [
        'Monthly payment',
        args.monthlyPayment != null ? money(args.monthlyPayment) : null,
      ],
    ];
  } else if (args.pricingMode === 'lease') {
    cards = [
      [
        'Term',
        args.termMonths != null
          ? `${args.termMonths} months (${(args.termMonths / 12).toFixed(1)} yrs)`
          : null,
      ],
      [
        'Monthly lease payment',
        args.monthlyPayment != null ? money(args.monthlyPayment) : null,
      ],
      [
        'Deposit',
        args.depositAmount != null ? money(args.depositAmount) : null,
      ],
    ];
  } else {
    cards = [
      [
        'PPA rate',
        args.ppaRatePerKwh != null
          ? `${args.currency} ${args.ppaRatePerKwh.toFixed(4)}/kWh`
          : null,
      ],
      [
        'Term',
        args.termMonths != null
          ? `${args.termMonths} months (${(args.termMonths / 12).toFixed(1)} yrs)`
          : null,
      ],
      [
        'Deposit',
        args.depositAmount != null ? money(args.depositAmount) : null,
      ],
    ];
  }
  cards.forEach(([label, value], idx) => {
    drawMetricCard(
      ctx,
      left + idx * (cardW + cardGap),
      y,
      cardW,
      cardH,
      label,
      value,
    );
  });
  y += cardH + 8;

  // Round 8: this banner must show whenever the price is stale, independent
  // of whether line items happen to still be attached (they usually are —
  // a previously-priced version froze them same as it froze the price) —
  // the "no line items yet" branch further below only fires for a proposal
  // that was *never* priced, which is a different, narrower condition than
  // "was priced, but the design has since moved on".
  if (args.priceStaleSinceDesignChange) {
    doc
      .fontSize(8.5)
      .font(UI_FONT_BOLD)
      .fillColor(args.pdfPrimaryHex)
      .text(
        'The figures above are unavailable because the system design has changed since this proposal was priced. The line items below reflect the price that is no longer current.',
        left,
        y,
        { width: ctx.pageWidth },
      );
    y = doc.y + 10;
  } else if (args.priceDeclinedOrExpired) {
    // Round 9: same reasoning as the cover — this proposal *was* priced,
    // the offer just isn't current (declined or expired), so say that
    // rather than the generic "not finalised yet" wording further below.
    doc
      .fontSize(8.5)
      .font(UI_FONT_BOLD)
      .fillColor(args.pdfPrimaryHex)
      .text(
        'The figures above are unavailable because the previously priced offer is no longer current. The line items below reflect that earlier offer.',
        left,
        y,
        { width: ctx.pageWidth },
      );
    y = doc.y + 10;
  }

  if (args.pricingMode === 'loan' && args.interestRatePercent !== null) {
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(`Indicative APR: ${args.interestRatePercent.toFixed(2)}%`, left, y);
    y = doc.y + 10;
  }
  if (args.pricingMode === 'ppa') {
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(
        'Under a PPA, ownership of the system stays with the provider — you pay only for the energy the system produces, at the rate above.',
        left,
        y,
        { width: ctx.pageWidth },
      );
    y = doc.y + 10;
  }
  if (args.pricingMode === 'lease') {
    doc
      .fontSize(8.5)
      .font(UI_FONT)
      .fillColor(MUTED)
      .text(
        'Under a lease, you pay a fixed monthly amount for use of the system regardless of production.',
        left,
        y,
        { width: ctx.pageWidth },
      );
    y = doc.y + 10;
  }

  y += 12;
  y = drawLineItemsTable(ctx, y);

  // Round 4: "what do I pay vs. what do I get back" was previously only
  // answerable by reading the line-items table plus the savings-page line
  // chart. A stacked bar of cumulative cost against cumulative savings at a
  // handful of year markers answers it at a glance, the way a competitor
  // document's chart does — but only draw it once real pricing/cashflow
  // figures exist, so the unpriced-proposal fallback below stays clean.
  const isPriced = cards.some(([, value]) => value != null);
  const cashflow = args.simulation.financial.cashflow;
  if (isPriced && cashflow.length >= 25) {
    const netUpfrontCost = (args.totalPrice ?? 0) - (args.rebateAmount ?? 0);
    const termYears = args.termMonths != null ? args.termMonths / 12 : Infinity;
    const annualCost: number =
      args.pricingMode === 'loan' || args.pricingMode === 'lease'
        ? (args.monthlyPayment ?? 0) * 12
        : args.pricingMode === 'ppa'
          ? (args.ppaRatePerKwh ?? 0) *
            (args.simulation.production.annualKwh ?? 0)
          : 0;
    const cumulativeCostAtYear = (year: number): number => {
      if (args.pricingMode === 'cash') return netUpfrontCost;
      return annualCost * Math.min(year, termYears);
    };
    const yearMarkers = [1, 5, 10, 15, 20, 25].filter(
      (yr) => yr <= cashflow.length,
    );
    // Round 5, item 2 — P1 fix: `cashflow[].cumulative` (financial.ts) is
    // already net of the upfront cost (`cumulative = -netCost + Σ
    // savings`), so plotting it as-is under a *separately drawn* cost bar
    // double-counts the cost and floors every pre-payback year at zero —
    // years 1 and 5 showed no savings at all even though pages 2/6 report a
    // real year-1 saving. Add `netCost` back to recover the gross bill
    // savings accumulated to date (independent of *how* the system was
    // paid for), which is the real, non-double-counted quantity this
    // series is supposed to represent.
    const netCost = args.simulation.financial.netCost;
    const cumulativeSavingsAtYear = (year: number): number =>
      (cashflow[year - 1]?.cumulative ?? -netCost) + netCost;

    y += 24;
    y = sectionHeading(ctx, 'What you pay vs. what you get back', y);
    const chartHeight = 150;
    drawStackedBarChart(ctx, {
      x: left,
      y,
      width: ctx.pageWidth,
      height: chartHeight,
      categories: yearMarkers.map((yr) => `Yr ${yr}`),
      series: [
        {
          label:
            args.pricingMode === 'cash' ? 'Amount paid' : 'Payments to date',
          color: '#ef4444',
          values: yearMarkers.map((yr) =>
            Math.max(0, cumulativeCostAtYear(yr)),
          ),
        },
        {
          label: 'Cumulative savings',
          color: args.pdfPrimaryHex,
          values: yearMarkers.map((yr) =>
            Math.max(0, cumulativeSavingsAtYear(yr)),
          ),
        },
      ],
      valueFormatter: (v) => money(v),
    });
    y += chartHeight + 30;
  }

  // Payment schedule — derived directly from the figures already on this
  // page (never invented), surfaced explicitly because "what do I actually
  // owe, and when" is the single most common question on a priced proposal.
  if (
    args.pricingMode === 'cash' &&
    args.totalPrice != null &&
    args.depositAmount != null
  ) {
    const balanceDue =
      args.totalPrice - (args.rebateAmount ?? 0) - args.depositAmount;
    y += 24;
    y = sectionHeading(ctx, 'Payment schedule', y);
    const rows: Array<[string, string]> = [
      ['Deposit due today', money(args.depositAmount)],
      ['Balance due at completion', money(Math.max(0, balanceDue))],
    ];
    rows.forEach(([label, value]) => {
      doc
        .fontSize(9.5)
        .font(UI_FONT)
        .fillColor(MUTED)
        .text(label, left, y, { width: ctx.pageWidth * 0.6, continued: false });
      doc
        .fontSize(9.5)
        .font(UI_FONT_BOLD)
        .fillColor(INK)
        .text(value, left, y, { width: ctx.pageWidth, align: 'right' });
      y += 16;
    });
  } else if (
    args.pricingMode === 'loan' &&
    args.monthlyPayment != null &&
    args.termMonths != null &&
    args.totalPrice != null
  ) {
    const totalRepaid = args.monthlyPayment * args.termMonths;
    const totalInterest = totalRepaid - args.totalPrice;
    y += 24;
    y = sectionHeading(ctx, 'Cost of financing', y);
    const rows: Array<[string, string]> = [
      ['Total repaid over term', money(totalRepaid)],
      ['Of which interest', money(Math.max(0, totalInterest))],
    ];
    rows.forEach(([label, value]) => {
      doc
        .fontSize(9.5)
        .font(UI_FONT)
        .fillColor(MUTED)
        .text(label, left, y, { width: ctx.pageWidth * 0.6 });
      doc
        .fontSize(9.5)
        .font(UI_FONT_BOLD)
        .fillColor(INK)
        .text(value, left, y, { width: ctx.pageWidth, align: 'right' });
      y += 16;
    });
  } else if (
    cards.every(([, value]) => value == null) &&
    args.lineItems.length === 0 &&
    !args.priceStaleSinceDesignChange &&
    !args.priceDeclinedOrExpired
  ) {
    // Reachable, real state: a proposal generated before pricing was
    // finalised (no line items entered, no financing figures set for the
    // selected mode) — not a bug, but the page above this point is just
    // three "Not available" cards and the pricing-mode caption, so it reads
    // as broken rather than "pending." Say so explicitly, and use the
    // space to restate the system specification that *is* final at this
    // point, rather than leaving it blank.
    //
    // Round 8/9: the stale-design and declined/expired cases are already
    // explained by the banners drawn right after the cards above (they fire
    // unconditionally on their respective flags, whether or not line items
    // are present) — this branch is explicitly excluded from both, so it
    // only ever covers the genuinely-never-priced case, and a stale or
    // declined proposal that happens to also have no line items doesn't get
    // two overlapping explanations.
    y += 12;
    doc
      .fontSize(9.5)
      .font(UI_FONT_OBLIQUE)
      .fillColor(MUTED)
      .text(
        'Pricing for this proposal has not been finalised yet — the figures above will populate once your consultant confirms the quote. In the meantime, here is the system specification this proposal is based on.',
        left,
        y,
        { width: ctx.pageWidth },
      );
    y = doc.y + 22;
    y = sectionHeading(ctx, 'System specification', y);
    const totalPanels = args.arrays.reduce(
      (sum, arr) => sum + arr.panelCount,
      0,
    );
    const totalDcKw = args.arrays.reduce((sum, arr) => sum + arr.dcKw, 0);
    const specRows: Array<[string, string]> = [
      ['System type', args.systemTypeLabel],
      ['Array count', `${args.arrays.length}`],
      ['Total panels', `${totalPanels}`],
      ['System size (DC)', formatKw(totalDcKw)],
      [
        'Estimated annual production',
        args.simulation.production.annualKwh != null
          ? `${Math.round(args.simulation.production.annualKwh).toLocaleString('en-US')} kWh`
          : 'Not available',
      ],
    ];
    specRows.forEach(([label, value]) => {
      doc
        .fontSize(9.5)
        .font(UI_FONT)
        .fillColor(MUTED)
        .text(label, left, y, { width: ctx.pageWidth * 0.6 });
      doc
        .fontSize(9.5)
        .font(UI_FONT_BOLD)
        .fillColor(INK)
        .text(value, left, y, { width: ctx.pageWidth, align: 'right' });
      y += 18;
    });
  }
}

// ---------------------------------------------------------------------------
// Page 10 — next steps & acceptance
// ---------------------------------------------------------------------------

function drawNextStepsPage(ctx: PageCtx): void {
  const { doc, args } = ctx;
  doc.addPage();
  let y = drawHeader(ctx, 'Next steps & acceptance');
  const left = doc.page.margins.left;

  y = sectionHeading(ctx, 'What happens next', y);
  const steps = [
    'Review this proposal and reach out to your consultant with any questions.',
    'Sign to accept — your coordinator will schedule a site survey to confirm final details.',
    'Installation is scheduled once permits and any utility approvals are in place.',
    'Your system is commissioned, tested, and switched on.',
  ];
  steps.forEach((step, idx) => {
    doc
      .circle(left + 6, y + 6, 8)
      .fillColor(args.pdfPrimaryHex)
      .fill();
    doc
      .fontSize(8)
      .font(UI_FONT_BOLD)
      .fillColor('#ffffff')
      .text(String(idx + 1), left + 2, y + 2, { width: 8, lineBreak: false });
    doc
      .fontSize(9.5)
      .font(UI_FONT)
      .fillColor(INK)
      .text(step, left + 22, y, { width: ctx.pageWidth - 22 });
    y = doc.y + 10;
  });

  y += 6;
  y = sectionHeading(ctx, 'Warranties', y);
  doc
    .fontSize(9)
    .font(UI_FONT)
    .fillColor(MUTED)
    .text(
      'Panel, inverter and battery warranty terms are as listed on the Equipment page and the manufacturer documentation provided with your final contract. Workmanship is warranted per your signed installation agreement.',
      left,
      y,
      { width: ctx.pageWidth },
    );
  y = doc.y + 20;

  y = sectionHeading(ctx, 'Terms & conditions', y);
  doc
    .fontSize(8.5)
    .font(UI_FONT)
    .fillColor(MUTED)
    .text(
      'This proposal is an estimate based on the design and inputs available at the time of preparation. Actual production and savings vary with weather, shading, utility rate changes and system performance. Acceptance of this proposal is subject to the terms of your signed installation agreement.',
      left,
      y,
      { width: ctx.pageWidth },
    );
  y = doc.y + 24;

  // Signature block — kept clear of other content so the existing e-sign
  // merge (`JobSignaturePdfMergeService`) can drop the signature image and
  // certificate text onto this, the document's last page, without overlap.
  const sigBoxTop = Math.max(y, ctx.contentBottom - 150);
  doc
    .moveTo(left, sigBoxTop + 60)
    .lineTo(left + 220, sigBoxTop + 60)
    .strokeColor('#9ca3af')
    .lineWidth(1)
    .stroke();
  doc
    .fontSize(8.5)
    .font(UI_FONT)
    .fillColor(MUTED)
    .text('Customer signature', left, sigBoxTop + 64);
  doc
    .moveTo(left + 260, sigBoxTop + 60)
    .lineTo(left + 400, sigBoxTop + 60)
    .strokeColor('#9ca3af')
    .lineWidth(1)
    .stroke();
  doc.text('Date', left + 260, sigBoxTop + 64);
}
