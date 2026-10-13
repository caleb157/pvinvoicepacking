// Editable table for the tracker tables: every cell edits in place and saves when you leave
// it; numbers accept "$1,234.50"; computed columns are read-only.
import { ReactNode, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TrackerRow, TrackerTable, deleteRow, updateRow } from '@/lib/export-docs-data';

export interface Col {
  key: string; label: string; kind: 'text' | 'date' | 'num' | 'select' | 'computed';
  options?: string[]; width?: string; render?: (row: TrackerRow) => ReactNode; total?: boolean;
}

const show = (c: Col, v: unknown) => {
  if (v == null) return '';
  if (c.kind === 'num') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
  return String(v);
};

function Cell({ col, row, onSave }: { col: Col; row: TrackerRow; onSave: (key: string, v: string) => Promise<void> }) {
  const raw = row[col.key];
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (col.kind === 'num' ? (raw == null ? '' : String(raw)) : show(col, raw));
  const commit = async () => {
    if (draft == null) return;
    const before = raw == null ? '' : String(raw);
    if (draft.trim() === before) { setDraft(null); return; }
    await onSave(col.key, draft.trim());
    setDraft(null);
  };
  const base = 'w-full h-7 bg-transparent px-1.5 text-xs rounded focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background';
  if (col.kind === 'select') {
    return (
      <select className={base} value={String(raw ?? '')} onChange={e => onSave(col.key, e.target.value)}>
        <option value="" />
        {col.options!.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input className={`${base} ${col.kind === 'num' ? 'text-right tabular-nums' : ''}`} type={col.kind === 'date' ? 'date' : 'text'}
      inputMode={col.kind === 'num' ? 'decimal' : undefined} value={value}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); }} />
  );
}

export function TrackerGrid({ table, cols, rows, setRows, actions }: {
  table: TrackerTable; cols: Col[]; rows: TrackerRow[]; setRows: (f: (r: TrackerRow[]) => TrackerRow[]) => void;
  actions?: (row: TrackerRow) => ReactNode;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const save = async (row: TrackerRow, key: string, v: string) => {
    try {
      const saved = await updateRow(table, row.id, { [key]: v });
      if (saved) setRows(rs => rs.map(r => (r.id === row.id ? saved : r)));
    } catch (e: any) { toast.error(`Not saved: ${e?.message}`); }
  };
  const remove = async (row: TrackerRow) => {
    if (!window.confirm('Delete this row?')) return;
    setDeleting(row.id);
    try { await deleteRow(table, row.id); setRows(rs => rs.filter(r => r.id !== row.id)); }
    catch (e: any) { toast.error(e?.message || 'Could not delete'); }
    finally { setDeleting(null); }
  };
  const totals = cols.filter(c => c.total);
  return (
    <div className="overflow-auto rounded-md border max-h-[calc(100vh-14rem)]">
      <table className="text-xs border-collapse min-w-full">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {cols.map(c => <th key={c.key} className={`text-left font-medium text-muted-foreground px-1.5 py-1.5 border-b whitespace-nowrap ${c.width ?? ''}`}>{c.label}</th>)}
            <th className="border-b" />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-b hover:bg-muted/40">
              {cols.map(c => (
                <td key={c.key} className={`px-0.5 py-0.5 ${c.width ?? ''}`}>
                  {c.kind === 'computed' ? <div className="px-1.5 whitespace-nowrap">{c.render?.(row)}</div>
                    : <Cell col={c} row={row} onSave={(k, v) => save(row, k, v)} />}
                </td>
              ))}
              <td className="px-1 whitespace-nowrap">
                {actions?.(row)}
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete row" onClick={() => remove(row)} disabled={deleting === row.id}>
                  {deleting === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="p-4 text-center text-muted-foreground">No rows yet.</td></tr>}
        </tbody>
        {totals.length > 0 && rows.length > 0 && (
          <tfoot className="sticky bottom-0 bg-muted font-semibold">
            <tr>
              {cols.map(c => (
                <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                  {c.total ? rows.reduce((t, r) => t + (Number(r[c.key]) || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Loads a tracker table once; shows the setup message when the tables are missing. */
export function useRows(load: () => Promise<TrackerRow[]>) {
  const [rows, setRows] = useState<TrackerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load().then(setRows).catch((e: any) => setError(e?.missingTables
      ? 'The app database is not set up yet. Run sql/setup.sql in the Neon SQL editor, then reload.'
      : e?.message || 'Could not load'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, setRows: (f: (r: TrackerRow[]) => TrackerRow[]) => setRows(r => f(r ?? [])), error };
}
