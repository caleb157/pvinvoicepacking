// A small styled .xlsx writer on top of jszip. SheetJS community edition can't
// write cell styles (borders, bold, fills), which the export documents need to
// look like the originals, so this writes the OOXML parts directly.
import JSZip from 'jszip';

export type CellStyle =
  | 'default' | 'bold' | 'title' | 'banner' | 'label' | 'head'
  | 'box' | 'boxWrap' | 'boxNum' | 'boxInt' | 'boxPct' | 'boxCbm' | 'boxDate'
  | 'totText' | 'totNum' | 'totInt' | 'totCbm' | 'date' | 'num' | 'italic';

// Order = cellXfs index.
const STYLE_ORDER: CellStyle[] = [
  'default', 'bold', 'title', 'banner', 'label', 'head',
  'box', 'boxWrap', 'boxNum', 'boxInt', 'boxPct', 'boxCbm', 'boxDate',
  'totText', 'totNum', 'totInt', 'totCbm', 'date', 'num', 'italic',
];

export interface Cell {
  v?: string | number | null;
  f?: string;          // formula without the leading "="
  s?: CellStyle;
}

export interface Sheet {
  name: string;
  cells: Record<string, Cell>;
  merges?: string[];                 // "C20:E20"
  colWidths?: Record<string, number>; // "B": 18
  rowHeights?: Record<number, number>;
  landscape?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const colIndex = (col: string) => col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const splitAddr = (a: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  if (!m) throw new Error(`Bad cell address ${a}`);
  return { col: m[1], row: Number(m[2]) };
};

/** Excel date serial for YYYY-MM-DD. */
export function excelDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
}

function stylesXml(): string {
  const thin = '<left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/>';
  // fonts: 0 normal, 1 bold, 2 title, 3 banner bold 9, 4 label 8 grey, 5 italic
  const fonts = [
    '<font><sz val="10"/><name val="Arial"/></font>',
    '<font><b/><sz val="10"/><name val="Arial"/></font>',
    '<font><b/><sz val="18"/><name val="Arial"/></font>',
    '<font><b/><sz val="9"/><name val="Arial"/></font>',
    '<font><sz val="8"/><color rgb="FF555555"/><name val="Arial"/></font>',
    '<font><i/><sz val="9"/><name val="Arial"/></font>',
  ];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE7EEF7"/><bgColor indexed="64"/></patternFill></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', `<border>${thin}</border>`];
  // numFmts: 164 = 0.00, 165 = 0.000, 166 = yyyy-mm-dd, 167 = 0%, 168 = #,##0.00
  const numFmts = '<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.000"/>'
    + '<numFmt numFmtId="166" formatCode="yyyy-mm-dd"/><numFmt numFmtId="167" formatCode="0%"/></numFmts>';
  const xf = (font: number, fill: number, border: number, numFmt: number, align = '') =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"`
    + `${numFmt ? ' applyNumberFormat="1"' : ''} applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1"' : ''}>${align}</xf>`;
  const wrapTop = '<alignment wrapText="1" vertical="top"/>';
  const center = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
  const mid = '<alignment vertical="center"/>';
  const byStyle: Record<CellStyle, string> = {
    default: xf(0, 0, 0, 0, '<alignment vertical="top"/>'),
    bold: xf(1, 0, 0, 0, '<alignment vertical="top"/>'),
    title: xf(2, 0, 0, 0, mid),
    banner: xf(3, 0, 0, 0, mid),
    label: xf(4, 0, 0, 0, '<alignment vertical="top"/>'),
    head: xf(1, 2, 1, 0, center),
    box: xf(0, 0, 1, 0, mid),
    boxWrap: xf(0, 0, 1, 0, wrapTop),
    boxNum: xf(0, 0, 1, 164, mid),
    boxInt: xf(0, 0, 1, 1, '<alignment horizontal="center" vertical="center"/>'),
    boxPct: xf(0, 0, 1, 167, '<alignment horizontal="center" vertical="center"/>'),
    boxCbm: xf(0, 0, 1, 165, mid),
    boxDate: xf(0, 0, 1, 166, '<alignment horizontal="left" vertical="center"/>'),
    totText: xf(1, 2, 1, 0, mid),
    totNum: xf(1, 2, 1, 164, mid),
    totInt: xf(1, 2, 1, 1, '<alignment horizontal="center" vertical="center"/>'),
    totCbm: xf(1, 2, 1, 165, mid),
    date: xf(0, 0, 0, 166, '<alignment horizontal="left" vertical="top"/>'),
    num: xf(0, 0, 0, 164, '<alignment vertical="top"/>'),
    italic: xf(5, 0, 0, 0, '<alignment vertical="top"/>'),
  };
  const xfs = STYLE_ORDER.map(s => byStyle[s]).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + numFmts
    + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
    + `<fills count="${fills.length}">${fills.join('')}</fills>`
    + `<borders count="${borders.length}">${borders.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${STYLE_ORDER.length}">${xfs}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

function sheetXml(sheet: Sheet): string {
  const rows = new Map<number, { col: string; addr: string; cell: Cell }[]>();
  for (const [addr, cell] of Object.entries(sheet.cells)) {
    const { col, row } = splitAddr(addr);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push({ col, addr, cell });
  }
  const rowXml = [...rows.keys()].sort((a, b) => a - b).map(r => {
    const cells = rows.get(r)!.sort((a, b) => colIndex(a.col) - colIndex(b.col)).map(({ addr, cell }) => {
      const s = STYLE_ORDER.indexOf(cell.s ?? 'default');
      const f = cell.f ? `<f>${esc(cell.f)}</f>` : '';
      if (typeof cell.v === 'number' && isFinite(cell.v)) return `<c r="${addr}" s="${s}">${f}<v>${cell.v}</v></c>`;
      if (cell.v != null && cell.v !== '') {
        if (cell.f) return `<c r="${addr}" s="${s}" t="str">${f}<v>${esc(String(cell.v))}</v></c>`;
        return `<c r="${addr}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(cell.v))}</t></is></c>`;
      }
      return `<c r="${addr}" s="${s}">${f}</c>`;
    }).join('');
    const ht = sheet.rowHeights?.[r];
    return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  const cols = Object.entries(sheet.colWidths ?? {})
    .sort((a, b) => colIndex(a[0]) - colIndex(b[0]))
    .map(([c, w]) => `<col min="${colIndex(c)}" max="${colIndex(c)}" width="${w}" customWidth="1"/>`).join('');
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${rowXml}</sheetData>`
    + merges
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
    + `<pageSetup paperSize="9" orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
    + '</worksheet>';
}

/** Build an .xlsx file (as a Blob) from one or more sheets. */
export async function buildXlsx(sheets: Sheet[]): Promise<Blob> {
  return xlsxZip(sheets).generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** The .xlsx package (a zip of OOXML parts). */
export function xlsxZip(sheets: Sheet[]): JSZip {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
    + '</workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>');
  zip.file('xl/styles.xml', stylesXml());
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip;
}
