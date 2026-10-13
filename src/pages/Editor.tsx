// Documents: pick a posted Odoo invoice (or a confirmed sales order for drafts), edit the
// commercial invoice and the packing list, and download Excel / PDF copies. The edited set
// is saved per invoice or order, so labels and letters later match the saved packing list.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Copy, Download, ExternalLink, FileSpreadsheet, FileText, History, Loader2, RefreshCw,
  Save, Search, Tag, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Field, PartyEditor } from '@/components/PartyEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ExportDocData, ExportLine, ICEGATE_RATES_URL, PackRow, TaxMode, amountInWords, grossFromUnits, invoiceLine, invoiceTotals,
  packingLines, packingMismatches, packingTotals, safeFileName, unevenRows,
} from '@/lib/export-docs';
import {
  ApiError, AppSettings, DEFAULT_SHIPPING, ShipmentSummary, ShippingDefaults, SourceKind, SourceSummary,
  docFromSource, getShipment, getSource, listSources, loadInit, rememberedPacking, saveCustomsRate, saveShipment,
} from '@/lib/export-docs-data';
import { WOOD_SPECIES, notReady } from '@/lib/letters';

export const MISSING_TABLES_MSG = 'The app database is not set up yet. Run sql/setup.sql in the Neon SQL editor, then reload.';
export const isMissingTable = (e: unknown) => e instanceof ApiError && e.missingTables;

const PREFS_KEY = 'pv-docs:editor';
interface Prefs { contact: string; signatory: string; taxMode: TaxMode; shipping: ShippingDefaults }
function loadPrefs(): Prefs {
  try {
    const s = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (s) return { contact: s.contact ?? '', signatory: s.signatory ?? '', taxMode: s.taxMode === 'lut' ? 'lut' : 'igst', shipping: { ...DEFAULT_SHIPPING, ...s.shipping } };
  } catch { /* fall through */ }
  return { contact: '', signatory: '', taxMode: 'igst', shipping: DEFAULT_SHIPPING };
}

export const money = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const today = () => new Date().toISOString().slice(0, 10);

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function NumCell({ value, onChange, w = 'w-20', warn }: { value: number; onChange: (n: number) => void; w?: string; warn?: boolean }) {
  return (
    <Input type="number" step="any" className={`h-7 px-1.5 text-xs text-right ${w} ${warn ? 'border-warning' : ''}`}
      value={Number.isFinite(value) && value !== 0 ? value : ''}
      onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
  );
}

interface Source { kind: SourceKind; name: string; odooId: number | null }

export default function Editor({ settings }: { settings: AppSettings | null }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);

  const [rate, setRate] = useState({ rate: '', notificationNo: '', effectiveFrom: today(), stored: null as null | { rate: number; notificationNo: string; effectiveFrom: string } });
  const [tablesMissing, setTablesMissing] = useState(false);

  const [kind, setKind] = useState<SourceKind>('invoice');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<SourceSummary[] | null>(null);
  const [listing, setListing] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);

  const [doc, setDoc] = useState<ExportDocData | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { rate: r, shipments: s } = await loadInit();
        if (r) {
          const stored = { rate: Number(r.rate), notificationNo: r.notification_no || '', effectiveFrom: r.effective_from };
          setRate({ rate: String(stored.rate), notificationNo: stored.notificationNo, effectiveFrom: stored.effectiveFrom, stored });
        }
        setShipments(s);
      } catch (e: any) {
        if (isMissingTable(e)) setTablesMissing(true); else toast.error(e?.message || 'Could not load saved data');
      }
    })();
  }, []);

  const runSearch = async (k = kind) => {
    setListing(true);
    try { setItems(await listSources(k, search.trim())); }
    catch (e: any) { toast.error(e?.message || 'Could not read Odoo'); }
    finally { setListing(false); }
  };
  useEffect(() => { runSearch(kind); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const rateNum = Number(rate.rate) || 0;
  const rateChanged = !rate.stored || rate.stored.rate !== rateNum || rate.stored.notificationNo !== rate.notificationNo
    || rate.stored.effectiveFrom !== rate.effectiveFrom;

  const saveRate = async () => {
    if (!(rateNum > 0)) { toast.error('Enter the rate first'); return; }
    try {
      await saveCustomsRate({ currency: 'USD', rate: rateNum, notification_no: rate.notificationNo.trim(), effective_from: rate.effectiveFrom || today(), source_url: ICEGATE_RATES_URL });
      setRate(r => ({ ...r, stored: { rate: rateNum, notificationNo: r.notificationNo.trim(), effectiveFrom: r.effectiveFrom } }));
      toast.success('Customs rate saved');
    } catch (e: any) { toast.error(isMissingTable(e) ? MISSING_TABLES_MSG : e?.message || 'Could not save the rate'); }
  };

  // Keep the document's rate in step with the rate card (and the INR value of freight lines).
  useEffect(() => {
    setDoc(d => {
      if (!d || (d.exchangeRate === rateNum && d.notificationNo === rate.notificationNo)) return d;
      const charges = d.exchangeRate ? d.shippingInr / d.exchangeRate : 0;
      return { ...d, exchangeRate: rateNum, notificationNo: rate.notificationNo, shippingInr: Math.round(charges * rateNum * 100) / 100 };
    });
  }, [rateNum, rate.notificationNo]);

  const buildFromOdoo = async (k: SourceKind, id: number) => {
    const src = await getSource(k, id);
    const remembered = await rememberedPacking(src.lines.map(l => l.internal_sku));
    setDoc(docFromSource(src, {
      contact: prefs.contact, remembered, shipping: prefs.shipping, taxMode: prefs.taxMode, lutArn: settings?.lutArn ?? '',
      rate: rateNum, notificationNo: rate.notificationNo, signatoryName: prefs.signatory || settings?.signatoryName || '',
    }));
    setSource({ kind: k, name: src.name, odooId: src.id });
    setSavedNote(null);
    setSavedKey(null);
  };

  /** Opens the saved set for this invoice / order if there is one, else builds it from Odoo. */
  const pick = async (k: SourceKind, id: number, name: string) => {
    setLoadingKey(`${k}:${id}`);
    try {
      const saved = await getShipment(k, name).catch(e => { if (isMissingTable(e)) return null; throw e; });
      if (saved) {
        setDoc(saved.payload);
        setSource({ kind: k, name, odooId: saved.odoo_id ?? id });
        setSavedNote(`Saved by ${saved.updated_by || 'someone'} on ${String(saved.updated_at).slice(0, 10)}.`);
        setSavedKey(JSON.stringify(saved.payload));
      } else await buildFromOdoo(k, id);
    } catch (e: any) { toast.error(e?.message || 'Could not load from Odoo'); }
    finally { setLoadingKey(null); }
  };

  const rebuild = async () => {
    if (!source?.odooId) return;
    if (!window.confirm('Rebuild from Odoo? Edits to this set (packing rows, addresses) will be replaced.')) return;
    setLoadingKey('rebuild');
    try { await buildFromOdoo(source.kind, source.odooId); toast.success('Rebuilt from Odoo'); }
    catch (e: any) { toast.error(e?.message || 'Could not read Odoo'); }
    finally { setLoadingKey(null); }
  };

  const patch = (p: Partial<ExportDocData>) => setDoc(d => (d ? { ...d, ...p } : d));
  const patchLine = (i: number, p: Partial<ExportLine>) => setDoc(d => d ? { ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) } : d);
  const patchPack = (i: number, p: Partial<PackRow>) => setDoc(d => {
    if (!d) return d;
    return {
      ...d, packing: d.packing.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...p };
        if ('grossWeightKg' in p) next.grossManual = true;
        else if ('unitsPerPackage' in p && !next.grossManual && next.unitGrossKg > 0) next.grossWeightKg = grossFromUnits(next.unitGrossKg, next.unitsPerPackage);
        return next;
      }),
    };
  });
  const useOdooGross = (i: number) => setDoc(d => d ? {
    ...d, packing: d.packing.map((x, j) => (j === i ? { ...x, grossManual: false, grossWeightKg: grossFromUnits(x.unitGrossKg, x.unitsPerPackage) } : x)),
  } : d);
  const copyPackRow = (i: number) => setDoc(d => d ? { ...d, packing: [...d.packing.slice(0, i + 1), { ...d.packing[i] }, ...d.packing.slice(i + 1)] } : d);
  const removePackRow = (i: number) => setDoc(d => d ? { ...d, packing: d.packing.filter((_, j) => j !== i) } : d);
  const movePackRow = (i: number, by: -1 | 1) => setDoc(d => {
    if (!d || i + by < 0 || i + by >= d.packing.length) return d;
    const p = [...d.packing];
    [p[i], p[i + by]] = [p[i + by], p[i]];
    return { ...d, packing: p };
  });

  const setTaxMode = (taxMode: TaxMode) => {
    setPrefs(p => ({ ...p, taxMode }));
    patch({ taxMode, lutArn: doc?.lutArn || settings?.lutArn || '' });
  };

  const totals = useMemo(() => (doc ? invoiceTotals(doc) : null), [doc]);
  const pack = useMemo(() => (doc ? packingLines(doc.packing) : []), [doc]);
  const packTotals = useMemo(() => (doc ? packingTotals(doc.packing) : null), [doc]);
  const cur = doc?.currency || 'USD';

  const invoiceWarnings = useMemo(() => {
    if (!doc) return [];
    const w: string[] = [];
    if (!(doc.exchangeRate > 0)) w.push('No customs exchange rate yet.');
    const noHsn = doc.lines.filter(l => !l.hsnCode).map(l => l.sku || l.description);
    if (noHsn.length) w.push(`No HSN code in Odoo for ${noHsn.join(', ')}.`);
    if (!doc.shipper.gstNumber) w.push('The Odoo company on this document has no GST number (Tax ID).');
    if (doc.taxMode === 'lut' && !doc.lutArn) w.push('LUT invoice, but no LUT ARN is set in Settings.');
    if (cur !== 'USD') w.push(`This document is in ${cur}; check the customs rate is the ${cur} rate.`);
    return w;
  }, [doc, cur]);

  const packingWarnings = useMemo(() => {
    if (!doc) return [] as string[];
    const w: string[] = [];
    for (const m of packingMismatches(doc.lines, doc.packing)) w.push(`${m.key}: packing list has ${m.packed}, invoice has ${m.invoice}.`);
    for (const { p, i } of unevenRows(doc.packing)) w.push(`Row ${i + 1} (${p.sku}): ${p.quantity} doesn't fill ${p.unitsPerPackage}-unit packages evenly; the last one is part-full.`);
    const noUnits = doc.packing.filter(p => !p.unitsPerPackage).map(p => p.sku);
    if (noUnits.length) w.push(`Units per package missing for ${noUnits.join(', ')}.`);
    const noDims = doc.packing.filter(p => !p.packageDims).map(p => p.sku);
    if (noDims.length) w.push(`Package size missing for ${noDims.join(', ')}.`);
    const noWeight = doc.packing.filter(p => !(p.netWeightKg > 0) || !(p.grossWeightKg > 0)).map(p => p.sku);
    if (noWeight.length) w.push(`Net and gross weight can't be 0 kg (${noWeight.join(', ')}).`);
    return w;
  }, [doc]);

  const save = async (d: ExportDocData, quiet = false) => {
    if (!source) return;
    const key = JSON.stringify(d);
    if (key === savedKey) { if (!quiet) toast.success('Already saved'); return; }
    try {
      setShipments(await saveShipment(source, d));
      setSavedKey(key);
      setSavedNote('Saved just now.');
      setPrefs(p => ({
        ...p, contact: d.shipper.contact, signatory: d.signatoryName,
        shipping: {
          preCarriageBy: d.preCarriageBy, portOfDischarge: d.portOfDischarge, countryOfOrigin: d.countryOfOrigin,
          placeOfReceipt: d.placeOfReceipt, portOfLoading: d.portOfLoading, termsOfDelivery: d.termsOfDelivery,
        },
      }));
      if (!quiet) toast.success('Saved');
    } catch (e: any) {
      toast.error(isMissingTable(e) ? `${MISSING_TABLES_MSG} Nothing was saved.` : `Not saved: ${e?.message}`);
    }
  };

  const clean = (d: ExportDocData): ExportDocData => ({
    ...d,
    shipper: { ...d.shipper, lines: d.shipper.lines.filter(s => s.trim()) },
    consignee: { ...d.consignee, lines: d.consignee.lines.filter(s => s.trim()) },
    buyer: d.buyer ? { ...d.buyer, lines: d.buyer.lines.filter(s => s.trim()) } : null,
  });

  const generate = async (what: 'invoice-xlsx' | 'packing-xlsx' | 'invoice-pdf' | 'packing-pdf') => {
    if (!doc) return;
    if (what.startsWith('packing') && doc.packing.some(p => !(p.netWeightKg > 0) || !(p.grossWeightKg > 0))) {
      toast.error('Fill in net and gross weight for every packing row first (0 kg is not accepted).');
      return;
    }
    const d = clean(doc);
    setBusy(true);
    try {
      const base = safeFileName(d.isDraft ? `DRAFT ${source?.name ?? ''}` : d.invoiceNo || 'invoice');
      if (what.endsWith('xlsx')) {
        const x = await import('@/lib/export-docs-xlsx');
        if (what === 'invoice-xlsx') download(await x.invoiceXlsx(d), `Commercial Invoice - ${base}.xlsx`);
        else download(await x.packingXlsx(d), `Packing List - ${base}.xlsx`);
      } else {
        const p = await import('@/lib/export-docs-pdf');
        if (what === 'invoice-pdf') download(p.invoicePdf(d), `Commercial Invoice - ${base}.pdf`);
        else download(p.packingPdf(d), `Packing List - ${base}.pdf`);
      }
      await save(d, true);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate the file');
    } finally { setBusy(false); }
  };

  const letterBlock = doc ? notReady(doc) : '';
  const sig = { name: settings?.signatoryName || doc?.signatoryName || '', title: settings?.signatoryTitle || 'Director' };

  const letter = async (what: 'labels' | 'nondg' | 'evd' | 'wood') => {
    if (!doc || letterBlock) return;
    const d = clean(doc);
    setBusy(true);
    try {
      const L = await import('@/lib/letters-pdf');
      const base = safeFileName(d.invoiceNo);
      if (what === 'labels') download(await L.labelsPdf(d), `Carton Labels - ${base}.pdf`);
      if (what === 'nondg') download(await L.nonDgPdf(d, sig), `Non-DG Letter - ${base}.pdf`);
      if (what === 'evd') download(await L.evdPdf(d, sig), `Export Value Declaration - ${base}.pdf`);
      if (what === 'wood') download(await L.woodPdf(d, sig), `Wooden Declaration - ${base}.pdf`);
      await save(d, true);
    } catch (e: any) {
      toast.error(e?.message || 'Could not make the PDF');
    } finally { setBusy(false); }
  };


  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {tablesMissing && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" /> {MISSING_TABLES_MSG}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">From Odoo</CardTitle>
            <div className="inline-flex rounded-md border p-0.5 text-xs">
              {(['invoice', 'order'] as const).map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`px-2.5 py-1 rounded ${kind === k ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}>
                  {k === 'invoice' ? 'Invoices' : 'Sales orders (draft)'}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); runSearch(); }}>
              <Input className="h-8 text-sm" placeholder={kind === 'invoice' ? 'Invoice number, customer, order or reference' : 'Order number, customer or reference'}
                value={search} onChange={e => setSearch(e.target.value)} />
              <Button type="submit" size="sm" variant="secondary" className="h-8 gap-1.5" disabled={listing}>
                {listing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Search
              </Button>
            </form>
            <div className="max-h-56 overflow-y-auto rounded border divide-y">
              {items === null && <div className="p-3 text-xs text-muted-foreground">{listing ? 'Reading Odoo…' : 'Nothing loaded.'}</div>}
              {items?.length === 0 && <div className="p-3 text-xs text-muted-foreground">Nothing matches.</div>}
              {items?.map(it => (
                <button key={`${it.kind}:${it.id}`} type="button" onClick={() => pick(it.kind, it.id, it.name)} disabled={loadingKey != null}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 hover:bg-muted/60 ${source?.kind === it.kind && source?.name === it.name ? 'bg-muted' : ''}`}>
                  <span className="font-medium w-36 shrink-0 truncate">{it.name}</span>
                  <span className="text-xs text-muted-foreground w-20 shrink-0">{it.date ?? ''}</span>
                  <span className="flex-1 truncate">{it.customer}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[8rem]">{it.ref || it.origin}</span>
                  <span className="tabular-nums text-xs">{it.currency} {money(it.amount_total)}</span>
                  {loadingKey === `${it.kind}:${it.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </button>
              ))}
            </div>
            {shipments.length > 0 && (
              <div className="pt-1">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1"><History className="h-3 w-3" /> Saved sets</div>
                <div className="flex flex-wrap gap-1.5">
                  {shipments.slice(0, 12).map(h => (
                    <Button key={h.id} variant="outline" size="sm" className="h-7 text-xs" disabled={loadingKey != null}
                      onClick={() => h.odoo_id && pick(h.source_kind, h.odoo_id, h.source_name)}>
                      {h.source_kind === 'order' ? `Draft ${h.source_name}` : h.source_name} · {String(h.updated_at).slice(0, 10)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Customs exchange rate (USD → INR)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="INR per USD (export)" value={rate.rate} onChange={v => setRate(r => ({ ...r, rate: v }))} placeholder="95.25" />
              <Field label="Notification No." value={rate.notificationNo} onChange={v => setRate(r => ({ ...r, notificationNo: v }))} placeholder="28/2026" />
            </div>
            <Field label="Effective from" type="date" value={rate.effectiveFrom} onChange={v => setRate(r => ({ ...r, effectiveFrom: v }))} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-8" onClick={saveRate} disabled={!rateChanged || !(rateNum > 0)}>Save as current rate</Button>
              <a href={ICEGATE_RATES_URL} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                ICEGATE notified rates <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {rate.stored ? `Saved: ${rate.stored.rate} from ${rate.stored.effectiveFrom}${rate.stored.notificationNo ? `, Notification ${rate.stored.notificationNo}` : ''}.` : 'No rate saved yet.'}
              {' '}ICEGATE publishes new rates on the 1st and 3rd Thursday of the month; use the export rate.
            </p>
          </CardContent>
        </Card>
      </div>

      {doc && totals && packTotals && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2">
            <div className="text-sm font-semibold">{doc.isDraft ? `Draft from ${source?.name}` : doc.invoiceNo}</div>
            {doc.isDraft && <span className="text-[11px] rounded bg-warning/15 text-warning px-1.5 py-0.5">Draft: no invoice yet</span>}
            {savedNote && <span className="text-xs text-muted-foreground">{savedNote}</span>}
            <div className="flex-1" />
            <div className="inline-flex rounded-md border p-0.5 text-xs">
              {(['igst', 'lut'] as const).map(m => (
                <button key={m} type="button" onClick={() => setTaxMode(m)}
                  className={`px-2.5 py-1 rounded ${doc.taxMode === m ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}>
                  {m === 'igst' ? 'IGST paid' : 'Under LUT'}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={rebuild} disabled={loadingKey != null}>
              {loadingKey === 'rebuild' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Rebuild from Odoo
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => save(clean(doc))}><Save className="h-3.5 w-3.5" /> Save</Button>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Parties and references</CardTitle></CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-2">
                <div className="text-xs font-semibold">Shipper</div>
                <div className="text-xs text-muted-foreground whitespace-pre-line">
                  {[doc.shipper.name, ...doc.shipper.lines].join('\n')}
                  {doc.shipper.gstNumber ? `\nGST ${doc.shipper.gstNumber}` : ''}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Contact" value={doc.shipper.contact} onChange={contact => patch({ shipper: { ...doc.shipper, contact } })} />
                  <Field label="Authorized signatory" value={doc.signatoryName} onChange={signatoryName => patch({ signatoryName })} />
                  <Field label="Invoice No." value={doc.invoiceNo} onChange={invoiceNo => patch({ invoiceNo })} />
                  <Field label="Invoice date" type="date" value={doc.invoiceDate} onChange={invoiceDate => patch({ invoiceDate })} />
                  <Field label="Exporter Ref. (IEC)" value={doc.exporterRef} onChange={exporterRef => patch({ exporterRef })} />
                  <Field label="Buyer's Order No." value={doc.buyerOrderNo} onChange={buyerOrderNo => patch({ buyerOrderNo })} />
                  <Field label="Buyer's order date" type="date" value={doc.buyerOrderDate} onChange={buyerOrderDate => patch({ buyerOrderDate })} />
                  <Field label="Bill of Lading No." value={doc.billOfLading} onChange={billOfLading => patch({ billOfLading })} />
                </div>
                <Field label="Other reference(s)" value={doc.otherReferences} onChange={otherReferences => patch({ otherReferences })} />
                {doc.taxMode === 'lut' && <Field label="LUT ARN" value={doc.lutArn} onChange={lutArn => patch({ lutArn })} />}
              </div>
              <PartyEditor title="Consignee" party={doc.consignee} onChange={consignee => patch({ consignee })} />
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={!doc.buyer} onCheckedChange={v => patch({ buyer: v ? null : { ...doc.consignee } })} />
                  Buyer is the same as the consignee
                </label>
                {doc.buyer && <PartyEditor title="Buyer (if other than Consignee)" party={doc.buyer} onChange={buyer => patch({ buyer })} />}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Shipping</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Field label="Pre-Carriage by" value={doc.preCarriageBy} onChange={preCarriageBy => patch({ preCarriageBy })} />
              <Field label="Vessel / Flight No." value={doc.vesselFlightNo} onChange={vesselFlightNo => patch({ vesselFlightNo })} />
              <Field label="Port of Discharge" value={doc.portOfDischarge} onChange={portOfDischarge => patch({ portOfDischarge })} />
              <Field label="Country of origin of goods" value={doc.countryOfOrigin} onChange={countryOfOrigin => patch({ countryOfOrigin })} />
              <Field label="Country of final destination" value={doc.countryOfFinalDestination} onChange={countryOfFinalDestination => patch({ countryOfFinalDestination })} />
              <Field label="Place of Receipt by pre-carrier" value={doc.placeOfReceipt} onChange={placeOfReceipt => patch({ placeOfReceipt })} />
              <Field label="Port of Loading" value={doc.portOfLoading} onChange={portOfLoading => patch({ portOfLoading })} />
              <Field label="Final Destination" value={doc.finalDestination} onChange={finalDestination => patch({ finalDestination })} />
              <Field label="Terms of Delivery & Payment" value={doc.termsOfDelivery} onChange={termsOfDelivery => patch({ termsOfDelivery })} className="sm:col-span-2" />
              <Field label="Handling Information (packing list)" value={doc.handlingInformation} onChange={handlingInformation => patch({ handlingInformation })} className="sm:col-span-2" />
              <div>
                <Label className="text-[11px] text-muted-foreground">Freight / insurance (INR)</Label>
                <NumCell w="w-full" value={doc.shippingInr} onChange={shippingInr => patch({ shippingInr })} />
              </div>
              {doc.taxMode === 'igst' && (
                <div>
                  <Label className="text-[11px] text-muted-foreground">Shipping IGST (INR)</Label>
                  <NumCell w="w-full" value={doc.shippingIgstInr} onChange={shippingIgstInr => patch({ shippingIgstInr })} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Commercial invoice</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left p-1">Product code</th>
                      <th className="text-left p-1">Description</th>
                      <th className="text-left p-1">HSN</th>
                      <th className="text-right p-1">Qty</th>
                      <th className="text-right p-1">Price {cur}</th>
                      <th className="text-right p-1">IGST %</th>
                      <th className="text-right p-1">FOB INR</th>
                      <th className="text-right p-1">IGST INR</th>
                      <th className="text-right p-1">Value {cur}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l, i) => {
                      const c = invoiceLine(l, doc.exchangeRate, doc.taxMode);
                      return (
                        <tr key={i} className="border-b align-top">
                          <td className="p-1"><Input className="h-7 px-1.5 text-xs w-36" value={l.sku} onChange={e => patchLine(i, { sku: e.target.value })} /></td>
                          <td className="p-1 min-w-[240px]"><Textarea rows={2} className="text-xs min-h-0 p-1.5" value={l.description} onChange={e => patchLine(i, { description: e.target.value })} /></td>
                          <td className="p-1"><Input className={`h-7 px-1.5 text-xs w-24 ${!l.hsnCode ? 'border-warning' : ''}`} value={l.hsnCode} onChange={e => patchLine(i, { hsnCode: e.target.value })} /></td>
                          <td className="p-1"><NumCell w="w-16" value={l.quantity} onChange={quantity => patchLine(i, { quantity })} /></td>
                          <td className="p-1"><NumCell value={l.fobPriceUsd} onChange={fobPriceUsd => patchLine(i, { fobPriceUsd })} /></td>
                          <td className="p-1">{doc.taxMode === 'lut'
                            ? <div className="text-right pt-1.5 text-muted-foreground">LUT</div>
                            : <NumCell w="w-14" value={l.igstRatePct} onChange={igstRatePct => patchLine(i, { igstRatePct })} />}</td>
                          <td className="p-1 text-right tabular-nums pt-2.5">{money(c.fobValueInr)}</td>
                          <td className="p-1 text-right tabular-nums pt-2.5">{money(c.fobIgstInr)}</td>
                          <td className="p-1 text-right tabular-nums pt-2.5">{money(c.fobValueUsd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="p-1" colSpan={3}>Consignment Total</td>
                      <td className="p-1 text-right tabular-nums">{totals.quantity}</td>
                      <td />
                      <td />
                      <td className="p-1 text-right tabular-nums">{money(totals.fobValueInr)}</td>
                      <td className="p-1 text-right tabular-nums">{money(totals.fobIgstInr)}</td>
                      <td className="p-1 text-right tabular-nums">{money(totals.fobValueUsd)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="text-xs text-muted-foreground">
                {cur} {money(totals.invoiceValueUsd)} · {amountInWords(totals.invoiceValueUsd, cur)} · at {doc.exchangeRate || '—'} INR/{cur}
                {doc.notificationNo ? ` (Notification No. ${doc.notificationNo})` : ''}. Product codes use the customer SKU from the Odoo variant tags when there is one.
              </div>
              {invoiceWarnings.length > 0 && (
                <ul className="text-xs text-warning space-y-0.5">
                  {invoiceWarnings.map(w => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</li>)}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('invoice-xlsx')}><FileSpreadsheet className="h-3.5 w-3.5" /> Invoice Excel</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('invoice-pdf')}><FileText className="h-3.5 w-3.5" /> Invoice PDF</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Packing list</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left p-1">Cartons</th>
                      <th className="text-left p-1">Product code</th>
                      <th className="text-left p-1">Description</th>
                      <th className="text-left p-1">Label name</th>
                      <th className="text-right p-1">Qty</th>
                      <th className="text-right p-1">Units/pkg</th>
                      <th className="text-left p-1">Package (in)</th>
                      <th className="text-left p-1">Kind</th>
                      <th className="text-right p-1">Pkgs</th>
                      <th className="text-right p-1">Net kg/pkg</th>
                      <th className="text-right p-1">Gross kg/pkg</th>
                      <th className="text-right p-1">m³/pkg</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {doc.packing.map((r, i) => (
                      <tr key={i} className="border-b align-top">
                        <td className="p-1 whitespace-nowrap pt-2.5 font-medium">{pack[i]?.cartonRange || '—'}</td>
                        <td className="p-1"><Input className="h-7 px-1.5 text-xs w-32" value={r.sku} onChange={e => patchPack(i, { sku: e.target.value })} /></td>
                        <td className="p-1 min-w-[200px]"><Textarea rows={2} className="text-xs min-h-0 p-1.5" value={r.description} onChange={e => patchPack(i, { description: e.target.value })} /></td>
                        <td className="p-1 min-w-[150px]"><Textarea rows={2} className="text-xs min-h-0 p-1.5" value={r.labelDescription} onChange={e => patchPack(i, { labelDescription: e.target.value })} /></td>
                        <td className="p-1"><NumCell w="w-16" value={r.quantity} onChange={quantity => patchPack(i, { quantity })} /></td>
                        <td className="p-1"><NumCell w="w-14" value={r.unitsPerPackage} onChange={unitsPerPackage => patchPack(i, { unitsPerPackage })} warn={!r.unitsPerPackage} /></td>
                        <td className="p-1"><Input className={`h-7 px-1.5 text-xs w-28 ${!r.packageDims ? 'border-warning' : ''}`} placeholder="20 x 20 x 20" value={r.packageDims} onChange={e => patchPack(i, { packageDims: e.target.value })} /></td>
                        <td className="p-1"><Input className="h-7 px-1.5 text-xs w-20" value={r.packageKind} onChange={e => patchPack(i, { packageKind: e.target.value })} /></td>
                        <td className="p-1 text-right tabular-nums pt-2.5">{pack[i]?.packages || '—'}</td>
                        <td className="p-1"><NumCell w="w-16" value={r.netWeightKg} onChange={netWeightKg => patchPack(i, { netWeightKg })} warn={!(r.netWeightKg > 0)} /></td>
                        <td className="p-1">
                          <NumCell w="w-16" value={r.grossWeightKg} onChange={grossWeightKg => patchPack(i, { grossWeightKg })} warn={!(r.grossWeightKg > 0)} />
                          {r.unitGrossKg > 0 && (
                            <button type="button" className="block text-[10px] text-muted-foreground hover:text-foreground mt-0.5"
                              title="Odoo weight × units per package" onClick={() => useOdooGross(i)}>
                              {r.grossManual ? 'use Odoo' : `Odoo ${r.unitGrossKg} kg × units`}
                            </button>
                          )}
                        </td>
                        <td className="p-1 text-right tabular-nums pt-2.5">{pack[i]?.cbmPerPackage != null ? pack[i].cbmPerPackage!.toFixed(4) : '—'}</td>
                        <td className="p-1 whitespace-nowrap">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy this row below (to split a product)" onClick={() => copyPackRow(i)}><Copy className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Move up" onClick={() => movePackRow(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Move down" onClick={() => movePackRow(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Remove row" onClick={() => removePackRow(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="p-1" colSpan={4}>Consignment Total</td>
                      <td className="p-1 text-right tabular-nums">{packTotals.quantity}</td>
                      <td colSpan={3} />
                      <td className="p-1 text-right tabular-nums">{packTotals.packages}</td>
                      <td className="p-1 text-right tabular-nums">{money(packTotals.netWeightKg)}</td>
                      <td className="p-1 text-right tabular-nums">{money(packTotals.grossWeightKg)}</td>
                      <td className="p-1 text-right tabular-nums">{packTotals.cbm.toFixed(3)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                To split a product over two carton sizes, copy its row and change the quantity and units on each; carton numbers follow the row order.
                Gross weight starts as the Odoo product weight (average gross per piece) × units per package. Weights are per package.
              </p>
              {packingWarnings.length > 0 && (
                <ul className="text-xs text-warning space-y-0.5">
                  {packingWarnings.map(w => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</li>)}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('packing-xlsx')}><FileSpreadsheet className="h-3.5 w-3.5" /> Packing list Excel</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('packing-pdf')}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Packing list PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Labels and letters</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {letterBlock ? (
                <p className="text-xs text-warning flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{letterBlock}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {packTotals.packages} A5 labels (one per carton), and the Non-DG certificate, Export Value Declaration and Wooden Declaration on the
                  letterhead, all from this invoice and packing list. Signed as {sig.name}, {sig.title}.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-muted-foreground">Wood used:</span>
                {WOOD_SPECIES.map(w => (
                  <label key={w} className="flex items-center gap-1.5">
                    <Checkbox checked={(doc.woodSpecies ?? []).includes(w)}
                      onCheckedChange={v => patch({ woodSpecies: WOOD_SPECIES.filter(x => (x === w ? !!v : (doc.woodSpecies ?? []).includes(x))) })} />
                    {w}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !!letterBlock} onClick={() => letter('labels')}><Tag className="h-3.5 w-3.5" /> Carton labels (A5)</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !!letterBlock} onClick={() => letter('nondg')}><FileText className="h-3.5 w-3.5" /> Non-DG letter</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !!letterBlock} onClick={() => letter('evd')}><FileText className="h-3.5 w-3.5" /> Export Value Declaration</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !!letterBlock || !(doc.woodSpecies ?? []).length} onClick={() => letter('wood')}
                  title={(doc.woodSpecies ?? []).length ? undefined : 'Tick the wood used first'}><FileText className="h-3.5 w-3.5" /> Wooden Declaration</Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
