// facturar.js — vista operativa para facturación, documentación y ecografías mensuales

'use strict';

import { DB, estado, getDioptria, filtered, WORKFLOW_KEYS } from './state.js';
import { save } from './firebase-ui.js';
import { connectorStartJob, connectorPollJob, renderJobStatus } from './connector.js';
import { hoyISO, toast, escapeHtml, escapeAttr } from './utils.js';
import { saveWithAudit } from './audit.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const LS_BASE = 'facturar_base_dir';
const LS_OUT = 'facturar_output_dir';
const LS_ECO_CATALOG = 'ecografia_image_catalog';
const LS_ECO_USAGE_MONTH = 'facturar_eco_usage_month';
const LS_ECO_PANEL_OPEN = 'facturar_eco_panel_open';
const LS_ECO_CONFIG_OPEN = 'facturar_eco_config_open';

let ECO_USAGE_CACHE = {};
let ECO_PANEL_RENDER_SEQ = 0;

function clone(v) { return JSON.parse(JSON.stringify(v || {})); }
function getBaseDir() { return localStorage.getItem(LS_BASE) || ''; }
function getOutputDir() { return localStorage.getItem(LS_OUT) || ''; }
function setBaseDir(v) { localStorage.setItem(LS_BASE, (v || '').trim()); }
function setOutputDir(v) { localStorage.setItem(LS_OUT, (v || '').trim()); }
function getEcoPanelOpen() { return localStorage.getItem(LS_ECO_PANEL_OPEN) === '1'; }
function setEcoPanelOpen(v) { localStorage.setItem(LS_ECO_PANEL_OPEN, v ? '1' : '0'); }
function getEcoConfigOpen() { return localStorage.getItem(LS_ECO_CONFIG_OPEN) === '1'; }
function setEcoConfigOpen(v) { localStorage.setItem(LS_ECO_CONFIG_OPEN, v ? '1' : '0'); }

function normalizeHoraText(v) {
  let s = String(v || '').trim().replace('.', ':').replace(/[^0-9:]/g, '');
  if (!s) return '';
  if (/^\d{1,2}$/.test(s)) s = `${s.padStart(2, '0')}:00`;
  else if (/^\d{3,4}$/.test(s)) s = `${s.slice(0, -2).padStart(2, '0')}:${s.slice(-2)}`;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return s;
  const hh = Math.min(Math.max(parseInt(m[1], 10) || 0, 0), 23);
  const mm = Math.min(Math.max(parseInt(m[2], 10) || 0, 0), 59);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseDateToISO(v) {
  const s = String(v || '').trim().slice(0, 10);
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}
function displayDate(v) {
  const iso = parseDateToISO(v);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '');
}
function fechaToEcoUS(fecha) {
  const iso = parseDateToISO(fecha);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(fecha || '');
}

function defaultEcoCatalog() {
  return Array.from({ length: 23 }, (_, i) => `${i + 1}.png`);
}
function normalizeEcoImageName(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const base = raw.split(/[\\/]/).pop().trim();
  const n = base.match(/(\d+)/);
  if (n) return `${parseInt(n[1], 10)}.png`;
  return base;
}
function getEcoCatalog() {
  const raw = localStorage.getItem(LS_ECO_CATALOG);
  let rows = raw ? raw.split(/\r?\n/).map(x => normalizeEcoImageName(x)).filter(Boolean) : defaultEcoCatalog();
  rows = [...new Set(rows)].filter(x => /^\d+\.png$/i.test(x));
  if (!rows.length) rows = defaultEcoCatalog();
  rows.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  localStorage.setItem(LS_ECO_CATALOG, rows.join('\n'));
  return rows;
}
function setEcoCatalogFromText(v) {
  let rows = String(v || '').split(/\r?\n/).map(x => normalizeEcoImageName(x)).filter(Boolean);
  rows = [...new Set(rows)].filter(x => /^\d+\.png$/i.test(x));
  if (!rows.length) rows = defaultEcoCatalog();
  rows.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  localStorage.setItem(LS_ECO_CATALOG, rows.join('\n'));
}
function getEcoUsageMonth() { return String(localStorage.getItem(LS_ECO_USAGE_MONTH) || '').slice(0, 7) || hoyISO().slice(0, 7); }
function setEcoUsageMonth(v) { localStorage.setItem(LS_ECO_USAGE_MONTH, String(v || '').slice(0, 7)); }
function billingDateFor(row) {
  return parseDateToISO(row.fechaFacturacion || row.fechaFacturada || '') || hoyISO();
}
function ecoMonthFor(row) { return billingDateFor(row).slice(0, 7); }
function fechaHoraEco(row) {
  const fecha = billingDateFor(row);
  const hora = normalizeHoraText(row.hora || row.hora_cirugia || '');
  return fecha && hora ? `${fechaToEcoUS(fecha)} ${hora}` : '';
}

function ecoUsageRecordFromRow(r, month) {
  if (!r?.extraVitrectomia) return null;
  const image = normalizeEcoImageName(r.ecografiaImagen || '');
  if (!image) return null;
  const fechaFactura = billingDateFor(r);
  const rowMonth = String(r.ecografiaMes || fechaFactura.slice(0, 7)).slice(0, 7);
  if (rowMonth !== month) return null;
  return {
    image,
    pacienteId: String(r.id || ''),
    pacienteNombre: String(r.nombre || ''),
    dni: String(r.dni || ''),
    fechaFacturacion: fechaFactura,
    hora: normalizeHoraText(r.hora || r.hora_cirugia || ''),
    assignedAt: r.updatedAt || new Date().toISOString(),
    source: 'rows'
  };
}
function ecoUsageRows(month) {
  const mm = String(month || '').slice(0, 7);
  return DB.rows.map(r => ecoUsageRecordFromRow(r, mm)).filter(Boolean);
}
function normalizeUsadasMap(usadas = {}) {
  const out = {};
  Object.entries(usadas || {}).forEach(([key, value]) => {
    const image = normalizeEcoImageName(key || value?.imagen || value?.image || '');
    if (!image) return;
    out[image] = Object.assign({}, value || {}, { image });
  });
  return out;
}
function usageMapFromRows(month) {
  const out = {};
  for (const rec of ecoUsageRows(month)) {
    out[rec.image] = rec;
  }
  return out;
}
function usedEcoImages(month, exceptId = '') {
  const sid = String(exceptId || '');
  const cached = ECO_USAGE_CACHE[String(month || '').slice(0, 7)];
  if (cached) {
    return new Set(Object.entries(cached)
      .filter(([, r]) => !sid || String(r?.pacienteId || '') !== sid)
      .map(([img]) => normalizeEcoImageName(img))
      .filter(Boolean));
  }
  return new Set(ecoUsageRows(month).filter(r => String(r.pacienteId || '') !== sid).map(r => r.image).filter(Boolean));
}

async function getEcoMonthDoc(month) {
  const db = window.firestoreConnector?.getDb?.();
  if (!db || !month) return null;
  const ref = doc(db, 'ecografias_mensuales', month);
  const snap = await getDoc(ref);
  return { ref, data: snap.exists() ? snap.data() : { mes: month, catalogo: getEcoCatalog(), usadas: {} } };
}
async function getEcoUsageMap(month, repair = true) {
  const mm = String(month || '').slice(0, 7);
  const rowsMap = usageMapFromRows(mm);
  const d = await getEcoMonthDoc(mm);
  if (!d) {
    ECO_USAGE_CACHE[mm] = rowsMap;
    return rowsMap;
  }

  const docMap = normalizeUsadasMap(d.data.usadas || {});
  const merged = Object.assign({}, docMap, rowsMap);
  ECO_USAGE_CACHE[mm] = merged;

  const normalizedCatalog = getEcoCatalog();
  const mustRepair = repair && (
    JSON.stringify(docMap) !== JSON.stringify(merged) ||
    JSON.stringify((d.data.catalogo || []).map(normalizeEcoImageName).filter(Boolean)) !== JSON.stringify(normalizedCatalog)
  );

  if (mustRepair) {
    try {
      await setDoc(d.ref, { mes: mm, catalogo: normalizedCatalog, usadas: merged, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.warn('[eco] no se pudo reparar/sincronizar ecografías mensuales', e?.message || e);
    }
  }
  return merged;
}
async function syncEcoMonthCatalog(month) {
  try {
    const d = await getEcoMonthDoc(month);
    if (!d) return;
    await setDoc(d.ref, { mes: month, catalogo: getEcoCatalog(), updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) { console.warn('[eco] no se pudo sincronizar catálogo mensual', e?.message || e); }
}
async function reserveEcoImage(row, image, month) {
  try {
    const mm = String(month || ecoMonthFor(row)).slice(0, 7);
    const img = normalizeEcoImageName(image || row.ecografiaImagen || '');
    const d = await getEcoMonthDoc(mm);
    if (!d || !img) return;
    const usadas = normalizeUsadasMap(d.data.usadas || {});
    usadas[img] = {
      image: img,
      pacienteId: String(row.id || ''),
      pacienteNombre: String(row.nombre || ''),
      dni: String(row.dni || ''),
      fechaFacturacion: billingDateFor(row),
      hora: normalizeHoraText(row.hora || row.hora_cirugia || ''),
      asignadoPor: String(window.CURRENT_USER?.email || ''),
      assignedAt: new Date().toISOString()
    };
    ECO_USAGE_CACHE[mm] = usadas;
    await setDoc(d.ref, { mes: mm, catalogo: getEcoCatalog(), usadas, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) { console.warn('[eco] no se pudo reservar imagen mensual', e?.message || e); }
}
async function releaseEcoImage(image, month, rowId = '') {
  try {
    const mm = String(month || '').slice(0, 7);
    const img = normalizeEcoImageName(image);
    const d = await getEcoMonthDoc(mm);
    if (!d || !img) return;
    const usadas = normalizeUsadasMap(d.data.usadas || {});
    if (rowId && String(usadas[img]?.pacienteId || '') !== String(rowId)) return;
    delete usadas[img];
    ECO_USAGE_CACHE[mm] = usadas;
    await setDoc(d.ref, { usadas, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) { console.warn('[eco] no se pudo liberar imagen mensual', e?.message || e); }
}
function nextEcoImage(row, month, usageMap = null) {
  const catalog = getEcoCatalog();
  const current = normalizeEcoImageName(row.ecografiaImagen || '');
  const sid = String(row.id || '');
  if (current && String(row.ecografiaMes || '').slice(0, 7) === month && catalog.includes(current)) return current;
  const used = usageMap
    ? new Set(Object.entries(usageMap).filter(([, r]) => String(r?.pacienteId || '') !== sid).map(([img]) => normalizeEcoImageName(img)).filter(Boolean))
    : usedEcoImages(month, row.id);
  const available = catalog.filter(img => !used.has(img));
  const pool = available.length ? available : catalog;
  if (!pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)] || '';
}
async function assignEcoIfNeeded(row, force = false) {
  if (!row.extraVitrectomia) return '';
  const month = ecoMonthFor(row);
  const usageMap = await getEcoUsageMap(month, true);
  const current = normalizeEcoImageName(row.ecografiaImagen || '');
  if (!force && current && String(row.ecografiaMes || '').slice(0, 7) === month && getEcoCatalog().includes(current)) {
    row.ecografiaImagen = current;
    await reserveEcoImage(row, current, month);
    return current;
  }
  const before = clone(row);
  const prevImage = normalizeEcoImageName(row.ecografiaImagen || '');
  const prevMonth = String(row.ecografiaMes || '').slice(0, 7);
  row.ecografiaMes = month;
  row.ecografiaImagen = nextEcoImage(row, month, usageMap);
  if (prevImage && prevMonth) await releaseEcoImage(prevImage, prevMonth, row.id);
  if (row.ecografiaImagen) await reserveEcoImage(row, row.ecografiaImagen, month);
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'ASIGNAR_ECOGRAFIA', detalle: `Asignó ${row.ecografiaImagen || '—'} (${month})` });
  return row.ecografiaImagen;
}

function rowsFacturar() {
  return filtered({ includeQuickFilter: false, includeEstadoSelect: false, stateKeys: [WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR] })
    .slice()
    .sort((a, b) => String(a.fechaCir || '').localeCompare(String(b.fechaCir || '')) || String(a.hora || a.hora_cirugia || '').localeCompare(String(b.hora || b.hora_cirugia || '')) || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
}
function selectedFacturarRows() { return rowsFacturar().filter(r => !!r.facturarSeleccionado); }

function otherEyeVitrectomia(row) {
  const dni = String(row?.dni || '').trim();
  const ojo = String(row?.ojo || '').trim().toUpperCase();
  if (!dni || !['OD', 'OI'].includes(ojo)) return null;
  const otro = ojo === 'OD' ? 'OI' : 'OD';
  return DB.rows.find(r =>
    String(r.id || '') !== String(row.id || '') &&
    String(r.dni || '').trim() === dni &&
    String(r.ojo || '').trim().toUpperCase() === otro &&
    !!r.extraVitrectomia
  ) || null;
}

function vitrectomiaWarningHtml(row) {
  const other = otherEyeVitrectomia(row);
  if (!other) return '';
  const ojo = String(other.ojo || '').trim().toUpperCase() || 'otro ojo';
  return `<span class="facturar-vit-alert" title="Revisar: el ${escapeAttr(ojo)} ya figura con vitrectomía">⚠</span>`;
}


function buildPacientePayload(row) {
  const hasVitrectomia = !!row.extraVitrectomia;
  const month = hasVitrectomia ? ecoMonthFor(row) : '';
  const billingDate = billingDateFor(row);
  const hora = normalizeHoraText(row.hora || row.hora_cirugia || '');
  const imagenEcografia = hasVitrectomia ? normalizeEcoImageName(row.ecografiaImagen || '') : '';
  return {
    id: String(row.id || ''),
    nombre_completo: String(row.nombre || '').trim(),
    dni: String(row.dni || '').trim(),
    afiliado: String(row.afiliado || '').trim(),
    fecha: String(billingDate || ''),
    fecha_facturacion: String(billingDate || ''),
    hora: String(hora || ''),
    fecha_hora_eco: hasVitrectomia ? String(fechaHoraEco(row) || '') : '',
    ojo_operado: String(row.ojo || '').trim().toUpperCase(),
    dioptria: String(getDioptria(row) || '').trim(),
    tiene_vitrectomia: hasVitrectomia,
    vitrectomia: hasVitrectomia,
    imagen_ecografia: imagenEcografia,
    ecografia_mes: String(month || ''),
    mes: String(month || ''),
    facturar: true,
    clinica: String(row.clinica || '').trim(),
    obra_social: String(row.obraSocial || '').trim(),
    generar: { ARM_Y_AV: true, HC: true, PROTOCOLO: true, ECOGRAFIA: hasVitrectomia },
    generar_ecografia: hasVitrectomia
  };
}

function validateRows(rows) {
  return rows.map(r => {
    const faltan = [];
    const obraSocial = String(r.obraSocial || r.obra_social || '').trim().toUpperCase();
    const ojo = String(r.ojo || r.ojo_operado || '').trim();
    const fechaCirugia = String(r.fechaCir || r.fecha_cirugia || r.fecha || '').trim();
    const hora = String(r.hora || r.hora_cirugia || r.horaCirugia || '').trim();

    if (!String(r.nombre || r.nombre_completo || '').trim()) faltan.push('nombre');
    if (!String(r.dni || '').trim()) faltan.push('DNI');

    // PARTICULAR no necesita número de afiliado.
    if (obraSocial !== 'PARTICULAR' && !String(r.afiliado || '').trim()) faltan.push('afiliado');

    if (!ojo) faltan.push('ojo');
    if (!String(getDioptria(r) || r.dioptria || r.lio || '').trim()) faltan.push('dioptría');
    if (!fechaCirugia) faltan.push('fecha cirugía');
    if (!hora) faltan.push('hora');
    if (!String(billingDateFor(r) || '').trim()) faltan.push('fecha facturación');

    // La ecografía solo es obligatoria cuando Vitrectomía está tildada.
    if (!!r.extraVitrectomia && !String(r.ecografiaImagen || '').trim()) faltan.push('imagen ecografía');

    return { row: r, faltan };
  }).filter(x => x.faltan.length);
}

async function setFacturar(row, checked) {
  const before = clone(row);
  row.facturarSeleccionado = !!checked;
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'MARCAR_FACTURAR' });
  renderRows();
}
async function setVitrectomia(row, checked) {
  const before = clone(row);
  row.extraVitrectomia = !!checked;
  if (row.extraVitrectomia) {
    row.facturarSeleccionado = true;
    await assignEcoIfNeeded(row);
  } else {
    await releaseEcoImage(row.ecografiaImagen, String(row.ecografiaMes || '').slice(0, 7), row.id);
    row.ecografiaImagen = '';
    row.ecografiaMes = '';
  }
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: row.extraVitrectomia ? 'MARCAR_VITRECTOMIA' : 'DESMARCAR_VITRECTOMIA' });
  renderRows();
}
async function setHora(row, val) {
  const before = clone(row);
  row.hora = normalizeHoraText(val);
  row.hora_cirugia = row.hora;
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'CAMBIAR_HORA_FACTURACION' });
  renderRows();
}
async function setEcoImage(row, val) {
  if (!row.extraVitrectomia) return;
  const before = clone(row);
  const prevImage = normalizeEcoImageName(row.ecografiaImagen || '');
  const prevMonth = String(row.ecografiaMes || '').slice(0, 7);
  row.ecografiaMes = ecoMonthFor(row);
  row.ecografiaImagen = normalizeEcoImageName(val || '');
  if (prevImage && prevMonth) await releaseEcoImage(prevImage, prevMonth, row.id);
  if (row.ecografiaImagen) await reserveEcoImage(row, row.ecografiaImagen, row.ecografiaMes);
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'SELECCION_ECOGRAFIA' });
  renderRows();
}
async function setFechaFacturacion(row, val) {
  const before = clone(row);
  const prevImage = normalizeEcoImageName(row.ecografiaImagen || '');
  const prevMonth = String(row.ecografiaMes || '').slice(0, 7);
  row.fechaFacturacion = parseDateToISO(val) || hoyISO();
  if (row.extraVitrectomia) {
    const newMonth = ecoMonthFor(row);
    if (prevImage && prevMonth && prevMonth !== newMonth) await releaseEcoImage(prevImage, prevMonth, row.id);
    await assignEcoIfNeeded(row, true);
  }
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'CAMBIAR_FECHA_FACTURACION' });
  setEcoUsageMonth(ecoMonthFor(row));
  renderRows();
}

function updateFacturarPanels() {
  const btnEco = document.getElementById('facturarToggleEcoPanel');
  const boxEco = document.getElementById('facturarEcoUsageBox');
  const ecoOpen = getEcoPanelOpen();
  if (btnEco) btnEco.textContent = ecoOpen ? 'Ocultar imágenes usadas' : 'Ver imágenes usadas';
  if (boxEco) boxEco.style.display = ecoOpen ? 'block' : 'none';

  const btnConfig = document.getElementById('facturarToggleEcoConfig');
  const boxConfig = document.getElementById('facturarEcoConfigBox');
  const configOpen = getEcoConfigOpen();
  if (btnConfig) btnConfig.textContent = configOpen ? 'Ocultar configuración de imágenes' : 'Configurar imágenes';
  if (boxConfig) boxConfig.style.display = configOpen ? 'block' : 'none';
}
function updateEcoPanelToggleLabel() { updateFacturarPanels(); }
async function renderEcoUsagePanel() {
  const box = document.getElementById('facturarEcoUsagePanel');
  if (!box) return;
  const seq = ++ECO_PANEL_RENDER_SEQ;
  const month = getEcoUsageMonth();
  const catalog = getEcoCatalog();
  box.innerHTML = `<div style="font-size:12px;color:#64748b">Cargando ecografías usadas del mes...</div>`;

  const mapByImage = await getEcoUsageMap(month, true);
  if (seq !== ECO_PANEL_RENDER_SEQ) return;

  const usedCount = Object.keys(mapByImage).length;
  const freeCount = Math.max(catalog.length - usedCount, 0);
  box.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <label style="font-size:12px">Mes <input id="facturarEcoUsageMonth" type="month" value="${escapeAttr(month)}" style="margin-left:6px"></label>
      <span class="badge b2">Usadas: ${usedCount}</span><span class="badge b1">Libres: ${freeCount}</span>
      <span style="font-size:11px;color:#64748b">Registro mensual guardado en Firebase. Se comparte entre todas las computadoras.</span>
    </div>
    <div class="table-scroll"><table class="wa-table"><thead><tr><th>Imagen</th><th>Estado</th><th>Paciente</th><th>DNI</th><th>Fecha facturación</th><th>Hora</th></tr></thead>
      <tbody>${catalog.map(img => {
        const row = mapByImage[img];
        return `<tr><td>${escapeHtml(img)}</td><td><span class="badge ${row ? 'b6' : 'b2'}">${row ? 'Usada' : 'Libre'}</span></td><td>${escapeHtml(row?.pacienteNombre || '')}</td><td>${escapeHtml(row?.dni || '')}</td><td>${escapeHtml(row?.fechaFacturacion || '')}</td><td>${escapeHtml(row?.hora || '')}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
  document.getElementById('facturarEcoUsageMonth')?.addEventListener('change', ev => { setEcoUsageMonth(ev.target.value); syncEcoMonthCatalog(String(ev.target.value || '').slice(0, 7)); renderEcoUsagePanel(); renderRows(); });
  updateEcoPanelToggleLabel();
}

function renderRows() {
  const tbody = document.getElementById('facturarTbody');
  const rows = rowsFacturar();
  if (!tbody) return;
  const catalog = getEcoCatalog();
  tbody.innerHTML = rows.length ? rows.map(r => {
    const hasVitrectomia = !!r.extraVitrectomia;
    const month = hasVitrectomia ? ecoMonthFor(r) : '';
    const used = hasVitrectomia ? usedEcoImages(month, r.id) : new Set();
    const assigned = hasVitrectomia ? normalizeEcoImageName(r.ecografiaImagen || '') : '';
    const pacienteDetalle = [String(r.ojo || '').trim(), r.afiliado ? `Af. ${r.afiliado}` : ''].filter(Boolean).join(' · ');
    return `<tr>
      <td class="facturar-check"><input type="checkbox" class="facturar-row" data-id="${escapeAttr(r.id)}" ${r.facturarSeleccionado ? 'checked' : ''}></td>
      <td class="facturar-vit-cell"><input type="checkbox" class="facturar-vit" data-id="${escapeAttr(r.id)}" ${r.extraVitrectomia ? 'checked' : ''}>${vitrectomiaWarningHtml(r)}</td>
      <td><input class="facturar-fecha" data-id="${escapeAttr(r.id)}" type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" value="${escapeAttr(displayDate(billingDateFor(r)))}"></td>
      <td><input class="facturar-hora" data-id="${escapeAttr(r.id)}" type="text" inputmode="numeric" maxlength="5" placeholder="09:30" value="${escapeAttr(r.hora || r.hora_cirugia || '')}"></td>
      <td class="facturar-paciente"><strong>${escapeHtml(r.nombre || '—')}</strong>${pacienteDetalle ? `<div>${escapeHtml(pacienteDetalle)}</div>` : ''}</td>
      <td>${escapeHtml(r.dni || '—')}</td>
      <td>${escapeHtml(r.obraSocial || '—')}</td>
      <td>${escapeHtml(getDioptria(r) || '—')}</td>
      <td>${!hasVitrectomia ? '<span style="color:#94a3b8">—</span>' : !assigned ? '<span style="color:#b45309;font-size:12px">Pendiente</span>' : ''}${hasVitrectomia ? `<select class="facturar-eco" data-id="${escapeAttr(r.id)}"><option value="">Asignar al ejecutar</option>${catalog.map(img => `<option value="${escapeAttr(img)}" ${img === assigned ? 'selected' : ''} ${used.has(img) ? 'data-used="1"' : ''}>${escapeHtml(img)}${used.has(img) ? ' · usada este mes' : ''}</option>`).join('')}</select><div style="font-size:10px;color:#64748b">${assigned ? `${escapeHtml(assigned)} / Mes ${escapeHtml(month)}` : ''}</div>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9"><div class="empty">No hay pacientes para facturar con los filtros actuales.</div></td></tr>';

  const selected = rows.filter(r => !!r.facturarSeleccionado).length;
  const countEl = document.getElementById('facturarCount');
  const selectedEl = document.getElementById('facturarSelected');
  if (countEl) countEl.textContent = String(rows.length);
  if (selectedEl) selectedEl.textContent = String(selected);
  const chkAll = document.getElementById('facturarChkAll');
  if (chkAll) chkAll.checked = !!rows.length && selected === rows.length;
  renderEcoUsagePanel();

  tbody.querySelectorAll('.facturar-row').forEach(chk => chk.addEventListener('change', ev => { const row = DB.rows.find(x => String(x.id) === String(ev.target.dataset.id)); if (row) setFacturar(row, ev.target.checked); }));
  tbody.querySelectorAll('.facturar-vit').forEach(chk => chk.addEventListener('change', ev => { const row = DB.rows.find(x => String(x.id) === String(ev.target.dataset.id)); if (row) setVitrectomia(row, ev.target.checked); }));
  tbody.querySelectorAll('.facturar-hora').forEach(inp => {
    inp.addEventListener('blur', ev => { const row = DB.rows.find(x => String(x.id) === String(ev.target.dataset.id)); if (row) setHora(row, ev.target.value); });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.currentTarget.blur(); } });
  });
  tbody.querySelectorAll('.facturar-fecha').forEach(inp => {
    inp.addEventListener('blur', ev => { const row = DB.rows.find(x => String(x.id) === String(ev.target.dataset.id)); if (row) setFechaFacturacion(row, ev.target.value); });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.currentTarget.blur(); } });
  });
  tbody.querySelectorAll('.facturar-eco').forEach(sel => sel.addEventListener('change', ev => { const row = DB.rows.find(x => String(x.id) === String(ev.target.dataset.id)); if (row) setEcoImage(row, ev.target.value); }));
}
async function selectAllRows(checked) { for (const r of rowsFacturar()) { r.facturarSeleccionado = !!checked; await save(r); } renderRows(); }
async function assignMissingEco() { const rows = rowsFacturar().filter(r => r.facturarSeleccionado && r.extraVitrectomia); for (const r of rows) await assignEcoIfNeeded(r, false); toast(`Ecografías asignadas para ${rows.length} paciente(s)`); renderRows(); }

function attachEvents() {
  document.getElementById('facturarBaseDir')?.addEventListener('change', e => setBaseDir(e.target.value));
  document.getElementById('facturarOutputDir')?.addEventListener('change', e => setOutputDir(e.target.value));
  document.getElementById('facturarRefresh')?.addEventListener('click', renderRows);
  document.getElementById('facturarClearSel')?.addEventListener('click', () => selectAllRows(false));
  document.getElementById('facturarSelectAll')?.addEventListener('click', () => selectAllRows(true));
  document.getElementById('facturarAssignEco')?.addEventListener('click', assignMissingEco);
  document.getElementById('facturarToggleEcoPanel')?.addEventListener('click', () => { setEcoPanelOpen(!getEcoPanelOpen()); updateFacturarPanels(); if (getEcoPanelOpen()) renderEcoUsagePanel(); });
  document.getElementById('facturarToggleEcoConfig')?.addEventListener('click', () => { setEcoConfigOpen(!getEcoConfigOpen()); updateFacturarPanels(); });
  document.getElementById('facturarSaveEcoCatalog')?.addEventListener('click', () => { setEcoCatalogFromText(document.getElementById('facturarEcoCatalog')?.value || ''); toast('Catálogo de ecografías guardado'); renderEcoUsagePanel(); renderRows(); });
  document.getElementById('facturarChkAll')?.addEventListener('change', e => selectAllRows(e.target.checked));
  document.getElementById('facturarRun')?.addEventListener('click', ejecutarFacturacionDocs);
  document.getElementById('facturarBack')?.addEventListener('click', () => document.querySelector('.tablink[data-tab="tabla"]')?.click());
}

async function ejecutarFacturacionDocs() {
  const rows = selectedFacturarRows();
  if (!rows.length) { toast('Tildá Facturar en al menos un paciente'); return; }
  const base_dir = (document.getElementById('facturarBaseDir')?.value || '').trim();
  const output_dir = (document.getElementById('facturarOutputDir')?.value || '').trim();
  if (!base_dir || !output_dir) { toast('Completá carpeta local y carpeta de salida'); return; }
  for (const r of rows) if (r.extraVitrectomia) await assignEcoIfNeeded(r, false);
  const invalid = validateRows(rows);
  if (invalid.length) {
    const detalle = invalid.map(x => `${x.row.nombre || 'Paciente sin nombre'}: falta ${x.faltan.join(', ')}`).join(' · ');
    renderJobStatus('facturarJobStatus', 'err', `❌ ${detalle}`);
    toast(`Hay ${invalid.length} paciente(s) con datos incompletos.`);
    return;
  }
  const resumen = rows.map(r => `• ${r.nombre || '—'} · ${r.ojo || '—'} · Factura: ${billingDateFor(r)} ${r.hora || r.hora_cirugia || ''} · Eco: ${r.extraVitrectomia ? (normalizeEcoImageName(r.ecografiaImagen || '') || 'pendiente') : '—'}${r.extraVitrectomia ? ' · Vitrectomía' : ''}`).join('\n');
  if (!confirm(`Se va a generar documentación y facturar ${rows.length} paciente(s):\n\n${resumen}`)) return;
  const pacientes = rows.map(buildPacientePayload);
  const payload = { base_dir, output_dir, source: 'github_facturar_tab', pacientes };
  const btn = document.getElementById('facturarRun');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Ejecutando...'; }
  renderJobStatus('facturarJobStatus', 'run', `⏳ Enviando ${pacientes.length} paciente(s) al conector local...`);
  try {
    const jobId = await connectorStartJob('facturar_docs', payload);
    renderJobStatus('facturarJobStatus', 'run', `⏳ Job iniciado: ${String(jobId).slice(0, 8)}`);
    const result = await connectorPollJob(jobId, s => renderJobStatus('facturarJobStatus', 'run', `⏳ Ejecutando${s?.done != null ? ` (${s.done}/${s.total ?? pacientes.length})` : ''}`));
    for (const r of rows) {
      const before = clone(r);
      const fechaFactura = billingDateFor(r);
      r.estadoFac = 'FACTURADA';
      r.fechaFacturada = fechaFactura;
      r.fechaFacturacion = fechaFactura;
      r.facturarSeleccionado = false;
      if (r.extraVitrectomia && r.ecografiaImagen) {
        r.ecografiaImagen = normalizeEcoImageName(r.ecografiaImagen);
        r.ecografiaMes = fechaFactura.slice(0, 7);
        await reserveEcoImage(r, r.ecografiaImagen, r.ecografiaMes);
      }
      await saveWithAudit(before, r, { modulo: 'Facturar', accion: 'MARCAR_FACTURADA', detalle: `Marcó FACTURADA en ${r.fechaFacturada}` });
    }
    renderJobStatus('facturarJobStatus', 'ok', `✅ Documentación generada. Carpeta: ${result?.output_dir || output_dir}`); toast('✅ Documentación generada y facturación guardada'); renderRows();
  } catch (err) { const msg = String(err?.message || 'Error ejecutando facturación documental'); renderJobStatus('facturarJobStatus', /conector local no detectado|no se pudo conectar/i.test(msg) ? 'off' : 'err', `❌ ${msg}`); toast(`❌ ${msg}`); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '▶ Generar documentación y facturar'; } }
}

export function renderFacturar() {
  const el = document.getElementById('facturarView');
  if (!el) return;
  el.innerHTML = `
    <div class="facturar-shell">
      <div class="facturar-head">
        <div>
          <h3 class="facturar-title">Facturar</h3>
          <div class="facturar-sub">Pacientes en <strong>REALIZADA - FALTA FACTURAR</strong>. La tabla es el centro de trabajo.</div>
        </div>
        <div class="facturar-counters"><span><strong id="facturarCount">0</strong> visibles</span><span><strong id="facturarSelected">0</strong> tildados</span></div>
      </div>

      <input id="facturarBaseDir" type="hidden" value="${escapeAttr(getBaseDir() || 'AUTO')}">
      <input id="facturarOutputDir" type="hidden" value="${escapeAttr(getOutputDir() || 'AUTO_SALIDA')}">

      <div class="facturar-actions">
        <button id="facturarRun" class="btn primary">▶ Generar documentación y facturar</button>
        <button id="facturarSelectAll" class="btn">Tildar pacientes</button>
        <button id="facturarClearSel" class="btn">Destildar pacientes</button>
        <button id="facturarToggleEcoConfig" class="btn">Configurar imágenes</button>
        <button id="facturarAssignEco" class="btn">Asignar ecografías faltantes</button>
        <button id="facturarToggleEcoPanel" class="btn"></button>
        <button id="facturarRefresh" class="btn">↺ Actualizar</button>
        <button id="facturarBack" class="btn">← Volver</button>
      </div>
      <div id="facturarJobStatus" class="facturar-status">Listo para ejecutar en conector local.</div>

      <div id="facturarEcoConfigBox" class="facturar-panel">
        <div class="facturar-panel-title">Configuración de imágenes de ecografía</div>
        <label>Imágenes disponibles, una por línea</label>
        <textarea id="facturarEcoCatalog" rows="5">${escapeHtml(getEcoCatalog().join('\n'))}</textarea>
        <div class="facturar-panel-actions"><button id="facturarSaveEcoCatalog" class="btn">Guardar lista</button></div>
      </div>

      <div id="facturarEcoUsageBox" class="facturar-panel">
        <div class="facturar-panel-title">Imágenes usadas del mes</div>
        <div id="facturarEcoUsagePanel"></div>
      </div>

      <div class="tablewrap facturar-tablewrap"><div class="table-scroll"><table class="wa-table facturar-table"><thead><tr><th><input id="facturarChkAll" type="checkbox"><br>Facturar</th><th>Vitrectomía</th><th>Fecha</th><th>Hora</th><th>Paciente</th><th>DNI</th><th>Obra social</th><th>Dioptría</th><th>Ecografía asignada</th></tr></thead><tbody id="facturarTbody"></tbody></table></div></div>
    </div>`;
  attachEvents(); updateFacturarPanels(); renderRows();
}
