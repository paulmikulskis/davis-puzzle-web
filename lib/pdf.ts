import { PDFDocument, StandardFonts } from "pdf-lib";
import { type PaletteEntry } from "@/lib/palette";
import { renderColorByNumberPage } from "@/lib/pdf/colorByNumber";
import { renderCoordinatePage } from "@/lib/pdf/coordinate";
import { renderCoverPage } from "@/lib/pdf/cover";
import { PAGE_H, PAGE_W, type PdfContext, type PdfFonts } from "@/lib/pdf/grid";
import { renderReferencePage } from "@/lib/pdf/reference";

export interface BuildPdfOptions {
  itemLabel: string;
  sourceFilename: string;
  palette: PaletteEntry[];
}

export async function buildPdf(options: BuildPdfOptions): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`${options.itemLabel} - Minecraft Pixel Art Puzzle`);
  pdfDoc.setAuthor("Davis Puzzle Generator");
  pdfDoc.setSubject(`Source texture: ${options.sourceFilename}`);

  const fonts: PdfFonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };

  const renderers = [
    (ctx: PdfContext) => renderCoverPage(ctx, options.itemLabel),
    (ctx: PdfContext) => renderReferencePage(ctx, options.itemLabel, options.palette),
    (ctx: PdfContext) => renderColorByNumberPage(ctx, options.itemLabel, options.palette),
    (ctx: PdfContext) => renderCoordinatePage(ctx, options.itemLabel, options.palette),
  ];

  for (const render of renderers) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    render({ page, fonts });
  }

  return pdfDoc.save();
}
