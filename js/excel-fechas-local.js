'use strict';

// Ajuste acotado a la descarga de "Cirugías programadas".
// Mantiene las mismas columnas, orden y formato de Tabla de Excel,
// cambiando únicamente las fechas visibles a dd/mm/yyyy.

import { DB, getDioptria } from './state.js';
import { fd, toast } from './utils.js';

function fechaDDMMYYYY(v) {
  const s = String(v || '').trim().slice(0, 10);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return s;
  return s;
}

function normalizarOjo(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s.includes('OD')) return 'OD';
  if (s.includes('OI') || s.includes('OS')) return 'OI';
  return s;
}

function horaAMinutos(v) {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? (parseInt(m[1], 10) * 60) + parseInt(m[2], 10) : Number.POSITIVE_INFINITY;
}

function xlsxEscapeXml(v) {
  return String(v ?? '').replace(/[&<>\"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[m]));
}

function xlsxColName(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xlsxCell(v, r, c) {
  const ref = `${xlsxColName(c)}${r}`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${xlsxEscapeXml(v)}</t></is></c>`;
}

function crc32(str) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  const bytes = new TextEncoder().encode(str);
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) { return [n & 255, (n >>> 8) & 255]; }
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function bytesOf(str) { return Array.from(new TextEncoder().encode(str)); }

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  files.forEach(file => {
    const name = bytesOf(file.name);
    const data = bytesOf(file.content);
    const crc = crc32(file.content);
    const local = [0x50,0x4b,0x03,0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data];
    localParts.push(...local);
    centralParts.push(0x50,0x4b,0x01,0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name);
    offset += local.length;
  });
  const centralOffset = offset;
  const end = [0x50,0x4b,0x05,0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralParts.length), ...u32(centralOffset), ...u16(0)];
  return new Uint8Array([...localParts, ...centralParts, ...end]);
}

function descargarTablaExcel(filename, headers, rows) {
  const lastCol = xlsxColName(headers.length);
  const lastRow = rows.length + 1;
  const ref = `A1:${lastCol}${lastRow}`;
  const anchos = [30, 14, 13, 16, 20, 18, 16, 10, 12, 13, 9];
  const colsXml = anchos.slice(0, headers.length).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const all = [headers, ...rows];
  const rowsXml = all.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => xlsxCell(v, ri + 1, ci + 1)).join('')}</row>`).join('');
  const tableCols = headers.map((h, i) => `<tableColumn id="${i + 1}" name="${xlsxEscapeXml(h)}"/>`).join('');

  const files = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cirugias programadas" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${ref}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${colsXml}</cols><sheetData>${rowsXml}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>` },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>` },
    { name: 'xl/tables/table1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="TablaCirugias" displayName="TablaCirugias" ref="${ref}" totalsRowShown="0"><autoFilter ref="${ref}"/><tableColumns count="${headers.length}">${tableCols}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>` }
  ];

  const blob = new Blob([makeZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function descargarProgramadasConFechasLocales(fecha) {
  const rowsProgramadas = DB.rows
    .filter(p => String(p.fechaCir || '').slice(0, 10) === fecha)
    .sort((a, b) => horaAMinutos(a.hora || a.hora_cirugia) - horaAMinutos(b.hora || b.hora_cirugia)
      || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));

  if (!rowsProgramadas.length) {
    toast(`No hay cirugías programadas para ${fd(fecha) || fecha}`);
    return false;
  }

  const headers = ['nombre', 'dni', 'fnac', 'tel', 'obraSocial', 'afiliado', 'clinica', 'ojo', 'dioptria', 'fecha Cir', 'hora'];
  const rows = rowsProgramadas.map(p => [
    p.nombre || '',
    p.dni || '',
    fechaDDMMYYYY(p.fnac),
    p.tel || '',
    p.obraSocial || '',
    p.afiliado || '',
    p.clinica || '',
    normalizarOjo(p.ojo || ''),
    getDioptria(p),
    fechaDDMMYYYY(p.fechaCir),
    p.hora || p.hora_cirugia || ''
  ]);

  descargarTablaExcel(`cirugias_programadas_${fecha}.xlsx`, headers, rows);
  toast(`✓ Descargadas ${rowsProgramadas.length} cirugías programadas del ${fd(fecha) || fecha}`);
  return true;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('#btnConfirmarDescargaProgramadas');
  if (!btn) return;

  // Frenamos únicamente la descarga original; el modal y su selector siguen siendo los mismos.
  e.preventDefault();
  e.stopImmediatePropagation();

  const modal = document.getElementById('cirugiasProgramadasExportModal');
  const fecha = modal?.querySelector('#fechaProgramadasExport')?.value || '';
  if (!fecha) {
    toast('Elegí una fecha de cirugía');
    return;
  }

  if (descargarProgramadasConFechasLocales(fecha) && modal) modal.style.display = 'none';
}, true);
