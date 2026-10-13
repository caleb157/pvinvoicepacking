// Reads an HDFC "Certificate of Foreign Inward Remittance" PDF without any AI: pdf.js gives
// the text with positions, rows are rebuilt by y, wide gaps split columns (" | "), and the
// fields are picked by their labels. Anything not found stays blank for manual entry.

export interface ParsedRemittance {
  remittance_no: string; value_date: string; currency: string; fcy_amount: number | null; exchange_rate: number | null;
  inr_amount: number | null; remitter: string; remitting_bank: string; purpose_code: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "23-Mar-2026", "23/03/2026", "2026-03-23" → "2026-03-23" ('' when unreadable). */
export function isoDate(s: string): string {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})[-/ .]([A-Za-z]{3})[A-Za-z]*[-/ .,]+(\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const DATE = String.raw`(\d{1,2}[-/ .][A-Za-z]{3,9}[-/ .,]+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})`;
const AMOUNT = String.raw`([\d,]+(?:\.\d+)?)`;
const FX = 'USD|EUR|GBP|AUD|CAD|AED|CHF|JPY|SGD|NZD|HKD|SEK|NOK|DKK';

// A cell that is itself a label (a header row), not a value.
const LABEL = /^(Remitter\b.*|(Remitting|Sender'?s?|Ordering|Beneficiary)\s+(Bank|Institution).*|Currency|(FCY |INR )?Amount|Exchange Rate|Rate|Purpose.*|[\w ]*Date|Account\b.*|[\w ]*Ref(erence)?( No)?\.?)\s*:?$/i;

/** The value after a label: the rest of its cell, else the same column on the next row(s). */
function after(rows: string[][], label: RegExp, take = 1): string {
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r];
    for (let c = 0; c < cells.length; c++) {
      const m = label.exec(cells[c]);
      if (!m) continue;
      const rest = cells[c].slice(m.index + m[0].length).replace(/^[\s:.-]+/, '').trim();
      if (rest) return rest;
      let n = c + 1;
      while (cells[n] && /^[:\s-]*$/.test(cells[n])) n++;
      if (cells[n] && !LABEL.test(cells[n])) return cells[n].trim();
      // Header row of labels: the value sits in the same column underneath.
      const below: string[] = [];
      for (let k = r + 1; k < rows.length && below.length < take; k++) {
        const v = (rows[k][c] ?? '').trim();
        if (!v || LABEL.test(v)) break;
        below.push(v);
      }
      return below.join(' ');
    }
  }
  return '';
}

/** Rows of cells (cells split on wide gaps) → the remittance fields. */
export function parseRemittance(rows: string[][]): ParsedRemittance {
  const text = rows.map(r => r.join(' | ')).join('\n');
  const out: ParsedRemittance = {
    remittance_no: '', value_date: '', currency: '', fcy_amount: null, exchange_rate: null, inr_amount: null,
    remitter: '', remitting_bank: '', purpose_code: '',
  };
  out.remittance_no = (/Inward\s*(?:Remittance\s*)?(?:No|Number|Ref(?:erence)?)\.?\s*[\s:|]*([A-Z0-9]{8,})/i.exec(text)?.[1]) ?? '';
  out.value_date = isoDate(new RegExp(String.raw`Value\s*Date\s*[\s:|]*${DATE}`, 'i').exec(text)?.[1] ?? '');

  const fx = new RegExp(String.raw`\b(${FX})\b\s*\|?\s*${AMOUNT}`).exec(text);
  if (fx) { out.currency = fx[1]; out.fcy_amount = num(fx[2]); }
  out.exchange_rate = num(new RegExp(String.raw`(?:Exchange\s*)?Rate\s*(?:\(.*?\))?\s*[\s:|]*${AMOUNT}`, 'i').exec(text)?.[1]);
  out.inr_amount = num(new RegExp(String.raw`\bINR\b\s*(?:Amount)?\s*[\s:|]*${AMOUNT}`).exec(text)?.[1]);
  if (out.inr_amount == null && out.fcy_amount != null && out.exchange_rate != null) out.inr_amount = Math.round(out.fcy_amount * out.exchange_rate * 100) / 100;
  // Tables often show the FX amount, rate and INR amount in a row of their own.
  if (out.exchange_rate == null && out.fcy_amount != null && out.inr_amount != null && out.fcy_amount > 0) {
    out.exchange_rate = Math.round((out.inr_amount / out.fcy_amount) * 10000) / 10000;
  }

  out.purpose_code = /\b(P\d{4})\b/.exec(text)?.[1] ?? '';
  out.remitter = after(rows, /Remitter(?:'s)?\s*(?:Name\s*(?:&|and)\s*Address|Name|Details)?/i, 2);
  out.remitting_bank = after(rows, /(?:Remitting|Sender(?:'s)?|Ordering)\s*(?:Bank|Institution)(?:\s*Name)?/i);
  return out;
}

/** Text items with positions → rows of cells, top to bottom. */
export function rowsFromItems(items: { str: string; x: number; y: number; w: number }[], gap = 12): string[][] {
  const sorted = items.filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; items: typeof sorted }[] = [];
  for (const it of sorted) {
    const row = rows.find(r => Math.abs(r.y - it.y) < 3);
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  return rows.map(r => {
    const cells: string[] = [];
    let end = -Infinity;
    for (const it of r.items.sort((a, b) => a.x - b.x)) {
      if (cells.length && it.x - end < gap) cells[cells.length - 1] += (it.x - end > 1 ? ' ' : '') + it.str;
      else cells.push(it.str);
      end = it.x + it.w;
    }
    return cells.map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
}

/** Reads every page of a PDF into rows of cells (pdf.js is loaded only when needed). */
export async function pdfRows(file: File): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const items = (content.items as any[]).filter(i => 'str' in i)
      .map(i => ({ str: String(i.str), x: i.transform[4], y: i.transform[5], w: i.width ?? 0 }));
    rows.push(...rowsFromItems(items));
  }
  return rows;
}
