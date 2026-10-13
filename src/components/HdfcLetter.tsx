// HDFC export regularization letter for the open invoice: shipping bills come from the
// tracker (by invoice number), remittances are picked from the remittance table with the
// amount used on this invoice; the app keeps each remittance's unused balance.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Field } from '@/components/PartyEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExportDocData, HdfcInputs } from '@/lib/export-docs';
import { Allocation, TrackerRow, listAllocations, listRows, setAllocations } from '@/lib/export-docs-data';
import { HDFC, RemitRow, billsFor, dateOfExport, defaultHdfc, hdfcDate, hdfcWarnings, utilisation } from '@/lib/hdfc';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Pick { remittanceId: string; amount: number }

export function HdfcLetter({ doc, patch, adCode, sig, onDownload }: {
  doc: ExportDocData; patch: (p: Partial<ExportDocData>) => void; adCode: string;
  sig: { name: string; title: string }; onDownload: (blob: Blob, name: string) => Promise<void>;
}) {
  const [bills, setBills] = useState<TrackerRow[] | null>(null);
  const [remittances, setRemittances] = useState<TrackerRow[]>([]);
  const [allocs, setAllocs] = useState<Allocation[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const h: HdfcInputs = doc.hdfc ?? defaultHdfc(new Date().toISOString().slice(0, 10));
  const setH = (p: Partial<HdfcInputs>) => patch({ hdfc: { ...h, ...p } });

  useEffect(() => {
    let live = true;
    Promise.all([listRows('shipping_bills'), listRows('inward_remittances'), listAllocations()])
      .then(([b, r, a]) => {
        if (!live) return;
        setBills(b); setRemittances(r); setAllocs(a);
        setPicks(a.filter(x => x.invoice_no === doc.invoiceNo).map(x => ({ remittanceId: x.remittance_id, amount: x.amount })));
      })
      .catch((e: any) => live && setError(e?.missingTables ? 'Run sql/setup.sql again (it adds the remittance allocations table), then reload.' : e?.message || 'Could not load the tracker'));
    return () => { live = false; };
  }, [doc.invoiceNo]);

  const mine = useMemo(() => billsFor(doc.invoiceNo, bills ?? []), [bills, doc.invoiceNo]);
  /** Unused balance of a remittance, ignoring this invoice's own allocation. */
  const left = (id: string) => {
    const r = remittances.find(x => x.id === id);
    const used = allocs.filter(a => a.remittance_id === id && a.invoice_no !== doc.invoiceNo).reduce((t, a) => t + a.amount, 0);
    return Math.max(0, Number(r?.fcy_amount || 0) - used);
  };
  const remitRows: RemitRow[] = picks.filter(p => p.remittanceId).map(p => {
    const r = remittances.find(x => x.id === p.remittanceId);
    return { remittanceNo: String(r?.remittance_no ?? ''), date: String(r?.value_date ?? ''), total: Number(r?.fcy_amount || 0), amount: p.amount };
  });
  const u = utilisation(doc, remitRows);
  const warnings = bills ? hdfcWarnings(doc, mine, remitRows) : [];
  const purposes = [...new Set(remittances.map(r => String(r.purpose_code || '')).filter(Boolean))];
  const choices = remittances.filter(r => left(r.id) > 0.005 || picks.some(p => p.remittanceId === r.id));

  const download = async () => {
    setBusy(true);
    try {
      const items = picks.filter(p => p.remittanceId && p.amount > 0).map(p => ({ remittance_id: p.remittanceId, amount: p.amount }));
      setAllocs(await setAllocations(doc.invoiceNo, items));
      const L = await import('@/lib/letters-pdf');
      await onDownload(await L.hdfcPdf(doc, { bills: mine, remits: remitRows, adCode, sig }), `HDFC Request Letter - ${doc.invoiceNo}.pdf`);
    } catch (e: any) { toast.error(e?.message || 'Could not make the letter'); }
    finally { setBusy(false); }
  };

  if (error) return <p className="text-xs text-warning flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}</p>;
  if (!bills) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Letter date" type="date" value={h.letterDate} onChange={letterDate => setH({ letterDate })} />
        <div className="sm:col-span-2">
          <Label className="text-[11px] text-muted-foreground">Purpose code & details</Label>
          <Input className="h-8 text-sm" list="purpose-codes" placeholder="P0103 - Advance receipts against export contracts" value={h.purposeCode}
            onChange={e => setH({ purposeCode: e.target.value })} />
          <datalist id="purpose-codes">{purposes.map(p => <option key={p} value={p} />)}</datalist>
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Type of export</Label>
          <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={h.exportType}
            onChange={e => setH({ exportType: e.target.value as HdfcInputs['exportType'] })}>
            {HDFC.exportTypes.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>
          From the tracker: {mine.length
            ? mine.map(b => `SB ${b.sb_number || '?'} of ${hdfcDate(String(b.sb_date || ''))}, port ${b.port_code || '?'}`).join('; ')
            : 'no shipping bill for this invoice yet'}.
          {' '}Date of export (transport document): {hdfcDate(dateOfExport(mine)) || '—'}. AD code: {adCode || 'not set in Settings'}.
        </div>
        <div>Destination {doc.countryOfFinalDestination || '—'} · account {HDFC.account} · tel {HDFC.tel} · {HDFC.email} · forward cover left blank.</div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Letter of credit and remark (only if used)</summary>
        <div className="grid gap-2 sm:grid-cols-3 pt-2">
          <Field label="LC No." value={h.lcNo} onChange={lcNo => setH({ lcNo })} />
          <Field label="LC dated" type="date" value={h.lcDate} onChange={lcDate => setH({ lcDate })} />
          <Field label="LC amount" value={h.lcAmount} onChange={lcAmount => setH({ lcAmount })} />
          <Field label="Issuing bank" value={h.issuingBank} onChange={issuingBank => setH({ issuingBank })} />
          <Field label="Tenor" value={h.tenor} onChange={tenor => setH({ tenor })} />
          <Field label="Documents to be delivered against" value={h.documentsAgainst} onChange={documentsAgainst => setH({ documentsAgainst })} />
          <Field label="Remark" value={h.remark} onChange={remark => setH({ remark })} className="sm:col-span-3" />
        </div>
      </details>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold">Inward remittances used for this invoice</div>
        {picks.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className="h-8 rounded-md border bg-background px-2 text-xs min-w-[18rem]" value={p.remittanceId}
              onChange={e => setPicks(ps => ps.map((x, j) => (j === i ? { remittanceId: e.target.value, amount: x.amount || Math.min(left(e.target.value), Math.max(0, u.difference)) } : x)))}>
              <option value="">Pick a remittance…</option>
              {choices.map(r => (
                <option key={r.id} value={r.id} disabled={picks.some((x, j) => j !== i && x.remittanceId === r.id)}>
                  {r.remittance_no} · {hdfcDate(String(r.value_date || ''))} · {r.currency} {money(Number(r.fcy_amount || 0))} · {money(left(r.id))} left
                </option>
              ))}
            </select>
            <Input type="number" step="any" className="h-8 w-32 text-xs text-right" placeholder="Amount used" value={p.amount || ''}
              onChange={e => setPicks(ps => ps.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} />
            {p.remittanceId && p.amount > left(p.remittanceId) + 0.005 && <span className="text-xs text-destructive">only {money(left(p.remittanceId))} left</span>}
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Remove" onClick={() => setPicks(ps => ps.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setPicks(ps => [...ps, { remittanceId: '', amount: 0 }])} disabled={!choices.length}>
          <Plus className="h-3.5 w-3.5" /> Add remittance
        </Button>
        {!remittances.length && <span className="text-xs text-muted-foreground ml-2">Add remittances on the Remittances tab first.</span>}
        <div className={`text-xs flex items-center gap-1.5 ${u.status === 'match' ? 'text-success' : u.status === 'none' ? 'text-muted-foreground' : 'text-warning'}`}>
          {u.status === 'match' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          Utilized {doc.currency} {money(u.utilised)} of invoice value {money(u.invoiceValue)}
          {u.status === 'under' && ` (${money(u.difference)} not covered)`}{u.status === 'over' && ` (${money(-u.difference)} over)`}
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="text-xs text-warning space-y-0.5">
          {warnings.map(w => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</li>)}
        </ul>
      )}
      <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || doc.isDraft} onClick={download}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} HDFC request letter
      </Button>
      <p className="text-[11px] text-muted-foreground">Downloading also saves the amounts used, so each remittance's balance stays right across invoices.</p>
    </div>
  );
}
