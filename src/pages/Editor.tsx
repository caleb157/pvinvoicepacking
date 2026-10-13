// The editor: pick a posted Odoo customer invoice; the app fills both documents
// (addresses, lines, HSN and IGST from the Odoo products, packing details remembered
// per SKU or taken from the Odoo product packaging), applies the customs exchange
// rate notified on ICEGATE, and downloads Excel copies in the original layout plus
// PDFs. Every generated set is saved in the app's database.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, ExternalLink, FileSpreadsheet, FileText, History, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ExportDocData, ExportLine, ExportParty, ICEGATE_RATES_URL, invoiceLine, invoiceTotals, packingLines, packingTotals,
  safeFileName, usdInWords,
} from '@/lib/export-docs';
import {
  ApiError, DEFAULT_SHIPPING, OdooInvoiceSummary, SavedExportDoc, ShippingDefaults,
  docFromOdoo, getOdooInvoice, getSavedDoc, listOdooInvoices, loadInit, packingDefaults, saveCustomsRate, saveDoc,
} from '@/lib/export-docs-data';

const MISSING_TABLES_MSG = 'The app database is not set up yet. Run sql/setup.sql in the Neon SQL editor, then reload.';
const isMissingTable = (e: unknown) => e instanceof ApiError && e.missingTables;

const SETTINGS_KEY = 'invoice-packing:settings';
interface Settings { contact: string; signatory: string; shipping: ShippingDefaults }
function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s) return { contact: s.contact ?? '', signatory: s.signatory ?? '', shipping: { ...DEFAULT_SHIPPING, ...s.shipping } };
  } catch { /* fall through */ }
  return { contact: '', signatory: '', shipping: DEFAULT_SHIPPING };
}

const money = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const today = () => new Date().toISOString().slice(0, 10);

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Field({ label, value, onChange, className, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input className="h-8 text-sm" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function PartyEditor({ title, party, onChange }: { title: string; party: ExportParty; onChange: (p: ExportParty) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold">{title}</div>
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

function NumCell({ value, onChange, w = 'w-20', step }: { value: number; onChange: (n: number) => void; w?: string; step?: string }) {
  return (
    <Input type="number" step={step ?? 'any'} className={`h-7 px-1.5 text-xs text-right ${w}`} value={Number.isFinite(value) && value !== 0 ? value : ''}
      onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
  );
}

export default function Editor() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }, [settings]);

  const [rate, setRate] = useState({ rate: '', notificationNo: '', effectiveFrom: today(), stored: null as null | { rate: number; notificationNo: string; effectiveFrom: string } });
  const [tablesMissing, setTablesMissing] = useState(false);

  const [search, setSearch] = useState('');
  const [invoices, setInvoices] = useState<OdooInvoiceSummary[] | null>(null);
  const [listing, setListing] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [history, setHistory] = useState<SavedExportDoc[]>([]);

  const [doc, setDoc] = useState<ExportDocData | null>(null);
  const [odooInvoiceId, setOdooInvoiceId] = useState<number | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The stored customs rate and saved sets
  useEffect(() => {
    (async () => {
      try {
        const { rate: r, history: h } = await loadInit();
        if (r) {
          const stored = { rate: Number(r.rate), notificationNo: r.notification_no || '', effectiveFrom: r.effective_from };
          setRate({ rate: String(stored.rate), notificationNo: stored.notificationNo, effectiveFrom: stored.effectiveFrom, stored });
        }
        setHistory(h);
      } catch (e: any) {
        if (isMissingTable(e)) setTablesMissing(true); else toast.error(e?.message || 'Could not load saved data');
      }
    })();
  }, []);

  const runSearch = async () => {
    setListing(true);
    try { setInvoices(await listOdooInvoices(search.trim())); }
    catch (e: any) { toast.error(e?.message || 'Could not read Odoo invoices'); }
    finally { setListing(false); }
  };
  useEffect(() => { runSearch(); /* first load */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Keep the document's rate in step with the rate card.
  useEffect(() => {
    setDoc(d => d && (d.exchangeRate !== rateNum || d.notificationNo !== rate.notificationNo)
      ? { ...d, exchangeRate: rateNum, notificationNo: rate.notificationNo } : d);
  }, [rateNum, rate.notificationNo]);

  const pickInvoice = async (id: number) => {
    setLoadingId(id);
    try {
      const inv = await getOdooInvoice(id);
      const packing = await packingDefaults(inv);
      setDoc(docFromOdoo(inv, { contact: settings.contact, packing, shipping: settings.shipping, rate: rateNum, notificationNo: rate.notificationNo, signatoryName: settings.signatory || settings.contact }));
      setOdooInvoiceId(id);
      setSavedKey(null);
    } catch (e: any) { toast.error(e?.message || 'Could not load the invoice'); }
    finally { setLoadingId(null); }
  };

  const openSaved = async (id: string) => {
    try {
      const row = await getSavedDoc(id);
      setDoc(row.payload);
      setOdooInvoiceId(row.odoo_invoice_id);
      setRate(r => ({ ...r, rate: String(row.payload.exchangeRate), notificationNo: row.payload.notificationNo }));
      setSavedKey(JSON.stringify(row.payload));
    } catch (e: any) { toast.error(e?.message || 'Could not open the saved set'); }
  };

  const patch = (p: Partial<ExportDocData>) => setDoc(d => (d ? { ...d, ...p } : d));
  const patchLine = (i: number, p: Partial<ExportLine>) => setDoc(d => d ? { ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) } : d);

  const totals = useMemo(() => (doc ? invoiceTotals(doc) : null), [doc]);
  const pack = useMemo(() => (doc ? packingLines(doc.lines) : []), [doc]);
  const packTotals = useMemo(() => (doc ? packingTotals(doc.lines) : null), [doc]);

  const warnings = useMemo(() => {
    if (!doc) return [];
    const w: string[] = [];
    if (!(doc.exchangeRate > 0)) w.push('No customs exchange rate yet.');
    const noHsn = doc.lines.filter(l => !l.hsnCode).map(l => l.sku || l.description);
    if (noHsn.length) w.push(`No HSN code in Odoo for ${noHsn.join(', ')}.`);
    const noPack = doc.lines.filter(l => !l.unitsPerPackage || !l.packageDims).map(l => l.sku || l.description);
    if (noPack.length) w.push(`Packing details missing for ${noPack.join(', ')}.`);
    if (!doc.shipper.gstNumber) w.push('The Odoo company on this invoice has no GST number (Tax ID).');
    return w;
  }, [doc]);

  /** Save a copy (once per unchanged document) and remember packing details per SKU. */
  const ensureSaved = async (d: ExportDocData) => {
    const key = JSON.stringify(d);
    if (key === savedKey) return;
    try {
      setHistory(await saveDoc(d, { odooInvoiceId, totalUsd: invoiceTotals(d).invoiceValueUsd }));
      setSavedKey(key);
      setSettings(s => ({
        ...s, contact: d.shipper.contact, signatory: d.signatoryName,
        shipping: {
          preCarriageBy: d.preCarriageBy, portOfDischarge: d.portOfDischarge, countryOfOrigin: d.countryOfOrigin,
          placeOfReceipt: d.placeOfReceipt, portOfLoading: d.portOfLoading, termsOfDelivery: d.termsOfDelivery,
        },
      }));
    } catch (e: any) {
      toast.error(isMissingTable(e) ? `${MISSING_TABLES_MSG} The file still downloaded, but no copy was saved.` : `Copy not saved: ${e?.message}`);
    }
  };

  const generate = async (what: 'invoice-xlsx' | 'packing-xlsx' | 'invoice-pdf' | 'packing-pdf' | 'all') => {
    if (!doc) return;
    const clean: ExportDocData = {
      ...doc,
      shipper: { ...doc.shipper, lines: doc.shipper.lines.filter(s => s.trim()) },
      consignee: { ...doc.consignee, lines: doc.consignee.lines.filter(s => s.trim()) },
      buyer: doc.buyer ? { ...doc.buyer, lines: doc.buyer.lines.filter(s => s.trim()) } : null,
    };
    setBusy(true);
    try {
      const base = safeFileName(clean.invoiceNo || 'invoice');
      const wants = (k: string) => what === 'all' || what === k;
      if (wants('invoice-xlsx') || wants('packing-xlsx')) {
        const x = await import('@/lib/export-docs-xlsx');
        if (wants('invoice-xlsx')) download(await x.invoiceXlsx(clean), `Commercial Invoice - ${base}.xlsx`);
        if (wants('packing-xlsx')) download(await x.packingXlsx(clean), `Packing List - ${base}.xlsx`);
      }
      if (wants('invoice-pdf') || wants('packing-pdf')) {
        const p = await import('@/lib/export-docs-pdf');
        if (wants('invoice-pdf')) download(p.invoicePdf(clean), `Commercial Invoice - ${base}.pdf`);
        if (wants('packing-pdf')) download(p.packingPdf(clean), `Packing List - ${base}.pdf`);
      }
      await ensureSaved(clean);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate the files');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">

        {tablesMissing && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" /> {MISSING_TABLES_MSG}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Invoice picker */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Odoo customer invoice</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <form className="flex gap-2" onSubmit={e => { e.preventDefault(); runSearch(); }}>
                <Input className="h-8 text-sm" placeholder="Invoice number, customer or sales order" value={search} onChange={e => setSearch(e.target.value)} />
                <Button type="submit" size="sm" variant="secondary" className="h-8 gap-1.5" disabled={listing}>
                  {listing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Search
                </Button>
              </form>
              <div className="max-h-56 overflow-y-auto rounded border divide-y">
                {invoices === null && <div className="p-3 text-xs text-muted-foreground">{listing ? 'Reading Odoo…' : 'No invoices loaded.'}</div>}
                {invoices?.length === 0 && <div className="p-3 text-xs text-muted-foreground">No posted customer invoices match.</div>}
                {invoices?.map(inv => (
                  <button key={inv.id} type="button" onClick={() => pickInvoice(inv.id)} disabled={loadingId != null}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 hover:bg-muted/60 ${odooInvoiceId === inv.id ? 'bg-muted' : ''}`}>
                    <span className="font-medium w-36 shrink-0">{inv.name}</span>
                    <span className="text-xs text-muted-foreground w-20 shrink-0">{inv.date ?? ''}</span>
                    <span className="flex-1 truncate">{inv.customer}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">{inv.origin}</span>
                    <span className="tabular-nums text-xs">{inv.currency} {money(inv.amount_total)}</span>
                    {loadingId === inv.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </button>
                ))}
              </div>
              {history.length > 0 && (
                <div className="pt-1">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1"><History className="h-3 w-3" /> Generated before</div>
                  <div className="flex flex-wrap gap-1.5">
                    {history.slice(0, 10).map(h => (
                      <Button key={h.id} variant="outline" size="sm" className="h-7 text-xs" onClick={() => openSaved(h.id)}>
                        {h.invoice_no} · {String(h.created_at).slice(0, 10)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customs rate */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Customs exchange rate (USD → INR)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="INR per USD (export)" value={rate.rate} onChange={v => setRate(r => ({ ...r, rate: v }))} placeholder="95.25" />
                <Field label="Notification No." value={rate.notificationNo} onChange={v => setRate(r => ({ ...r, notificationNo: v }))} placeholder="28/2026" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Effective from</Label>
                <Input type="date" className="h-8 text-sm" value={rate.effectiveFrom} onChange={e => setRate(r => ({ ...r, effectiveFrom: e.target.value }))} />
              </div>
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
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Invoice No." value={doc.invoiceNo} onChange={invoiceNo => patch({ invoiceNo })} />
                    <Field label="Invoice date" value={doc.invoiceDate} onChange={invoiceDate => patch({ invoiceDate })} placeholder="YYYY-MM-DD" />
                    <Field label="Exporter Ref. (IEC)" value={doc.exporterRef} onChange={exporterRef => patch({ exporterRef })} />
                    <Field label="Buyer's Order No." value={doc.buyerOrderNo} onChange={buyerOrderNo => patch({ buyerOrderNo })} />
                    <Field label="Buyer's order date" value={doc.buyerOrderDate} onChange={buyerOrderDate => patch({ buyerOrderDate })} placeholder="optional" />
                    <Field label="Bill of Lading No." value={doc.billOfLading} onChange={billOfLading => patch({ billOfLading })} />
                  </div>
                  <Field label="Other reference(s)" value={doc.otherReferences} onChange={otherReferences => patch({ otherReferences })} />
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
                  <Label className="text-[11px] text-muted-foreground">Shipping (INR)</Label>
                  <NumCell w="w-full" value={doc.shippingInr} onChange={shippingInr => patch({ shippingInr })} />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Shipping IGST (INR)</Label>
                  <NumCell w="w-full" value={doc.shippingIgstInr} onChange={shippingIgstInr => patch({ shippingIgstInr })} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Lines</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[11px] text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left p-1">Product code</th>
                        <th className="text-left p-1">Description</th>
                        <th className="text-left p-1">HSN</th>
                        <th className="text-right p-1">Qty</th>
                        <th className="text-right p-1">FOB USD</th>
                        <th className="text-right p-1">IGST %</th>
                        <th className="text-right p-1">FOB INR</th>
                        <th className="text-right p-1">IGST INR</th>
                        <th className="text-right p-1 border-l">Units/pkg</th>
                        <th className="text-left p-1">Package (in)</th>
                        <th className="text-left p-1">Kind</th>
                        <th className="text-right p-1">Net kg/pkg</th>
                        <th className="text-right p-1">Gross kg/pkg</th>
                        <th className="text-left p-1">Cartons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((l, i) => {
                        const c = invoiceLine(l, doc.exchangeRate);
                        return (
                          <tr key={i} className="border-b align-top">
                            <td className="p-1 font-medium whitespace-nowrap">{l.sku || '—'}</td>
                            <td className="p-1 min-w-[220px]"><Textarea rows={2} className="text-xs min-h-0 p-1.5" value={l.description} onChange={e => patchLine(i, { description: e.target.value })} /></td>
                            <td className="p-1"><Input className={`h-7 px-1.5 text-xs w-24 ${!l.hsnCode ? 'border-warning' : ''}`} value={l.hsnCode} onChange={e => patchLine(i, { hsnCode: e.target.value })} /></td>
                            <td className="p-1"><NumCell w="w-16" value={l.quantity} onChange={quantity => patchLine(i, { quantity })} /></td>
                            <td className="p-1"><NumCell value={l.fobPriceUsd} onChange={fobPriceUsd => patchLine(i, { fobPriceUsd })} /></td>
                            <td className="p-1"><NumCell w="w-14" value={l.igstRatePct} onChange={igstRatePct => patchLine(i, { igstRatePct })} /></td>
                            <td className="p-1 text-right tabular-nums pt-2.5">{money(c.fobValueInr)}</td>
                            <td className="p-1 text-right tabular-nums pt-2.5">{money(c.fobIgstInr)}</td>
                            <td className="p-1 border-l"><NumCell w="w-14" value={l.unitsPerPackage} onChange={unitsPerPackage => patchLine(i, { unitsPerPackage })} /></td>
                            <td className="p-1"><Input className={`h-7 px-1.5 text-xs w-32 ${!l.packageDims ? 'border-warning' : ''}`} placeholder="20 x 20 x 20" value={l.packageDims} onChange={e => patchLine(i, { packageDims: e.target.value })} /></td>
                            <td className="p-1"><Input className="h-7 px-1.5 text-xs w-20" value={l.packageKind} onChange={e => patchLine(i, { packageKind: e.target.value })} /></td>
                            <td className="p-1"><NumCell w="w-16" value={l.netWeightKg} onChange={netWeightKg => patchLine(i, { netWeightKg })} /></td>
                            <td className="p-1"><NumCell w="w-16" value={l.grossWeightKg} onChange={grossWeightKg => patchLine(i, { grossWeightKg })} /></td>
                            <td className="p-1 whitespace-nowrap pt-2.5">{pack[i]?.cartonRange || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold">
                        <td className="p-1" colSpan={3}>Consignment Total</td>
                        <td className="p-1 text-right tabular-nums">{totals.quantity}</td>
                        <td className="p-1 text-right tabular-nums">{money(totals.fobValueUsd)}</td>
                        <td />
                        <td className="p-1 text-right tabular-nums">{money(totals.fobValueInr)}</td>
                        <td className="p-1 text-right tabular-nums">{money(totals.fobIgstInr)}</td>
                        <td className="p-1 border-l" colSpan={3}>{packTotals.packages} packages</td>
                        <td className="p-1 text-right tabular-nums">{money(packTotals.netWeightKg)}</td>
                        <td className="p-1 text-right tabular-nums">{money(packTotals.grossWeightKg)}</td>
                        <td className="p-1 tabular-nums">{packTotals.cbm.toFixed(3)} m³</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="text-xs text-muted-foreground">
                  USD {money(totals.invoiceValueUsd)} · {usdInWords(totals.invoiceValueUsd)} · at {doc.exchangeRate || '—'} INR/USD
                  {doc.notificationNo ? ` (Notification No. ${doc.notificationNo})` : ''}. HSN and IGST come from the Odoo products; packing details are remembered per SKU once you generate.
                </div>
                {warnings.length > 0 && (
                  <ul className="text-xs text-warning space-y-0.5">
                    {warnings.map(w => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</li>)}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => generate('all')}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download all four
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('invoice-xlsx')}><FileSpreadsheet className="h-3.5 w-3.5" /> Invoice Excel</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('packing-xlsx')}><FileSpreadsheet className="h-3.5 w-3.5" /> Packing list Excel</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('invoice-pdf')}><FileText className="h-3.5 w-3.5" /> Invoice PDF</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => generate('packing-pdf')}><FileText className="h-3.5 w-3.5" /> Packing list PDF</Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
