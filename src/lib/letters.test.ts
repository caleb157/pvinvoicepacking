import { describe, expect, it } from 'vitest';
import { ExportDocData, PackRow } from './export-docs';
import { evdTerms, isRelatedBuyer, joinAnd, labelData, letterDate, nonDgRows, notReady, productNames, woodText } from './letters';

const row = (label: string, qty: number, per: number, net: number, gross: number, customerSku = ''): PackRow => ({
  sku: label, internalSku: label, customerSku, description: `${label} / long`, labelDescription: label, quantity: qty,
  unitsPerPackage: per, packageDims: '20 x 20 x 20', packageKind: 'Carton', netWeightKg: net, grossWeightKg: gross, unitGrossKg: 0, grossManual: true,
});
const party = (name: string) => ({ name, lines: ['1 Main St', 'Vineland, NJ 08360', 'United States'], contact: '', email: '', phone: '' });
const DOC: ExportDocData = {
  invoiceNo: 'INV/2026/00015', invoiceDate: '2026-10-01', exporterRef: '', buyerOrderNo: 'PO-7781', buyerOrderDate: '', billOfLading: '',
  otherReferences: '', shipper: { ...party('Parable Ventures Private Limited'), gstNumber: 'x' }, consignee: party('LuxeDesigns Warehouse'),
  buyer: party('LuxeDesigns Co'), preCarriageBy: '', vesselFlightNo: '', portOfDischarge: '', countryOfOrigin: 'India',
  countryOfFinalDestination: 'United States of America', placeOfReceipt: '', portOfLoading: '', finalDestination: '',
  termsOfDelivery: 'FOB Jodhpur, 50% advance', handlingInformation: '', currency: 'USD', taxMode: 'lut', lutArn: '', isDraft: false,
  exchangeRate: 93, notificationNo: '', shippingInr: 0, shippingIgstInr: 0, signatoryCompany: '', signatoryName: '',
  lines: [],
  // 110 ashtrays split 100 in cartons of 20 + 10 in one carton, then 3 trays one per carton.
  packing: [row('Ashtray with Cork (Mango)', 100, 20, 8, 9.5, 'LX-1001'), row('Ashtray with Cork (Mango)', 10, 10, 4, 5, 'LX-1001'), row('Serving Tray', 3, 1, 2, 2.6)],
};

describe('labels', () => {
  it('makes one label per carton, numbered across the shipment', () => {
    const l = labelData(DOC);
    expect(l).toHaveLength(9);
    expect(l[0]).toMatchObject({ carton: 1, total: 9, qty: 20, customerSku: 'LX-1001', customerPo: 'PO-7781', invoiceNo: 'INV/2026/00015', origin: 'India', size: '20 x 20 x 20 in' });
    expect(l[5]).toMatchObject({ carton: 6, qty: 10, grossKg: 5 });
    expect(l[8]).toMatchObject({ carton: 9, description: 'Serving Tray', customerSku: '' });
  });
  it('needs a posted invoice and weights', () => {
    expect(notReady(DOC)).toBe('');
    expect(notReady({ ...DOC, isDraft: true })).toMatch(/posted invoice/);
    expect(notReady({ ...DOC, packing: [row('x', 1, 1, 0, 1)] })).toMatch(/0 kg/);
  });
});

describe('letters', () => {
  it('joins product names', () => {
    expect(joinAnd(['A'])).toBe('A');
    expect(joinAnd(['A', 'B'])).toBe('A and B');
    expect(joinAnd(['A', 'B', 'C'])).toBe('A, B and C');
    expect(productNames(DOC)).toBe('Ashtray with Cork (Mango) and Serving Tray');
  });
  it('fills the Non-DG rows from the packing list and invoice', () => {
    const r = Object.fromEntries(nonDgRows(DOC, { name: 'Parker Hoye', title: 'Director' }));
    expect(r['NO. OF PACKAGES']).toBe('9');
    expect(r['GROSS WEIGHT']).toBe('60.3 KG'); // 5 × 9.5 + 5 + 3 × 2.6
    expect(r['NET WEIGHT']).toBe('50 KG');
    expect(r['CONSIGNEE ADDRESS']).toBe('LuxeDesigns Warehouse, 1 Main St, Vineland, NJ 08360, United States');
    expect(r['AWB NO.']).toBe('');
    expect(r['NOTIFY ADDRESS']).toMatch(/^Parable Ventures Private Limited, 1 Main St/);
    expect(r.NAME).toBe('Parker Hoye');
  });
  it('marks Desert Kingdom Traders as related', () => {
    expect(isRelatedBuyer(DOC)).toBe(false);
    expect(isRelatedBuyer({ ...DOC, buyer: party('DESERT KINGDOM TRADERS LLC') })).toBe(true);
    expect(isRelatedBuyer({ ...DOC, buyer: null, consignee: party('Desert Kingdom Traders') })).toBe(true);
  });
  it('reads terms from Odoo, else from the combined field', () => {
    expect(evdTerms(DOC)).toEqual({ payment: '50% advance', delivery: 'FOB Jodhpur' });
    expect(evdTerms({ ...DOC, incoterm: 'FOB', paymentTerms: '30 Days' })).toEqual({ payment: '30 Days', delivery: 'FOB' });
  });
  it('writes the wooden declaration', () => {
    expect(letterDate('2026-10-01')).toBe('1 Oct 2026');
    expect(woodText({ ...DOC, woodSpecies: ['Mango', 'Acacia'] })).toBe(
      'We hereby declare that we are sending wooden items to consignee in the United States of America under our Invoice no. '
      + 'INV/2026/00015 dated 1 Oct 2026 and confirming that we have used MANGO AND ACACIA WOOD in this shipment, which is not a prohibited item.');
  });
});
