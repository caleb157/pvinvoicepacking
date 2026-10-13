// Search posted Odoo customer invoices and pick one (read live; nothing is copied).
import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SourceSummary, listSources } from '@/lib/export-docs-data';

export function OdooInvoicePicker({ onPick, onClose, placeholder = 'Search Odoo invoices' }: {
  onPick: (s: SourceSummary) => void; onClose?: () => void; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SourceSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setBusy(true);
      try { setHits(await listSources('invoice', q.trim())); } catch { setHits([]); } finally { setBusy(false); }
    }, q ? 300 : 0);
    return () => window.clearTimeout(timer.current);
  }, [q]);
  return (
    <div className="relative w-full max-w-md">
      <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
      <Input autoFocus className="h-8 text-sm pl-7 pr-7" placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onClose?.(); }} />
      {busy ? <Loader2 className="h-3.5 w-3.5 absolute right-2 top-2.5 animate-spin text-muted-foreground" />
        : onClose && <button type="button" className="absolute right-2 top-2.5" onClick={onClose} title="Close"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
      {hits && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-popover shadow-md">
          {hits.length === 0 && <div className="p-2 text-xs text-muted-foreground">No posted invoices match.</div>}
          {hits.map(h => (
            <button key={h.id} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted flex gap-2"
              onClick={() => onPick(h)}>
              <span className="font-medium w-32 shrink-0 truncate">{h.name}</span>
              <span className="text-muted-foreground w-20 shrink-0">{h.date ?? ''}</span>
              <span className="flex-1 truncate">{h.customer}</span>
              <span className="tabular-nums">{h.currency} {h.amount_total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
