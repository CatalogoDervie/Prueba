// app.js — Punto de entrada. Inicialización, eventos y acciones del usuario.

'use strict';

import { toast, hoyISO, nowTag, downloadTextFile, idbSet, idbGet, fdInput, escapeAttr, cleanDigits } from './utils.js';
import {
  DB, setDB, selId, setSelId, sortCol, setSortCol, sortDir, setSortDir,
  currentTab, setCurrentTab, quickFilter, setQuickFilter as _setQuickFilter,
  hideFinalizadasSinAccion, setHideFinalizadasSinAccion,
  SETTINGS, ALERT_SILENCES, findRow, normalizeId,
  estado, alertas, secondEyeMissing, isFacturadoCompleto, getDioptria,
  silenciarAlerta, reactivarAlerta, backupDiario, normalizarData, validarFila, filtered
} from './state.js';
import {
  render, renderTabla, renderStats, renderAlerts, refreshSidePanel,
  openSide, closeSide, forceUnlockUI, renderWorkdayPanel, updateStickyMetrics,
  toggleKpis, restoreKpisPref, MAIN_TABLE_COLUMNS
} from './render.js';
import {
  save, deleteFromServer, showSyncBadge, loadFromServer, sincronizarAhora,
  ensureFirestoreRealtimeSync, activateFirestoreIfReady, repararCache, configurarURL
} from './firebase-ui.js';
import { probarConexion, connectorStartJob, connectorPollJob, renderJobStatus } from './connector.js';
import { abrirModalRecetas, cerrarModalRecetas, generarRecetasDesdeModal } from './recetas.js';
import { canEditPatient, canFacturar, canManageUsers, canExport, canViewRowHistory, canDelete, canView } from './authz.js';
import { openRowHistoryModal, closeRowHistoryModal } from './audit.js';
import { loadAdmisionConfig, ensureAdmisionForPatient, loadLentessEntregas, entregaForClinica } from './admision-config.js';

// ── Exposición global para compatibilidad con HTML legacy ────────────────
// (necesario mientras los botones del HTML usan onclick=)
Object.assign(window, {
  probarConexion,
  sincronizarAhora,
  repararCache,
  configurarURL,
  toggleKpis,
  exportarListos,
  exportarBackupJSON,
  importarBackupJSON,
  exportarFiltradoExcel,
  exportarCirugiasDelDia,
  exportarCirugiasFacturadas,
  abrirLentessModal,
  cerrarLentessModal,
  abrirStockModal,
  closeStockModal,
  cargarStockLente,
  closeExport,
  abrirModalRecetas,
  cerrarModalRecetas,
  generarRecetasDesdeModal,
  copyExcel,
  downloadExcelListos,
  descargarScriptLentess,
  nuevoModal,
  closeSide,
  goBackSecondary,
  toggleAlerts: () => document.getElementById('alertsPanel')?.classList.toggle('open'),
  setTab,
  setQuickFilter,
  clearTopFilters,
  sortBy,
  configurarAlertas,
  silenciarAlerta: (key) => { silenciarAlerta(key); render(); },
  reactivarAlerta: (key) => { reactivarAlerta(key); render(); },
  marcarSolLenteHoy,
  marcarLenteLlegoHoy,
  programarCirugia,
  marcarCirugiaRealizada,
  marcarFacturadaHoy,
  duplicarPaciente,
  eliminar,
  openSide,
  // Inline editing (llamado desde tabla)
  inlineEdit,
  inlineEditDate,
  inlineEditSel,
  commitInline,
  rowClick,
  rowCheck,
});


let sideDraft = null;
let sideDirty = false;
function markSideDirty(v = true) {
  sideDirty = v;
  const hint = document.getElementById('sideDirtyHint');
  if (hint) hint.style.display = v ? 'inline' : 'none';
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function initSideDraft(id) { const row = findRow(id); sideDraft = row ? clone(row) : null; markSideDirty(false); }
async function saveSideDraft(id) {
  if (!sideDraft || normalizeId(sideDraft.id) !== normalizeId(id)) return;
  const p = findRow(id); if (!p) return;
  Object.assign(p, clone(sideDraft));
  validarFila(p);
  await save(p);
  await ensureAdmisionForPatient(p).catch(e => console.warn('[admision] no se pudo sincronizar paciente', e));
  markSideDirty(false);
  render();
  openSide(id);
  toast('✓ Cambios guardados');
}
function cancelSideDraft(id) {
  markSideDirty(false);
  openSide(id);
  toast('Cambios descartados');
}
// ── Tabs ──────────────────────────────────────────────────────────────────
function setTab(tab, el) {
  if (!canView(tab)) { toast('No tenés permisos para este módulo'); return; }
  if (tab === 'kanban') resetModuleFilters(false);
  setCurrentTab(tab);
  document.body.classList.toggle('mode-operacion', tab === 'tabla');
  document.querySelectorAll('.tablink').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  ['tabView', 'pedirLenteView', 'kanView', 'calView', 'statsView', 'facturarView', 'waView', 'adminView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const tabMap = { tabla: 'tabView', pedirlente: 'pedirLenteView', kanban: 'kanView', calendario: 'calView', estadisticas: 'statsView', facturar: 'facturarView', whatsapp: 'waView', administracion: 'adminView' };
  const target = document.getElementById(tabMap[tab]);
  if (target) target.style.display = 'block';
  render();
}

// ── Quick filter ──────────────────────────────────────────────────────────
function setQuickFilter(f, el) {
  _setQuickFilter(f);
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  render();
}

// ── Limpiar filtros ───────────────────────────────────────────────────────
function clearTopFilters() {
  const els = ['q', 'fCli', 'fEst', 'fOS', 'fFechaCir'];
  els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sil = document.getElementById('showSilenced');
  if (sil) sil.checked = false;
  const hideFin = document.getElementById('hideFinalizadasSinAccion');
  if (hideFin) {
    hideFin.checked = false;
    setHideFinalizadasSinAccion(false);
  }
  const resetBtn = document.querySelector('#quickFilters .qf-btn[data-qf="TODOS"]') || document.querySelector('#quickFilters .qf-btn');
  setQuickFilter('TODOS', resetBtn);
}

function resetModuleFilters(renderNow = true) {
  ['q', 'fCli', 'fEst', 'fOS', 'fFechaCir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sil = document.getElementById('showSilenced');
  if (sil) sil.checked = false;
  const hideFin = document.getElementById('hideFinalizadasSinAccion');
  if (hideFin) hideFin.checked = false;
  setHideFinalizadasSinAccion(false);
  _setQuickFilter('TODOS');
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.toggle('active', b.dataset.qf === 'TODOS'));
  if (renderNow) render();
}

// ── Ordenar tabla ─────────────────────────────────────────────────────────
function sortBy(col) {
  if (sortCol === col) setSortDir(-sortDir);
  else { setSortCol(col); setSortDir(1); }
  render();
}

// ── Nuevo paciente ────────────────────────────────────────────────────────
async function nuevoModal() {
  if (!canEditPatient()) { toast('No tenés permisos para crear pacientes'); return; }
  const nid = String(DB.nid++);
  const newRow = {
    id: nid, clinica: 'CDU', nombre: '', dni: '', fnac: '', tel: '', dir: '',
    obraSocial: 'PAMI', afiliado: '', ojos: '2 ojos', ojo: 'OI', dioptria: '',
    fechaSolLente: '', fechaLlegaLente: '', recepLente: '', extraSutura: false, extraInyeccion: false, extraVitrectomia: false,
    fechaCir: '', hora: '', estadoCir: '', estadoFac: '', fechaFacturada: '',
    fechaCarga: hoyISO(), notas: ''
  };
  DB.rows.push(newRow);
  await save(newRow);
  render();
  openSide(nid);
  toast('Nuevo paciente creado — completá los datos');
}

// ── Eliminar paciente ─────────────────────────────────────────────────────
async function eliminar(id) {
  if (!canDelete()) { toast('No tenés permisos para eliminar'); return; }
  const p = findRow(id);
  const nombre = p?.nombre || `ID ${id}`;
  if (!confirm(`¿Eliminar a "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
  const sid = normalizeId(id);
  DB.rows = DB.rows.filter(x => normalizeId(x.id) !== sid);
  await deleteFromServer(sid);
  await save(null);
  closeSide();
  render();
  toast('Paciente eliminado');
}

// ── Actualizar campo de un paciente (desde panel lateral) ─────────────────
async function upd(id, field, val) {
  const p = findRow(id);
  if (!p) return;
  p[field] = val;
  validarFila(p);
  try {
    await save(p);
    renderStats();
    renderAlerts();
    renderTabla();
    if (normalizeId(selId) === normalizeId(id)) refreshSidePanel(p);
    toast('✓ Guardado');
  } catch (err) {
    console.error('Error guardando campo:', err);
    toast('⚠ Error al guardar');
  } finally {
    forceUnlockUI();
  }
}

// ── Duplicar paciente (segundo ojo) ───────────────────────────────────────
async function duplicarPaciente(id) {
  const orig = findRow(id);
  if (!orig) return;
  const otroOjo = orig.ojo === 'OD' ? 'OI' : 'OD';
  const yaExiste = DB.rows.some(x => x.id !== orig.id && String(x.dni || '').trim() === String(orig.dni || '').trim() && x.ojo === otroOjo);
  if (yaExiste) { toast(`Ya existe episodio para ${otroOjo}`); return; }
  const copia = { ...orig };
  orig.ojos = '2 ojos';
  copia.id = String(DB.nid++);
  copia.ojo = otroOjo;
  copia.ojos = '2 ojos';
  copia.fechaSolLente = '';
  copia.fechaLlegaLente = '';
  copia.recepLente = '';
  copia.fechaCir = '';
  copia.estadoCir = '';
  copia.estadoFac = '';
  copia.notas = `Copia de ${orig.nombre} — ${orig.ojo} → ${copia.ojo}`;
  DB.rows.push(copia);
  await save(copia);
  render();
  closeSide();
  setTimeout(() => openSide(copia.id), 100);
  toast(`✓ Duplicado para ojo ${copia.ojo}`);
}

// ── Acciones rápidas ──────────────────────────────────────────────────────
async function marcarSolLenteHoy(id) {
  const p = findRow(id); if (!p) return;
  p.fechaSolLente = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Sol. lente marcada hoy');
}

async function marcarLenteLlegoHoy(id) {
  const p = findRow(id); if (!p) return;
  p.fechaLlegaLente = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Lente llegó hoy');
}

async function programarCirugia(id) {
  const fecha = prompt('Fecha de cirugía (YYYY-MM-DD):');
  if (!fecha) return;
  const p = findRow(id); if (!p) return;
  p.fechaCir = fecha;
  await save(p); render(); openSide(id);
  toast('✓ Cirugía programada');
}

async function marcarCirugiaRealizada(id) {
  const p = findRow(id); if (!p) return;
  p.estadoCir = 'Realizada';
  if (!p.fechaCir) p.fechaCir = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Cirugía marcada como realizada');
}

async function marcarFacturadaHoy(id) {
  const p = findRow(id); if (!p) return;
  p.estadoFac = 'FACTURADA';
  p.fechaFacturada = hoyISO();
  await save(p); render(); openSide(id);
  toast('✓ Marcada como facturada');
}

// ── Inline editing ────────────────────────────────────────────────────────
function inlineEdit(e, id, field) {
  e.stopPropagation();
  const td = e.currentTarget;
  const p = findRow(id);
  if (!p) return;
  td.classList.add('editing');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = p[field] || '';
  input.autofocus = true;
  input.addEventListener('blur', ev => commitInline(ev, id, field));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') ev.target.blur();
    if (ev.key === 'Escape') { ev.target.dataset.cancel = '1'; ev.target.blur(); }
  });
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
}

function inlineEditDate(e, id, field) {
  e.stopPropagation();
  const td = e.currentTarget;
  const p = findRow(id);
  if (!p) return;
  td.classList.add('editing');
  const input = document.createElement('input');
  input.type = 'date';
  input.value = fdInput(p[field]);
  input.autofocus = true;
  input.addEventListener('blur', ev => commitInline(ev, id, field));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') ev.target.blur();
    if (ev.key === 'Escape') { ev.target.dataset.cancel = '1'; ev.target.blur(); }
  });
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
}

function inlineEditSel(e, id, field, opts) {
  e.stopPropagation();
  const td = e.currentTarget;
  const p = findRow(id);
  if (!p) return;
  td.classList.add('editing');
  const sel = document.createElement('select');
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o || '—';
    if (p[field] === o) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('blur', ev => commitInline(ev, id, field));
  sel.addEventListener('change', () => sel.blur());
  td.innerHTML = '';
  td.appendChild(sel);
  sel.focus();
}

async function commitInline(e, id, field) {
  const el = e.target;
  if (el.dataset.cancel) { render(); forceUnlockUI(); return; }
  const val = el.value;
  const p = findRow(id);
  if (!p) { render(); forceUnlockUI(); return; }
  p[field] = val;
  if (field === 'estadoFac') {
    if (String(val || '').toUpperCase() === 'FACTURADA' && !p.fechaFacturada) p.fechaFacturada = hoyISO();
    if (!val) p.fechaFacturada = '';
  }
  try {
    await save(p);
    render();
    toast('✓ Guardado');
  } catch (err) {
    console.error('Error guardando inline:', err);
    toast('⚠ Error al guardar');
    render();
  } finally {
    forceUnlockUI();
  }
}

// ── Row click / checkbox ──────────────────────────────────────────────────
function rowClick(e, id) {
  if (e.target.type === 'checkbox') return;
  const nid = normalizeId(id);
  if (selId === nid) { closeSide(); return; }
  if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return;
  setSelId(nid);
  render();
  openSide(nid);
}

function rowCheck(e, id) {
  e.stopPropagation();
  const nid = normalizeId(id);
  if (e.target.checked) { if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) { e.target.checked = false; return; } setSelId(nid); openSide(nid); }
  else { setSelId(null); closeSide(); }
  render();
}

// ── Exportaciones ─────────────────────────────────────────────────────────
async function exportarBackupJSON() {
  const data = JSON.stringify(DB, null, 2);
  downloadTextFile(`cirugias_backup_${nowTag()}.json`, data, 'application/json');
  toast('✓ Backup descargado');
}

async function importarBackupJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const rows = Array.isArray(data) ? data : (data.rows || []);
      if (!rows.length) { toast('⚠ El archivo no tiene filas válidas'); return; }
      if (!confirm(`¿Importar ${rows.length} pacientes?\n\nSe AGREGARÁN a los existentes.`)) return;
      rows.forEach(r => {
        r.id = String(r.id || Date.now());
        if (!DB.rows.find(x => x.id === r.id)) DB.rows.push(r);
      });
      await save(null);
      normalizarData();
      render();
      toast(`✓ Importados ${rows.length} pacientes`);
    } catch (err) {
      console.error(err);
      toast('⚠ Error al importar JSON: ' + err.message);
    }
  };
  input.click();
}

function exportarFiltradoExcel() {
  if (!canExport()) { toast('No tenés permisos para exportar'); return; }
  import('./state.js').then(({ filtered }) => {
    const rows = filtered();
    const cols = ['nombre', 'dni', 'fnac', 'tel', 'obraSocial', 'afiliado', 'clinica', 'ojo', 'dioptria', 'fechaSolLente', 'fechaLlegaLente', 'fechaCir', 'hora', 'estadoCir', 'estadoFac', 'fechaFacturada', 'extraSutura', 'extraInyeccion', 'extraVitrectomia', 'ecografiaImagen', 'ecografiaMes', 'notas'];
    toExcelFile(`cirugias_${nowTag()}.xlsx`, cols, rows.map(p => cols.map(c => p[c] ?? '')));
    toast('✓ Descargar Excel: vista actual');
  });
}

function exportarListos() {
  if (!canExport()) { toast('No tenés permisos para exportar'); return; }
  import('./state.js').then(({ DB: db, estado: est }) => {
    const listos = db.rows.filter(p => est(p) === 'PEDIR LENTE');
    if (!listos.length) { toast('No hay pacientes listos para pedir lente'); return; }
    const headers = ['Nombre', 'DNI', 'Obra social', 'N° afiliado', 'Clínica', 'Ojo', 'Dioptría'];
    const rows = listos.map(p => [p.nombre, p.dni, p.obraSocial, p.afiliado || '', p.clinica, p.ojo, getDioptria(p)]);
    toExcelFile(`listos_pedir_${nowTag()}.xlsx`, headers, rows);
    toast(`✓ Descargar Excel: ${listos.length} pacientes listos`);
  });
}

function exportarCirugiasDelDia() {
  if (!canExport()) { toast('No tenés permisos para exportar'); return; }
  import('./state.js').then(({ DB: db }) => {
    const fecha = prompt('Elegí fecha programada (YYYY-MM-DD):', hoyISO());
    if (!fecha) return;
    const rowsProgramadas = db.rows
      .filter(p => String(p.fechaCir || '').slice(0, 10) === fecha)
      .sort((a, b) => String(a.hora || a.hora_cirugia || '').localeCompare(String(b.hora || b.hora_cirugia || '')) || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
    if (!rowsProgramadas.length) { toast(`No hay cirugías programadas para ${fecha}`); return; }
    const headers = ['Nombre del paciente', 'DNI', 'Teléfono', 'Obra social', 'N° afiliado', 'Clínica', 'Ojo', 'Dioptría', 'Fecha programada', 'Hora'];
    const rows = rowsProgramadas.map(p => [p.nombre, p.dni, p.tel, p.obraSocial, p.afiliado || '', p.clinica, p.ojo, getDioptria(p), p.fechaCir, p.hora || p.hora_cirugia || '']);
    toExcelFile(`cirugias_programadas_${fecha}.xlsx`, headers, rows);
    toast(`✓ Descargar Excel: ${rowsProgramadas.length} cirugías programadas`);
  });
}

function exportarCirugiasFacturadas() {
  if (!canFacturar() && !canExport()) { toast('No tenés permisos para exportar facturadas'); return; }
  import('./state.js').then(({ DB: db, isFacturadoCompleto, getFechaFacturadaBase }) => {
    const desde = prompt('Desde fecha facturada (YYYY-MM-DD). Dejá vacío para sin inicio:', `${hoyISO().slice(0, 7)}-01`);
    if (desde === null) return;
    const hasta = prompt('Hasta fecha facturada (YYYY-MM-DD). Dejá vacío para sin fin:', hoyISO());
    if (hasta === null) return;
    const tipo = prompt('Filtro vitrectomía: escribí TODO, CON o SIN', 'TODO');
    if (tipo === null) return;
    const modo = String(tipo || 'TODO').trim().toUpperCase();
    const rowsFact = db.rows.filter(p => {
      if (!isFacturadoCompleto(p.estadoFac)) return false;
      const f = getFechaFacturadaBase(p);
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (modo === 'CON' && !p.extraVitrectomia) return false;
      if (modo === 'SIN' && p.extraVitrectomia) return false;
      return true;
    }).sort((a, b) => String(getFechaFacturadaBase(a)).localeCompare(String(getFechaFacturadaBase(b))) || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
    if (!rowsFact.length) { toast('No hay cirugías facturadas con ese filtro'); return; }
    const headers = ['Nombre del paciente', 'DNI', 'Número de afiliado', 'Obra social', 'Fecha facturada', 'Fecha programada', 'Hora', 'Clínica', 'Ojo', 'Vitrectomía'];
    const rows = rowsFact.map(p => [p.nombre, p.dni, p.afiliado || '', p.obraSocial || '', getFechaFacturadaBase(p), p.fechaCir || '', p.hora || p.hora_cirugia || '', p.clinica || '', p.ojo || '', p.extraVitrectomia ? 'Sí' : 'No']);
    const suf = modo === 'CON' ? '_con_vitrectomia' : modo === 'SIN' ? '_sin_vitrectomia' : '';
    toExcelFile(`cirugias_facturadas${suf}_${nowTag()}.xlsx`, headers, rows);
    toast(`✓ Descargar Excel: ${rowsFact.length} facturada(s)`);
  });
}

// ── Modales ───────────────────────────────────────────────────────────────
function cerrarLentessModal() {
  const modal = document.getElementById('lentessModal');
  if (modal) modal.style.display = 'none';
}
function abrirStockModal() {
  renderStockModal();
  const modal = document.getElementById('stockModal');
  if (modal) modal.style.display = 'flex';
}
function closeStockModal() {
  const modal = document.getElementById('stockModal');
  if (modal) modal.style.display = 'none';
}
function closeExport() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.style.display = 'none';
}
function goBackSecondary() {
  if (window.history.length > 1) window.history.back();
  else { closeSide(); closeExport(); closeStockModal(); }
}


// ── Configurar alertas ────────────────────────────────────────────────────
function configurarAlertas() {
  const defs = [
    ['Demora de lente (pedido sin llegada)', 'lens_delay_warn_days', 'lens_delay_crit_days'],
    ['Lente llegó y no se programó', 'lens_arrived_not_scheduled_warn_days', 'lens_arrived_not_scheduled_crit_days'],
    ['Cirugía realizada sin facturar', 'billing_not_done_warn_days', 'billing_not_done_crit_days'],
    ['Facturada y falta segundo ojo', 'second_eye_missing_warn_days', 'second_eye_missing_crit_days'],
  ];
  for (const [label, warnKey, critKey] of defs) {
    const currentWarn = Number(SETTINGS[warnKey] || 0);
    const currentCrit = Number(SETTINGS[critKey] || 0);
    const dias = prompt(
      `${label}\nDías para alerta (aviso,crítico):`,
      `${currentWarn},${currentCrit}`
    );
    if (dias === null) return;
    const [w, c] = String(dias).split(',').map(n => parseInt(n.trim(), 10));
    if (Number.isFinite(w) && w > 0) SETTINGS[warnKey] = w;
    if (Number.isFinite(c) && c > 0) SETTINGS[critKey] = c;
  }
  import('./state.js').then(({ saveSettings }) => { saveSettings(); render(); });
  toast('✓ Umbrales de alertas actualizados');
}

// ── Delegación de eventos ─────────────────────────────────────────────────
function initEventDelegation() {
  if (window.__cirugiasEventsBound) return;
  window.__cirugiasEventsBound = true;
  // Tabla: click en fila
  document.getElementById('tbody')?.addEventListener('click', e => {
    const actionBtn = e.target.closest('[data-row-action][data-open-side]');
    if (actionBtn) {
      e.stopPropagation();
      const id = actionBtn.dataset.openSide;
      const action = actionBtn.dataset.rowAction;
      if (action === 'programar') { programarCirugia(id); return; }
      if (action === 'realizada') { marcarCirugiaRealizada(id); return; }
      if (action === 'facturar') { marcarFacturadaHoy(id); return; }
      if (action === 'historial') {
        if (!canViewRowHistory()) { toast('No tenés permisos para ver historial'); return; }
        const row = findRow(id);
        if (row) openRowHistoryModal(row);
        return;
      }
    }
    const openBtn = e.target.closest('[data-open-side]');
    if (openBtn) {
      e.stopPropagation();
      openSide(openBtn.dataset.openSide);
      return;
    }
    const tr = e.target.closest('tr[data-row-click]');
    if (tr) {
      const id = tr.dataset.rowClick;
      if (e.target.type === 'checkbox') return;
      const nid = normalizeId(id);
      if (selId === nid) { closeSide(); return; }
      if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return;
      setSelId(nid);
      render();
      openSide(nid);
    }
    // Checkbox
    const cbx = e.target.closest('.cbx');
    if (cbx) {
      e.stopPropagation();
      const id = cbx.dataset.rowId;
      if (!id) return;
      const nid = normalizeId(id);
      if (cbx.checked) { if (sideDirty && normalizeId(selId) !== normalizeId(nid) && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) { cbx.checked = false; return; } setSelId(nid); openSide(nid); }
      else { setSelId(null); closeSide(); }
      render();
    }
  });

  // Tabla: doble clic para editar inline
  document.getElementById('tbody')?.addEventListener('dblclick', e => {
    const td = e.target.closest('td');
    if (!td) return;
    if (td.dataset.inlineEdit) {
      inlineEdit(e, td.dataset.inlineEdit, td.dataset.field);
    } else if (td.dataset.inlineDate) {
      inlineEditDate(e, td.dataset.inlineDate, td.dataset.field);
    } else if (td.dataset.inlineSel) {
      const opts = td.dataset.opts.split('|');
      inlineEditSel(e, td.dataset.inlineSel, td.dataset.field, opts);
    }
  });

  // Tabla: sort headers
  document.getElementById('mainThead')?.addEventListener('click', e => {
    const div = e.target.closest('[data-sort]');
    if (div) sortBy(div.dataset.sort);
  });

  // Panel lateral: cambio en inputs/selects
  document.getElementById('sideBody')?.addEventListener('change', e => {
    const el = e.target;
    const id = el.dataset.rowId;
    const field = el.dataset.field;
    if (!id || !field) return;
    if (!sideDraft || normalizeId(sideDraft.id) !== normalizeId(id)) initSideDraft(id);
    sideDraft[field] = el.type === 'checkbox' ? !!el.checked : el.value;
    if (field === 'estadoFac') {
      if (String(sideDraft.estadoFac || '').toUpperCase() === 'FACTURADA' && !sideDraft.fechaFacturada) sideDraft.fechaFacturada = hoyISO();
      if (!sideDraft.estadoFac) sideDraft.fechaFacturada = '';
      const ff = document.querySelector(`#sideBody [data-row-id="${CSS.escape(id)}"][data-field="fechaFacturada"]`);
      if (ff) ff.value = sideDraft.fechaFacturada || '';
    }
    if (field === 'fechaCir' && !sideDraft.fechaCir) {
      sideDraft.hora = '';
      const hf = document.querySelector(`#sideBody [data-row-id="${CSS.escape(id)}"][data-field="hora"]`);
      if (hf) hf.value = '';
    }
    validarFila(sideDraft);
    markSideDirty(true);
  });

  // Panel lateral: silenciar alerta y borrar campos puntuales
  document.getElementById('sideBody')?.addEventListener('click', e => {
    const item = e.target.closest('[data-sil-key]');
    if (item) { silenciarAlerta(item.dataset.silKey); render(); return; }
    const clearBtn = e.target.closest('[data-clear-field]');
    if (!clearBtn) return;
    const id = clearBtn.dataset.rowId;
    const field = clearBtn.dataset.clearField;
    if (!id || !field) return;
    if (!sideDraft || normalizeId(sideDraft.id) !== normalizeId(id)) initSideDraft(id);
    sideDraft[field] = '';
    const input = document.querySelector(`#sideBody [data-row-id="${CSS.escape(id)}"][data-field="${CSS.escape(field)}"]`);
    if (input) input.value = '';
    validarFila(sideDraft);
    markSideDirty(true);
  });

  // Panel lateral (foot): acciones rápidas y eliminar
  document.getElementById('sideFoot')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-qa-action]');
    if (!btn) return;
    const id = btn.dataset.qaId;
    const action = btn.dataset.qaAction;
    if (action === 'solLenteHoy') await marcarSolLenteHoy(id);
    else if (action === 'lenteLlegoHoy') await marcarLenteLlegoHoy(id);
    else if (action === 'programarCirugia') await programarCirugia(id);
    else if (action === 'cirugiaRealizada') await marcarCirugiaRealizada(id);
    else if (action === 'facturadaHoy') await marcarFacturadaHoy(id);
    else if (action === 'guardarCambios') await saveSideDraft(id);
    else if (action === 'cancelarCambios') cancelSideDraft(id);
    else if (action === 'duplicar') await duplicarPaciente(id);
    else if (action === 'eliminar') await eliminar(id);
  });

  // Panel alertas: abrir paciente
  document.getElementById('alertsList')?.addEventListener('click', e => {
    const row = e.target.closest('[data-open-side]');
    if (row && !e.target.closest('.ar-sil-btn')) openSide(row.dataset.openSide);
    const silBtn = e.target.closest('.ar-sil-btn');
    if (silBtn) {
      e.stopPropagation();
      const key = silBtn.dataset.alertKey;
      const wasSilenced = silBtn.dataset.silenced === '1';
      if (wasSilenced) reactivarAlerta(key);
      else silenciarAlerta(key);
      render();
    }
  });

  // Kanban: abrir paciente
  document.getElementById('kanView')?.addEventListener('click', e => {
    const card = e.target.closest('[data-open-side]');
    if (card) openSide(card.dataset.openSide);
  });

  // Overlay cierra panel
  document.getElementById('sideOverlay')?.addEventListener('click', () => { if (sideDirty && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return; closeSide(); });
  document.getElementById('btnSideBack')?.addEventListener('click', () => { if (sideDirty && !confirm('Hay cambios sin guardar. ¿Descartar cambios?')) return; closeSide(); });

  // Filtros
  document.getElementById('q')?.addEventListener('input', () => {
    clearTimeout(window._filterTimer);
    window._filterTimer = setTimeout(render, 180);
  });
  ['fCli', 'fEst', 'fOS', 'fFechaCir', 'showSilenced', 'hideFinalizadasSinAccion'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (id === 'hideFinalizadasSinAccion') {
        setHideFinalizadasSinAccion(!!document.getElementById('hideFinalizadasSinAccion')?.checked);
      }
      render();
      const saved = {
        fCli: document.getElementById('fCli')?.value || '',
        fEst: document.getElementById('fEst')?.value || '',
        fOS: document.getElementById('fOS')?.value || '',
        fFechaCir: document.getElementById('fFechaCir')?.value || '',
        showSilenced: document.getElementById('showSilenced')?.checked || false
      };
      localStorage.setItem('cirugias_saved_filters', JSON.stringify(saved));
    });
  });

  // Quick filter buttons
  document.getElementById('quickFilters')?.addEventListener('click', e => {
    const btn = e.target.closest('.qf-btn');
    if (btn) setQuickFilter(btn.dataset.qf || btn.textContent.trim(), btn);
  });

  // Alert filter buttons
  document.querySelector('.alerts-filters')?.addEventListener('click', e => {
    const btn = e.target.closest('.af-btn');
    if (btn) {
      const id = btn.id.replace('af-', '');
      import('./render.js').then(({ setAlertFilter }) => setAlertFilter(id, btn));
    }
  });

  // Tab buttons
  document.querySelector('.tabrow')?.addEventListener('click', e => {
    const btn = e.target.closest('.tablink');
    if (!btn) return;
    const tab = btn.dataset.tab || 'tabla';
    setTab(tab, btn);
  });



  // Botones de cabecera y modales
  document.getElementById('connectorBadge')?.addEventListener('click', probarConexion);
  document.getElementById('btnNuevo')?.addEventListener('click', nuevoModal);
  document.getElementById('btnSync')?.addEventListener('click', sincronizarAhora);
  document.getElementById('btnLentess')?.addEventListener('click', abrirLentessModal);
  document.getElementById('toggleKpisBtn')?.addEventListener('click', toggleKpis);
  document.getElementById('btnConfigurarURL')?.addEventListener('click', configurarURL);
  document.getElementById('btnExportarListos')?.addEventListener('click', exportarListos);
  document.getElementById('btnExportarDia')?.addEventListener('click', exportarCirugiasDelDia);
  document.getElementById('btnExportarFacturadas')?.addEventListener('click', exportarCirugiasFacturadas);
  document.getElementById('btnStock')?.addEventListener('click', abrirStockModal);
  document.getElementById('btnExportarVista')?.addEventListener('click', exportarFiltradoExcel);
  document.getElementById('btnBackup')?.addEventListener('click', exportarBackupJSON);
  document.getElementById('btnImportar')?.addEventListener('click', importarBackupJSON);
  document.getElementById('btnCloseHistory')?.addEventListener('click', closeRowHistoryModal);
  document.getElementById('btnCloseHistory2')?.addEventListener('click', closeRowHistoryModal);
  document.getElementById('historyModal')?.addEventListener('click', e => { if (e.target.id === 'historyModal') closeRowHistoryModal(); });
  document.getElementById('btnReparar')?.addEventListener('click', repararCache);
  document.getElementById('btnConfigAlertas')?.addEventListener('click', configurarAlertas);
  document.getElementById('btnLimpiarFiltros')?.addEventListener('click', clearTopFilters);
  document.getElementById('alertsToggle')?.addEventListener('click', () => {
    document.getElementById('alertsPanel')?.classList.add('open');
    import('./render.js').then(({ setAlertFilter }) => setAlertFilter('criticas', document.getElementById('af-criticas')));
  });
  document.getElementById('btnCloseAlerts')?.addEventListener('click', () => document.getElementById('alertsPanel')?.classList.remove('open'));
  document.getElementById('btnCloseStock')?.addEventListener('click', closeStockModal);
  document.getElementById('btnCloseStock2')?.addEventListener('click', closeStockModal);
  document.getElementById('btnCloseLentess')?.addEventListener('click', cerrarLentessModal);
  document.getElementById('btnCloseRecetas')?.addEventListener('click', cerrarModalRecetas);
  document.getElementById('btnCloseRecetas2')?.addEventListener('click', cerrarModalRecetas);
  document.getElementById('btnCloseLentess2')?.addEventListener('click', cerrarLentessModal);
  document.getElementById('btnCloseExport')?.addEventListener('click', closeExport);
  document.getElementById('btnCloseExport2')?.addEventListener('click', closeExport);
  document.getElementById('btnCopyExcel')?.addEventListener('click', copyExcel);
  document.getElementById('btnDownloadListos')?.addEventListener('click', downloadExcelListos);
  document.getElementById('exportModal')?.addEventListener('click', e => { if (e.target.id === 'exportModal') closeExport(); });
  document.getElementById('stockModal')?.addEventListener('click', e => { if (e.target.id === 'stockModal') closeStockModal(); });
  document.getElementById('lentessModal')?.addEventListener('click', e => { if (e.target.id === 'lentessModal') cerrarLentessModal(); });
  document.getElementById('recetasModal')?.addEventListener('click', e => { if (e.target.id === 'recetasModal') cerrarModalRecetas(); });

  document.addEventListener('click', e => {
    document.querySelectorAll('details.more-menu[open], details.advanced-filters[open]').forEach(d => {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
  });
  document.querySelectorAll('details.more-menu .more-menu-list button').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('details')?.removeAttribute('open'));
  });

  // Resize
  window.addEventListener('resize', updateStickyMetrics);
}



function xlsxEscapeXml(v) {
  return String(v ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}
function xlsxColName(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function xlsxCell(v, r, c) {
  const ref = `${xlsxColName(c)}${r}`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${xlsxEscapeXml(v)}</t></is></c>`;
}
function xlsxSheetXml(headers, rows) {
  const all = [headers, ...rows];
  const body = all.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => xlsxCell(v, ri + 1, ci + 1)).join('')}</row>`).join('');
  const maxCol = xlsxColName(Math.max(headers.length, 1));
  const maxRow = Math.max(all.length, 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${maxCol}${maxRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}
function crc32(str) {
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  }));
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
function toExcelFile(filename, headers, rows) {
  const files = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Control de Cirugías</Application></Properties>` },
    { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Control de Cirugías</dc:creator></cp:coreProperties>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/worksheets/sheet1.xml', content: xlsxSheetXml(headers, rows) },
  ];
  const blob = new Blob([makeZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function buildTSVListos() {
  const listos = DB.rows.filter(p => estado(p) === 'PEDIR LENTE');
  return 'clinica\tnombre\tdni\tobra_social\tafiliado\tojo\tdioptria\n' +
    listos.map(p => [p.clinica, p.nombre, p.dni, p.obraSocial, p.afiliado || '', p.ojo, getDioptria(p)].join('\t')).join('\n');
}

function copyExcel() {
  navigator.clipboard.writeText(buildTSVListos()).then(() => toast('Datos copiados (TSV para Excel)'));
}

function downloadExcelListos() {
  const listos = DB.rows.filter(p => estado(p) === 'PEDIR LENTE');
  toExcelFile('listos_lente.xlsx', ['Clínica','Nombre','DNI','O. Social','N° Afiliado','Ojo','Dioptría'], listos.map(p => [p.clinica, p.nombre, p.dni, p.obraSocial, p.afiliado || '', p.ojo, getDioptria(p)]));
  toast('Excel descargado');
}

function renderStockModal() {
  DB.lensStock = DB.lensStock || [];
  const rows = [...DB.lensStock].sort((a, b) => (a.model || '').localeCompare(b.model || '') || String(a.dioptria || '').localeCompare(String(b.dioptria || '')));
  const body = document.getElementById('stockBody');
  if (!body) return;
  body.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn primary" id="btnAddStockInline">+ Cargar stock</button></div>
    ${rows.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${['Modelo','Dioptría','Stock','Estado'].map(h => `<th style="padding:7px 10px;background:#f1f5f9;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e2e8f0">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(x => `<tr>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${x.model || ''}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${x.dioptria || ''}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${x.stock || 0}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:${(x.stock || 0) <= 1 ? '#dc2626' : '#059669'}">${(x.stock || 0) <= 1 ? 'CRÍTICO' : 'OK'}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="empty" style="padding:20px">Sin stock cargado.</div>'}`;
  document.getElementById('btnAddStockInline')?.addEventListener('click', cargarStockLente);
}

function cargarStockLente() {
  const model = prompt('Modelo de lente:'); if (!model) return;
  const dioptria = prompt('Dioptría:'); if (!dioptria) return;
  const stock = parseInt(prompt('Stock a cargar:', '1') || '0', 10);
  DB.lensStock = DB.lensStock || [];
  let it = DB.lensStock.find(x => x.model === model && x.dioptria === dioptria);
  if (!it) { it = { model, dioptria, stock: 0 }; DB.lensStock.push(it); }
  it.stock += Math.max(stock, 0);
  localStorage.setItem('cirugias_cache', JSON.stringify(DB));
  idbSet('cirugias_cache', DB);
  renderStockModal();
  render();
  toast('Stock actualizado');
}

function lentessEligibility(p) {
  const faltan = [];
  if (String(p.obraSocial || '').trim().toUpperCase() !== 'PAMI') faltan.push('no PAMI');
  if (estado(p) !== 'PEDIR LENTE') faltan.push('estado no es PEDIR LENTE');
  if (cleanDigits(p.afiliado || '').length < 8) faltan.push('afiliado');
  if (!String(p.ojo || '').trim()) faltan.push('ojo');
  if (!String(getDioptria(p) || '').trim()) faltan.push('dioptría');
  return { ok: faltan.length === 0, faltan };
}

function getFilteredRowsForLentess() {
  return filtered().map(p => ({ row: p, check: lentessEligibility(p) }));
}

function buildLentessPayload(items) {
  return items.filter(x => x.check.ok).map(({ row: p }) => ({
    sourceId: p.id,
    nombre: String(p.nombre || '').trim(),
    afiliado: cleanDigits(p.afiliado || ''),
    ojo: String(p.ojo || '').trim().toUpperCase(),
    lio: String(getDioptria(p) || '').trim(),
    clinica: p.clinica || ''
  }));
}

let LENTESS_CTX = { sourceRows: [], validRows: [] };
const LENTESS_CREDS_KEY = 'pami_lentess_creds';
let LENTESS_RUNNING = false;

function getPamiLentessCreds() {
  try { return JSON.parse(localStorage.getItem(LENTESS_CREDS_KEY) || '{}') || {}; } catch (_) { return {}; }
}

async function abrirLentessModal() {
  const sourceRows = getFilteredRowsForLentess();
  const validRows = buildLentessPayload(sourceRows);
  if (!sourceRows.length) { toast('No hay pacientes en el filtro actual'); return; }
  const creds = getPamiLentessCreds();
  const entregas = await loadLentessEntregas().catch(() => []);
  LENTESS_CTX = { sourceRows, validRows, entregas };
  const body = document.getElementById('lentessBody');
  if (!body) return;
  body.innerHTML = `
    <div id="lentessJobStatus" style="font-size:12px;color:#64748b;margin-bottom:8px">Listo para ejecutar en conector local.</div>
    <p style="font-size:12px;color:#6b7280;margin-bottom:8px">Filtradas en pantalla: <b>${sourceRows.length}</b> · Aptas Lentess: <b>${validRows.length}</b>. Podés destildar manualmente pacientes antes de ejecutar.</p>
    <label style="font-size:12px;display:block;margin:0 0 10px">Fecha solicitud a registrar
      <input id="lentessFechaSol" class="input" type="date" value="${hoyISO()}" style="width:220px;margin-top:4px">
    </label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:0 0 10px">
      <label style="font-size:12px">Usuario PAMI
        <input id="lentessUser" class="input" type="text" value="${escapeAttr(creds.user || '')}" style="width:100%;margin-top:4px">
      </label>
      <label style="font-size:12px">Contraseña PAMI
        <input id="lentessPass" class="input" type="password" value="${escapeAttr(creds.pass || '')}" style="width:100%;margin-top:4px">
      </label>
    </div>
    <label style="font-size:12px;display:inline-flex;gap:6px;align-items:center;margin-bottom:10px">
      <input id="lentessRemember" type="checkbox" ${(creds.user || creds.pass) ? 'checked' : ''}> guardar credenciales en este navegador
    </label>
    <div style="border:1px solid #dbe5f0;background:#f8fbff;border-radius:12px;padding:10px;margin:0 0 10px">
      <label style="font-size:12px;font-weight:700;display:block">Lugar de entrega Lentess
        <select id="lentessEntregaId" class="input" style="width:100%;margin-top:4px">
          <option value="">Seleccionar según sede de pacientes</option>
          ${entregas.map(e => `<option value="${escapeAttr(e.id)}">${escapeHtml(e.clinica)} · ${escapeHtml(e.nombre)} · ${escapeHtml(e.fraseLugar)}</option>`).join('')}
        </select>
      </label>
      <div style="font-size:11px;color:#64748b;margin-top:5px">No se permite mezclar pacientes de distintas sedes/lugares en la misma ejecución.</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin:6px 0 8px">
      <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input id="lentessChkAll" type="checkbox" ${validRows.length ? 'checked' : ''}> seleccionar aptos</label>
      <span id="lentessSelCount" style="font-size:12px;color:#475569"></span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>${['Enviar','Nombre','Afiliado','Ojo','Lio/Dioptría','Clínica','Estado','Validación'].map(h => `<th style="padding:7px 10px;background:#f1f5f9;text-align:left;font-size:11px;color:#6b7280;border-bottom:1px solid #e2e8f0">${h}</th>`).join('')}</tr></thead>
      <tbody>${sourceRows.map(({ row, check }) => {
        const payload = buildLentessPayload([{ row, check }])[0];
        return `<tr>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9"><input type="checkbox" class="lentess-row" data-id="${escapeAttr(row.id)}" ${check.ok ? 'checked' : 'disabled'}></td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${escapeHtml(row.nombre || '—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${escapeHtml(payload?.afiliado || cleanDigits(row.afiliado || '') || '—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${escapeHtml(row.ojo || '—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${escapeHtml(getDioptria(row) || '—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${escapeHtml(row.clinica || '—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${escapeHtml(estado(row) || '—')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:${check.ok ? '#059669' : '#dc2626'}">${check.ok ? 'Apto' : escapeHtml(check.faltan.join(', '))}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn primary" id="btnRunLentess">▶ Ejecutar Lentess seleccionados</button>
    </div>`;
  const updateCount = () => {
    const n = body.querySelectorAll('.lentess-row:checked').length;
    const el = document.getElementById('lentessSelCount');
    if (el) el.textContent = `${n} seleccionado(s)`;
  };
  body.querySelectorAll('.lentess-row').forEach(chk => chk.addEventListener('change', updateCount));
  document.getElementById('lentessChkAll')?.addEventListener('change', e => {
    body.querySelectorAll('.lentess-row:not(:disabled)').forEach(chk => { chk.checked = e.target.checked; });
    updateCount();
  });
  updateCount();
  document.getElementById('btnRunLentess')?.addEventListener('click', descargarScriptLentess);
  const modal = document.getElementById('lentessModal');
  if (modal) modal.style.display = 'flex';
}

function lentessGuardarCreds() {
  const remember = !!document.getElementById('lentessRemember')?.checked;
  const user = String(document.getElementById('lentessUser')?.value || '').trim();
  const pass = String(document.getElementById('lentessPass')?.value || '').trim();
  if (!remember) { localStorage.removeItem(LENTESS_CREDS_KEY); return { user, pass }; }
  localStorage.setItem(LENTESS_CREDS_KEY, JSON.stringify({ user, pass }));
  return { user, pass };
}

async function descargarScriptLentess() {
  if (LENTESS_RUNNING) return;
  const checkedIds = new Set(Array.from(document.querySelectorAll('#lentessBody .lentess-row:checked')).map(chk => String(chk.dataset.id || '')));
  const rows = (LENTESS_CTX.validRows || []).filter(r => checkedIds.has(String(r.sourceId)));
  if (!rows.length) { toast('Seleccioná al menos un paciente apto para Lentess'); return; }
  const cfg = lentessGuardarCreds();
  if (!cfg.user || !cfg.pass) { toast('Completar usuario y contraseña PAMI'); return; }
  const fechaSol = String(document.getElementById('lentessFechaSol')?.value || '').trim() || hoyISO();
  const sedesSeleccionadas = [...new Set(rows.map(r => String(r.clinica || '').trim()).filter(Boolean))];
  if (sedesSeleccionadas.length !== 1) { toast('Lentess: no mezcles pacientes de distintas sedes en una misma ejecución'); return; }
  const entregas = LENTESS_CTX.entregas || await loadLentessEntregas().catch(() => []);
  const entregaId = String(document.getElementById('lentessEntregaId')?.value || '').trim();
  const entrega = entregaForClinica(entregas, sedesSeleccionadas[0], entregaId);
  if (!entrega) { toast(`Configurá un lugar de entrega Lentess para la sede ${sedesSeleccionadas[0]} en Administración`); return; }
  if (String(entrega.clinica || '').trim() !== sedesSeleccionadas[0]) { toast('El lugar de entrega elegido no corresponde a la sede seleccionada'); return; }
  const payload = { entrega, credenciales: { user: cfg.user, pass: cfg.pass }, pacientes: rows.map(r => ({ sourceId: r.sourceId, nombre: r.nombre, afiliado: r.afiliado, ojo: r.ojo, lio: r.lio, clinica: r.clinica })) };
  const runBtn = document.getElementById('btnRunLentess');
  LENTESS_RUNNING = true;
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = '⏳ Ejecutando Lentess...'; }
  renderJobStatus('lentessJobStatus', 'run', '⏳ Verificando conector...');
  connectorStartJob('lentess', payload)
    .then(jobId => {
      toast('✅ Lentess: proceso iniciado');
      renderJobStatus('lentessJobStatus', 'run', `⚙️ Procesando solicitudes... (job ${String(jobId).slice(0, 8)})`);
      return connectorPollJob(jobId, s => {
        const label = s._label || `⚙️ ${s.status || 'en curso'}`;
        renderJobStatus('lentessJobStatus', 'run', label);
      });
    })
    .then(() => {
      rows.forEach(r => {
        const row = findRow(r.sourceId);
        if (row) row.fechaSolLente = fechaSol;
      });
      return Promise.all(rows.map(r => {
        const row = findRow(r.sourceId);
        return row ? save(row) : Promise.resolve();
      }));
    })
    .then(() => {
      toast('✅ Lentess completado correctamente');
      renderJobStatus('lentessJobStatus', 'ok', '✅ Solicitudes seleccionadas guardadas y fecha aplicada.');
      render();
    })
    .catch(err => {
      const msg = String(err?.message || 'Error de ejecución');
      toast('❌ ' + msg);
      renderJobStatus('lentessJobStatus', /no detectado|no está corriendo|iniciar/i.test(msg) ? 'off' : 'err', `❌ ${msg}`);
    })
    .finally(() => {
      LENTESS_RUNNING = false;
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = '▶ Ejecutar Lentess seleccionados'; }
    });
}

// ── Restaurar filtros guardados ───────────────────────────────────────────
function restoreFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem('cirugias_saved_filters') || '{}');
    ['fCli', 'fEst', 'fOS', 'fFechaCir'].forEach(id => {
      if (saved[id] !== undefined) {
        const el = document.getElementById(id);
        if (el) el.value = saved[id];
      }
    });
    if (saved.showSilenced !== undefined) {
      const el = document.getElementById('showSilenced');
      if (el) el.checked = !!saved.showSilenced;
    }
    const hf = document.getElementById('hideFinalizadasSinAccion');
    if (hf) hf.checked = hideFinalizadasSinAccion;
  } catch (_) { }
}

// ── Punto de entrada: arranca la app ─────────────────────────────────────
window.__appStarted = false;
window.startOriginalApp = async function () {
  if (window.__appStarted || !window.CURRENT_USER) return;
  window.__appStarted = true;

  // 1. Escuchar evento de Firestore
  window.addEventListener('firestoreReady', activateFirestoreIfReady);

  // 2. Cargar caché local inmediatamente
  try {
    const cached = localStorage.getItem('cirugias_cache') || await idbGet('cirugias_cache');
    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      if (parsed && Array.isArray(parsed.rows)) {
        setDB(parsed);
        showSyncBadge('⟳ Cargando desde caché...', 'blue');
      }
    }
  } catch (e) { console.warn('[Init] error leyendo caché:', e.message); }

  // 3. Normalizar y renderizar con datos locales
  normalizarData();
  backupDiario();
  restoreKpisPref();
  restoreFilters();
  applyRoleUi();
  initEventDelegation();
  document.body.classList.add('mode-operacion');
  updateStickyMetrics();
  render();
  loadAdmisionConfig().then(() => render()).catch(e => console.warn('[admision] no se pudo cargar configuración', e));

  // 4. Conectar Firestore en paralelo
  if (window.firestoreConnector) {
    activateFirestoreIfReady();
  } else {
    showSyncBadge('⟳ Esperando Firebase...', 'blue');
    setTimeout(async () => {
      if (!FIRESTORE_ENABLED) {
        await loadFromServer();
        normalizarData();
        render();
      }
    }, 6000);
  }
};

function applyRoleUi() {
  const btnNuevo = document.getElementById('btnNuevo');
  if (btnNuevo) btnNuevo.style.display = canEditPatient() ? '' : 'none';
  const btnImportar = document.getElementById('btnImportar');
  if (btnImportar) btnImportar.style.display = canManageUsers() ? '' : 'none';
  const btnBackup = document.getElementById('btnBackup');
  if (btnBackup) btnBackup.textContent = '💾 Descargar backup de seguridad';
  document.querySelectorAll('.tablink').forEach(btn => {
    const tab = btn.dataset.tab || '';
    btn.style.display = canView(tab) ? '' : 'none';
  });
}
window.addEventListener('authReady', () => {
  if (!window.__appStarted && window.CURRENT_USER) window.startOriginalApp();
});
if (window.CURRENT_USER && !window.__appStarted) {
  window.startOriginalApp();
}
window.addEventListener('side:opened', e => initSideDraft(e.detail.id));
  window.addEventListener('side:closed', () => { sideDraft = null; markSideDirty(false); });
