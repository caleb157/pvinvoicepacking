import { describe, expect, it } from 'vitest';
import { ExportDocData } from './export-docs';
import { billsFor, dateOfExport, defaultHdfc, hdfcDate, hdfcWarnings, sbRows, utilisation } from './hdfc';

const DOC = {
  invoiceNo: 'INV/2026/00015', invoiceDate: '2026-10-01', currency: 'USD', isDraft: false, exchangeRate: 93, shippingInr: 0, shippingIgstInr: 0,
  taxMode: 'lut', lines: [{ sku: 'a', internalSku: 'a', description: 'a', hsnCode: '', quantity: 10, uom: 'Units', fobPriceUsd: 100, igstRatePct: 0 }],
  hdfc: { ...defaultHdfc('2026-10-13'), purposeCode: 'P0103' },
} as unknown as ExportDocData;

const BILLS = [
  { invoice_no: 'inv/2026/00015 ', sb_number: '4471235', sb_date: '2026-10-03', port_code: 'INJDH6', transport_doc_date: '2026-10-05' },
  { invoice_no: 'INV/2026/00014', sb_number: '1', sb_date: '2026-09-01' },
];

describe('HDFC letter', () => {
  it('finds the shipping bill by invoice number and takes the export date from the transport document', () => {
    const mine = billsFor(DOC.invoiceNo, BILLS);
    expect(mine).toHaveLength(1);
    expect(sbRows(mine, '6390005')).toEqual([{ sbNo: '4471235', date: '2026-10-03', portCode: 'INJDH6', adCode: '6390005', shipmentDate: '2026-10-05' }]);
    expect(dateOfExport(mine)).toBe('2026-10-05');
    expect(billsFor('', BILLS)).toEqual([]);
  });
  it('compares remittances used with the invoice value', () => {
    expect(utilisation(DOC, []).status).toBe('none');
    expect(utilisation(DOC, [{ remittanceNo: 'x', date: '', total: 3785.2, amount: 1000 }])).toEqual({ invoiceValue: 1000, utilised: 1000, difference: 0, status: 'match' });
    expect(utilisation(DOC, [{ remittanceNo: 'x', date: '', total: 3785.2, amount: 600 }]).status).toBe('under');
    expect(hdfcWarnings(DOC, billsFor(DOC.invoiceNo, BILLS), [{ remittanceNo: 'x', date: '', total: 900, amount: 900 }]))
      .toEqual(['Remittances cover 900.00 of 1000.00 USD; 100.00 is not covered.']);
    expect(hdfcWarnings(DOC, [], [])[0]).toMatch(/No shipping bill/);
  });
  it('writes dates the way the form asks', () => {
    expect(hdfcDate('2026-10-05')).toBe('05-Oct-2026');
    expect(hdfcDate('')).toBe('');
  });
});
