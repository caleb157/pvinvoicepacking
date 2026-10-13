import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  ExportDocData, ExportLine, invoiceTotals, packageCbm, packingFromOdoo, packingLines, packingTotals,
  panFromGstin, partnerLines, usdInWords,
} from './export-docs';
import { invoiceSheet, packingSheet } from './export-docs-xlsx';
import { xlsxZip } from './xlsx-writer';

// The five lines of INV262700015 (the sample Caleb sent), with its packing details.
const line = (sku: string, qty: number, price: number, igst: number, per: number, dims: string, net: number, gross: number): ExportLine => ({
  sku, description: sku, hsnCode: '94016900', quantity: qty, uom: 'Units', fobPriceUsd: price, igstRatePct: igst,
  unitsPerPackage: per, packageDims: dims, packageKind: 'Carton', netWeightKg: net, grossWeightKg: gross,
});
const LINES: ExportLine[] = [
  line('KUR-KCSL-KURI', 20, 91.68, 18, 1, '20 x 20 x 20', 11, 12.1),
  line('KUR-KRTL-KURI', 20, 23.28, 5, 1, '16.75 x 10.75 x 6.5', 1.5, 2.3),
  line('KUR-KTST-KURI', 21, 61.51, 18, 1, '27 x 22 x 25', 10, 11.3),
  line('KUR-KSCB-OWAX', 20, 14.25, 5, 5, '27 x 14.75 x 20', 4, 4.8),
  line('KURI-KBAR-0502', 40, 0.6, 5, 40, '26 x 14.5 x 13', 19, 20.7),
];

const party = { name: 'X', lines: ['a', 'b'], contact: '', email: '', phone: '' };
const DOC: ExportDocData = {
  invoiceNo: 'INV262700015', invoiceDate: '2026-09-30', exporterRef: 'AAFCH6385K', buyerOrderNo: 'P00025', buyerOrderDate: '',
  billOfLading: '', otherReferences: '', shipper: { ...party, gstNumber: '08AAFCH6385K1Z1' }, consignee: party, buyer: party,
  preCarriageBy: 'Truck', vesselFlightNo: '', portOfDischarge: 'New York, USA', countryOfOrigin: 'India',
  countryOfFinalDestination: 'United States of America', placeOfReceipt: 'Jodhpur', portOfLoading: 'Jodhpur, India',
  finalDestination: 'Forney, TX, USA', termsOfDelivery: 'FOB Jodhpur', handlingInformation: '',
  exchangeRate: 95.25, notificationNo: '28/2026', shippingInr: 0, shippingIgstInr: 0,
  signatoryCompany: 'Parable Ventures Pvt Ltd', signatoryName: 'Caleb Quinones', lines: LINES,
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
    expect(packingLines(LINES).map(c => c.cartonRange)).toEqual(['1 to 20', '21 to 40', '41 to 61', '62 to 65', '66']);
  });

  it('rounds a part package up', () => {
    expect(packingLines([line('A', 21, 1, 0, 5, '1 x 1 x 1', 1, 1)])[0].packages).toBe(5);
  });

  it('computes CBM per package from inches', () => {
    expect(packageCbm('20 x 20 x 20')).toBeCloseTo(0.1310968, 6);
    expect(packageCbm('20x20')).toBeNull();
  });

  it('totals weights and CBM per package × packages', () => {
    const t = packingTotals(LINES);
    expect(t.packages).toBe(66);
    expect(t.netWeightKg).toBeCloseTo(20 * 11 + 20 * 1.5 + 21 * 10 + 4 * 4 + 19, 6);
    expect(t.grossWeightKg).toBeCloseTo(20 * 12.1 + 20 * 2.3 + 21 * 11.3 + 4 * 4.8 + 20.7, 6);
    expect(t.cbm).toBeCloseTo(20 * 0.1310968 + 20 * 0.0191796 + 21 * 0.2433484 + 4 * 0.1305233 + 0.0803132, 4);
  });

  it('pre-fills from the Odoo product packaging', () => {
    expect(packingFromOdoo(2, { units: 4, dims_in: [20, 14.5, 13], empty_kg: 1.5 }))
      .toEqual({ unitsPerPackage: 4, packageDims: '20 x 14.5 x 13', packageKind: 'Carton', netWeightKg: 8, grossWeightKg: 9.5 });
    expect(packingFromOdoo(null, { units: 6, dims_in: null, empty_kg: 0 }))
      .toEqual({ unitsPerPackage: 6, packageDims: '', packageKind: 'Carton', netWeightKg: 0, grossWeightKg: 0 });
    expect(packingFromOdoo(2, null)).toBeNull();
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
