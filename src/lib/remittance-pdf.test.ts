import { isoDate, parseRemittance, rowsFromItems } from './remittance-pdf';

describe('isoDate', () => {
  it('reads the bank formats', () => {
    expect(isoDate('23-Mar-2026')).toBe('2026-03-23');
    expect(isoDate('3/04/2026')).toBe('2026-04-03');
    expect(isoDate('2026-03-23')).toBe('2026-03-23');
    expect(isoDate('soon')).toBe('');
  });
});

describe('rowsFromItems', () => {
  it('groups by line and splits columns on wide gaps', () => {
    const rows = rowsFromItems([
      { str: 'Value', x: 10, y: 700, w: 20 }, { str: 'Date', x: 32, y: 700, w: 15 },
      { str: '23-Mar-2026', x: 200, y: 701, w: 40 },
      { str: 'Next', x: 10, y: 680, w: 20 },
    ]);
    expect(rows).toEqual([['Value Date', '23-Mar-2026'], ['Next']]);
  });
});

describe('parseRemittance (HDFC certificate layout)', () => {
  const rows = [
    ['CERTIFICATE OF FOREIGN INWARD REMITTANCE'],
    ['Inward No', ':', '240326I049906113', 'Sender Ref', ':', '0582781082FF'],
    ['Value Date', ':', '23-Mar-2026', 'Credit Date', ':', '24-Mar-2026'],
    ['Account No', ':', '50200054318563'],
    ['Remitter Name & Address', 'Remitting Bank'],
    ['346462580325769 LuxeDesigns CO', 'JPMORGAN CHASE BANK N.A.'],
    ['3003 North Mill Road 08360 Vineland NJ US'],
    ['Currency', 'Amount', 'Exchange Rate', 'INR Amount'],
    ['USD', '3,785.20', '93.4700', '353,802.64'],
    ['Purpose', ':', 'P0103 - Advance receipts against export contracts'],
  ];
  const r = parseRemittance(rows);
  it('reads the numbers and dates', () => {
    expect(r.remittance_no).toBe('240326I049906113');
    expect(r.value_date).toBe('2026-03-23');
    expect(r.currency).toBe('USD');
    expect(r.fcy_amount).toBe(3785.2);
    expect(r.purpose_code).toBe('P0103');
  });
  it('reads the remitter and bank columns', () => {
    expect(r.remitter).toBe('346462580325769 LuxeDesigns CO 3003 North Mill Road 08360 Vineland NJ US');
    expect(r.remitting_bank).toBe('JPMORGAN CHASE BANK N.A.');
  });
});
