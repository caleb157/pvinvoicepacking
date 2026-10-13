import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  ExportDocData, ExportLine, PackRow, amountInWords, cartonLabels, invoiceTotals, labelDescription, packageCbm,
  packingLines, packingMismatches, packingTotals, panFromGstin, partnerLines, unevenRows, usdInWords,
} from './export-docs';
import { invoiceSheet, packingSheet } from './export-docs-xlsx';
import { xlsxZip } from './xlsx-writer';

// The five lines of INV262700015 (the sample Caleb sent), with its packing details.
const pack = (sku: string, qty: number, per: number, dims: string, net: number, gross: number): PackRow => ({
  sku, internalSku: sku, customerSku: '', description: sku, labelDescription: sku, quantity: qty,
  unitsPerPackage: per, packageDims: dims, packageKind: 'Carton', netWeightKg: net, grossWeightKg: gross, unitGrossKg: 0, grossManual: true,
});
const line = (sku: string, qty: number, price: number, igst: number, per: number, dims: string, net: number, gross: number) => ({
  line: { sku, internalSku: sku, description: sku, hsnCode: '94016900', quantity: qty, uom: 'Units', fobPriceUsd: price, igstRatePct: igst } as ExportLine,
  pack: pack(sku, qty, per, dims, net, gross),
});
const ROWS = [
  line('KUR-KCSL-KURI', 20, 91.68, 18, 1, '20 x 20 x 20', 11, 12.1),
  line('KUR-KRTL-KURI', 20, 23.28, 5, 1, '16.75 x 10.75 x 6.5', 1.5, 2.3),
  line('KUR-KTST-KURI', 21, 61.51, 18, 1, '27 x 22 x 25', 10, 11.3),
  line('KUR-KSCB-OWAX', 20, 14.25, 5, 5, '27 x 14.75 x 20', 4, 4.8),
  line('KURI-KBAR-0502', 40, 0.6, 5, 40, '26 x 14.5 x 13', 19, 20.7),
];
const LINES: ExportLine[] = ROWS.map(r => r.line);
const PACKING: PackRow[] = ROWS.map(r => r.pack);

const party = { name: 'X', lines: ['a', 'b'], contact: '', email: '', phone: '' };
const DOC: ExportDocData = {
  invoiceNo: 'INV262700015', invoiceDate: '2026-09-30', exporterRef: 'AAFCH6385K', buyerOrderNo: 'P00025', buyerOrderDate: '',
  billOfLading: '', otherReferences: '', shipper: { ...party, gstNumber: '08AAFCH6385K1Z1' }, consignee: party, buyer: party,
  preCarriageBy: 'Truck', vesselFlightNo: '', portOfDischarge: 'New York, USA', countryOfOrigin: 'India',
  countryOfFinalDestination: 'United States of America', placeOfReceipt: 'Jodhpur', portOfLoading: 'Jodhpur, India',
  finalDestination: 'Forney, TX, USA', termsOfDelivery: 'FOB Jodhpur', handlingInformation: '',
  currency: 'USD', taxMode: 'igst', lutArn: '', isDraft: false,
  exchangeRate: 95.25, notificationNo: '28/2026', shippingInr: 0, shippingIgstInr: 0,
  signatoryCompany: 'Parable Ventures Pvt Ltd', signatoryName: 'Caleb Quinones', lines: LINES, packing: PACKING,
};

describe('commercial invoice numbers', () => {
  it('matches the INV262700015 totals', () => {
    const t = invoiceTotals(DOC);
    expect(t.quantity).toBe(121);
    expect(t.fobValueUsd).toBeCloseTo(3899.91, 2);
    expect(t.fobValueInr).toBeCloseTo(3899.91 * 95.25, 2);
    // IGST: 18% on lines 1 and 3, 5% on the rest
    const igst = (1833.6 * 0.18 + 465.6 * 0.05 + 1291.71 * 0.18 + 285 * 0.05 + 24 * 0.05) * 95.25;
    expect(t.fobIgstInr).toBeCloseTo(igst, 2);
    // IGST is not added to the invoice value
    expect(t.invoiceValueInr).toBeCloseTo(t.fobValueInr, 6);
    expect(t.invoiceValueUsd).toBeCloseTo(3899.91, 2);
  });

  it('writes the amount in words', () => {
    expect(usdInWords(3899.91)).toBe('Three Thousand Eight Hundred Ninety Nine Dollars and Ninety One Cents');
    expect(usdInWords(1)).toBe('One Dollar');
    expect(usdInWords(1200000.05)).toBe('One Million Two Hundred Thousand Dollars and Five Cents');
    expect(amountInWords(2.5, 'EUR')).toBe('Two Euros and Fifty Cents');
  });

  it('reads the PAN out of a GSTIN', () => {
    expect(panFromGstin('08AAFCH6385K1Z1')).toBe('AAFCH6385K');
    expect(panFromGstin('')).toBe('');
  });

  it('formats Odoo addresses', () => {
    expect(partnerLines({ street: '18721 FM 740', city: 'Forney', state: 'TX', zip: '75126', country: 'United States' }))
      .toEqual(['18721 FM 740', 'Forney, TX 75126', 'United States']);
  });
});

describe('packing list numbers', () => {
  it('numbers the cartons like the sample', () => {
    expect(packingLines(PACKING).map(c => c.cartonRange)).toEqual(['1 to 20', '21 to 40', '41 to 61', '62 to 65', '66']);
  });

  it('rounds a part package up', () => {
    expect(packingLines([pack('A', 21, 5, '1 x 1 x 1', 1, 1)])[0].packages).toBe(5);
  });

  it('computes CBM per package from inches', () => {
    expect(packageCbm('20 x 20 x 20')).toBeCloseTo(0.1310968, 6);
    expect(packageCbm('20x20')).toBeNull();
  });

  it('totals weights and CBM per package × packages', () => {
    const t = packingTotals(PACKING);
    expect(t.packages).toBe(66);
    expect(t.netWeightKg).toBeCloseTo(20 * 11 + 20 * 1.5 + 21 * 10 + 4 * 4 + 19, 6);
    expect(t.grossWeightKg).toBeCloseTo(20 * 12.1 + 20 * 2.3 + 21 * 11.3 + 4 * 4.8 + 20.7, 6);
    expect(t.cbm).toBeCloseTo(20 * 0.1310968 + 20 * 0.0191796 + 21 * 0.2433484 + 4 * 0.1305233 + 0.0803132, 4);
  });

  it('renumbers cartons when a row is split', () => {
    // 110 ashtrays: 100 in boxes of 20, then one box of 10, inserted under the first row
    const rows = [pack('ASH', 100, 20, '10 x 10 x 10', 5, 6), pack('ASH', 10, 10, '8 x 8 x 8', 2.5, 3), pack('PIPE', 12, 6, '9 x 9 x 9', 3, 4)];
    expect(packingLines(rows).map(c => c.cartonRange)).toEqual(['1 to 5', '6', '7 to 8']);
    expect(packingMismatches([{ ...LINES[0], internalSku: 'ASH', quantity: 110 }, { ...LINES[0], internalSku: 'PIPE', quantity: 12 }], rows)).toEqual([]);
    expect(packingMismatches([{ ...LINES[0], internalSku: 'ASH', quantity: 120 }], rows.slice(0, 2)))
      .toEqual([{ key: 'ASH', invoice: 120, packed: 110 }]);
    expect(unevenRows([pack('X', 21, 5, '', 0, 0)]).length).toBe(1);
  });

  it('makes one label per carton, numbered across the shipment', () => {
    const labels = cartonLabels([pack('A', 21, 10, '', 0, 0), pack('B', 4, 4, '', 0, 0)]);
    expect(labels.map(l => `${l.carton}/${l.total}:${l.unitsInCarton}`)).toEqual(['1/4:10', '2/4:10', '3/4:1', '4/4:4']);
  });

  it('shortens descriptions for labels', () => {
    expect(labelDescription('Ashtray with Cork / 5 x 5 x 5 inch / with cork (Mango)')).toBe('Ashtray with Cork (Mango)');
    expect(labelDescription('[PV-01] Pipe Stand (Teak) / 6 inch')).toBe('Pipe Stand (Teak)');
    expect(labelDescription('Bowl / large (Box of 20) (Acacia)')).toBe('Bowl (Acacia)');
  });
});

describe('excel layout', () => {
  it('keeps the original cell addresses for five lines', () => {
    const s = invoiceSheet(DOC);
    expect(s.cells.B1.v).toBe('INVOICE');
    expect(s.cells.I4.v).toBe('INV262700015');
    expect(s.cells.F19.v).toBe('HSN CODE');
    expect(s.cells.J20.f).toBe('IF(G20<>"",I20*G20,"")');
    expect(s.cells.L20.f).toBe('IF(J20<>"",J20*$D$31,"")');
    expect(s.cells.B27.v).toBe('Consignment Total');
    expect(s.cells.D31.v).toBe(95.25);
    expect(s.cells.D32.v).toBe('28/2026');
    expect(s.cells.N35.f).toBe('N29+N32');
    const p = packingSheet(DOC);
    expect(p.cells.B19.v).toBe('1 to 20');
    expect(p.cells.B26.v).toBe('Consignment Total');
    expect(p.cells.L26.v).toBe(66);
  });

  it('produces a valid xlsx package', async () => {
    const bytes = await xlsxZip([invoiceSheet(DOC), packingSheet(DOC)]).generateAsync({ type: 'uint8array' });
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<c r="I4"');
    expect(sheet).toContain('&lt;&gt;');
    expect(zip.file('xl/styles.xml')).toBeTruthy();
    expect(zip.file('xl/worksheets/sheet2.xml')).toBeTruthy();
  });
});
