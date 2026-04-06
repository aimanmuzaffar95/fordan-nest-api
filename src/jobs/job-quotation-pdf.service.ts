import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ProposalConfigItem } from './job-quotation.service';

type BuildQuotationPdfArgs = {
  attachmentFilename: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  orderNumber: string;
  systemTypeLabel: string;
  systemSizeLabel: string;
  batterySizeLabel: string;
  proposalItems: ProposalConfigItem[];
  proposalTotal: number;
};

@Injectable()
export class JobQuotationPdfService {
  async buildQuotationPdf(args: BuildQuotationPdfArgs): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        info: {
          Title: args.attachmentFilename,
          Author: 'Fordan Solar CRM',
          Subject: `Quotation for ${args.customerName}`,
        },
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer | Uint8Array | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const formatCurrency = (value: number) =>
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const contentRight = doc.page.width - doc.page.margins.right;

      doc
        .fillColor('#855300')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('Fordan Solar', doc.page.margins.left, 40, { width: pageWidth });

      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text('QUOTATION', contentRight - 160, 42, {
          width: 160,
          align: 'right',
        });

      doc.moveDown(1.8);
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#111827')
        .text(`Solar project quotation for ${args.customerName}`);

      doc
        .moveDown(0.4)
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor('#4b5563')
        .text(
          'Thank you for considering Fordan Solar. This quotation has been prepared using the saved proposal configuration for your project.',
        );

      doc.moveDown(1.1);
      const summaryTop = doc.y;
      const leftColWidth = pageWidth * 0.56;
      const rightColX = doc.page.margins.left + leftColWidth + 24;
      const rightColWidth = pageWidth - leftColWidth - 24;

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#855300')
        .text('Customer details', doc.page.margins.left, summaryTop);
      doc
        .moveDown(0.3)
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#111827')
        .text(args.customerName)
        .text(args.customerAddress || 'Address not set')
        .text(args.customerEmail);

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#855300')
        .text('Project summary', rightColX, summaryTop, {
          width: rightColWidth,
        });
      doc
        .moveDown(0.3)
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#111827')
        .text(`Order #: ${args.orderNumber}`, rightColX, doc.y, {
          width: rightColWidth,
        })
        .text(`System type: ${args.systemTypeLabel}`, rightColX, doc.y, {
          width: rightColWidth,
        })
        .text(`Solar array: ${args.systemSizeLabel}`, rightColX, doc.y, {
          width: rightColWidth,
        })
        .text(`Battery storage: ${args.batterySizeLabel}`, rightColX, doc.y, {
          width: rightColWidth,
        });

      doc.y = Math.max(doc.y, summaryTop + 84);
      doc.moveDown(0.6);

      const drawTableHeader = () => {
        const y = doc.y;
        doc.fillColor('#855300').font('Helvetica-Bold').fontSize(9);
        doc.text('Item', doc.page.margins.left, y, {
          width: pageWidth * 0.54,
        });
        doc.text('Qty', doc.page.margins.left + pageWidth * 0.56, y, {
          width: 40,
          align: 'right',
        });
        doc.text('Unit', doc.page.margins.left + pageWidth * 0.67, y, {
          width: 72,
          align: 'right',
        });
        doc.text('Line total', doc.page.margins.left + pageWidth * 0.81, y, {
          width: pageWidth * 0.19,
          align: 'right',
        });
        doc
          .moveTo(doc.page.margins.left, y + 16)
          .lineTo(contentRight, y + 16)
          .strokeColor('#d1d5db')
          .stroke();
        doc.y = y + 24;
      };

      const ensureSpace = (requiredHeight: number) => {
        if (
          doc.y + requiredHeight <=
          doc.page.height - doc.page.margins.bottom
        ) {
          return;
        }
        doc.addPage();
        drawTableHeader();
      };

      drawTableHeader();

      args.proposalItems.forEach((item) => {
        const itemLabel = item.subtitle.trim()
          ? `${item.name} — ${item.subtitle}`
          : item.name;
        const itemHeight = Math.max(
          18,
          doc.heightOfString(itemLabel, { width: pageWidth * 0.54 }) + 6,
        );

        ensureSpace(itemHeight + 10);

        const rowY = doc.y;
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#111827')
          .text(itemLabel, doc.page.margins.left, rowY, {
            width: pageWidth * 0.54,
          });
        doc.text(
          String(item.quantity),
          doc.page.margins.left + pageWidth * 0.56,
          rowY,
          {
            width: 40,
            align: 'right',
          },
        );
        doc.text(
          formatCurrency(item.proposalUnitPrice),
          doc.page.margins.left + pageWidth * 0.67,
          rowY,
          {
            width: 72,
            align: 'right',
          },
        );
        doc.text(
          formatCurrency(item.lineTotal),
          doc.page.margins.left + pageWidth * 0.81,
          rowY,
          {
            width: pageWidth * 0.19,
            align: 'right',
          },
        );

        doc
          .moveTo(doc.page.margins.left, rowY + itemHeight + 4)
          .lineTo(contentRight, rowY + itemHeight + 4)
          .strokeColor('#f3f4f6')
          .stroke();

        doc.y = rowY + itemHeight + 10;
      });

      ensureSpace(80);
      doc.moveDown(0.8);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#4b5563')
        .text(
          'Total project investment',
          doc.page.margins.left + pageWidth * 0.62,
          doc.y,
          {
            width: pageWidth * 0.18,
          },
        );
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#111827')
        .text(
          formatCurrency(args.proposalTotal),
          doc.page.margins.left + pageWidth * 0.76,
          doc.y - 3,
          {
            width: pageWidth * 0.24,
            align: 'right',
          },
        );

      doc
        .moveDown(1.6)
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#4b5563')
        .text(
          'This quotation is generated from the saved proposal configuration in Fordan Solar CRM. Please contact our team if you would like any adjustments before moving forward.',
        );

      doc.end();
    });
  }
}
