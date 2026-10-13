import { describe, expect, it } from 'vitest';
import { fillEmpty, parseShippingBill } from './shipping-bill-pdf';

// Rows as pdf.js gives them for SB 6822428 (INV262700012), trimmed to the parts the reader uses.
const ROWS = [
  ['Port Code', 'SB No', 'SB Date'],
  ['INTHA6', '6822428', '14-SEP-26'],
  ['INDIAN CUSTOMS EDI SYSTEM'],
  ['ICD THAR DRY PORT BARMER ROAD PAL GAON JODHPUR', 'PKG', '45', 'G.WT KGS', '586', '* SB21150920261153'],
  ['1.EXPORTER\'S NAME & ADDRESS', '7.CONSIGNEE NAME & ADDRESS'],
  ['PARABLE VENTURES PRIVATE LIMITED', 'JOFFA'],
  ['33, Udhyog Nagar,Bansi Second Phase', '2537 BROAD AVE, SUITE 101'],
  ['3. AD CODE:', '0510005', '8. GSTIN / TYPE', '08AAFCH6385K1Z1 GSN'],
  ['1.FOB VALUE', '2.FREIGHT 3.INSURANC 4.DISCOU 5.COM', '1.DBK CLAIM', '2. IGST AMT', '3.CESS AMT'],
  ['358545.34', '0', '0', '0', '0', '5596', '31971.39'],
  ['D.'],
  ['6.DEDUCTIONS', '7.P/C', '8.DUTY 9.CESS', '4.IGST VALUE', '5.RODTEP AMT', '6.ROSCTL AMT'],
  ['C.VALUSUMMA', 'EX.PR.'],
  ['0', '0', '358545.35', '2318', '0'],
  ['1.MAWB NO. 2.MAWB DT 3.HAWB NO. 4.HAWB DT N.O.C.', '1.SNO', '2.INV NO.', '3. INV AMT. 4.CURRENC'],
  ['1', 'INV262700012', '3832.66', 'USD'],
  ['PART - II - INVOICE DETAILS'],
  ['1.S.No', '2.INVOICE No. & Dt.', '3.P.O.No. & Dt.', '4.LoC No. & Dt', '5.Contract No.&Dt', '6.AD code', '7.INVTERM'],
  ['A.'],
  ['REF1', 'INV262700012 09/09/2026', '0510005', 'FOB'],
  ['1.EXPORTER\'S NAME & ADDRESS', '2.BUYER\'S NAME & ADDRESS'],
  ['PARABLE VENTURES PRIVATE LIMITED', 'DESERT KINGDOM TRADERS, LLC'],
  ['1.INVOICE VALUE', '2.FOB VALUE 3FREIGHT 4.INSURANCE5DISCOUNT6.COMMISON 7.DEDUCT', '8.P/C 9.EXCHANGE RATE'],
  ['COPY'],
  ['3832.66', '3832.66', '0', '0', '0', '0', '0', '1 USD INR 93.55'],
];

describe('shipping bill PDF', () => {
  it('reads SB 6822428', () => {
    expect(parseShippingBill(ROWS)).toEqual({
      sb_number: '6822428', sb_date: '2026-09-14', port_code: 'INTHA6', invoice_no: 'INV262700012', invoice_date: '2026-09-09',
      taxable_value_inr: 358545.35, currency: 'USD', consignee: 'JOFFA', buyer: 'DESERT KINGDOM TRADERS, LLC',
      fob_value: 3832.66, freight_value: 0, insurance_value: 0, ad_code: '0510005', packages: 45, gross_weight_kg: 586, exchange_rate: 93.55,
    });
  });
  it('leaves fields blank when the layout is different', () => {
    const p = parseShippingBill([['Something else']]);
    expect(p.sb_number).toBe('');
    expect(p.fob_value).toBeNull();
  });
  it('only fills empty fields of an existing row', () => {
    expect(fillEmpty({ consignee: 'FBA: HYPERNIKAO', sb_number: null, fob_value: '' }, { consignee: 'JOFFA', sb_number: '6822428', fob_value: 3832.66, port_code: '' }))
      .toEqual({ sb_number: '6822428', fob_value: 3832.66 });
  });
});
