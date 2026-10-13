// Consignee / buyer editor: pick an Odoo customer or delivery address from a live search,
// or type the details by hand. Picking only fills the fields; they stay editable.
import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ExportParty } from '@/lib/export-docs';
import { PartnerHit, searchPartners, toParty } from '@/lib/export-docs-data';

export function Field({ label, value, onChange, className, placeholder, type }: {
  label: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string; type?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input className="h-8 text-sm" type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function PartnerSearch({ onPick }: { onPick: (p: PartnerHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PartnerHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) { setHits(null); return; }
    timer.current = window.setTimeout(async () => {
      setBusy(true);
      try { setHits(await searchPartners(q.trim())); } catch { setHits([]); } finally { setBusy(false); }
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [q]);
  return (
    <div className="relative">
      <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
      <Input className="h-8 text-sm pl-7" placeholder="Search Odoo customers and addresses" value={q} onChange={e => setQ(e.target.value)} />
      {busy && <Loader2 className="h-3.5 w-3.5 absolute right-2 top-2.5 animate-spin text-muted-foreground" />}
      {hits && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-popover shadow-md">
          {hits.length === 0 && <div className="p-2 text-xs text-muted-foreground">No matches in Odoo.</div>}
          {hits.map(h => (
            <button key={h.id} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted"
              onClick={() => { onPick(h); setQ(''); setHits(null); }}>
              <div className="font-medium">{h.label}</div>
              <div className="text-muted-foreground truncate">{[h.street, h.city, h.country].filter(Boolean).join(', ')}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PartyEditor({ title, party, onChange }: { title: string; party: ExportParty; onChange: (p: ExportParty) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold">{title}</div>
      <PartnerSearch onPick={h => onChange(toParty(h))} />
      <Field label="Name" value={party.name} onChange={name => onChange({ ...party, name })} />
      <div>
        <Label className="text-[11px] text-muted-foreground">Address (one line per row)</Label>
        <Textarea rows={3} className="text-sm" value={party.lines.join('\n')}
          onChange={e => onChange({ ...party, lines: e.target.value.split('\n') })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Contact" value={party.contact} onChange={contact => onChange({ ...party, contact })} />
        <Field label="Email" value={party.email} onChange={email => onChange({ ...party, email })} />
        <Field label="Phone" value={party.phone} onChange={phone => onChange({ ...party, phone })} />
      </div>
    </div>
  );
}
