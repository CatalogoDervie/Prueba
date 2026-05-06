// render.js — Funciones de render: tabla, panel lateral, alertas, kanban, calendario

'use strict';

import { escapeHtml, escapeAttr, jsq, fd, fdInput, toast } from './utils.js';
import {
  DB, selId, setSelId, sortCol, sortDir, setSortCol, setSortDir,
  currentTab, quickFilter, quickFilterLabel, SETTINGS, ALERT_SILENCES,
  estado, stateKey, WORKFLOW_KEYS, alertas, proximaAccion, filtered, duplicateNewestIds,
  readDomFilterSnapshot,
  secondEyeMissing, getOtherEyeRow, isFacturadoCompleto, getDioptria, clinicaClass, practicasExtrasTexto, getEstadoCirCalculado, getFechaFacturadaBase,
  bc, estadoLabelCanon, estadoLabelNorm, normalizeId, findRow,
  validarFila, silenciarAlerta, reactivarAlerta, isSilenced,
  backupDiario
} from './state.js';
import { hoyISO, diffDays, toDateOnly } from './utils.js';
import { canViewRowHistory } from './authz.js';
import { getAdmisionOptions } from './admision-config.js';

// ── Columnas de la tabla principal ────────────────────────────────────────
export const MAIN_TABLE_COLUMNS = [
  { key: 'paciente', label: 'Paciente', width: '26%', sortable: true, sortKey: 'nombre' },
  { key: 'ojo', label: 'Ojo', width: '8%', sortable: true, sortKey: 'ojo' },
  { key: 'obraSocial', label: 'Obra social', width: '13%', sortable: true, sortKey: 'obraSocial' },
  { key: 'estadoActual', label: 'Estado actual', width: '16%', sortable: true, sortKey: 'estadoActual' },
  { key: 'proximaAccion', label: 'Próxima acción', width: '17%', sortable: true, sortKey: 'proximaAccion' },
  { key: 'fechaClave', label: 'Fecha clave', width: '10%', sortable: true, sortKey: 'fechaClave' },
  { key: 'acciones', label: 'Acciones', width: '10%' },
];

// ── Render principal ──────────────────────────────────────────────────────
export function render() {
  refreshAdmisionFilterOptions();
  refreshEstadoFilterOptions();
  renderStats();
  renderQueueRail();
  renderActiveFiltersBar();
  renderAlerts();
  if (currentTab === 'tabla') renderTabla();
  else if (currentTab === 'pedirlente') renderPedirLenteLazy();
  else if (currentTab === 'kanban') renderKanban();
  else if (currentTab === 'calendario') renderCalendario();
  else if (currentTab === 'estadisticas') renderEstadisticasLazy();
  else if (currentTab === 'facturar') renderFacturarLazy();
  else if (currentTab === 'whatsapp') renderWhatsAppTab();
  else if (currentTab === 'administracion') renderAdministracionLazy();
  else renderTabla();
}


function fillSelectOptions(selectId, items, firstLabel) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value || '';
  const opts = [''].concat((items || []).filter(Boolean));
  sel.innerHTML = opts.map((v, idx) => idx === 0 ? `<option value="">${escapeHtml(firstLabel)}</option>` : `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
  if (current && opts.includes(current)) sel.value = current;
}
function refreshAdmisionFilterOptions() {
  const cfg = getAdmisionOptions();
  fillSelectOptions('fCli', cfg.sedes || [], 'Todas las clínicas');
  fillSelectOptions('fOS', cfg.obrasSociales || [], 'Todas las obras sociales');
}

// ── Opciones del selector de estado ──────────────────────────────────────
export function refreshEstadoFilterOptions() {
  const sel = document.getElementById('fEst');
  if (!sel) return;
  const current = sel.value || '';
  const map = new Map();
  DB.rows.forEach(r => {
    const st = estadoLabelCanon(estado(r));
    const key = estadoLabelNorm(st);
    if (key && !map.has(key)) map.set(key, st);
  });
  const pref = [
    'VER TODO',
    'PEDIR LENTE',
    'ESPERANDO LENTE',
    'LLEGÓ LENTE - PROGRAMAR CIRUGÍA',
    'FECHA PROGRAMADA',
    'REALIZADA - FALTA FACTURAR',
    'FACTURADA',
    'FACTURADA FALTA OTRO OJO',
    'FINALIZADA',
    'DEVOLVER LENTE',
  ];
  const ordered = [
    ...pref.filter(st => Array.from(map.values()).some(v => estadoLabelNorm(v) === estadoLabelNorm(st))),
    ...Array.from(map.values()).filter(v => !pref.some(st => estadoLabelNorm(st) === estadoLabelNorm(v))).sort((a, b) => a.localeCompare(b, 'es')),
  ];
  sel.innerHTML = '<option value="">Todos los estados</option>' +
    ordered.map(st => `<option value="${escapeAttr(st)}">${escapeHtml(st)}</option>`).join('');
  if (current && ordered.some(st => estadoLabelNorm(st) === estadoLabelNorm(current))) {
    const found = ordered.find(st => estadoLabelNorm(st) === estadoLabelNorm(current));
    if (found) sel.value = found;
  }
}

const QUEUE_RAIL_DEFS = [
  { key: WORKFLOW_KEYS.TODOS, icon: '🧾', label: 'Ver todo', help: 'Todos los casos', count: () => DB.rows.length },
  { key: WORKFLOW_KEYS.PEDIR_LENTE, icon: '📝', label: 'Pedir lente', help: 'Sin solicitud', count: () => DB.rows.filter(p => stateKey(p) === WORKFLOW_KEYS.PEDIR_LENTE).length },
  { key: WORKFLOW_KEYS.ESPERANDO_LENTE, icon: '⏳', label: 'Esperando lente', help: 'Pedido en curso', count: () => DB.rows.filter(p => stateKey(p) === WORKFLOW_KEYS.ESPERANDO_LENTE).length },
  { key: WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR, icon: '📦', label: 'Llegó lente - Programar', help: 'Listo para fecha', count: () => DB.rows.filter(p => stateKey(p) === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR).length },
  { key: WORKFLOW_KEYS.FECHA_PROGRAMADA, icon: '📅', label: 'Fecha programada', help: 'Con fecha asignada', count: () => DB.rows.filter(p => stateKey(p) === WORKFLOW_KEYS.FECHA_PROGRAMADA).length },
  { key: WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR, icon: '💰', label: 'Realizada - Falta facturar', help: 'Pendiente admin', count: () => DB.rows.filter(p => stateKey(p) === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR).length },
  { key: WORKFLOW_KEYS.FACTURADA, icon: '✅', label: 'Facturada', help: 'Cierre completo', count: () => DB.rows.filter(p => [WORKFLOW_KEYS.FACTURADA, WORKFLOW_KEYS.FINALIZADA].includes(stateKey(p))).length },
  { key: WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO, icon: '👁', label: 'Facturada falta el otro ojo', help: 'Seguimiento bilateral', count: () => DB.rows.filter(p => stateKey(p) === WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO).length },
  { key: WORKFLOW_KEYS.ALERTAS, icon: '🚨', label: 'Alertas', help: 'Casos urgentes', count: () => DB.rows.filter(p => alertas(p).length).length, compact: true },
];

export function renderQueueRail() {
  const wrap = document.getElementById('quickFilters');
  if (!wrap) return;
  wrap.innerHTML = QUEUE_RAIL_DEFS.map(item => {
    const active = quickFilter === item.key || (!quickFilter && item.key === 'TODOS');
    const n = item.count();
    return `<button class="qf-btn ${active ? 'active' : ''} ${item.key === 'TODOS' ? 'qf-btn-secondary' : ''} ${item.compact ? 'qf-btn-compact' : ''}" data-qf="${escapeAttr(item.key)}">
      <span class="qf-icon">${escapeHtml(item.icon || '•')}</span>
      <span class="qf-name">${escapeHtml(item.label)}</span>
      <span class="qf-help">${escapeHtml(item.help)}</span>
      <span class="qf-count">${n}</span>
    </button>`;
  }).join('');
}

export function renderActiveFiltersBar() {
  const bar = document.getElementById('activeFiltersBar');
  if (!bar) return;
  const chips = [];
  const { q = '', fCli = '', fOS = '', fFechaCir = '' } = readDomFilterSnapshot();
  const showSilenced = !!document.getElementById('showSilenced')?.checked;
  const hideDone = !!document.getElementById('hideFinalizadasSinAccion')?.checked;
  const total = filtered().length;
  const queueText = quickFilter && quickFilter !== 'TODOS' ? quickFilterLabel(quickFilter) : 'Vista general';
  if (q) chips.push(`Búsqueda: ${q}`);
  if (fCli) chips.push(`Clínica: ${fCli}`);
  if (fOS) chips.push(`Obra social: ${fOS}`);
  if (fFechaCir && quickFilter === WORKFLOW_KEYS.FECHA_PROGRAMADA) chips.push(`Fecha programada: ${fFechaCir}`);
  if (showSilenced) chips.push('Incluye alertas silenciadas');
  if (hideDone) chips.push('Oculta casos cerrados sin acción');
  const base = `<div class="active-filters-summary"><strong>${queueText}</strong> · ${total} paciente(s) visibles</div>`;
  bar.innerHTML = chips.length ? `${base}${chips.map(ch => `<span class="af-chip">${escapeHtml(ch)}</span>`).join('')}` : `${base}<span class="af-chip af-chip-soft">Sin refinamientos adicionales</span>`;
}

// ── KPIs / Estadísticas rápidas ───────────────────────────────────────────
export function renderStats() {
  const statsbar = document.getElementById('statsbar');
  if (!statsbar) return;
  statsbar.innerHTML = '';
  statsbar.style.display = 'none';
}

// ── Panel alertas ─────────────────────────────────────────────────────────
let _alertFilter = 'TODAS';

export function setAlertFilter(f, el) {
  _alertFilter = f;
  document.querySelectorAll('.af-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderAlerts();
}

function alertActionText(type) {
  const map = {
    devolver: '↩ Devolver lente al proveedor',
    not_scheduled: '📅 Programar fecha de cirugía',
    lens_not_requested: '📋 Pedir lente urgente',
    lens_delayed: '📞 Llamar al proveedor',
    no_schedule_after_arrival: '📅 Asignar fecha de cirugía',
    scheduled_no_lens: '🚨 Gestionar lente urgente',
    billing_pending: '💰 Ingresar a facturación',
    second_surgery_missing: '👁 Programar segundo ojo',
  };
  return map[type] || 'Ver paciente';
}

export function toggleAlerts() {
  document.getElementById('alertsPanel').classList.toggle('open');
}

export function renderAlerts() {
  const showSilenced = !!document.getElementById('showSilenced')?.checked;
  const withAlerts = DB.rows.map(p => ({ p, alerts: alertas(p, { includeSilenced: true }) })).filter(x => x.alerts.length > 0);
  let flat = withAlerts.flatMap(x =>
    x.alerts.filter(a => showSilenced || !isSilenced(a)).map(a => ({ p: x.p, a }))
  );
  if (_alertFilter === 'criticas') flat = flat.filter(({ a }) => a.severity === 'red');
  else if (_alertFilter === 'today') {
    const today = hoyISO();
    flat = flat.filter(({ p }) => (p.fechaCir && String(p.fechaCir).slice(0, 10) === today) || (p.fechaLlegaLente && String(p.fechaLlegaLente).slice(0, 10) === today));
  }
  else if (_alertFilter !== 'TODAS') flat = flat.filter(({ a }) => a.type === _alertFilter);
  flat.sort((x, y) => {
    const sev = { red: 0, orange: 1, yellow: 2, neutral: 3 };
    return (sev[x.a.severity] ?? 3) - (sev[y.a.severity] ?? 3);
  });
  const titleEl = document.getElementById('alertsTitle');
  if (titleEl) titleEl.textContent = `⚠ ${flat.length} alertas`;
  const sevColor = { red: '#dc2626', orange: '#ea580c', yellow: '#a16207', neutral: '#6b7280' };
  const sevBg = { red: '#fef2f2', orange: '#fff7ed', yellow: '#fefce8', neutral: '#f8fafc' };
  const listEl = document.getElementById('alertsList');
  if (!listEl) return;
  listEl.innerHTML = flat.length ? flat.map(({ p, a }) => `
    <div class="alert-row" style="background:${sevBg[a.severity] || '#f8fafc'}" data-open-side="${escapeAttr(p.id)}">
      <div>
        <div class="ar-name">${escapeHtml(p.nombre || '—')} <span style="font-size:10px;color:#9ca3af;font-weight:400">· ${escapeHtml(p.clinica)}</span></div>
        <div style="font-size:11px;color:${sevColor[a.severity] || '#6b7280'};font-weight:700;margin-top:2px">${escapeHtml(a.msg)}</div>
        <div class="ar-action">${escapeHtml(alertActionText(a.type))}</div>
      </div>
      <button class="ar-sil-btn" data-alert-key="${escapeAttr(a.key)}" data-silenced="${isSilenced(a) ? '1' : '0'}" title="${isSilenced(a) ? 'Reactivar' : 'Silenciar'}">${isSilenced(a) ? '↺' : '✕'}</button>
    </div>`).join('') :
    '<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">Sin alertas en esta categoría ✓</div>';
}

// ── Panel "Trabajo del día" ───────────────────────────────────────────────
export function renderWorkdayPanel() {
  const all = DB.rows;
  const panel = document.getElementById('workdayPanel');
  const container = document.getElementById('workdayBlocks');
  if (!container || !panel) return;
  panel.style.display = currentTab === 'tabla' ? 'block' : 'none';
  const enCurso = all.filter(p => [WORKFLOW_KEYS.PEDIR_LENTE, WORKFLOW_KEYS.ESPERANDO_LENTE, WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR].includes(stateKey(p))).length;
  const programadas = all.filter(p => stateKey(p) === WORKFLOW_KEYS.FECHA_PROGRAMADA).length;
  const facturar = all.filter(p => stateKey(p) === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR).length;
  const criticas = all.filter(p => alertas(p).some(a => a.severity === 'red')).length;
  const cards = [
    { label: 'Lentes en gestión', sub: 'Pedido, espera y programación', n: enCurso, action: 'qf:PEDIR LENTE', cls: 'purple' },
    { label: 'Cirugías programadas', sub: 'Seguimiento de agenda', n: programadas, action: 'qf:CIRUGIA PROGRAMADA', cls: 'green' },
    { label: 'Pendientes de facturar', sub: 'Administración post cirugía', n: facturar, action: 'qf:FACTURAR', cls: 'orange' },
    { label: 'Alertas críticas', sub: 'Prioridad máxima', n: criticas, action: 'alerts:criticas', cls: 'red' },
  ];
  container.innerHTML = `<div class="wdp-header"><div><div class="wdp-title">Resumen operativo</div><div class="wdp-sub">Entrá por módulo arriba y usá estas tarjetas para priorizar el trabajo del día.</div></div></div>` + cards.map(card => `
    <button class="wdp-block wdp-${card.cls}" data-wdp-action="${escapeAttr(card.action)}">
      <div class="wdp-stack"><div class="wdp-n">${card.n}</div><div class="wdp-l">${escapeHtml(card.label)}</div><div class="wdp-help">${escapeHtml(card.sub)}</div></div>
      <div class="wdp-cta">Abrir →</div>
    </button>`).join('');
}

// ── Tabla principal ───────────────────────────────────────────────────────
export function renderMainTableHeader() {
  const colgroup = document.getElementById('mainColgroup');
  const thead = document.getElementById('mainThead');
  if (!colgroup || !thead) return;
  colgroup.innerHTML = MAIN_TABLE_COLUMNS.map(c => `<col style="width:${c.width}">`).join('');
  thead.innerHTML = `<tr>${MAIN_TABLE_COLUMNS.map(c => {
    const isActive = c.sortable && (sortCol === (c.sortKey || c.key));
    const arrow = isActive ? (sortDir === 1 ? ' ↑' : ' ↓') : ' ↕';
    const label = c.sortable ? `${c.label}${arrow}` : c.label;
    const cls = c.thClass ? ` class="${c.thClass}"` : '';
    const sortAttr = c.sortable ? ` data-sort="${c.sortKey || c.key}"` : '';
    return `<th${cls}><div class="th-inner"${sortAttr}>${label}</div></th>`;
  }).join('')}</tr>`;
  const chkWrap = thead.querySelector('th.th-check .th-inner');
  if (chkWrap) {
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = 'chkAll';
    chkWrap.innerHTML = '';
    chkWrap.appendChild(chk);
    chk.addEventListener('change', () => {
      if (!chk.checked) { setSelId(null); closeSide(); render(); }
    });
  }
}

function facBadgeCls(fac) {
  const f = (fac || '').toUpperCase();
  if (f === 'FACTURADA') return 'b7';
  return 'b7';
}

export function renderTabla() {
  renderMainTableHeader();
  const rows = filtered();
  const dupIds = duplicateNewestIds();
  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  const tablewrap = document.querySelector('#tabView .tablewrap');
  if (tablewrap) {
    const qLabel = quickFilter === 'TODOS' ? 'Vista general' : quickFilterLabel(quickFilter);
    const tags = [];
    if (quickFilter !== 'TODOS') tags.push(`<span class="table-tag">Cola: ${escapeHtml(qLabel)}</span>`);
    const red = rows.filter(p => alertas(p).some(a => a.severity === 'red')).length;
    const needsAction = rows.filter(p => proximaAccion(p).label !== 'Sin acción').length;
    tags.push(`<span class="table-tag">${rows.length} visibles</span>`);
    if (red) tags.push(`<span class="table-tag">${red} críticas</span>`);
    if (needsAction) tags.push(`<span class="table-tag">${needsAction} con acción</span>`);
    const existing = tablewrap.querySelector('.table-topbar');
    const html = `<div class="table-topbar"><div><div class="table-topbar-title">${escapeHtml(qLabel)}</div><div class="table-topbar-sub">Bandeja principal para uso diario. Elegí una cola arriba y resolvé desde acá.</div></div><div class="table-topbar-tags">${tags.join('')}</div></div>`;
    if (existing) existing.outerHTML = html; else tablewrap.insertAdjacentHTML('afterbegin', html);
  }
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${MAIN_TABLE_COLUMNS.length}"><div class="empty">No hay pacientes con esos filtros.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((p, i) => {
    const e = estado(p);
    const sel = normalizeId(p.id) === normalizeId(selId);
    const dup = dupIds.has(p.id);
    const rowAlerts = alertas(p);
    const topA = rowAlerts.find(a => a.severity === 'red') || rowAlerts.find(a => a.severity === 'orange') || rowAlerts[0];
    const alertDot = topA ? `<span title="${escapeAttr(topA.msg)}" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${topA.severity === 'red' ? '#dc2626' : topA.severity === 'orange' ? '#f97316' : '#f59e0b'};margin-left:5px;flex-shrink:0"></span>` : '';
    const pa = proximaAccion(p);
    const fechaClave = p.fechaCir || p.fechaLlegaLente || p.fechaSolLente || '';
    const fechaLabel = p.fechaCir ? 'Cirugía' : (p.fechaLlegaLente ? 'Llegada lente' : (p.fechaSolLente ? 'Solicitud lente' : 'Sin fecha'));
    const contexto = [p.clinica || '—', p.obraSocial || '—', p.ojo || '—'].filter(Boolean).join(' · ');
    const mainAction = pa.label === 'Facturar' ? `<button class="btn btn-row-open" data-row-action="facturar" data-open-side="${escapeAttr(p.id)}">Facturar</button>` :
      pa.label.includes('Programar') ? `<button class="btn btn-row-open" data-row-action="programar" data-open-side="${escapeAttr(p.id)}">Programar</button>` :
      pa.label.includes('Realizada') ? `<button class="btn btn-row-open" data-row-action="realizada" data-open-side="${escapeAttr(p.id)}">Marcar realizada</button>` :
      `<button class="btn btn-row-open" data-open-side="${escapeAttr(p.id)}">Abrir</button>`;
    const historyBtn = canViewRowHistory() ? `<button class="btn btn-row-open" data-row-action="historial" data-open-side="${escapeAttr(p.id)}">Historial</button>` : '';
    const rowCells = {
      paciente: `<td data-label="Paciente"><div class="cell" title="${escapeAttr(p.nombre || '—')}"><div class="cell-stack"><div class="cell-main"><span style="color:#9ca3af;margin-right:6px;font-size:10px">${i + 1}</span>${escapeHtml(p.nombre || '—')}${alertDot}</div><div class="cell-sub">DNI ${escapeHtml(p.dni || '—')} · Afiliado ${escapeHtml(p.afiliado || '—')}</div></div></div></td>`,
      ojo: `<td data-label="Ojo + dioptría"><div class="cell"><div class="cell-stack"><div class="cell-main">${escapeHtml(p.ojo || '—')} · ${escapeHtml(getDioptria(p) || 'sin dioptría')}</div><div class="cell-sub">Ojo a operar</div></div></div></td>`,
      obraSocial: `<td data-label="Obra social"><div class="cell"><div class="cell-stack"><div class="cell-main">${escapeHtml(p.obraSocial || '—')}</div><div class="cell-sub">${escapeHtml(p.clinica || '—')}</div></div></div></td>`,
      estadoActual: `<td data-label="Estado actual"><div class="cell"><span class="badge ${bc(e)}">${escapeHtml(e.length > 34 ? e.substring(0, 32) + '…' : e)}</span></div></td>`,
      proximaAccion: `<td data-label="Próxima acción"><div class="cell"><span class="pa-chip" style="color:${pa.color};background:${pa.bg}">${pa.icon} ${escapeHtml(pa.label)}</span></div></td>`,
      fechaClave: `<td data-label="Fecha clave"><div class="cell"><div class="cell-stack"><div class="cell-main">${escapeHtml(fd(fechaClave) || '—')}</div><div class="cell-sub">${escapeHtml(fechaLabel)}</div></div></div></td>`,
      acciones: `<td data-label="Acciones"><div class="cell"><div class="row-actions"><button class="btn btn-row-open" data-open-side="${escapeAttr(p.id)}">Editar</button>${historyBtn}</div></div></td>`,
    };
    const tds = MAIN_TABLE_COLUMNS.map(c => rowCells[c.key]).join('');
    const hasCritRow = rowAlerts.some(a => a.severity === 'red');
    const hasWarnRow = rowAlerts.some(a => a.severity === 'orange' || a.severity === 'yellow');
    const rowSevCls = hasCritRow ? 'row-crit' : hasWarnRow ? 'row-warn' : ([WORKFLOW_KEYS.FACTURADA, WORKFLOW_KEYS.FINALIZADA].includes(stateKey(p)) ? 'row-ok' : '');
    return `<tr class="${sel ? 'selected' : ''} ${dup ? 'dup-error' : ''} ${rowSevCls}" data-row-click="${escapeAttr(p.id)}">${tds}</tr>`;
  }).join('');
}

// ── Kanban ────────────────────────────────────────────────────────────────
const KANCOLS = [
  { key: WORKFLOW_KEYS.FALTA_DIOPTRIA, label: 'Falta dioptría' },
  { key: WORKFLOW_KEYS.PEDIR_LENTE, label: 'Pedir lente' },
  { key: WORKFLOW_KEYS.ESPERANDO_LENTE, label: 'Esperando lente' },
  { key: WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR, label: 'Programar cirugía' },
  { key: WORKFLOW_KEYS.FECHA_PROGRAMADA, label: 'Fecha programada' },
  { key: WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR, label: 'Realizada - Falta facturar' },
  { key: WORKFLOW_KEYS.FACTURADA, label: 'Facturada' },
  { key: WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO, label: 'Facturada falta el otro ojo' },
  { key: WORKFLOW_KEYS.FINALIZADA, label: 'Finalizada' },
];

export function renderKanban() {
  const data = filtered();
  const kanView = document.getElementById('kanView');
  if (!kanView) return;
  kanView.innerHTML = `<div class="kanban">${KANCOLS.map(col => {
    const cards = data.filter(p => stateKey(p) === col.key);
    return `<div class="kancol">
      <div class="kancol-h"><span>${escapeHtml(col.label)}</span><span class="kancol-n">${cards.length}</span></div>
      <div>${cards.length ? cards.map(p => {
      const als = alertas(p);
      return `<div class="kancard" data-open-side="${escapeAttr(p.id)}">
            <div class="kancard-name">${escapeHtml(p.nombre || '—')}</div>
            <div class="kancard-meta">
              <span>${escapeHtml(p.ojo || '')}</span>
              <span class="${clinicaClass(p.clinica)}" style="border-radius:4px;padding:1px 5px">${escapeHtml(p.clinica)}</span>
            </div>
            ${als.length ? `<div class="kancard-alert">⚠ ${escapeHtml(als[0].msg || '')}</div>` : ''}
          </div>`;
    }).join('') : '<div style="color:#9ca3af;font-size:11px;font-style:italic;padding:4px">Sin pacientes</div>'}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ── Calendario ────────────────────────────────────────────────────────────
export function renderCalendario() {
  const rows = filtered().filter(p => p.fechaCir);
  const by = {};
  rows.forEach(p => {
    const k = p.fechaCir;
    if (!by[k]) by[k] = [];
    by[k].push(p);
  });
  const dias = Object.keys(by).sort();
  const calView = document.getElementById('calView');
  if (!calView) return;
  calView.innerHTML = dias.map(d => {
    const items = by[d].slice().sort((a, b) => String(a.hora || '').localeCompare(String(b.hora || '')));
    return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="font-weight:700;color:#1e40af;margin-bottom:6px">${escapeHtml(fd(d))}</div>
      <ul style="padding-left:18px">${items.map(p => {
        const extras = practicasExtrasTexto(p);
        const detail = extras ? ` (${extras})` : '';
        const hora = p.hora ? ` · ${escapeHtml(p.hora)}` : '';
        return `<li style="margin:3px 0">${escapeHtml(p.nombre || '—')} ${escapeHtml(p.ojo || '')}${escapeHtml(detail)}${hora}</li>`;
      }).join('')}</ul>
    </div>`;
  }).join('') || '<div class="empty">No hay cirugías programadas.</div>';
}

// ── Panel lateral ─────────────────────────────────────────────────────────
export function openSide(id) {
  setSelId(id);
  const p = findRow(id);
  if (!p) return;
  const e = estado(p);
  const als = alertas(p);
  const sideNameEl = document.getElementById('sideName');
  const sideSubEl = document.getElementById('sideSub');
  if (sideNameEl) sideNameEl.textContent = p.nombre || '—';
  if (sideSubEl) sideSubEl.textContent = `DNI ${p.dni} · ${p.clinica} · ${p.obraSocial}`;
  const bcl = bc(e);
  const bcMap = { b0: '#fee2e2', b1: '#ffedd5', b2: '#fef9c3', b3: '#dbeafe', b4: '#ede9fe', b5: '#d1fae5', b6: '#dcfce7', b7: '#bbf7d0', b8: '#fce7f3', b9: '#fef3c7' };
  const tcMap = { b0: '#991b1b', b1: '#9a3412', b2: '#854d0e', b3: '#1e40af', b4: '#5b21b6', b5: '#065f46', b6: '#14532d', b7: '#14532d', b8: '#9d174d', b9: '#78350f' };

  // Validaciones
  const validaciones = [];
  const dupCheck = DB.rows.filter(x => x.id !== p.id && String(x.dni || '').trim() === String(p.dni || '').trim() && x.ojo === p.ojo);
  if (dupCheck.length) validaciones.push({ level: 'error', msg: `⚠ Posible duplicado: ${dupCheck.map(x => `#${escapeHtml(String(x.id))} ${escapeHtml(x.nombre || '')}`).join(', ')}` });
  if (p.fechaCir && !p.fechaLlegaLente) validaciones.push({ level: 'warning', msg: '📦 Cirugía programada pero lente no llegó aún' });
  if (isFacturadoCompleto(p.estadoFac) && (p.estadoCir || '').toUpperCase() !== 'REALIZADA') validaciones.push({ level: 'warning', msg: '💰 Facturada fuerza cirugía realizada — revisar fechas' });
  if (p.fechaSolLente && p.fechaLlegaLente && p.fechaLlegaLente < p.fechaSolLente) validaciones.push({ level: 'error', msg: '📅 Fecha llegada lente anterior a la solicitud — revisar' });
  if (p.fechaCir && p.fechaLlegaLente && p.fechaCir < p.fechaLlegaLente) validaciones.push({ level: 'warning', msg: '📅 Fecha cirugía anterior a llegada del lente — verificar' });

  const sideBody = document.getElementById('sideBody');
  if (sideBody) {
    sideBody.innerHTML = `
      <div class="estado-calc" style="background:${bcMap[bcl] || '#f1f5f9'};color:${tcMap[bcl] || '#374151'}">${escapeHtml(e)}</div>
      <div class="side-summary-grid">
        <div class="side-summary-card"><span class="side-summary-label">Próxima acción</span><strong>${escapeHtml(proximaAccion(p).label)}</strong></div>
        <div class="side-summary-card"><span class="side-summary-label">Fecha cirugía</span><strong>${escapeHtml(fd(p.fechaCir) || 'Sin fecha')}</strong></div>
        <div class="side-summary-card"><span class="side-summary-label">Facturación</span><strong>${isFacturadoCompleto(p.estadoFac) ? 'Facturada' : 'Pendiente'}</strong></div>
        <div class="side-summary-card"><span class="side-summary-label">Segundo ojo</span><strong>${p.ojos === '2 ojos' ? (secondEyeMissing(p) ? `Falta ${secondEyeMissing(p)}` : 'Completo') : 'No aplica'}</strong></div>
      </div>
      ${als.length ? `<div class="alertas-box">${als.map(a => `
        <div class="alerta-item" data-sil-key="${escapeAttr(a.key)}" style="cursor:pointer">⚠ ${escapeHtml(a.msg)} <span style='float:right;font-size:10px;color:#9ca3af'>silenciar ✕</span></div>`).join('')}</div>` : ''}
      <div class="sgroup">
        <div class="sgroup-title">Datos del paciente</div>
        <div class="srow"><label>Nombre</label><input type="text" data-field="nombre" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.nombre || '')}"></div>
        <div class="srow"><label>DNI</label><input type="text" data-field="dni" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.dni || '')}"></div>
        <div class="srow"><label>Fecha Nac.</label><input type="date" data-field="fnac" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fnac))}"></div>
        <div class="srow"><label>Teléfono</label><input type="text" data-field="tel" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.tel || '')}"></div>
        <div class="srow"><label>Dirección</label><input type="text" data-field="dir" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.dir || '')}"></div>
        ${(() => {
          const adm = getAdmisionOptions();
          const sedes = adm.sedes || [];
          const obras = [...new Set([...(adm.obrasPorSede?.[p.clinica || ''] || []), ...(adm.obrasSociales || []), p.obraSocial || '', 'PAMI'].filter(Boolean))];
          return `<datalist id="sideClinicasList">${sedes.map(x => `<option value="${escapeAttr(x)}"></option>`).join('')}</datalist><datalist id="sideObrasSocialesList">${obras.map(x => `<option value="${escapeAttr(x)}"></option>`).join('')}</datalist>`;
        })()}
        <div class="srow"><label>Clínica</label><input type="text" list="sideClinicasList" data-field="clinica" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.clinica || '')}" placeholder="Elegir o escribir nueva sede"></div>
        <div class="srow"><label>Obra Social</label><input type="text" list="sideObrasSocialesList" data-field="obraSocial" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.obraSocial || 'PAMI')}" placeholder="Elegir o escribir nueva obra social"></div>
        <div class="srow"><label>N° Afiliado</label><input type="text" data-field="afiliado" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.afiliado || '')}"></div>
      </div>
      <div class="sgroup">
        <div class="sgroup-title">Cirugía</div>
        <div class="srow"><label>Ojos a operar</label><select data-field="ojos" data-row-id="${escapeAttr(id)}">
          <option ${p.ojos === '2 ojos' ? 'selected' : ''}>2 ojos</option>
          <option ${p.ojos === '1 ojo' ? 'selected' : ''}>1 ojo</option>
        </select></div>
        <div class="srow"><label>Ojo</label><select data-field="ojo" data-row-id="${escapeAttr(id)}">
          <option ${p.ojo === 'OI' ? 'selected' : ''}>OI</option>
          <option ${p.ojo === 'OD' ? 'selected' : ''}>OD</option>
        </select></div>
        <div class="srow"><label>Dioptría</label><input type="text" data-field="dioptria" data-row-id="${escapeAttr(id)}" value="${escapeAttr(getDioptria(p) || '')}"></div>
        <div class="srow"><label>Modelo lente</label><input type="text" placeholder="Ej: Estándar / Especial" data-field="model" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.model || '')}"></div>
        <div class="srow"><label>Precio especial</label><input type="number" min="0" data-field="precioEspecial" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.precioEspecial || '')}"></div>
      </div>
      <div class="sgroup">
        <div class="sgroup-title">🔑 Lente y Fechas</div>
        <div class="srow"><label>📅 Fecha sol. lente</label><input type="date" data-field="fechaSolLente" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaSolLente))}"></div>
        <div class="srow"><label>📦 Fecha llegada lente</label><input type="date" data-field="fechaLlegaLente" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaLlegaLente))}"></div>
        <div class="srow"><label>Recepción lente</label><select data-field="recepLente" data-row-id="${escapeAttr(id)}">
          <option value="" ${!p.recepLente ? 'selected' : ''}>—</option>
          <option ${p.recepLente === 'Correcta' ? 'selected' : ''}>Correcta</option>
          <option ${p.recepLente === 'Devolver' ? 'selected' : ''}>Devolver</option>
        </select></div>
        <div class="srow"><label>📅 Fecha cirugía</label><input type="date" data-field="fechaCir" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaCir))}"></div>
        <div class="srow"><label>🕒 Hora cirugía</label><div style="display:flex;gap:6px;align-items:center;flex:1"><input type="time" data-field="hora" data-row-id="${escapeAttr(id)}" value="${escapeAttr(p.hora || '')}" style="flex:1"><button type="button" class="btn" data-clear-field="hora" data-row-id="${escapeAttr(id)}" style="padding:5px 8px">Borrar</button></div></div>
        <div class="srow"><label>Estado cirugía</label><select data-field="estadoCir" data-row-id="${escapeAttr(id)}">
          <option value="" ${!p.estadoCir ? 'selected' : ''}>No</option>
          <option value="Realizada" ${(p.estadoCir || '') === 'Realizada' ? 'selected' : ''}>Sí</option>
        </select></div>
        <div class="srow"><label>💰 Facturada</label><select data-field="estadoFac" data-row-id="${escapeAttr(id)}">
          <option value="" ${!p.estadoFac ? 'selected' : ''}>No</option>
          <option value="FACTURADA" ${String(p.estadoFac || '').toUpperCase() === 'FACTURADA' ? 'selected' : ''}>Sí</option>
        </select></div>
        <div class="srow"><label>📅 Fecha facturada</label><input type="date" data-field="fechaFacturada" data-row-id="${escapeAttr(id)}" value="${escapeAttr(fdInput(p.fechaFacturada || ''))}"></div>
        <div class="srow"><label>Prácticas adicionales</label><div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px">
          <label><input type="checkbox" data-field="extraSutura" data-row-id="${escapeAttr(id)}" ${p.extraSutura ? 'checked' : ''}> Sutura</label>
          <label><input type="checkbox" data-field="extraInyeccion" data-row-id="${escapeAttr(id)}" ${p.extraInyeccion ? 'checked' : ''}> Inyección</label>
          <label><input type="checkbox" data-field="extraVitrectomia" data-row-id="${escapeAttr(id)}" ${p.extraVitrectomia ? 'checked' : ''}> Vitrectomía</label>
        </div></div>
      </div>
      <div class="sgroup">
        <div class="sgroup-title">Notas</div>
        <div class="srow"><textarea rows="2" data-field="notas" data-row-id="${escapeAttr(id)}" style="flex:1;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-family:inherit;font-size:12px;resize:vertical">${escapeHtml(p.notas || '')}</textarea></div>
      </div>`;
  }

  // Footer con acciones rápidas
  const st = estado(p);
  const stKey = stateKey(p);
  const fac = (p.estadoFac || '').toUpperCase();
  const qaButtons = [];
  if (!p.fechaSolLente && ![WORKFLOW_KEYS.FACTURADA, WORKFLOW_KEYS.FINALIZADA].includes(stateKey(p))) qaButtons.push(`<button class="qa-btn" data-qa-action="solLenteHoy" data-qa-id="${escapeAttr(id)}">📋 Sol. lente hoy</button>`);
  if (stKey === WORKFLOW_KEYS.ESPERANDO_LENTE) qaButtons.push(`<button class="qa-btn green" data-qa-action="lenteLlegoHoy" data-qa-id="${escapeAttr(id)}">📦 Lente llegó hoy</button>`);
  if (stKey === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR) qaButtons.push(`<button class="qa-btn" data-qa-action="programarCirugia" data-qa-id="${escapeAttr(id)}">📅 Programar cirugía</button>`);
  const estCirCalc = getEstadoCirCalculado(p);
  if (p.fechaCir && estCirCalc !== 'Realizada') qaButtons.push(`<button class="qa-btn green" data-qa-action="cirugiaRealizada" data-qa-id="${escapeAttr(id)}">✅ Cirugía realizada</button>`);
  if (estCirCalc === 'Realizada' && !isFacturadoCompleto(fac)) qaButtons.push(`<button class="qa-btn orange" data-qa-action="facturadaHoy" data-qa-id="${escapeAttr(id)}">💰 Facturada hoy</button>`);
  if (p.ojos === '2 ojos' && secondEyeMissing(p)) qaButtons.push(`<button class="qa-btn violet" data-qa-action="duplicar" data-qa-id="${escapeAttr(id)}">⧉ Duplicar → ${escapeHtml(secondEyeMissing(p))}</button>`);

  const sideFoot = document.getElementById('sideFoot');
  if (sideFoot) {
    sideFoot.innerHTML = `
      ${validaciones.map(v => `<div class="val-${v.level}">${v.msg}</div>`).join('')}
      ${qaButtons.length ? `<div class="quick-actions-bar">${qaButtons.join('')}</div>` : ''}
      <div style="padding:10px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span id="sideDirtyHint" style="font-size:11px;color:#b45309;display:none">● Cambios sin guardar</span>
        <button class="btn primary" data-qa-action="guardarCambios" data-qa-id="${escapeAttr(id)}">Guardar cambios</button>
        <button class="btn" data-qa-action="cancelarCambios" data-qa-id="${escapeAttr(id)}">Cancelar</button>
        <button class="btn" data-qa-action="duplicar" data-qa-id="${escapeAttr(id)}">⧉ Duplicar ojo</button>
        <button class="btn" data-qa-action="eliminar" data-qa-id="${escapeAttr(id)}" style="margin-left:auto;border-color:#fca5a5;color:#dc2626">🗑 Eliminar</button>
      </div>`;
  }

  document.getElementById('sidePanel')?.classList.add('open');
  const overlay = document.getElementById('sideOverlay');
  if (overlay) overlay.style.display = 'block';
  window.dispatchEvent(new CustomEvent('side:opened', { detail: { id } }));
}

export function closeSide() {
  document.getElementById('sidePanel')?.classList.remove('open');
  const overlay = document.getElementById('sideOverlay');
  if (overlay) overlay.style.display = 'none';
  setSelId(null);
  window.dispatchEvent(new CustomEvent('side:closed'));
  document.body.style.pointerEvents = 'auto';
  document.body.style.overflow = 'auto';
  render();
}

export function forceUnlockUI() {
  const overlay = document.getElementById('sideOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.pointerEvents = 'auto';
  document.body.style.overflow = 'auto';
  document.querySelectorAll('.editing').forEach(el => el.classList.remove('editing'));
}

// ── Refresh parcial del panel lateral (sin reconstruir) ───────────────────
export function refreshSidePanel(p) {
  const e = estado(p);
  const als = alertas(p);
  const bcl = bc(e);
  const bcMap = { b0: '#fee2e2', b1: '#ffedd5', b2: '#fef9c3', b3: '#dbeafe', b4: '#ede9fe', b5: '#d1fae5', b6: '#dcfce7', b7: '#bbf7d0', b8: '#fce7f3', b9: '#fef3c7' };
  const tcMap = { b0: '#991b1b', b1: '#9a3412', b2: '#854d0e', b3: '#1e40af', b4: '#5b21b6', b5: '#065f46', b6: '#14532d', b7: '#14532d', b8: '#9d174d', b9: '#78350f' };
  const ec = document.querySelector('.estado-calc');
  if (ec) { ec.style.background = bcMap[bcl] || '#f1f5f9'; ec.style.color = tcMap[bcl] || '#374151'; ec.textContent = e; }
  const ab = document.querySelector('.alertas-box');
  if (ab) ab.innerHTML = als.map(a => `<div class="alerta-item" data-sil-key="${escapeAttr(a.key)}" style="cursor:pointer">⚠ ${escapeHtml(a.msg)} <span style='float:right;font-size:10px;color:#9ca3af'>silenciar ✕</span></div>`).join('');
  const sn = document.getElementById('sideName');
  const ss = document.getElementById('sideSub');
  if (sn) sn.textContent = p.nombre || '—';
  if (ss) ss.textContent = `DNI ${p.dni} · ${p.clinica} · ${p.obraSocial}`;
}

// ── Estadísticas (lazy) ───────────────────────────────────────────────────
export function renderEstadisticasLazy() {
  import('./estadisticas.js').then(m => m.renderEstadisticas()).catch(e => console.error('[stats]', e));
}


export function renderFacturarLazy() {
  import('./facturar.js').then(m => m.renderFacturar()).catch(e => {
    console.error('[facturar]', e);
    const el = document.getElementById('facturarView');
    if (el) el.innerHTML = '<div class="empty">No se pudo cargar la vista Facturar</div>';
  });
}

export function renderPedirLenteLazy() {
  import('./pedir-lente.js').then(m => m.renderPedirLente()).catch(e => {
    console.error('[pedir-lente]', e);
    const el = document.getElementById('pedirLenteView');
    if (el) el.innerHTML = '<div class="empty">No se pudo cargar el módulo Pedir lente</div>';
  });
}

// ── WhatsApp tab (stub que carga el módulo pesado) ─────────────────────────
export function renderWhatsAppTab() {
  import('./whatsapp.js').then(m => m.renderWhatsApp()).catch(e => {
    const el = document.getElementById('waView');
    if (el) el.innerHTML = '<div class="empty">Módulo WhatsApp no disponible</div>';
  });
}

export function renderAdministracionLazy() {
  import('./admin.js').then(m => m.renderAdministracion()).catch(e => {
    console.error('[admin]', e);
    const el = document.getElementById('adminView');
    if (el) el.innerHTML = '<div class="empty">Módulo Administración no disponible</div>';
  });
}

// ── Sidebar KPIs ─────────────────────────────────────────────────────────
export function toggleKpis() {
  const box = document.getElementById('statsbar');
  const btn = document.getElementById('toggleKpisBtn');
  if (!box || !btn) return;
  const hidden = box.classList.toggle('hidden');
  btn.textContent = hidden ? 'Mostrar resumen' : 'Ocultar resumen';
  btn.setAttribute('aria-label', hidden ? 'Mostrar resumen' : 'Ocultar resumen');
  localStorage.setItem('cirugias_hide_kpis', hidden ? '1' : '0');
  updateStickyMetrics();
}

export function restoreKpisPref() {
  const hide = localStorage.getItem('cirugias_hide_kpis') === '1';
  const box = document.getElementById('statsbar');
  const btn = document.getElementById('toggleKpisBtn');
  if (!box || !btn) return;
  box.classList.toggle('hidden', hide);
  btn.textContent = hide ? 'Mostrar resumen' : 'Ocultar resumen';
  btn.setAttribute('aria-label', hide ? 'Mostrar resumen' : 'Ocultar resumen');
}

export function updateStickyMetrics() {
  const h = document.querySelector('header');
  const fb = document.querySelector('.filterbar');
  const headerH = h ? Math.ceil(h.getBoundingClientRect().height) : 120;
  document.body.style.setProperty('--header-h', `${headerH}px`);
}
