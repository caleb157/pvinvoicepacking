// Excel copies of the commercial invoice and packing list, cell for cell in the
// layout of the INV262700015 spreadsheets (same addresses, labels and formulas),
// so the files can still be edited in Excel with live totals.
import {
  ExportDocData, ExportParty, invoiceLine, invoiceTotals, packingLines, packingTotals, usdInWords,
} from './export-docs';
import { Cell, Sheet, buildXlsx, excelDate } from './xlsx-writer';

type Cells = Record<string, Cell>;

/** Fit address lines into n rows, joining any overflow into the last row. */
function fit(lines: string[], n: number): string[] {
  if (lines.length <= n) return lines;
  return [...lines.slice(0, n - 1), lines.slice(n - 1).join(', ')];
}

const put = (cells: Cells, addr: string, v: Cell['v'], s: Cell['s'] = 'default', f?: string) => {
  cells[addr] = { v, s, ...(f ? { f } : {}) };
};

/** Header block shared by both documents. `o` shifts rows 3+ (packing list sits one row higher). */
function header(cells: Cells, doc: ExportDocData, o: number, kind: 'invoice' | 'packing') {
  const r = (n: number) => n + o;
  const sh = doc.shipper;
  put(cells, `B${r(3)}`, 'Shipper', 'bold');
  put(cells, `B${r(4)}`, sh.name, 'bold');
  fit(sh.lines, 4).forEach((l, i) => put(cells, `B${r(5 + i)}`, l));
  put(cells, `E${r(4)}`, 'Contact', 'label'); put(cells, `F${r(4)}`, sh.contact);
  put(cells, `E${r(5)}`, 'Email:', 'label'); put(cells, `F${r(5)}`, sh.email);
  put(cells, `E${r(6)}`, 'Phone:', 'label'); put(cells, `F${r(6)}`, sh.phone);
  put(cells, `E${r(7)}`, 'GST Number:', 'label'); put(cells, `F${r(7)}`, sh.gstNumber);

  put(cells, `I${r(3)}`, 'Invoice No. & Date', 'label');
  put(cells, `I${r(4)}`, doc.invoiceNo, 'bold');
  const d = excelDate(doc.invoiceDate);
  put(cells, `K${r(4)}`, d ?? doc.invoiceDate, d != null ? 'date' : 'default');
  put(cells, `L${r(3)}`, 'Exporter Ref.', 'label');
  put(cells, `L${r(4)}`, doc.exporterRef);
  put(cells, `I${r(5)}`, "Buyer's Order No. & Date", 'label');
  put(cells, `I${r(6)}`, doc.buyerOrderNo);
  const od = excelDate(doc.buyerOrderDate);
  if (doc.buyerOrderDate) put(cells, `K${r(6)}`, od ?? doc.buyerOrderDate, od != null ? 'date' : 'default');
  put(cells, `L${r(5)}`, 'Bill of Lading Number', 'label');
  put(cells, `L${r(6)}`, doc.billOfLading);
  put(cells, `I${r(7)}`, 'Other reference(s)', 'label');
  put(cells, `I${r(8)}`, doc.otherReferences);

  const party = (p: ExportParty, col: string, labelCol: string, valCol: string, title: string) => {
    put(cells, `${col}${r(9)}`, title, 'bold');
    put(cells, `${col}${r(10)}`, p.name, 'bold');
    fit(p.lines, 3).forEach((l, i) => put(cells, `${col}${r(11 + i)}`, l));
    put(cells, `${labelCol}${r(10)}`, 'Contact', 'label'); put(cells, `${valCol}${r(10)}`, p.contact);
    put(cells, `${labelCol}${r(11)}`, 'Email:', 'label'); put(cells, `${valCol}${r(11)}`, p.email);
    put(cells, `${labelCol}${r(12)}`, 'Phone:', 'label'); put(cells, `${valCol}${r(12)}`, p.phone);
  };
  party(doc.consignee, 'B', 'E', 'F', 'Consignee');
  if (doc.buyer) party(doc.buyer, 'I', 'L', 'M', kind === 'invoice' ? 'Buyer (if other than Consignee)' : 'Buyer (if other than consignee)');
  else put(cells, `I${r(9)}`, kind === 'invoice' ? 'Buyer (if other than Consignee)' : 'Buyer (if other than consignee)', 'bold');

  put(cells, `B${r(15)}`, 'Pre-Carriage by', 'label'); put(cells, `B${r(16)}`, doc.preCarriageBy);
  put(cells, `E${r(15)}`, 'Vessel / Flight No.', 'label'); put(cells, `E${r(16)}`, doc.vesselFlightNo);
  put(cells, `G${r(15)}`, 'Port of Discharge', 'label'); put(cells, `G${r(16)}`, doc.portOfDischarge);
  put(cells, `I${r(15)}`, 'Country of origin of goods', 'label'); put(cells, `I${r(16)}`, doc.countryOfOrigin);
  put(cells, `L${r(15)}`, 'Country of final destination', 'label'); put(cells, `L${r(16)}`, doc.countryOfFinalDestination);
  put(cells, `B${r(17)}`, 'Place of Receipt by pre-carrier', 'label'); put(cells, `B${r(18)}`, doc.placeOfReceipt);
  put(cells, `E${r(17)}`, 'Port of Loading', 'label'); put(cells, `E${r(18)}`, doc.portOfLoading);
  put(cells, `G${r(17)}`, 'Final Destination', 'label'); put(cells, `G${r(18)}`, doc.finalDestination);
  if (kind === 'invoice') {
    put(cells, `I${r(17)}`, 'Terms of Delivery & Payment:', 'label');
    put(cells, `I${r(18)}`, 'Incoterm:', 'label');
    put(cells, `J${r(18)}`, doc.termsOfDelivery);
  } else {
    put(cells, `I${r(17)}`, 'Handling Information', 'label');
    put(cells, `I${r(18)}`, doc.handlingInformation);
  }
}

export function invoiceSheet(doc: ExportDocData): Sheet {
  const cells: Cells = {};
  const merges: string[] = ['B1:O1', 'B2:O2'];
  put(cells, 'B1', 'INVOICE', 'title');
  put(cells, 'B2', '** SUPPLY MEANT FOR EXPORT UPON PAYMENT OF INTEGRATED TAX **', 'banner');
  header(cells, doc, 0, 'invoice');

  const H = 19;
  const heads: [string, string][] = [
    ['B', 'Product Code'], ['C', 'Description of Goods'], ['F', 'HSN CODE'], ['G', 'Unit Quantity'], ['H', 'UOM'],
    ['I', 'FOB Price USD'], ['J', 'FOB Value USD'], ['K', 'IGST Rate %'], ['L', 'FOB Value INR'], ['M', 'FOB IGST INR'],
    ['N', 'Invoice Value INR'], ['O', 'Invoice Value USD'],
  ];
  heads.forEach(([c, t]) => put(cells, `${c}${H}`, t, 'head'));
  put(cells, `D${H}`, '', 'head'); put(cells, `E${H}`, '', 'head');
  merges.push(`C${H}:E${H}`);

  const first = H + 1;
  const n = doc.lines.length;
  const T = first + n + 2;               // totals row (two spare rows, as in the original)
  const rateRow = T + 4;
  const rate = `$D$${rateRow}`;
  const lastLineRow = T - 1;
  for (let i = 0; i < n + 2; i++) {
    const row = first + i;
    const l = doc.lines[i];
    merges.push(`C${row}:E${row}`);
    if (!l) {
      ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].forEach(c => put(cells, `${c}${row}`, null, 'box'));
      continue;
    }
    const c = invoiceLine(l, doc.exchangeRate);
    put(cells, `B${row}`, l.sku, 'boxWrap');
    put(cells, `C${row}`, l.description, 'boxWrap'); put(cells, `D${row}`, null, 'boxWrap'); put(cells, `E${row}`, null, 'boxWrap');
    put(cells, `F${row}`, /^\d+$/.test(l.hsnCode) ? Number(l.hsnCode) : l.hsnCode, 'boxInt');
    put(cells, `G${row}`, l.quantity, 'boxInt');
    put(cells, `H${row}`, l.uom, 'box');
    put(cells, `I${row}`, l.fobPriceUsd, 'boxNum');
    put(cells, `J${row}`, c.fobValueUsd, 'boxNum', `IF(G${row}<>"",I${row}*G${row},"")`);
    put(cells, `K${row}`, l.igstRatePct / 100, 'boxPct');
    put(cells, `L${row}`, c.fobValueInr, 'boxNum', `IF(J${row}<>"",J${row}*${rate},"")`);
    put(cells, `M${row}`, c.fobIgstInr, 'boxNum', `IF(L${row}<>"",L${row}*K${row},"")`);
    put(cells, `N${row}`, c.invoiceValueInr, 'boxNum', `IF(G${row}<>"",L${row},"")`);
    put(cells, `O${row}`, c.invoiceValueUsd, 'boxNum', `IF(G${row}<>"",J${row},"")`);
  }

  const t = invoiceTotals(doc);
  const sum = (c: string) => `SUM(${c}${first}:${c}${lastLineRow})`;
  ['C', 'D', 'E', 'F', 'H', 'I', 'K'].forEach(c => put(cells, `${c}${T}`, null, 'totText'));
  put(cells, `B${T}`, 'Consignment Total', 'totText');
  merges.push(`B${T}:F${T}`);
  put(cells, `G${T}`, t.quantity, 'totInt', sum('G'));
  put(cells, `J${T}`, t.fobValueUsd, 'totNum', sum('J'));
  put(cells, `L${T}`, t.fobValueInr, 'totNum', sum('L'));
  put(cells, `M${T}`, t.fobIgstInr, 'totNum', sum('M'));
  put(cells, `N${T}`, t.invoiceValueInr, 'totNum', sum('N'));
  put(cells, `O${T}`, t.invoiceValueUsd, 'totNum', sum('O'));

  // Footer, left
  put(cells, `B${T + 2}`, 'Total Invoice Amount in Words (USD)', 'bold');
  put(cells, `B${T + 3}`, usdInWords(t.invoiceValueUsd), 'italic');
  merges.push(`B${T + 3}:G${T + 3}`);
  put(cells, `B${T + 4}`, 'Exchange Rate (INR/USD)', 'label'); put(cells, `D${rateRow}`, doc.exchangeRate, 'num');
  put(cells, `B${T + 5}`, 'As per Notification No.', 'label'); put(cells, `D${T + 5}`, doc.notificationNo);
  put(cells, `B${T + 6}`, 'Shippers Declaration', 'bold');
  put(cells, `B${T + 7}`, 'We declare that invoice shows the actual price of goods');
  put(cells, `B${T + 8}`, 'described and that all particulars are true & correct.');
  put(cells, `B${T + 9}`, 'Signatory Company', 'label'); put(cells, `B${T + 10}`, doc.signatoryCompany, 'bold');
  put(cells, `E${T + 9}`, 'Name of Authorized Signatory', 'label'); put(cells, `E${T + 10}`, doc.signatoryName, 'bold');
  put(cells, `H${T + 2}`, 'Signature / Date / Co stamp.', 'label');

  // Footer, right: summary box
  const box: [string, number, string][] = [
    ['FOB IGST Amount (INR)', t.fobIgstInr, `M${T}`],
    ['FOB Value (INR)', t.fobValueInr, `L${T}`],
    ['FOB Value', t.fobValueUsd, `J${T}`],
    ['Shipping IGST Amount (INR)', t.shippingIgstInr, ''],
    ['Shipping Amount (INR)', t.shippingInr, ''],
    ['Shipping', doc.exchangeRate ? t.shippingInr / doc.exchangeRate : 0, ''],
    ['Total Invoice IGST (INR)', t.totalIgstInr, `N${T + 2}+N${T + 5}`],
    ['Total Invoice Value (INR)', t.invoiceValueInr, `N${T}`],
    ['Total Invoice Value', t.invoiceValueUsd, `O${T}`],
  ];
  box.forEach(([label, v, f], i) => {
    const row = T + 2 + i;
    put(cells, `L${row}`, label, i >= 6 ? 'totText' : 'box'); put(cells, `M${row}`, null, i >= 6 ? 'totText' : 'box');
    merges.push(`L${row}:M${row}`);
    put(cells, `N${row}`, v, i >= 6 ? 'totNum' : 'boxNum', f || undefined);
  });

  return {
    name: 'INVOICE', cells, merges, landscape: true,
    colWidths: { A: 2, B: 18, C: 16, D: 12, E: 14, F: 13, G: 12, H: 8, I: 13, J: 14, K: 10, L: 15, M: 15, N: 16, O: 15 },
    rowHeights: { 1: 30 },
  };
}

export function packingSheet(doc: ExportDocData): Sheet {
  const cells: Cells = {};
  const merges: string[] = ['B1:O1'];
  put(cells, 'B1', 'Packing List', 'title');
  header(cells, doc, -1, 'packing');

  const H = 18;
  const heads: [string, string][] = [
    ['B', 'Case & Carton Number'], ['C', 'Product Code'], ['D', 'Description of Goods'], ['G', 'Unit Quantity'],
    ['H', 'Units Per Package'], ['I', 'Dimensions of Package (in)'], ['J', 'Kind of Package & Number of Packages'],
    ['M', 'Net Weight of Package (Kg)'], ['N', 'Gross Weight of Package (Kg)'], ['O', 'Measurement of Package (m3)'],
  ];
  heads.forEach(([c, t]) => put(cells, `${c}${H}`, t, 'head'));
  ['E', 'F', 'K', 'L'].forEach(c => put(cells, `${c}${H}`, '', 'head'));
  merges.push(`D${H}:F${H}`, `J${H}:L${H}`);

  const first = H + 1;
  const n = doc.lines.length;
  const T = first + n + 2;
  const last = T - 1;
  const calc = packingLines(doc.lines);
  for (let i = 0; i < n + 2; i++) {
    const row = first + i;
    const l = doc.lines[i];
    merges.push(`D${row}:F${row}`);
    if (!l) {
      ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].forEach(c => put(cells, `${c}${row}`, null, 'box'));
      continue;
    }
    const c = calc[i];
    put(cells, `B${row}`, c.cartonRange, 'box');
    put(cells, `C${row}`, l.sku, 'boxWrap');
    put(cells, `D${row}`, l.description, 'boxWrap'); put(cells, `E${row}`, null, 'boxWrap'); put(cells, `F${row}`, null, 'boxWrap');
    put(cells, `G${row}`, l.quantity, 'boxInt');
    put(cells, `H${row}`, l.unitsPerPackage || null, 'boxInt');
    put(cells, `I${row}`, l.packageDims, 'box');
    put(cells, `J${row}`, l.packageKind, 'box');
    put(cells, `K${row}`, 'x', 'boxInt');
    put(cells, `L${row}`, c.packages, 'boxInt', `IF(AND(G${row}<>"",H${row}<>"",J${row}<>""),ROUNDUP(G${row}/H${row},0),"")`);
    put(cells, `M${row}`, l.netWeightKg || null, 'boxNum');
    put(cells, `N${row}`, l.grossWeightKg || null, 'boxNum');
    put(cells, `O${row}`, c.cbmPerPackage, 'boxCbm');
  }

  const t = packingTotals(doc.lines);
  ['C', 'D', 'E', 'F', 'H', 'I', 'J', 'K'].forEach(c => put(cells, `${c}${T}`, null, 'totText'));
  put(cells, `B${T}`, 'Consignment Total', 'totText');
  merges.push(`B${T}:F${T}`);
  put(cells, `G${T}`, t.quantity, 'totInt', `SUM(G${first}:G${last})`);
  put(cells, `L${T}`, t.packages, 'totInt', `SUM(L${first}:L${last})`);
  put(cells, `M${T}`, t.netWeightKg, 'totNum', `SUMPRODUCT($L${first}:$L${last},M${first}:M${last})`);
  put(cells, `N${T}`, t.grossWeightKg, 'totNum', `SUMPRODUCT($L${first}:$L${last},N${first}:N${last})`);
  put(cells, `O${T}`, t.cbm, 'totCbm', `SUMPRODUCT($L${first}:$L${last},O${first}:O${last})`);

  put(cells, `F${T + 1}`, 'Signature / Date / Co stamp.', 'label');
  put(cells, `L${T + 4}`, 'Signatory Company', 'label'); put(cells, `L${T + 5}`, doc.signatoryCompany, 'bold');
  put(cells, `L${T + 6}`, 'Name of Authorized Signatory', 'label'); put(cells, `L${T + 7}`, doc.signatoryName, 'bold');

  return {
    name: 'Packing List', cells, merges, landscape: true,
    colWidths: { A: 2, B: 14, C: 17, D: 14, E: 12, F: 12, G: 10, H: 10, I: 17, J: 10, K: 11, L: 8, M: 13, N: 13, O: 14 },
    rowHeights: { 1: 30 },
  };
}

export const invoiceXlsx = (doc: ExportDocData) => buildXlsx([invoiceSheet(doc)]);
export const packingXlsx = (doc: ExportDocData) => buildXlsx([packingSheet(doc)]);
