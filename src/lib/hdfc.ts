// HDFC "Request letter for export of goods (collection/discounting & regularisation)".
// Filled from the saved invoice set, the shipping bill tracker (looked up by invoice number)
// and the remittances allocated to this invoice. Pure, so it is tested without drawing.
import { ExportDocData, HdfcInputs, invoiceTotals } from './export-docs';

export const HDFC = {
  bank: ['HDFC BANK LTD', 'Ratanada Jodhpur Raj. Branch'],
  account: '50200054318563',
  tel: '78273-81480',
  email: 'caleb@parable-ventures.com',
  exportTypes: ['REGULAR', 'WAREHOUSE', 'PROJECT EXPORT'] as const,
};

export const defaultHdfc = (today: string): HdfcInputs => ({
  letterDate: today, purposeCode: '', exportType: 'REGULAR',
  lcNo: '', lcDate: '', lcAmount: '', issuingBank: '', tenor: '', documentsAgainst: '', remark: '',
});

export interface SbRow { sbNo: string; date: string; portCode: string; adCode: string; shipmentDate: string }
export interface RemitRow { remittanceNo: string; date: string; total: number; amount: number }

type Bill = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const norm = (v: unknown) => s(v).replace(/\s+/g, '').toUpperCase();

/** Shipping bills in the tracker for this invoice number (spaces and case ignored). */
export const billsFor = (invoiceNo: string, bills: Bill[]) => bills.filter(b => norm(b.invoice_no) === norm(invoiceNo) && norm(invoiceNo));

export function sbRows(bills: Bill[], adCode: string): SbRow[] {
  return bills.map(b => ({
    sbNo: s(b.sb_number), date: s(b.sb_date), portCode: s(b.port_code), adCode, shipmentDate: s(b.transport_doc_date),
  }));
}

/** Date of export = the transport document (BoL / AWB) date from the tracker. */
export const dateOfExport = (bills: Bill[]) => bills.map(b => s(b.transport_doc_date)).find(Boolean) ?? '';

export interface Utilisation { invoiceValue: number; utilised: number; difference: number; status: 'match' | 'under' | 'over' | 'none' }

export function utilisation(doc: ExportDocData, remits: RemitRow[]): Utilisation {
  const invoiceValue = Math.round(invoiceTotals(doc).invoiceValueUsd * 100) / 100;
  const utilised = Math.round(remits.reduce((t, r) => t + (r.amount || 0), 0) * 100) / 100;
  const difference = Math.round((invoiceValue - utilised) * 100) / 100;
  const status = !remits.length ? 'none' : Math.abs(difference) < 0.01 ? 'match' : difference > 0 ? 'under' : 'over';
  return { invoiceValue, utilised, difference, status };
}

/** "13-Oct-2026", the date style the HDFC form asks for. */
export function hdfcDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]}-${months[Number(m[2]) - 1]}-${m[1]}`;
}

/** Things to fix before the letter goes to the bank. */
export function hdfcWarnings(doc: ExportDocData, bills: Bill[], remits: RemitRow[]): string[] {
  const w: string[] = [];
  if (doc.isDraft) w.push('This is a draft from a sales order; the bank letter needs the posted invoice.');
  if (!bills.length) w.push(`No shipping bill in the tracker for ${doc.invoiceNo}. Add it on the Shipping bills tab.`);
  else if (!dateOfExport(bills)) w.push('The tracker has no transport document (BoL / AWB) date for this invoice, so the date of export is blank.');
  if (!doc.hdfc?.purposeCode) w.push('Enter the purpose code.');
  const u = utilisation(doc, remits);
  if (u.status === 'under') w.push(`Remittances cover ${u.utilised.toFixed(2)} of ${u.invoiceValue.toFixed(2)} ${doc.currency}; ${u.difference.toFixed(2)} is not covered.`);
  if (u.status === 'over') w.push(`Remittances add up to ${u.utilised.toFixed(2)} ${doc.currency}, more than the invoice value ${u.invoiceValue.toFixed(2)}.`);
  return w;
}

export const DECLARATIONS = {
  packingCredit: 'We hereby confirm that we have not availed any Packing Credit against the related PO/ LC from any Bank and will not avail the same in future. '
    + 'We authorize you to debit our account and recover the loan amount in case of non- realization of export bill.',
  ofac: 'OFAC Declaration: I/We hereby declare that the above transaction does not involve and is not designed for the purpose of any contravention or evasion of the provision of the OFAC.',
  fema: 'FEMA DECLARATION-CUM-UNDERTAKING: We are eligible to export the above mentioned goods under the extant Foreign Trade policy. I / We hereby declare that the above '
    + 'transaction does not involve, and is not designed for the purpose of any contravention or evasion of the provisions of the FEMA 1999 or of any rule, regulation, '
    + 'notification, direction or order made thereunder. I/ We also hereby agree and undertake to give such information/ documents as will reasonably satisfy you about '
    + 'this transaction in terms of the above declaration. I/ We also undertake that if I/ We refuse to comply with any such requirements or make only unsatisfactory '
    + 'compliance therewith, the bank shall refuse in writing to undertake the transaction and shall if it has reason to believe that any contravention /evasion is '
    + 'contemplated by me /us report the matter to Reserve Bank of India. *I / We further declare that the undersigned has/have the authority to give this declaration '
    + 'and undertaking on behalf of the firm/company. We hereby confirm that we have not availed any Packing Credit Against the related PO/ LC from any Bank and will not '
    + 'avail the same in future.',
  terms: [
    'We further agree to the following terms and conditions:',
    '• Upon negotiation / finance of clean documents by the Bank under a confirmed Letter of Credit or payment made by the bank on the due date under a confirmed DC, '
      + 'we will co-operate fully with the Bank and render the Bank all assistance it requires in collection of any outstanding and the enforcement of payment thereof, '
      + 'whether by legal proceedings or otherwise, including the provision of evidence and witnesses, and the execution of further documents required to perfect title to the debt.',
    '• The Bank shall have the right of recourse to us under its confirmation in case non payment by the Letter of Credit issuing /confirming bank for any reason.',
  ],
  eligible: 'We are eligible to export the above mentioned goods under the current Foreign Trade policy in place,',
  disclaimers: [
    'Disclaimers:',
    '• The Bank handling this collection document shall not be held responsible for any act, commission, default suspension, insolvency of the Overseas Buyer and or that of Overseas Bank of the buyer.',
    '• The bank handling this collection document shall not be held liable for any delay in receipt of payment, exchange loss, or any other matter with respect to handling of these documents.',
    '• We are aware of the Crystallisation process of the Bank and we hereby agree to repay the Rupee Equivalent of the Foreign Currency Bill Amount so arrived at together with interest thereon as per record of the Bank.',
    '• We are aware that Export Document backed by Letter of Credit is governed by the Provisions of UCPDC 600 / Non LC Export Document is governed by the Provisions of URC 522 (As applicable).',
  ],
};
