// Inward remittances: one row per HDFC inward remittance, edited in place. "Read PDF" fills a
// new row from the bank's Certificate of Foreign Inward Remittance (no AI: fixed layout).
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Col, TrackerGrid, useRows } from '@/components/TrackerGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Allocation, insertRow, listAllocations, listRows } from '@/lib/export-docs-data';

const COLS: Col[] = [
  { key: 'remittance_no', label: 'Remittance No.', kind: 'text', width: 'min-w-[140px]' },
  { key: 'value_date', label: 'Value Date', kind: 'date' },
  { key: 'currency', label: 'Cur.', kind: 'text', width: 'min-w-[60px]' },
  { key: 'fcy_amount', label: 'FCY Amount', kind: 'num', width: 'min-w-[100px]', total: true },
  { key: 'exchange_rate', label: 'Exch. Rate', kind: 'num', width: 'min-w-[80px]' },
  { key: 'inr_amount', label: 'INR Amount', kind: 'num', width: 'min-w-[110px]', total: true },
  { key: 'used', label: 'Used on invoices', kind: 'computed' },
  { key: 'remitter', label: 'Remitter', kind: 'text', width: 'min-w-[220px]' },
  { key: 'remitting_bank', label: 'Remitting Bank', kind: 'text', width: 'min-w-[160px]' },
  { key: 'purpose_code', label: 'Purpose', kind: 'text', width: 'w-20' },
  { key: 'comments', label: 'Comments', kind: 'text', width: 'min-w-[200px]' },
];

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Remittances() {
  const { rows, setRows, error } = useRows(() => listRows('inward_remittances'));
  const [allocs, setAllocs] = useState<Allocation[]>([]);
  useEffect(() => { listAllocations().then(setAllocs).catch(() => { /* table not set up yet */ }); }, []);
  const cols = useMemo(() => COLS.map(c => (c.key !== 'used' ? c : {
    ...c, render: (r: Record<string, unknown>) => {
      const mine = allocs.filter(a => a.remittance_id === r.id);
      if (!mine.length) return <span className="text-muted-foreground">unused</span>;
      const used = mine.reduce((t, a) => t + a.amount, 0);
      const left = Number(r.fcy_amount || 0) - used;
      return (
        <span title={mine.map(a => `${a.invoice_no}: ${fmt(a.amount)}`).join('\n')}>
          {mine.map(a => a.invoice_no).join(', ')} · <span className={left > 0.005 ? 'text-warning' : 'text-muted-foreground'}>{left > 0.005 ? `${fmt(left)} left` : 'fully used'}</span>
        </span>
      );
    },
  })), [allocs]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => (rows ?? []).filter(r => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return ['remittance_no', 'remitter', 'remitting_bank', 'purpose_code', 'comments'].some(k => String(r[k] ?? '').toLowerCase().includes(s));
  }), [rows, q]);

  const addBlank = async () => {
    setBusy(true);
    try { const r = await insertRow('inward_remittances', { currency: 'USD' }); setRows(rs => [r, ...rs]); }
    catch (e: any) { toast.error(e?.message || 'Could not add'); }
    finally { setBusy(false); }
  };

  const readPdfs = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const { parseRemittance, pdfRows } = await import('@/lib/remittance-pdf');
    for (const f of Array.from(files)) {
      try {
        const p = parseRemittance(await pdfRows(f));
        if (!p.remittance_no && p.fcy_amount == null) { toast.error(`${f.name}: couldn't find a remittance in this PDF. Add it by hand.`); continue; }
        if (p.remittance_no && rows?.some(r => r.remittance_no === p.remittance_no)) { toast.warning(`${p.remittance_no} is already in the table; skipped.`); continue; }
        const missing = Object.entries(p).filter(([, v]) => v == null || v === '').map(([k]) => k.replace(/_/g, ' '));
        const r = await insertRow('inward_remittances', { ...p, comments: `Read from ${f.name}` });
        setRows(rs => [r, ...rs]);
        if (missing.length) toast.warning(`${p.remittance_no || f.name}: added. Not found in the PDF: ${missing.join(', ')}.`);
        else toast.success(`${p.remittance_no}: added from the PDF. Check it against the certificate.`);
      } catch (e: any) { toast.error(`${f.name}: ${e?.message || 'could not read'}`); }
    }
    setBusy(false);
    if (file.current) file.current.value = '';
  };

  return (
    <div className="p-4 sm:p-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold mr-2">Inward remittances</h2>
        <Input className="h-8 text-sm w-56" placeholder="Search number, remitter, bank" value={q} onChange={e => setQ(e.target.value)} />
        <div className="flex-1" />
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <input ref={file} type="file" accept="application/pdf" multiple className="hidden" onChange={e => readPdfs(e.target.files)} />
        <Button size="sm" className="h-8 gap-1.5" onClick={() => file.current?.click()} disabled={!rows || busy}><FileUp className="h-3.5 w-3.5" /> Read remittance PDF</Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={addBlank} disabled={!rows || busy}><Plus className="h-3.5 w-3.5" /> Blank row</Button>
      </div>
      {error && <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">{error}</div>}
      {!rows && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {rows && <TrackerGrid table="inward_remittances" cols={cols} rows={shown} setRows={setRows} />}
      <p className="text-[11px] text-muted-foreground">
        Cells save when you leave them. PDFs are read in your browser from HDFC's inward remittance certificate layout; anything it can't find is left blank.
      </p>
    </div>
  );
}
