// PDF copies of the commercial invoice and packing list (A4 landscape), with the
// same blocks, columns and totals as the Excel versions.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ExportDocData, ExportParty, invoiceLine, invoiceTotals, packingLines, packingTotals, usdInWords,
} from './export-docs';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const M = 10;          // page margin, mm
const W = 297 - 2 * M; // usable width

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

function label(pdf: jsPDF, text: string, x: number, y: number) {
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(100);
  pdf.text(text, x, y);
  pdf.setTextColor(0);
}
function value(pdf: jsPDF, text: string, x: number, y: number, opts: { bold?: boolean; size?: number; maxW?: number } = {}) {
  pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal'); pdf.setFontSize(opts.size ?? 8);
  const lines = opts.maxW ? pdf.splitTextToSize(text || '', opts.maxW) : [text || ''];
  pdf.text(lines, x, y);
  return lines.length;
}
function box(pdf: jsPDF, x: number, y: number, w: number, h: number) {
  pdf.setDrawColor(150); pdf.setLineWidth(0.2); pdf.rect(x, y, w, h);
}

function party(pdf: jsPDF, title: string, p: ExportParty | null, x: number, y: number, w: number, extra?: [string, string]) {
  label(pdf, title, x + 2, y + 4);
  if (!p) return;
  value(pdf, p.name, x + 2, y + 8.5, { bold: true, maxW: w * 0.5 });
  p.lines.slice(0, 4).forEach((l, i) => value(pdf, l, x + 2, y + 12.5 + i * 3.6, { maxW: w * 0.5 }));
  const cx = x + w * 0.52;
  const rows: [string, string][] = [['Contact', p.contact], ['Email', p.email], ['Phone', p.phone]];
  if (extra) rows.push(extra);
  rows.forEach(([k, v], i) => { label(pdf, k, cx, y + 8.5 + i * 4.2); value(pdf, v, cx + 19, y + 8.5 + i * 4.2, { maxW: w * 0.48 - 21 }); });
}

/** Shared header; returns the y where the line table starts. */
function header(pdf: jsPDF, doc: ExportDocData, title: string, kind: 'invoice' | 'packing'): number {
  let y = M;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text(title, M, y + 6);
  y += 8;
  if (kind === 'invoice') {
    pdf.setFontSize(7.5); pdf.text('** SUPPLY MEANT FOR EXPORT UPON PAYMENT OF INTEGRATED TAX **', M, y + 3);
    y += 5;
  }
  const half = W / 2;
  const h1 = 30;
  box(pdf, M, y, half, h1); box(pdf, M + half, y, half, h1);
  const sh = doc.shipper;
  party(pdf, 'Shipper', { ...sh }, M, y, half, ['GST Number', sh.gstNumber]);
  // Reference block
  const rx = M + half + 2, rx2 = M + half + half / 2 + 2;
  label(pdf, 'Invoice No. & Date', rx, y + 4);
  value(pdf, `${doc.invoiceNo}   ${doc.invoiceDate || ''}`, rx, y + 8.5, { bold: true });
  label(pdf, 'Exporter Ref.', rx2, y + 4); value(pdf, doc.exporterRef, rx2, y + 8.5);
  label(pdf, "Buyer's Order No. & Date", rx, y + 14); value(pdf, `${doc.buyerOrderNo}   ${doc.buyerOrderDate || ''}`, rx, y + 18.5);
  label(pdf, 'Bill of Lading Number', rx2, y + 14); value(pdf, doc.billOfLading, rx2, y + 18.5);
  label(pdf, 'Other reference(s)', rx, y + 24); value(pdf, doc.otherReferences, rx, y + 28, { maxW: half - 4 });
  y += h1;

  const h2 = 28;
  box(pdf, M, y, half, h2); box(pdf, M + half, y, half, h2);
  party(pdf, 'Consignee', doc.consignee, M, y, half);
  party(pdf, kind === 'invoice' ? 'Buyer (if other than Consignee)' : 'Buyer (if other than consignee)', doc.buyer, M + half, y, half);
  y += h2;

  // Shipping grid: 5 columns × 2 rows
  const cw = W / 5, rh = 10;
  const cellsTop: [string, string][] = [
    ['Pre-Carriage by', doc.preCarriageBy], ['Vessel / Flight No.', doc.vesselFlightNo], ['Port of Discharge', doc.portOfDischarge],
    ['Country of origin of goods', doc.countryOfOrigin], ['Country of final destination', doc.countryOfFinalDestination],
  ];
  const cellsBottom: [string, string][] = [
    ['Place of Receipt by pre-carrier', doc.placeOfReceipt], ['Port of Loading', doc.portOfLoading], ['Final Destination', doc.finalDestination],
  ];
  cellsTop.forEach(([k, v], i) => { box(pdf, M + i * cw, y, cw, rh); label(pdf, k, M + i * cw + 2, y + 3.5); value(pdf, v, M + i * cw + 2, y + 8, { maxW: cw - 4 }); });
  y += rh;
  cellsBottom.forEach(([k, v], i) => { box(pdf, M + i * cw, y, cw, rh); label(pdf, k, M + i * cw + 2, y + 3.5); value(pdf, v, M + i * cw + 2, y + 8, { maxW: cw - 4 }); });
  box(pdf, M + 3 * cw, y, 2 * cw, rh);
  if (kind === 'invoice') {
    label(pdf, 'Terms of Delivery & Payment:', M + 3 * cw + 2, y + 3.5);
    value(pdf, `Incoterm: ${doc.termsOfDelivery}`, M + 3 * cw + 2, y + 8, { maxW: 2 * cw - 4 });
  } else {
    label(pdf, 'Handling Information', M + 3 * cw + 2, y + 3.5);
    value(pdf, doc.handlingInformation, M + 3 * cw + 2, y + 8, { maxW: 2 * cw - 4 });
  }
  return y + rh + 2;
}

const tableStyles = {
  theme: 'grid' as const,
  styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.2, lineColor: [150, 150, 150] as [number, number, number], lineWidth: 0.2, textColor: 20, valign: 'middle' as const },
  headStyles: { fillColor: [231, 238, 247] as [number, number, number], textColor: 20, fontStyle: 'bold' as const, halign: 'center' as const },
  footStyles: { fillColor: [231, 238, 247] as [number, number, number], textColor: 20, fontStyle: 'bold' as const },
  margin: { left: M, right: M },
};

type ColStyles = Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number }>;
/** Foot cells take their column's alignment (autoTable applies columnStyles to the body only). */
const footAlign = (cols: ColStyles) => (d: { section: string; column: { index: number }; cell: { styles: { halign: unknown } } }) => {
  if (d.section === 'foot' && cols[d.column.index]?.halign) d.cell.styles.halign = cols[d.column.index].halign;
};

const INVOICE_COLS: ColStyles = {
  0: { cellWidth: 26 }, 1: { cellWidth: 62 }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' },
  5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'center' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' },
};
const PACKING_COLS: ColStyles = {
  0: { cellWidth: 22, halign: 'center' }, 1: { cellWidth: 26 }, 2: { cellWidth: 66 }, 3: { halign: 'center' }, 4: { halign: 'center' },
  5: { halign: 'center' }, 6: { halign: 'center' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' },
};

export function buildInvoicePdf(doc: ExportDocData): jsPDF {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as Doc;
  const startY = header(pdf, doc, 'INVOICE', 'invoice');
  const t = invoiceTotals(doc);
  autoTable(pdf, {
    ...tableStyles,
    startY,
    head: [['Product Code', 'Description of Goods', 'HSN CODE', 'Unit Quantity', 'UOM', 'FOB Price USD', 'FOB Value USD', 'IGST Rate %', 'FOB Value INR', 'FOB IGST INR', 'Invoice Value INR', 'Invoice Value USD']],
    body: doc.lines.map(l => {
      const c = invoiceLine(l, doc.exchangeRate);
      return [l.sku, l.description, l.hsnCode, qty(l.quantity), l.uom, money(l.fobPriceUsd), money(c.fobValueUsd),
        `${qty(l.igstRatePct)}%`, money(c.fobValueInr), money(c.fobIgstInr), money(c.invoiceValueInr), money(c.invoiceValueUsd)];
    }),
    foot: [['', 'Consignment Total', '', qty(t.quantity), '', '', money(t.fobValueUsd), '', money(t.fobValueInr), money(t.fobIgstInr), money(t.invoiceValueInr), money(t.invoiceValueUsd)]],
    columnStyles: INVOICE_COLS,
    didParseCell: footAlign(INVOICE_COLS),
  });
  let y = (pdf.lastAutoTable?.finalY ?? startY) + 5;
  if (y > 150) { pdf.addPage(); y = M; }

  // Footer left
  label(pdf, 'Total Invoice Amount in Words (USD)', M, y + 3);
  value(pdf, usdInWords(t.invoiceValueUsd), M, y + 7.5, { bold: true, maxW: 140 });
  label(pdf, 'Exchange Rate (INR/USD)', M, y + 14); value(pdf, String(doc.exchangeRate), M + 38, y + 14);
  label(pdf, 'As per Notification No.', M, y + 18.5); value(pdf, doc.notificationNo, M + 38, y + 18.5);
  label(pdf, 'Shippers Declaration', M, y + 25);
  value(pdf, 'We declare that invoice shows the actual price of goods described and that all particulars are true & correct.', M, y + 29, { maxW: 140, size: 7.5 });
  label(pdf, 'Signatory Company', M, y + 37); value(pdf, doc.signatoryCompany, M, y + 41.5, { bold: true });
  label(pdf, 'Name of Authorized Signatory', M + 60, y + 37); value(pdf, doc.signatoryName, M + 60, y + 41.5, { bold: true });
  label(pdf, 'Signature / Date / Co stamp.', M + 150, y + 3);
  box(pdf, M + 150, y, 50, 44);

  // Footer right: summary
  const rows: [string, string][] = [
    ['FOB IGST Amount (INR)', money(t.fobIgstInr)],
    ['FOB Value (INR)', money(t.fobValueInr)],
    ['FOB Value', money(t.fobValueUsd)],
    ['Shipping IGST Amount (INR)', money(t.shippingIgstInr)],
    ['Shipping Amount (INR)', money(t.shippingInr)],
    ['Shipping', money(doc.exchangeRate ? t.shippingInr / doc.exchangeRate : 0)],
    ['Total Invoice IGST (INR)', money(t.totalIgstInr)],
    ['Total Invoice Value (INR)', money(t.invoiceValueInr)],
    ['Total Invoice Value', `USD ${money(t.invoiceValueUsd)}`],
  ];
  autoTable(pdf, {
    ...tableStyles,
    startY: y,
    margin: { left: M + W - 72, right: M },
    tableWidth: 72,
    body: rows,
    columnStyles: { 0: { cellWidth: 42 }, 1: { halign: 'right' } },
    didParseCell: (d) => { if (d.row.index >= 6) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [231, 238, 247]; } },
  });
  return pdf;
}

export function buildPackingPdf(doc: ExportDocData): jsPDF {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as Doc;
  const startY = header(pdf, doc, 'Packing List', 'packing');
  const calc = packingLines(doc.lines);
  const t = packingTotals(doc.lines);
  autoTable(pdf, {
    ...tableStyles,
    startY,
    head: [['Case & Carton Number', 'Product Code', 'Description of Goods', 'Unit Quantity', 'Units Per Package', 'Dimensions of Package (in)', 'Kind of Package & Number of Packages', 'Net Weight of Package (Kg)', 'Gross Weight of Package (Kg)', 'Measurement of Package (m3)']],
    body: doc.lines.map((l, i) => {
      const c = calc[i];
      return [c.cartonRange, l.sku, l.description, qty(l.quantity), l.unitsPerPackage ? qty(l.unitsPerPackage) : '', l.packageDims,
        c.packages ? `${l.packageKind} x ${c.packages}` : l.packageKind, l.netWeightKg ? money(l.netWeightKg) : '', l.grossWeightKg ? money(l.grossWeightKg) : '',
        c.cbmPerPackage != null ? c.cbmPerPackage.toFixed(4) : ''];
    }),
    foot: [['', '', 'Consignment Total', qty(t.quantity), '', '', `${t.packages} packages`, money(t.netWeightKg), money(t.grossWeightKg), t.cbm.toFixed(3)]],
    columnStyles: PACKING_COLS,
    didParseCell: footAlign(PACKING_COLS),
  });
  let y = (pdf.lastAutoTable?.finalY ?? startY) + 6;
  if (y > 170) { pdf.addPage(); y = M; }
  label(pdf, 'Totals are per package × number of packages.', M, y + 3);
  label(pdf, 'Signature / Date / Co stamp.', M + 110, y + 3);
  box(pdf, M + 110, y, 60, 30);
  label(pdf, 'Signatory Company', M + 190, y + 4); value(pdf, doc.signatoryCompany, M + 190, y + 8.5, { bold: true });
  label(pdf, 'Name of Authorized Signatory', M + 190, y + 15); value(pdf, doc.signatoryName, M + 190, y + 19.5, { bold: true });
  return pdf;
}

export const invoicePdf = (doc: ExportDocData): Blob => buildInvoicePdf(doc).output('blob');
export const packingPdf = (doc: ExportDocData): Blob => buildPackingPdf(doc).output('blob');
