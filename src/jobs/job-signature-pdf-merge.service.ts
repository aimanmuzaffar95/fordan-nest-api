import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts } from 'pdf-lib';

@Injectable()
export class JobSignaturePdfMergeService {
  async mergeSignatureAndCertificate(
    quotationPdfBytes: Buffer,
    signaturePngBytes: Buffer,
    certificateLines: string[],
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(quotationPdfBytes);
    const png = await doc.embedPng(signaturePngBytes);
    const pages = doc.getPages();
    const last = pages[pages.length - 1];
    const { height } = last.getSize();

    const sigW = 220;
    const sigH = (png.height / png.width) * sigW;
    const sigX = 48;
    const sigY = Math.max(72, height - sigH - 120);

    last.drawImage(png, {
      x: sigX,
      y: sigY,
      width: sigW,
      height: sigH,
    });

    const font = await doc.embedFont(StandardFonts.Helvetica);
    last.drawText('Customer signature (electronic)', {
      x: sigX,
      y: sigY - 14,
      size: 9,
      font,
    });

    const certPage = doc.addPage();
    const { height: ch } = certPage.getSize();
    let y = ch - 72;
    certPage.drawText('Signature certificate', {
      x: 48,
      y,
      size: 16,
      font,
    });
    y -= 28;

    const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
    for (const line of certificateLines) {
      if (y < 72) break;
      const text = line.length > 120 ? `${line.slice(0, 117)}...` : line;
      certPage.drawText(text, {
        x: 48,
        y,
        size: 10,
        font: bodyFont,
      });
      y -= 14;
    }

    const pdfBytes = await doc.save();
    return Buffer.from(pdfBytes);
  }
}
