// Shipping bill tracker: one row per shipping bill, edited in place. "Add from Odoo invoice"
// (or the row's link button) fills invoice no/date, consignee, buyer, FOB, freight and
// insurance from a posted Odoo invoice; everything else is typed by hand.
import { useMemo, useState } from 'react';
import { AlertTriangle, Link2, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { OdooInvoicePicker } from '@/components/OdooInvoicePicker';
import { Col, TrackerGrid, useRows } from '@/components/TrackerGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { insertRow, listRows, trackerFields, updateRow } from '@/lib/export-docs-data';

export const BANK_STATUSES = ['Not Submitted', 'Pending', 'Completed'];
export const STATUSES = ['In Progress', 'Done'];

const DAY = 86_400_000;
/** Days from the transport document date to bank submission (or to today while not submitted). */
export function daysToSubmission(r: Record<string, unknown>, today = new Date()): { days: number; open: boolean } | null {
  if (!r.transport_doc_date) return null;
  const from = Date.parse(String(r.transport_doc_date));
  const to = r.bank_submitted_date ? Date.parse(String(r.bank_submitted_date)) : Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { days: Math.round((to - from) / DAY), open: !r.bank_submitted_date };
}

const COLS: Col[] = [
  { key: 'sb_number', label: 'Shipping Bill No.', kind: 'text', width: 'min-w-[110px]' },
  { key: 'sb_date', label: 'SB Date', kind: 'date' },
  { key: 'port_code', label: 'Port Code', kind: 'text', width: 'min-w-[80px]' },
  { key: 'invoice_no', label: 'Invoice No.', kind: 'text', width: 'min-w-[120px]' },
  { key: 'invoice_date', label: 'Invoice Date', kind: 'date' },
  { key: 'taxable_value_inr', label: 'SB Taxable Value (INR)', kind: 'num', width: 'min-w-[110px]', total: true },
  { key: 'consignee', label: 'Consignee (Ship To)', kind: 'text', width: 'min-w-[160px]' },
  { key: 'buyer', label: 'Buyer (Bill To)', kind: 'text', width: 'min-w-[160px]' },
  { key: 'currency', label: 'Cur.', kind: 'text', width: 'min-w-[60px]' },
  { key: 'fob_value', label: 'FOB Value', kind: 'num', width: 'min-w-[90px]', total: true },
  { key: 'freight_value', label: 'Freight', kind: 'num', width: 'min-w-[80px]', total: true },
  { key: 'insurance_value', label: 'Insurance', kind: 'num', width: 'min-w-[80px]', total: true },
  { key: 'transport_doc_no', label: 'BoL / AWB No.', kind: 'text', width: 'min-w-[110px]' },
  { key: 'transport_doc_date', label: 'Transport Doc Date', kind: 'date' },
  { key: 'ebrc_date', label: 'eBRC Submitted', kind: 'date' },
  { key: 'bank_submitted_date', label: 'Submitted to Bank', kind: 'date' },
  { key: 'bank_status', label: 'Bank Status', kind: 'select', options: BANK_STATUSES },
  { key: 'status', label: 'Status', kind: 'select', options: STATUSES },
  {
    key: 'days', label: 'Days to Submission', kind: 'computed', render: r => {
      const d = daysToSubmission(r);
      if (!d) return <span className="text-muted-foreground">—</span>;
      return <span className={d.open && d.days > 15 ? 'text-destructive font-medium' : d.open ? 'text-warning' : ''}>{d.days}{d.open ? ' (open)' : ''}</span>;
    },
  },
  { key: 'comments', label: 'Comments', kind: 'text', width: 'min-w-[200px]' },
];

export default function ShippingBills() {
  const { rows, setRows, error } = useRows(() => listRows('shipping_bills'));
  const [adding, setAdding] = useState<'odoo' | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'open' | 'all' | 'done'>('all');

  const shown = useMemo(() => (rows ?? []).filter(r => {
    if (status === 'open' && r.status === 'Done') return false;
    if (status === 'done' && r.status !== 'Done') return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return ['sb_number', 'invoice_no', 'consignee', 'buyer', 'transport_doc_no', 'comments'].some(k => String(r[k] ?? '').toLowerCase().includes(s));
  }), [rows, q, status]);

  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows ?? []) if (r.invoice_no) seen.set(String(r.invoice_no), (seen.get(String(r.invoice_no)) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  }, [rows]);

  const addBlank = async () => {
    setBusy(true);
    try { const r = await insertRow('shipping_bills', { bank_status: 'Not Submitted', status: 'In Progress', currency: 'USD' }); setRows(rs => [r, ...rs]); }
    catch (e: any) { toast.error(e?.message || 'Could not add'); }
    finally { setBusy(false); }
  };

  const fromOdoo = async (invoiceId: number, rowId?: string) => {
    setBusy(true);
    try {
      const f = await trackerFields(invoiceId);
      if (!rowId && rows?.some(r => r.invoice_no === f.invoice_no) && !window.confirm(`${f.invoice_no} is already in the tracker. Add another row?`)) return;
      const r = rowId ? await updateRow('shipping_bills', rowId, { ...f }) : await insertRow('shipping_bills', { ...f, bank_status: 'Not Submitted', status: 'In Progress' });
      if (r) setRows(rs => (rowId ? rs.map(x => (x.id === rowId ? r : x)) : [r, ...rs]));
      toast.success(`Filled from ${f.invoice_no}`);
    } catch (e: any) { toast.error(e?.message || 'Could not read Odoo'); }
    finally { setBusy(false); setAdding(null); setLinking(null); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold mr-2">Shipping bills</h2>
        <Input className="h-8 text-sm w-56" placeholder="Search SB, invoice, party, AWB" value={q} onChange={e => setQ(e.target.value)} />
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          {(['all', 'open', 'done'] as const).map(s => (
            <button key={s} type="button" onClick={() => setStatus(s)}
              className={`px-2.5 py-1 rounded capitalize ${status === s ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}>{s === 'open' ? 'In progress' : s}</button>
          ))}
        </div>
        <div className="flex-1" />
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {adding === 'odoo'
          ? <OdooInvoicePicker onPick={s => fromOdoo(s.id)} onClose={() => setAdding(null)} placeholder="Pick the Odoo invoice for this shipping bill" />
          : <Button size="sm" className="h-8 gap-1.5" onClick={() => setAdding('odoo')} disabled={!rows}><Plus className="h-3.5 w-3.5" /> Add from Odoo invoice</Button>}
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={addBlank} disabled={!rows || busy}><Plus className="h-3.5 w-3.5" /> Blank row</Button>
      </div>
      {linking && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Fill the selected row from:</span>
          <OdooInvoicePicker onPick={s => fromOdoo(s.id, linking)} onClose={() => setLinking(null)} />
        </div>
      )}
      {dupes.length > 0 && (
        <div className="text-xs text-warning flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> More than one row for invoice {dupes.join(', ')}.</div>
      )}
      {error && <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">{error}</div>}
      {!rows && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {rows && (
        <TrackerGrid table="shipping_bills" cols={COLS} rows={shown} setRows={setRows}
          actions={r => (
            <Button variant="ghost" size="icon" className={`h-7 w-7 ${linking === r.id ? 'bg-muted' : ''}`} title="Fill this row from an Odoo invoice"
              onClick={() => setLinking(linking === r.id ? null : r.id)}>
              <Link2 className="h-3.5 w-3.5" />
            </Button>
          )} />
      )}
      <p className="text-[11px] text-muted-foreground">
        Cells save when you leave them. Days to submission count from the transport document date to the bank submission date (or today, while still open).
      </p>
    </div>
  );
}
