// PDFs for the carton labels (A5, one per carton) and the letters on the Parable Ventures
// letterhead (A4: Non-DG certificate, Export Value Declaration, Wooden Declaration). The text
// comes from src/lib/letters.ts; this file only draws it.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import boldUrl from '@/assets/montserrat-bold.ttf?url';
import regularUrl from '@/assets/montserrat-regular.ttf?url';
import logoUrl from '@/assets/pv-logo.png?url';
import { ExportDocData } from './export-docs';
import { DECLARATIONS, HDFC, RemitRow, dateOfExport, defaultHdfc, hdfcDate, sbRows, utilisation } from './hdfc';
import { LETTERHEAD, evdTerms, isRelatedBuyer, labelData, letterDate, nonDgRows, woodText } from './letters';

export interface Signatory { name: string; title: string }

const F = 'Montserrat';
let assets: Promise<{ regular: string; bold: string; logo: string }> | null = null;

async function binary(url: string) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return s;
}
async function dataUrl(url: string) {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
}
const loadAssets = () => (assets ??= Promise.all([binary(regularUrl), binary(boldUrl), dataUrl(logoUrl)])
  .then(([regular, bold, logo]) => ({ regular, bold, logo })));

async function newPdf(format: 'a4' | 'a5', orientation: 'portrait' | 'landscape' = 'portrait') {
  const a = await loadAssets();
  const pdf = new jsPDF({ unit: 'mm', format, orientation });
  pdf.addFileToVFS('Montserrat-Regular.ttf', a.regular); pdf.addFont('Montserrat-Regular.ttf', F, 'normal');
  pdf.addFileToVFS('Montserrat-Bold.ttf', a.bold); pdf.addFont('Montserrat-Bold.ttf', F, 'bold');
  pdf.setFont(F, 'normal');
  return { pdf, logo: a.logo };
}

// ---------- letterhead (A4) ----------

const PW = 210, PH = 297, LM = 17.8, RM = 17.8, TW = PW - LM - RM;

/** Draws the letterhead; returns the y where the body starts. */
function letterhead(pdf: jsPDF, logo: string): number {
  const logoW = 52, logoH = logoW * 199 / 683;
  pdf.addImage(logo, 'PNG', PW - RM - logoW, 12, logoW, logoH);
  const textW = TW - logoW - 6;
  let y = 15;
  pdf.setFont(F, 'bold'); pdf.setFontSize(10); pdf.text(LETTERHEAD.company, LM, y);
  pdf.setFont(F, 'normal');
  for (const l of LETTERHEAD.lines) { y += 4.4; pdf.text(l, LM, y); }
  pdf.setFontSize(7.5);
  y += 1;
  for (const l of LETTERHEAD.small) {
    const lines = pdf.splitTextToSize(l, textW);
    pdf.text(lines, LM, y + 3.5); y += 3.3 * lines.length;
  }
  y += 4;
  pdf.setDrawColor(150); pdf.setLineWidth(0.3); pdf.line(LM, y, PW - RM, y);
  // footer
  pdf.setFontSize(8.5); pdf.setTextColor(0);
  const f2 = pdf.splitTextToSize(LETTERHEAD.footer[1], TW);
  const fy = PH - 12 - f2.length * 3.6;
  pdf.line(LM, fy - 5, PW - RM, fy - 5);
  pdf.text(LETTERHEAD.footer[0], PW / 2, fy, { align: 'center' });
  pdf.text(f2, PW / 2, fy + 3.8, { align: 'center' });
  return y + 10;
}

function para(pdf: jsPDF, text: string, y: number, opts: { bold?: boolean; size?: number; align?: 'left' | 'center' | 'justify'; gap?: number } = {}) {
  pdf.setFont(F, opts.bold ? 'bold' : 'normal'); pdf.setFontSize(opts.size ?? 10.5);
  const lines = pdf.splitTextToSize(text, TW);
  const lh = (opts.size ?? 10.5) * 0.48;
  if (opts.align === 'center') pdf.text(lines, PW / 2, y, { align: 'center' });
  else pdf.text(lines, LM, y, { align: opts.align === 'justify' ? 'justify' : 'left', maxWidth: TW });
  return y + lines.length * lh + (opts.gap ?? 4);
}

function signature(pdf: jsPDF, y: number, lines: string[]) {
  pdf.setFont(F, 'bold'); pdf.setFontSize(10.5);
  lines.forEach((l, i) => pdf.text(l, LM, y + i * 6));
}

// ---------- Non-DG ----------

export async function nonDgPdf(doc: ExportDocData, sig: Signatory): Promise<Blob> {
  const { pdf, logo } = await newPdf('a4');
  let y = letterhead(pdf, logo);
  y = para(pdf, 'SHIPPER CERTIFICATE FOR NON-DANGEROUS GOODS', y, { bold: true, size: 12, align: 'center', gap: 8 });
  y = para(pdf, `Date: ${letterDate(doc.invoiceDate)}`, y, { bold: true, gap: 1 });
  y = para(pdf, `Invoice: ${doc.invoiceNo}`, y, { bold: true, gap: 6 });
  y = para(pdf, 'We hereby certify that the contents of the consignment are not dangerous and are not dangerous of carrying by air according to '
    + 'the current edition (65) of IATA dangerous goods regulation and all the applicable carrier and government regulation. We acknowledge '
    + 'that we may be liable for damages resulting from any misstatement or omission and we further agree that any air carrier involved in the '
    + 'shipment of the consignment may rely upon this certificate.', y, { align: 'justify', gap: 6 });
  autoTable(pdf, {
    startY: y, margin: { left: LM, right: RM }, theme: 'plain',
    styles: { font: F, fontSize: 10, cellPadding: { top: 1.6, bottom: 1.6, left: 1, right: 1 }, valign: 'top' },
    columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold' }, 1: { cellWidth: 5 }, 2: { cellWidth: 'auto' } },
    body: nonDgRows(doc, sig).map(([k, v], i) => [`${i + 1}. ${k}`, ':', v]),
  });
  y = (pdf as any).lastAutoTable.finalY + 12;
  signature(pdf, y, [`FOR ${doc.shipper.name || 'Parable Ventures Pvt Ltd'}`, '', '', '', 'Auth. Signatory']);
  return pdf.output('blob');
}

// ---------- Export Value Declaration ----------

const tick = (on: boolean) => (on ? '(  X  )' : '(       )');

export async function evdPdf(doc: ExportDocData, sig: Signatory): Promise<Blob> {
  const { pdf, logo } = await newPdf('a4');
  let y = letterhead(pdf, logo);
  y = para(pdf, 'ANNEXURE A', y, { bold: true, size: 11, align: 'center', gap: 1 });
  y = para(pdf, 'EXPORT VALUATION DECLARATION', y, { bold: true, size: 12, align: 'center', gap: 1 });
  y = para(pdf, '(SEE RULE 7 OF CUSTOMS VALUATION (DETERMINATION OF VALUE OF EXPORT GOODS) RULES, 2007.)', y, { size: 8.5, align: 'center', gap: 7 });
  const related = isRelatedBuyer(doc);
  const terms = evdTerms(doc);
  const S = 10;
  y = para(pdf, '1. SHIPPING BILL NO. & DATE:', y, { size: S });
  y = para(pdf, `2. INVOICE NO & DATE:  ${doc.invoiceNo}  dated  ${letterDate(doc.invoiceDate)}`, y, { size: S });
  y = para(pdf, '3. NATURE OF TRANSACTION', y, { size: S, gap: 1.5 });
  y = para(pdf, '     [X] SALE        [  ] SALE OF CONSIGNMENT        [  ] SAMPLE        [  ] GIFT        [  ] OTHERS', y, { size: S });
  y = para(pdf, '4. METHOD OF VALUATION', y, { size: S, gap: 1.5 });
  y = para(pdf, '     RULE 3 ( YES )     RULE 4 (     )     RULE 5 (     )     RULE 6 (     )', y, { size: S, bold: true });
  y = para(pdf, `5. WHETHER SELLER AND BUYER ARE RELATED     YES ${tick(related)}     NO ${tick(!related)}`, y, { size: S });
  y = para(pdf, `6. IF YES, WHETHER RELATIONSHIP HAS INFLUENCED THE PRICE     YES ${tick(false)}     NO ${tick(related)}`, y, { size: S });
  y = para(pdf, `7. TERMS OF PAYMENT:  ${terms.payment}`, y, { size: S });
  y = para(pdf, `8. TERMS OF DELIVERY:  ${terms.delivery}`, y, { size: S });
  y = para(pdf, '9. PREVIOUS EXPORTS OF IDENTICAL/ SIMILAR GOODS, IF ANY', y, { size: S, gap: 1.5 });
  y = para(pdf, '     SHIPPING BILL NO & DATE:', y, { size: S });
  y = para(pdf, '10. ANY OTHER RELEVANT INFORMATION (ATTACH SEPARATE SHEET, IF NECESSARY)', y, { size: S, gap: 8 });
  y = para(pdf, 'DECLARATION:', y, { size: S, bold: true, gap: 1.5 });
  y = para(pdf, '1. I/WE HEREBY DECLARE THAT THE INFORMATION FURNISHED ABOVE IS TRUE, COMPLETE AND CORRECT IN EVERY RESPECT.', y, { size: S, gap: 1.5 });
  y = para(pdf, '2. I/WE ALSO UNDERTAKE TO BRING TO THE NOTICE OF PROPER OFFICER ANY PARTICULARS WHICH SUBSEQUENTLY COME TO MY/ OUR '
    + 'KNOWLEDGE WHICH WILL HAVE BEARING ON A VALUATION.', y, { size: S, gap: 14 });
  pdf.setFont(F, 'normal'); pdf.setFontSize(S);
  pdf.text('PLACE: ', LM, y); pdf.setFont(F, 'bold'); pdf.text('JODHPUR', LM + 15, y);
  pdf.setFont(F, 'normal'); pdf.text('FOR: ', PW / 2, y); pdf.setFont(F, 'bold'); pdf.text('PARABLE VENTURES PVT LTD', PW / 2 + 10, y);
  y += 8;
  pdf.setFont(F, 'normal'); pdf.text(`DATE: ${letterDate(doc.invoiceDate)}`, LM, y);
  pdf.text('AUTHORITY SIGN.', PW / 2, y + 18);
  if (sig.name) pdf.text(`${sig.name}, ${sig.title}`, PW / 2, y + 23);
  return pdf.output('blob');
}

// ---------- Wooden Declaration ----------

export async function woodPdf(doc: ExportDocData, sig: Signatory): Promise<Blob> {
  const { pdf, logo } = await newPdf('a4');
  let y = letterhead(pdf, logo) + 10;
  y = para(pdf, `Date: ${letterDate(doc.invoiceDate)}`, y, { gap: 14 });
  y = para(pdf, 'TO WHOMSOEVER IT MAY CONCERN', y, { bold: true, size: 12, align: 'center', gap: 14 });
  y = para(pdf, woodText(doc), y, { align: 'justify', size: 11, gap: 24 });
  y = para(pdf, 'Thanking you', y, { size: 11, gap: 26 });
  y = para(pdf, 'Authorized Signatory.', y, { size: 11, gap: 1 });
  if (sig.name) y = para(pdf, `${sig.name}, ${sig.title}`, y, { size: 11, gap: 1 });
  para(pdf, 'Parable Ventures Pvt Ltd', y, { size: 11, bold: true });
  return pdf.output('blob');
}

// ---------- A5 carton labels ----------

export async function labelsPdf(doc: ExportDocData): Promise<Blob> {
  const { pdf } = await newPdf('a5', 'landscape');
  const W = 210, H = 148, M = 8;
  labelData(doc).forEach((l, i) => {
    if (i) pdf.addPage('a5', 'landscape');
    pdf.setDrawColor(0); pdf.setLineWidth(0.6); pdf.rect(M, M, W - 2 * M, H - 2 * M);
    // carton number, top right
    pdf.setFont(F, 'bold'); pdf.setFontSize(26);
    pdf.text(`${l.carton} of ${l.total}`, W - M - 5, M + 14, { align: 'right' });
    pdf.setFontSize(9); pdf.setFont(F, 'normal'); pdf.text('CARTON', W - M - 5, M + 5.5, { align: 'right' });
    // description
    pdf.setFont(F, 'bold'); pdf.setFontSize(20);
    const desc = pdf.splitTextToSize(l.description, W - 2 * M - 70);
    pdf.text(desc.slice(0, 2), M + 5, M + 12);
    const rows: [string, string][] = [
      ['CUSTOMER SKU', l.customerSku],
      ['CUSTOMER PO', l.customerPo],
      ['INVOICE NO.', l.invoiceNo],
      ['QTY IN CARTON', `${l.qty} PCS`],
      ['NET WEIGHT', `${l.netKg} KG`],
      ['GROSS WEIGHT', `${l.grossKg} KG`],
      ['CARTON SIZE', l.size],
      ['COUNTRY OF ORIGIN', l.origin.toUpperCase()],
    ];
    autoTable(pdf, {
      startY: M + 30, margin: { left: M + 5, right: M + 5 }, theme: 'grid',
      styles: { font: F, fontSize: 15, cellPadding: 2.4, lineColor: 120, lineWidth: 0.2, textColor: 0 },
      columnStyles: { 0: { cellWidth: 58, fontSize: 11, textColor: 80 }, 1: { fontStyle: 'bold' } },
      body: rows,
    });
  });
  return pdf.output('blob');
}

// ---------- HDFC export regularization letter ----------

export interface HdfcExtras { bills: Record<string, unknown>[]; remits: RemitRow[]; adCode: string; sig: Signatory }

export async function hdfcPdf(doc: ExportDocData, x: HdfcExtras): Promise<Blob> {
  const { pdf, logo } = await newPdf('a4');
  const h = doc.hdfc ?? defaultHdfc('');
  const bottom = PH - 30;
  let y = letterhead(pdf, logo);
  const room = (need: number) => { if (y + need > bottom) { pdf.addPage(); y = 20; } };
  const table = (body: (string | number)[][], opts: { head?: string[]; widths?: Record<number, number>; boldFirst?: boolean } = {}) => {
    autoTable(pdf, {
      startY: y, margin: { left: LM, right: RM, bottom: 32 }, theme: 'grid',
      styles: { font: F, fontSize: 8.5, cellPadding: 1.4, lineColor: 160, lineWidth: 0.15, textColor: 0, valign: 'top' },
      headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
      columnStyles: Object.fromEntries(Object.entries(opts.widths ?? {}).map(([k, w]) => [k, { cellWidth: w, ...(opts.boldFirst && k === '0' ? { fontStyle: 'bold' } : {}) }])),
      head: opts.head ? [opts.head] : undefined, body: body.map(r => r.map(String)),
    });
    y = (pdf as any).lastAutoTable.finalY + 4;
  };
  const text = (t: string, opts: { bold?: boolean; size?: number } = {}) => {
    pdf.setFont(F, opts.bold ? 'bold' : 'normal'); pdf.setFontSize(opts.size ?? 8.5);
    const lines = pdf.splitTextToSize(t, TW);
    const lh = (opts.size ?? 8.5) * 0.45;
    room(lines.length * lh + 2);
    pdf.text(lines, LM, y);
    y += lines.length * lh + 2.5;
  };

  text('REQUEST LETTER FOR EXPORT OF GOODS (COLLECTION/DISCOUNTING & REGULARISATION)', { bold: true, size: 10.5 });
  y += 1;
  pdf.setFont(F, 'normal'); pdf.setFontSize(9);
  pdf.text(['To,', ...HDFC.bank], LM, y);
  pdf.text(`Date: ${hdfcDate(h.letterDate)}`, PW - RM, y, { align: 'right' });
  y += 16;

  const total = utilisation(doc, x.remits).invoiceValue;
  const W1 = 70;
  table([
    ['Account no to be credited', HDFC.account],
    ['Purpose Code & Details', h.purposeCode],
    ['Exchange Rate / Forward Contract details if any', ''],
    ['Date of Export / Expected date of Service of Advance', hdfcDate(dateOfExport(x.bills))],
    ['Country of Dispatch', 'INDIA'],
    ['Country of Destination', doc.countryOfFinalDestination],
    ['Invoice No / Dated', `${doc.invoiceNo}   dated ${hdfcDate(doc.invoiceDate)}`],
    ['Type of Export', h.exportType],
    ['Date of Export / Sale (Warehouse) / Completion (Project Export)', hdfcDate(dateOfExport(x.bills))],
  ], { widths: { 0: W1 }, boldFirst: true });

  text('Please find enclosed Export Documents under Collection / Letter of Credit:', { bold: true });
  table([
    ['Letter of Credit No', h.lcNo, 'Dated', hdfcDate(h.lcDate)],
    ['Letter of Credit Amount', h.lcAmount, 'Issuing Bank', h.issuingBank],
    ['Currency and Amount', `${doc.currency} ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Tenor', h.tenor],
    ['Drawee / Buyer', (doc.buyer ?? doc.consignee).name, 'Documents to be delivered against', h.documentsAgainst],
  ], { widths: { 0: 42, 2: 38 }, boldFirst: true });

  text('Please utilize the below Forward Contract for disbursal:', { bold: true });
  table([['', '', '', '']], { head: ['Forward Cover No & Date', 'Forward Cover Rate', 'Amount to be utilized for this transaction', 'Due Date of the Contract'] });

  text('Number of documents submitted in TWO sets for Collection or as per LC Terms', { bold: true });
  table([['Original', '', '', '', '', '', '', ''], ['Duplicate', '', '', '', '', '', '', '']],
    { head: ['Documents', 'Drafts', 'Invoice', 'Transport Doc. (B/L / AWB / LR)', 'Packing List', 'Insurance', 'Certificate of Origin', 'Others'] });

  text('We hereby request bank to discount the bill by way of Earmarking/Using Interchangeability of available Limit <Please write name of the facility>.');
  text('We request you to send the documents on approval basis with discrepancies.');
  text('Please forward the documents in one lot by courier at our cost, risk and responsibility to below address');
  text('Bank Swift Code: ______________  (Mandatory in case the documents are being sent to a bank)');

  const sb = sbRows(x.bills, x.adCode);
  table((sb.length ? sb : [{ sbNo: '', date: '', portCode: '', adCode: x.adCode, shipmentDate: '' }])
    .map(r => [r.sbNo, hdfcDate(r.date), r.portCode, r.adCode, hdfcDate(r.shipmentDate)]),
  { head: ['GR / Shipping Bill / Softex No', 'Date', 'Port Code', 'AD Code', 'Shipment Date'] });

  text(`Debit all processing charges from account no: ${HDFC.account}`);
  text(`In case of any queries please contact us on Tel. No ${HDFC.tel} or email us at ${HDFC.email}`);
  text(DECLARATIONS.packingCredit);
  text('PROCEEDS DISPOSAL INSTRUCTIONS: Upon realization of funds, please credit proceeds to (Please tick any one).', { bold: true });
  text('[  ] 100% to be converted and credited to Current account / CC Account');
  text('[  ] ____% to be credited to EEFC account no. ____________ and balance to be converted and credited to Current account / CC Account no ____________');
  text('[  ] PCFC / EPC to be adjusted (PCFC/EPC no ____________ )');
  text(DECLARATIONS.ofac);
  text(DECLARATIONS.fema);
  DECLARATIONS.terms.forEach(t => text(t));
  text(DECLARATIONS.eligible);
  text(`Our Importer Exporter Code is: ${doc.exporterRef}`);
  DECLARATIONS.disclaimers.forEach((t, i) => text(t, { bold: i === 0 }));
  text(`Remark: ${h.remark}`);

  const cur = doc.currency || 'USD';
  table(x.remits.length ? x.remits.map(r => [r.remittanceNo, hdfcDate(r.date), money2(r.total), money2(r.amount)]) : [['', '', '', '']],
    { head: ['Inward Remittance Number', 'Inward Remittance Date', `Total Amount ${cur}`, `Amount to be Utilized ${cur}`] });

  room(40);
  y += 4;
  pdf.setFont(F, 'bold'); pdf.setFontSize(9.5);
  pdf.text(`For ${doc.shipper.name || 'Parable Ventures Private Limited'}`, LM, y);
  y += 22;
  pdf.setLineWidth(0.3); pdf.line(LM, y, LM + 70, y);
  pdf.setFont(F, 'normal'); pdf.setFontSize(8.5);
  pdf.text(['AUTHORISED SIGNATORY', '(Signature as per Bank record with company seal)', x.sig.name ? `${x.sig.name}, ${x.sig.title}` : ''], LM, y + 4.5);
  return pdf.output('blob');
}

const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
