'use strict';

import { DB, getFechaFacturadaBase, normalizeId, isFacturadoCompleto } from './state.js';
import { fd, hoyISO, toast } from './utils.js';

const ID_FILTRO = 'fVitrectomiaPrincipal';
const SAVED_FILTERS_KEY = 'cirugias_saved_filters';

function activo(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return v === true || ['1', 'true', 'si', 'sí', 's'].includes(s);
}

function esCasoVitrectomia(p) {
  return !!p && (activo(p.extraVitrectomia) || activo(p.vitrectomia) || activo(p.extras && p.extras.vitrectomia));
}

function buscarPaciente(id) {
  const sid = normalizeId(id);
  return DB.rows.find(p => normalizeId(p.id) === sid) || null;
}

function normalizarOjo(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s.includes('OD')) return 'OD';
  if (s.includes('OI') || s.includes('OS')) return 'OI';
  return s;
}

function dioptriaDelOjo(p, ojo) {
  if (!p) return '';
  const o = normalizarOjo(ojo);
  const campo = o === 'OD' ? 'dioptriaOD' : 'dioptriaOI';
  const guardada = p[campo];
  if (guardada !== undefined && guardada !== null && String(guardada).trim() !== '') return String(guardada).trim();
  if (normalizarOjo(p.ojo) === o) return String(p.dioptria || p.lio || '').trim();
  return '';
}

function dioptriaActual(p) {
  return String(p?.dioptria || p?.lio || dioptriaDelOjo(p, p?.ojo) || '').trim();
}

function limpiarFiltrosPersistidosObsoletos() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '{}') || {};
    delete saved.fFechaCir;
    delete saved.fEst;
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(saved));
  } catch (_) { /* configuración inválida: la app la recreará */ }
}

function limpiarEstadoOculto() {
  const estado = document.getElementById('fEst');
  if (estado) estado.value = '';
}

function dispatchChange(el) {
  if (!el) return;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function limpiarFechaCirugia(renderizar = true) {
  const fecha = document.getElementById('fFechaCir');
  if (!fecha || !fecha.value) return;
  fecha.value = '';
  if (renderizar) dispatchChange(fecha);
}

function sumarDiasISO(fechaISO, dias) {
  const [y, m, d] = String(fechaISO || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function asegurarAyudasFecha() {
  const input = document.getElementById('fFechaCir');
  const label = input?.closest('label');
  if (!input || !label || label.dataset.dateFilterEnhanced === '1') return;
  label.dataset.dateFilterEnhanced = '1';

  const textNode = Array.from(label.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = 'Fecha de cirugía ';

  const wrap = document.createElement('div');
  wrap.className = 'date-filter-shortcuts';
  wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px';
  wrap.innerHTML = `
    <button type="button" class="btn" data-date-preset="today" style="padding:4px 8px">Hoy</button>
    <button type="button" class="btn" data-date-preset="tomorrow" style="padding:4px 8px">Mañana</button>
    <button type="button" class="btn" data-date-preset="clear" style="padding:4px 8px">Limpiar fecha</button>
    <span style="font-size:11px;color:#64748b;align-self:center">Solo afecta la vista Operación.</span>`;
  label.appendChild(wrap);

  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-date-preset]');
    if (!btn) return;
    const preset = btn.dataset.datePreset;
    input.value = preset === 'today' ? hoyISO() : preset === 'tomorrow' ? sumarDiasISO(hoyISO(), 1) : '';
    dispatchChange(input);
  });
}

function asegurarCheckbox() {
  let filtro = document.getElementById(ID_FILTRO);
  if (filtro) return filtro;

  const contenedor = document.querySelector('.advanced-filters-body');
  if (!contenedor) return null;

  const label = document.createElement('label');
  label.className = 'filter-label';
  label.innerHTML = `<input type="checkbox" id="${ID_FILTRO}"> Solo vitrectomía`;

  const fechaProgramada = document.getElementById('fFechaCir')?.closest('label');
  if (fechaProgramada?.parentNode === contenedor) fechaProgramada.insertAdjacentElement('afterend', label);
  else contenedor.insertBefore(label, contenedor.querySelector('#showSilenced')?.closest('label') || null);

  return document.getElementById(ID_FILTRO);
}

function mostrarFechaFacturacion(tr, p) {
  const td = tr.querySelector('td[data-label="Fecha clave"]');
  if (!td) return;
  const main = td.querySelector('.cell-main');
  const sub = td.querySelector('.cell-sub');
  const fecha = getFechaFacturadaBase(p) || p.fechaFacturada || p.fechaFacturacion || '';
  if (main) main.textContent = fd(fecha) || '—';
  if (sub) sub.textContent = 'Facturación';
}

function aplicarVitrectomia() {
  const filtro = document.getElementById(ID_FILTRO);
  const tbody = document.getElementById('tbody');
  if (!filtro || !tbody) return;
  const usarFiltro = filtro.checked;
  let visibles = 0;

  tbody.querySelectorAll('tr[data-row-click]').forEach(tr => {
    const paciente = buscarPaciente(tr.dataset.rowClick);
    const mostrar = !usarFiltro || esCasoVitrectomia(paciente);
    tr.style.display = mostrar ? '' : 'none';
    if (mostrar) visibles += 1;
    if (usarFiltro && mostrar) mostrarFechaFacturacion(tr, paciente);
  });

  if (usarFiltro) {
    const tag = Array.from(document.querySelectorAll('.table-topbar .table-tag')).find(el => /visibles/i.test(el.textContent || ''));
    if (tag) tag.textContent = `${visibles} visibles`;
  }
}

let pintandoChip = false;
function asegurarChipFechaVisible() {
  if (pintandoChip) return;
  const bar = document.getElementById('activeFiltersBar');
  const input = document.getElementById('fFechaCir');
  if (!bar || !input) return;

  const existente = bar.querySelector('[data-clear-surgery-date]');
  if (!input.value) {
    existente?.remove();
    return;
  }
  if (existente) return;

  pintandoChip = true;
  bar.querySelector('.af-chip-soft')?.remove();
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'af-chip';
  chip.dataset.clearSurgeryDate = '1';
  chip.title = 'Quitar filtro de fecha de cirugía';
  chip.style.cursor = 'pointer';
  chip.textContent = `Fecha de cirugía: ${fd(input.value) || input.value} ×`;
  chip.addEventListener('click', () => limpiarFechaCirugia(true));
  bar.appendChild(chip);
  pintandoChip = false;
}

// ── Ajustes solicitados de interfaz ───────────────────────────────────────
function aplicarAjustesInterfaz() {
  const limpiar = document.getElementById('btnLimpiarFiltros');
  if (limpiar) limpiar.textContent = 'Borrar filtros';

  const more = document.getElementById('moreMenu');
  const summary = more?.querySelector('summary');
  const list = more?.querySelector('.more-menu-list');
  if (summary) summary.textContent = 'Descargar Excel ▾';

  const btnVista = document.getElementById('btnExportarVista');
  const btnBackup = document.getElementById('btnBackup');
  const btnDia = document.getElementById('btnExportarDia');
  if (btnVista) btnVista.textContent = '📄 Descargar Excel vista';
  if (btnBackup) btnBackup.textContent = '💾 Descargar backup';
  if (btnDia) btnDia.textContent = '📅 Descargar cirugías programadas';

  if (list && list.dataset.downloadMenuClean !== '1') {
    list.dataset.downloadMenuClean = '1';
    const permitidos = new Set(['btnExportarVista', 'btnBackup', 'btnExportarDia']);
    Array.from(list.querySelectorAll('button, hr')).forEach(el => {
      if (el.tagName === 'HR' || !permitidos.has(el.id)) el.remove();
    });
  }

  const btnConector = document.getElementById('btnConfigurarURL');
  const refineSecondary = document.querySelector('.refine-secondary');
  if (btnConector && refineSecondary && btnConector.parentElement !== refineSecondary) {
    btnConector.textContent = '⚙ Conector';
    btnConector.title = 'Configurar conector';
    if (more?.parentElement === refineSecondary) refineSecondary.insertBefore(btnConector, more);
    else refineSecondary.appendChild(btnConector);
  }

  const ayuda = document.querySelector('.advanced-help');
  if (ayuda && /Tableros/i.test(ayuda.textContent || '')) {
    ayuda.textContent = 'Usá estos filtros solo cuando quieras afinar la operación diaria.';
  }
}

// ── Dioptrías de ambos ojos y primer ojo explícito ────────────────────────
function mejorarCamposOjos() {
  const sideBody = document.getElementById('sideBody');
  if (!sideBody) return;
  const grupos = Array.from(sideBody.querySelectorAll('.sgroup'));
  const grupo = grupos.find(g => (g.querySelector('.sgroup-title')?.textContent || '').trim() === 'Cirugía');
  if (!grupo || grupo.dataset.eyeFieldsEnhanced === '1') return;

  const ojosSel = grupo.querySelector('select[data-field="ojos"]');
  const ojoSel = grupo.querySelector('select[data-field="ojo"]');
  const dioptriaInput = grupo.querySelector('input[data-field="dioptria"]');
  if (!ojosSel || !ojoSel || !dioptriaInput) return;

  grupo.dataset.eyeFieldsEnhanced = '1';
  const id = ojoSel.dataset.rowId || dioptriaInput.dataset.rowId || '';
  const paciente = buscarPaciente(id) || {};
  const filaOjo = ojoSel.closest('.srow');
  const filaDioptria = dioptriaInput.closest('.srow');
  const labelOjo = filaOjo?.querySelector('label');

  Array.from(ojoSel.options).forEach(opt => {
    const o = normalizarOjo(opt.value || opt.textContent);
    if (o === 'OI') {
      opt.value = 'OI';
      opt.textContent = 'OI — Izquierdo (habitual)';
    } else if (o === 'OD') {
      opt.value = 'OD';
      opt.textContent = 'OD — Derecho';
    }
  });
  if (!normalizarOjo(ojoSel.value)) ojoSel.value = 'OI';

  const filaSegundo = document.createElement('div');
  filaSegundo.className = 'srow eye-two-only';
  filaSegundo.innerHTML = '<label>Segundo ojo</label><div data-second-eye-label style="flex:1;font-weight:700;color:#475569"></div>';

  const filaOI = document.createElement('div');
  filaOI.className = 'srow eye-two-only';
  filaOI.innerHTML = `<label>Dioptría OI</label><input type="text" data-field="dioptriaOI" data-row-id="${id}">`;

  const filaOD = document.createElement('div');
  filaOD.className = 'srow eye-two-only';
  filaOD.innerHTML = `<label>Dioptría OD</label><input type="text" data-field="dioptriaOD" data-row-id="${id}">`;

  const ayuda = document.createElement('div');
  ayuda.className = 'eye-two-only';
  ayuda.style.cssText = 'font-size:11px;color:#64748b;margin:-2px 0 8px 0;padding-left:2px';
  ayuda.textContent = 'Cargá ambas dioptrías ahora. Al usar “Duplicar segundo ojo”, la dioptría correspondiente se completa automáticamente.';

  const oiInput = filaOI.querySelector('input');
  const odInput = filaOD.querySelector('input');
  oiInput.value = dioptriaDelOjo(paciente, 'OI');
  odInput.value = dioptriaDelOjo(paciente, 'OD');

  filaDioptria.insertAdjacentElement('afterend', filaSegundo);
  filaSegundo.insertAdjacentElement('afterend', filaOI);
  filaOI.insertAdjacentElement('afterend', filaOD);
  filaOD.insertAdjacentElement('afterend', ayuda);

  const secondLabel = filaSegundo.querySelector('[data-second-eye-label]');

  const sincronizarDioptriaActual = () => {
    if (ojosSel.value !== '2 ojos') return;
    const ojo = normalizarOjo(ojoSel.value) || 'OI';
    dioptriaInput.value = ojo === 'OD' ? odInput.value : oiInput.value;
    dispatchChange(dioptriaInput);
    if (secondLabel) secondLabel.textContent = ojo === 'OD' ? 'OI — Izquierdo' : 'OD — Derecho';
  };

  const aplicarModo = () => {
    const dosOjos = ojosSel.value === '2 ojos';
    if (labelOjo) labelOjo.textContent = dosOjos ? 'Primer ojo a operar' : 'Ojo a operar';
    if (filaDioptria) filaDioptria.style.display = dosOjos ? 'none' : '';
    [filaSegundo, filaOI, filaOD, ayuda].forEach(el => { el.style.display = dosOjos ? '' : 'none'; });
    if (dosOjos) {
      if (!normalizarOjo(ojoSel.value)) ojoSel.value = 'OI';
      sincronizarDioptriaActual();
    }
  };

  ojoSel.addEventListener('change', () => {
    if (ojosSel.value !== '2 ojos') return;
    if (normalizarOjo(ojoSel.value) === 'OD') {
      const seguro = window.confirm('¿Está seguro de que quiere que se opere primero el OD?');
      if (!seguro) ojoSel.value = 'OI';
    }
    sincronizarDioptriaActual();
  });

  oiInput.addEventListener('change', () => {
    if (ojosSel.value === '2 ojos' && normalizarOjo(ojoSel.value) === 'OI') sincronizarDioptriaActual();
  });
  odInput.addEventListener('change', () => {
    if (ojosSel.value === '2 ojos' && normalizarOjo(ojoSel.value) === 'OD') sincronizarDioptriaActual();
  });

  ojosSel.addEventListener('change', () => {
    if (ojosSel.value === '2 ojos') {
      const ojoAntes = normalizarOjo(ojoSel.value) || normalizarOjo(paciente.ojo) || 'OI';
      const valorActual = dioptriaInput.value || '';
      if (ojoAntes === 'OI' && !oiInput.value) { oiInput.value = valorActual; dispatchChange(oiInput); }
      if (ojoAntes === 'OD' && !odInput.value) { odInput.value = valorActual; dispatchChange(odInput); }
      if (normalizarOjo(ojoSel.value) === 'OD') {
        const seguro = window.confirm('¿Está seguro de que quiere que se opere primero el OD?');
        if (!seguro) {
          ojoSel.value = 'OI';
          dispatchChange(ojoSel);
        }
      }
    }
    aplicarModo();
  });

  const duplicarBtn = document.querySelector(`#sideFoot [data-qa-action="duplicar"][data-qa-id="${CSS.escape(id)}"]`)
    || document.querySelector('#sideFoot [data-qa-action="duplicar"]');
  if (duplicarBtn) {
    const otro = normalizarOjo(ojoSel.value) === 'OD' ? 'OI' : 'OD';
    duplicarBtn.textContent = `⧉ Duplicar segundo ojo → ${otro}`;
  }

  aplicarModo();
}

async function duplicarSegundoOjo(id) {
  const orig = buscarPaciente(id);
  if (!orig) return;
  if (!isFacturadoCompleto(orig.estadoFac)) {
    toast('Para cargar el segundo ojo, primero facturá/finalizá el ojo actual.');
    return;
  }
  const dirty = document.getElementById('sideDirtyHint');
  if (dirty && dirty.style.display !== 'none') {
    toast('Guardá los cambios antes de duplicar el segundo ojo.');
    return;
  }

  const ojoOriginal = normalizarOjo(orig.ojo || 'OI') || 'OI';
  const otroOjo = ojoOriginal === 'OD' ? 'OI' : 'OD';
  const yaExiste = DB.rows.some(x => normalizeId(x.id) !== normalizeId(orig.id)
    && String(x.dni || '').trim() === String(orig.dni || '').trim()
    && normalizarOjo(x.ojo) === otroOjo);
  if (yaExiste) {
    toast(`Ya existe episodio para ${otroOjo}`);
    return;
  }

  if (ojoOriginal === 'OI' && !orig.dioptriaOI) orig.dioptriaOI = String(orig.dioptria || orig.lio || '').trim();
  if (ojoOriginal === 'OD' && !orig.dioptriaOD) orig.dioptriaOD = String(orig.dioptria || orig.lio || '').trim();
  const dioptriaSegundo = dioptriaDelOjo(orig, otroOjo);
  orig.ojos = '2 ojos';

  const copia = {
    id: String(DB.nid++),
    clinica: orig.clinica || 'CDU',
    nombre: orig.nombre || '',
    dni: orig.dni || '',
    fnac: orig.fnac || '',
    tel: orig.tel || '',
    dir: orig.dir || '',
    obraSocial: orig.obraSocial || 'PAMI',
    afiliado: orig.afiliado || '',
    ojos: '2 ojos',
    ojo: otroOjo,
    dioptria: dioptriaSegundo,
    lio: dioptriaSegundo,
    dioptriaOI: orig.dioptriaOI || '',
    dioptriaOD: orig.dioptriaOD || '',
    model: orig.model || '',
    precioEspecial: orig.precioEspecial || '',
    fechaSolLente: '',
    fechaLlegaLente: '',
    recepLente: '',
    fechaCir: '',
    hora: '',
    hora_cirugia: '',
    estadoCir: '',
    estadoFac: '',
    fechaFacturada: '',
    fechaFacturacion: '',
    facturarSeleccionado: false,
    extraSutura: false,
    extraInyeccion: false,
    extraVitrectomia: false,
    vitrectomia: false,
    ecografiaImagen: '',
    ecografiaMes: '',
    fechaCarga: hoyISO(),
    notas: `Segundo ojo duplicado desde ${ojoOriginal} → ${otroOjo}`
  };

  const [{ save }, { render }] = await Promise.all([
    import('./firebase-ui.js'),
    import('./render.js')
  ]);

  DB.rows.push(copia);
  await save(orig);
  await save(copia);
  render();
  window.closeSide?.();
  setTimeout(() => window.openSide?.(copia.id), 100);
  toast(dioptriaSegundo
    ? `✓ Segundo ojo ${otroOjo} creado con dioptría ${dioptriaSegundo}`
    : `✓ Segundo ojo ${otroOjo} creado. Falta cargar su dioptría.`);
}

// ── Excel de cirugías programadas: una fecha + Tabla de Excel real ───────
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
    const central = [0x50,0x4b,0x01,0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name];
    centralParts.push(...central);
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

function horaAMinutos(v) {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Number.POSITIVE_INFINITY;
  return (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
}

function fechasProgramadasEnUso() {
  const counts = new Map();
  DB.rows.forEach(p => {
    const f = String(p.fechaCir || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
    counts.set(f, (counts.get(f) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function descargarCirugiasProgramadas(fecha) {
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
    String(p.fnac || '').slice(0, 10),
    p.tel || '',
    p.obraSocial || '',
    p.afiliado || '',
    p.clinica || '',
    normalizarOjo(p.ojo || ''),
    dioptriaActual(p),
    String(p.fechaCir || '').slice(0, 10),
    p.hora || p.hora_cirugia || ''
  ]);

  descargarTablaExcel(`cirugias_programadas_${fecha}.xlsx`, headers, rows);
  toast(`✓ Descargadas ${rowsProgramadas.length} cirugías programadas del ${fd(fecha) || fecha}`);
  return true;
}

function asegurarModalCirugiasProgramadas() {
  let modal = document.getElementById('cirugiasProgramadasExportModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'cirugiasProgramadasExportModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:#0006;z-index:700;align-items:center;justify-content:center;padding:18px';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(520px,96vw);box-shadow:0 24px 70px #0003;overflow:hidden">
      <div style="padding:16px 18px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:800;font-size:15px">Descargar cirugías programadas</div><div style="font-size:11px;color:#64748b;margin-top:3px">Elegí una sola fecha de cirugía.</div></div>
        <button type="button" class="btn" data-close-programadas>✕</button>
      </div>
      <div style="padding:18px">
        <label style="display:block;font-size:12px;font-weight:700;color:#334155">Fecha de cirugía
          <select id="fechaProgramadasExport" style="width:100%;margin-top:7px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff"></select>
        </label>
        <div id="fechaProgramadasInfo" style="font-size:11px;color:#64748b;margin-top:8px"></div>
      </div>
      <div style="padding:12px 18px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn" data-close-programadas>Cancelar</button>
        <button type="button" class="btn primary" id="btnConfirmarDescargaProgramadas">Descargar Excel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-close-programadas]')) modal.style.display = 'none';
  });
  modal.querySelector('#fechaProgramadasExport')?.addEventListener('change', e => {
    const option = e.target.selectedOptions?.[0];
    const info = modal.querySelector('#fechaProgramadasInfo');
    if (info) info.textContent = option?.dataset.count ? `${option.dataset.count} cirugía(s) en esa fecha. El Excel se ordenará por hora de menor a mayor.` : '';
  });
  modal.querySelector('#btnConfirmarDescargaProgramadas')?.addEventListener('click', () => {
    const fecha = modal.querySelector('#fechaProgramadasExport')?.value || '';
    if (!fecha) { toast('Elegí una fecha de cirugía'); return; }
    if (descargarCirugiasProgramadas(fecha)) modal.style.display = 'none';
  });
  return modal;
}

function abrirModalCirugiasProgramadas() {
  const fechas = fechasProgramadasEnUso();
  if (!fechas.length) {
    toast('No hay fechas de cirugía programadas para descargar');
    return;
  }
  const modal = asegurarModalCirugiasProgramadas();
  const select = modal.querySelector('#fechaProgramadasExport');
  const today = hoyISO();
  const recomendada = fechas.find(([f]) => f >= today)?.[0] || fechas[fechas.length - 1][0];
  select.innerHTML = '';
  fechas.forEach(([fecha, count]) => {
    const opt = document.createElement('option');
    opt.value = fecha;
    opt.dataset.count = String(count);
    opt.textContent = `${fd(fecha) || fecha} — ${count} cirugía${count === 1 ? '' : 's'}`;
    if (fecha === recomendada) opt.selected = true;
    select.appendChild(opt);
  });
  select.dispatchEvent(new Event('change'));
  modal.style.display = 'flex';
}

function instalarInterceptores() {
  if (window.__ajustesCirugiasInterceptores) return;
  window.__ajustesCirugiasInterceptores = true;

  document.addEventListener('click', e => {
    const exportDia = e.target.closest('#btnExportarDia');
    if (exportDia) {
      e.preventDefault();
      e.stopImmediatePropagation();
      exportDia.closest('details')?.removeAttribute('open');
      abrirModalCirugiasProgramadas();
      return;
    }

    const duplicar = e.target.closest('[data-qa-action="duplicar"]');
    if (duplicar) {
      e.preventDefault();
      e.stopImmediatePropagation();
      duplicarSegundoOjo(duplicar.dataset.qaId).catch(err => {
        console.error('[duplicar segundo ojo]', err);
        toast('No se pudo duplicar el segundo ojo.');
      });
    }
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('cirugiasProgramadasExportModal');
      if (modal?.style.display === 'flex') modal.style.display = 'none';
    }
  });
}

function iniciar() {
  limpiarEstadoOculto();
  asegurarAyudasFecha();
  aplicarAjustesInterfaz();
  instalarInterceptores();

  const filtro = asegurarCheckbox();
  const tbody = document.getElementById('tbody');
  if (filtro && tbody && !window.vitrectomiaPrincipalLista) {
    window.vitrectomiaPrincipalLista = true;
    filtro.addEventListener('change', aplicarVitrectomia);
    new MutationObserver(aplicarVitrectomia).observe(tbody, { childList: true });
    aplicarVitrectomia();
  }

  const bar = document.getElementById('activeFiltersBar');
  if (bar && !bar.dataset.dateChipObserver) {
    bar.dataset.dateChipObserver = '1';
    new MutationObserver(asegurarChipFechaVisible).observe(bar, { childList: true, subtree: true });
  }
  document.getElementById('fFechaCir')?.addEventListener('change', asegurarChipFechaVisible);
  asegurarChipFechaVisible();

  const sideBody = document.getElementById('sideBody');
  if (sideBody && !sideBody.dataset.eyeFieldsObserver) {
    sideBody.dataset.eyeFieldsObserver = '1';
    new MutationObserver(() => mejorarCamposOjos()).observe(sideBody, { childList: true });
  }
  mejorarCamposOjos();
}

// Se ejecuta antes de que el usuario inicie sesión y antes de restoreFilters().
limpiarFiltrosPersistidosObsoletos();

// Los módulos manejan sus fechas internamente. La fecha global solo corresponde a Operación.
document.addEventListener('click', e => {
  const tab = e.target.closest('.tablink');
  if (!tab || (tab.dataset.tab || 'tabla') === 'tabla') return;
  limpiarFechaCirugia(false);
  limpiarEstadoOculto();
}, true);

window.addEventListener('beforeunload', limpiarFiltrosPersistidosObsoletos);
window.addEventListener('authReady', () => setTimeout(iniciar, 0));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
