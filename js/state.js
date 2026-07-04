// state.js — Estado global, lógica de negocio y cálculo de alertas

'use strict';

import { hoyISO, toDateOnly, diffDays, parseDateOnly } from './utils.js';

// ── Estado principal ──────────────────────────────────────────────────────
export let DB = { rows: [], nid: 200 };
export let selId = null;
export let sortCol = 'nombre';
export let sortDir = 1;
export let currentTab = 'tabla';
export let isSyncing = false;
export let quickFilter = 'TODOS';
export let hideFinalizadasSinAccion = localStorage.getItem('hide_finalizadas_sin_accion') === '1';
export let FIRESTORE_ENABLED = false;
export let FIRESTORE_UNSUB = null;
export let APPS_SCRIPT_URL = localStorage.getItem('apps_script_url') || '';

export function setDB(newDB) { DB = newDB; }
export function setSelId(id) { selId = id; }
export function setSortCol(col) { sortCol = col; }
export function setSortDir(dir) { sortDir = dir; }
export function setCurrentTab(tab) { currentTab = tab; }
export function setIsSyncing(v) { isSyncing = v; }
export function setQuickFilter(v) { quickFilter = v; }
export function setHideFinalizadasSinAccion(v) {
  hideFinalizadasSinAccion = !!v;
  localStorage.setItem('hide_finalizadas_sin_accion', hideFinalizadasSinAccion ? '1' : '0');
}
export function setFirestoreEnabled(v) { FIRESTORE_ENABLED = v; }
export function setFirestoreUnsub(fn) { FIRESTORE_UNSUB = fn; }
export function setAppsScriptUrl(url) {
  APPS_SCRIPT_URL = url;
  localStorage.setItem('apps_script_url', url);
}

// ── Configuración de alertas ──────────────────────────────────────────────
export let SETTINGS = Object.assign({
  second_eye_missing_warn_days: 30,
  second_eye_missing_crit_days: 45,
  lens_arrived_not_scheduled_warn_days: 15,
  lens_arrived_not_scheduled_crit_days: 30,
  billing_not_done_warn_days: 15,
  billing_not_done_crit_days: 30,
  lens_delay_warn_days: 10,
  lens_delay_crit_days: 20
}, JSON.parse(localStorage.getItem('cirugias_settings') || '{}') || {});

export let ALERT_SILENCES = JSON.parse(localStorage.getItem('cirugias_alert_silences') || '{}');

export function saveSettings() {
  localStorage.setItem('cirugias_settings', JSON.stringify(SETTINGS));
  localStorage.setItem('cirugias_alert_silences', JSON.stringify(ALERT_SILENCES));
}

export function silenciarAlerta(key) {
  ALERT_SILENCES[key] = { silencedAt: new Date().toISOString() };
  saveSettings();
}

export function reactivarAlerta(key) {
  delete ALERT_SILENCES[key];
  saveSettings();
}

export function isSilenced(a) { return !!ALERT_SILENCES[a.key]; }

// ── Estado de workflow unificado ──────────────────────────────────────────
export const WORKFLOW_KEYS = Object.freeze({
  PEDIR_LENTE: 'PEDIR_LENTE',
  ESPERANDO_LENTE: 'ESPERANDO_LENTE',
  LLEGO_LENTE_PROGRAMAR: 'LLEGO_LENTE_PROGRAMAR',
  FECHA_PROGRAMADA: 'FECHA_PROGRAMADA',
  REALIZADA_FALTA_FACTURAR: 'REALIZADA_FALTA_FACTURAR',
  FACTURADA: 'FACTURADA',
  FACTURADA_FALTA_OTRO_OJO: 'FACTURADA_FALTA_OTRO_OJO',
  FINALIZADA: 'FINALIZADA',
  DEVOLVER_LENTE: 'DEVOLVER_LENTE',
  FALTA_DIOPTRIA: 'FALTA_DIOPTRIA',
  ALERTAS: 'ALERTAS',
  TODOS: 'TODOS'
});

function rawText(v) { return String(v || '').trim(); }
function normText(v) {
  return rawText(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function normalizeWorkflowKey(v) {
  const n = normText(v);
  const map = {
    'TODOS': WORKFLOW_KEYS.TODOS,
    'VER TODO': WORKFLOW_KEYS.TODOS,
    'PEDIR LENTE': WORKFLOW_KEYS.PEDIR_LENTE,
    'LISTO PARA PEDIR LENTE': WORKFLOW_KEYS.PEDIR_LENTE,
    'ESPERANDO LENTE': WORKFLOW_KEYS.ESPERANDO_LENTE,
    'LENTE SOLICITADA': WORKFLOW_KEYS.ESPERANDO_LENTE,
    'LLEGO LENTE': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'LLEGO LENTE - PROGRAMAR CIRUGIA': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'LLEGO LENTE / PROGRAMAR': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'LLEGO LENTE PROGRAMAR': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'LLEGÓ LENTE': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'LLEGÓ LENTE - PROGRAMAR CIRUGIA': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'LLEGÓ LENTE - PROGRAMAR CIRUGÍA': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'PROGRAMAR': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'PROGRAMAR CIRUGIA': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'PROGRAMAR CIRUGÍA': WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    'FECHA PROGRAMADA': WORKFLOW_KEYS.FECHA_PROGRAMADA,
    'CIRUGIA PROGRAMADA': WORKFLOW_KEYS.FECHA_PROGRAMADA,
    'CIRUGÍA PROGRAMADA': WORKFLOW_KEYS.FECHA_PROGRAMADA,
    'REALIZADA': WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    'REALIZADA - FALTA FACTURAR': WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    'CIRUGIA REALIZADA': WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    'CIRUGÍA REALIZADA': WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    'FALTA FACTURAR': WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    'SIN FACTURAR': WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    'FACTURAR': WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    'FACTURADA': WORKFLOW_KEYS.FACTURADA,
    'FINALIZADO': WORKFLOW_KEYS.FINALIZADA,
    'FINALIZADA': WORKFLOW_KEYS.FINALIZADA,
    'FINALIZADO - FACTURADA': WORKFLOW_KEYS.FINALIZADA,
    'FACTURADA FALTA EL OTRO OJO': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FACTURADA FALTA OTRO OJO': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FACTURADA FALTA OD/OI': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FACTURADA | FALTA OD': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FACTURADA | FALTA OI': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FINALIZADA | FALTA OJO DERECHO': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FINALIZADA | FALTA OJO IZQUIERDO': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FACTURADA FALTA OJO DERECHO': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FACTURADA FALTA OJO IZQUIERDO': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'FALTA OTRO OJO': WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    'ALERTAS': WORKFLOW_KEYS.ALERTAS,
    'CON ALERTAS': WORKFLOW_KEYS.ALERTAS,
    'DEVOLVER LENTE': WORKFLOW_KEYS.DEVOLVER_LENTE,
    'FALTA DIOPTRIA': WORKFLOW_KEYS.FALTA_DIOPTRIA,
    'FALTA DIOPTRÍA': WORKFLOW_KEYS.FALTA_DIOPTRIA,
  };
  return map[n] || rawText(v) || WORKFLOW_KEYS.TODOS;
}

export function stateLabelFromKey(key, p = null) {
  switch (key) {
    case WORKFLOW_KEYS.PEDIR_LENTE: return 'PEDIR LENTE';
    case WORKFLOW_KEYS.ESPERANDO_LENTE: return 'ESPERANDO LENTE';
    case WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR: return 'LLEGÓ LENTE - PROGRAMAR CIRUGÍA';
    case WORKFLOW_KEYS.FECHA_PROGRAMADA: return 'FECHA PROGRAMADA';
    case WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR: return 'REALIZADA - FALTA FACTURAR';
    case WORKFLOW_KEYS.FACTURADA: return 'FACTURADA';
    case WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO: {
      const faltante = p ? faltanteSegundoOjo(p) : '';
      if (faltante === 'OD') return 'FACTURADA FALTA OJO DERECHO';
      if (faltante === 'OI') return 'FACTURADA FALTA OJO IZQUIERDO';
      return 'FACTURADA FALTA OTRO OJO';
    }
    case WORKFLOW_KEYS.FINALIZADA: return 'FINALIZADA';
    case WORKFLOW_KEYS.DEVOLVER_LENTE: return 'DEVOLVER LENTE';
    case WORKFLOW_KEYS.FALTA_DIOPTRIA: return 'FALTA DIOPTRÍA';
    default: return rawText(key) || '—';
  }
}

export function quickFilterLabel(v = quickFilter) {
  const key = normalizeWorkflowKey(v);
  const map = {
    [WORKFLOW_KEYS.TODOS]: 'Ver todo',
    [WORKFLOW_KEYS.PEDIR_LENTE]: 'Pedir lente',
    [WORKFLOW_KEYS.ESPERANDO_LENTE]: 'Esperando lente',
    [WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR]: 'Llegó lente - programar',
    [WORKFLOW_KEYS.FECHA_PROGRAMADA]: 'Fecha programada',
    [WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR]: 'Realizada - falta facturar',
    [WORKFLOW_KEYS.FACTURADA]: 'Facturada',
    [WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO]: 'Facturada: falta el otro ojo',
    [WORKFLOW_KEYS.FINALIZADA]: 'Finalizada',
    [WORKFLOW_KEYS.ALERTAS]: 'Con alertas'
  };
  return map[key] || rawText(v) || 'Ver todo';
}

// ── ID helpers ────────────────────────────────────────────────────────────
export function normalizeId(id) { return String(id ?? ''); }
export function findRow(id) {
  const sid = normalizeId(id);
  return DB.rows.find(x => normalizeId(x.id) === sid) || null;
}

// ── Normalización de datos ────────────────────────────────────────────────
export function normalizarClinica(c) {
  if (c === 'Clínica 1' || c === 'CDU') return 'CDU';
  if (c === 'Clínica 2' || c === 'Gualeguaychu' || c === 'Gualeguaychú') return 'Gualeguaychú';
  return c || 'CDU';
}

export function getDioptria(p) { return p.dioptria || p.lio || ''; }
export function clinicaClass(c) { return c === 'CDU' ? 'bcl1' : 'bcl2'; }

function normDateField(v) {
  const dt = parseDateOnly(v);
  return dt ? dt.toISOString().slice(0, 10) : '';
}
function hasValidDate(v) { return !!parseDateOnly(v); }

export function isFacturadoCompleto(fac) {
  const f = normText(fac);
  return f === 'FACTURADA' || f === 'FINALIZADA';
}

export function getEstadoCirCalculado(p) {
  const manual = normText(p.estadoCir);
  const fc = toDateOnly(p.fechaCir);
  const today = toDateOnly(hoyISO());
  if (isFacturadoCompleto(p.estadoFac)) return 'Realizada';
  if (!fc) return '';
  if (manual === 'REALIZADA') return 'Realizada';
  const passedDays = diffDays(today, fc);
  if (passedDays !== null && passedDays >= 1) return 'Realizada';
  return 'Programada';
}

export function normalizeEstadoCir(p) {
  const calc = getEstadoCirCalculado(p);
  return (calc === 'Programada' || calc === 'Realizada') ? calc : '';
}

export function normalizarData() {
  DB.rows.forEach(p => {
    p.id = String(p.id ?? '');
    p.clinica = normalizarClinica(p.clinica);
    if (!p.ojo) p.ojo = 'OI';
    if (!p.ojos) p.ojos = '2 ojos';
    ['fechaSolLente', 'fechaLlegaLente', 'fechaCir', 'fechaFacturada'].forEach(k => { p[k] = normDateField(p[k]); });
    if (!hasValidDate(p.fechaCir)) p.hora = '';
  });
}

// ── Lógica de duplicados ──────────────────────────────────────────────────
export function duplicateNewestIds() {
  const map = {};
  DB.rows.forEach(r => {
    const k = `${String(r.dni || '').trim()}|${r.ojo || ''}`;
    if (!map[k]) map[k] = [];
    map[k].push(r);
  });
  const dup = new Set();
  Object.values(map).forEach(arr => {
    if (arr.length > 1 && arr[0].dni) {
      arr.sort((a, b) => (b.id || 0) - (a.id || 0));
      dup.add(arr[0].id);
    }
  });
  return dup;
}

export function getOtherEyeRow(p) {
  if (!p || p.ojos !== '2 ojos') return null;
  const dni = String(p.dni || '').trim();
  if (!dni) return null;
  const otro = p.ojo === 'OD' ? 'OI' : 'OD';
  const candidates = DB.rows.filter(x => x.id !== p.id && String(x.dni || '').trim() === dni && String(x.ojo || '').trim().toUpperCase() === otro);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => String(b.updatedAt || b.createdAt || b.id || '').localeCompare(String(a.updatedAt || a.createdAt || a.id || '')))[0] || null;
}

export function secondEyeMissing(p) {
  if (p.ojos !== '2 ojos') return '';
  const otro = p.ojo === 'OD' ? 'OI' : 'OD';
  const other = getOtherEyeRow(p);
  return other ? '' : otro;
}

export function isSecondEyeBlockedByBilling(p) {
  if (!p || p.ojos !== '2 ojos' || isFacturadoCompleto(p.estadoFac)) return false;
  const other = getOtherEyeRow(p);
  return !!other && !isFacturadoCompleto(other.estadoFac);
}

function faltanteSegundoOjo(p) {
  if (p.ojos !== '2 ojos') return '';
  const otro = p.ojo === 'OD' ? 'OI' : 'OD';
  const other = getOtherEyeRow(p);
  return other ? '' : otro;
}

export function practicasExtrasTexto(p) {
  const vals = [];
  if (p.extraSutura) vals.push('Sutura');
  if (p.extraInyeccion) vals.push('Inyección');
  if (p.extraVitrectomia) vals.push('Vitrectomía');
  return vals.join(' + ');
}

export function getFechaFacturadaBase(p) {
  if (p.fechaFacturada) return String(p.fechaFacturada).slice(0, 10);
  if (!isFacturadoCompleto(p.estadoFac)) return '';
  const upd = String(p.updatedAt || '').slice(0, 10);
  if (upd) return upd;
  return String(p.fechaCir || '').slice(0, 10);
}

// ── Estado calculado del paciente ─────────────────────────────────────────
export function stateKey(p) {
  const estCir = getEstadoCirCalculado(p);
  const tieneSol = hasValidDate(p.fechaSolLente);
  const tieneLlego = hasValidDate(p.fechaLlegaLente);
  const tieneCir = hasValidDate(p.fechaCir);

  if (p.recepLente === 'Devolver') return WORKFLOW_KEYS.DEVOLVER_LENTE;
  if (!getDioptria(p)) return WORKFLOW_KEYS.FALTA_DIOPTRIA;
  if (!tieneSol) return WORKFLOW_KEYS.PEDIR_LENTE;
  if (!tieneLlego) return WORKFLOW_KEYS.ESPERANDO_LENTE;
  if (!tieneCir) return WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR;

  if (isFacturadoCompleto(p.estadoFac)) {
    if (p.ojos === '2 ojos') {
      const faltante = faltanteSegundoOjo(p);
      if (faltante) return WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO;
      return WORKFLOW_KEYS.FINALIZADA;
    }
    return WORKFLOW_KEYS.FACTURADA;
  }

  if (estCir === 'Realizada') return WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR;
  return WORKFLOW_KEYS.FECHA_PROGRAMADA;
}

export function estado(p) { return stateLabelFromKey(stateKey(p), p); }

export function matchesWorkflowFilter(p, key) {
  const rowKey = stateKey(p);
  const target = normalizeWorkflowKey(key);
  if (target === WORKFLOW_KEYS.TODOS) return true;
  if (target === WORKFLOW_KEYS.ALERTAS) return alertas(p).length > 0;
  if (target === WORKFLOW_KEYS.FACTURADA) {
    return rowKey === WORKFLOW_KEYS.FACTURADA || rowKey === WORKFLOW_KEYS.FINALIZADA;
  }
  return rowKey === target;
}

// ── Próxima acción sugerida ───────────────────────────────────────────────
export function proximaAccion(p) {
  const st = stateKey(p);
  if (st === WORKFLOW_KEYS.FACTURADA || st === WORKFLOW_KEYS.FINALIZADA) {
    return { label: 'Sin acción', color: '#9ca3af', bg: '#f1f5f9', icon: '✓' };
  }
  if (st === WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO) {
    return { label: 'Ver segundo ojo', color: '#7c3aed', bg: '#ede9fe', icon: '👁' };
  }
  if (st === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR) {
    return { label: 'Facturar', color: '#dc2626', bg: '#fee2e2', icon: '💰' };
  }
  if (st === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR) {
    return { label: 'Programar cirugía', color: '#065f46', bg: '#d1fae5', icon: '📅' };
  }
  if (st === WORKFLOW_KEYS.ESPERANDO_LENTE) {
    const d = diffDays(toDateOnly(hoyISO()), p.fechaSolLente);
    if (d !== null && d > 15) return { label: 'Reclamar lente', color: '#dc2626', bg: '#fee2e2', icon: '📞' };
    return { label: 'Esperar lente', color: '#1d4ed8', bg: '#dbeafe', icon: '⏳' };
  }
  if (st === WORKFLOW_KEYS.FECHA_PROGRAMADA) {
    return { label: 'Confirmar paciente', color: '#065f46', bg: '#d1fae5', icon: '📞' };
  }
  if (st === WORKFLOW_KEYS.PEDIR_LENTE) {
    return { label: 'Pedir lente', color: '#7c3aed', bg: '#ede9fe', icon: '📋' };
  }
  if (st === WORKFLOW_KEYS.FALTA_DIOPTRIA) {
    return { label: 'Cargar dioptría', color: '#dc2626', bg: '#fee2e2', icon: '⚠' };
  }
  if (st === WORKFLOW_KEYS.DEVOLVER_LENTE) {
    return { label: 'Devolver lente', color: '#9d174d', bg: '#fce7f3', icon: '↩' };
  }
  return { label: 'Revisar', color: '#475569', bg: '#e2e8f0', icon: '•' };
}

// ── Severidad de alertas ──────────────────────────────────────────────────
export function severityByDays(days, yellowFrom = 15, redFrom = 30) {
  if (days >= redFrom) return 'red';
  if (days >= yellowFrom) return 'yellow';
  return 'neutral';
}

export function episodeIdFor(p) {
  if (p.episode_id) return p.episode_id;
  const base = (p.fechaCir || p.fechaCarga || hoyISO()).slice(0, 7);
  return `${String(p.dni || '').trim()}|${p.clinica || ''}|${base}`;
}

// ── Cálculo de alertas de un paciente ────────────────────────────────────
export function alertas(p, opts = {}) {
  const today = toDateOnly(hoyISO());
  const res = [];
  const includeSilenced = !!opts.includeSilenced;
  const stKey = stateKey(p);
  const dni = String(p.dni || '').trim();
  const ojo = String(p.ojo || '').toUpperCase() || 'NA';
  const push = (type, d, msg, yellow, red, baseKey='') => {
    if (d == null || d < yellow) return;
    res.push({ type, days: d, key: `${type}:${dni}:${ojo}:${baseKey}`, severity: severityByDays(d, yellow, red), msg });
  };

  if (p.recepLente === 'Devolver' || stKey === WORKFLOW_KEYS.DEVOLVER_LENTE) return [];

  if (p.fechaSolLente && !p.fechaLlegaLente) {
    const d = diffDays(today, p.fechaSolLente);
    push('lens_delayed', d, `DEMORA EN LLEGADA DE LENTE (+${d} días)`, SETTINGS.lens_delay_warn_days, SETTINGS.lens_delay_crit_days, p.fechaSolLente);
  } else if (stKey === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR) {
    const d = diffDays(today, p.fechaLlegaLente);
    push('no_schedule_after_arrival', d, `LENTE LLEGÓ Y FALTA PROGRAMAR (+${d} días)`, SETTINGS.lens_arrived_not_scheduled_warn_days, SETTINGS.lens_arrived_not_scheduled_crit_days, p.fechaLlegaLente);
  } else if (stKey === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR) {
    const base = p.fechaCir || p.updatedAt || hoyISO();
    const d = diffDays(today, base);
    push('billing_pending', d, `REALIZADA Y SIN FACTURAR (+${d} días)`, SETTINGS.billing_not_done_warn_days, SETTINGS.billing_not_done_crit_days, base);
  } else if (stKey === WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO) {
    const base = getFechaFacturadaBase(p) || p.fechaCir || p.updatedAt || hoyISO();
    const d = diffDays(today, base);
    const otro = faltanteSegundoOjo(p);
    const otroTxt = otro === 'OD' ? 'OJO DERECHO' : otro === 'OI' ? 'OJO IZQUIERDO' : 'OTRO OJO';
    push('second_surgery_missing', d, `FACTURADA Y FALTA ${otroTxt} (+${d} días)`, SETTINGS.second_eye_missing_warn_days, SETTINGS.second_eye_missing_crit_days, base);
  }

  if (opts.raw) return res;
  return includeSilenced ? res : res.filter(a => !isSilenced(a));
}

export function readDomFilterSnapshot() {
  return {
    q: rawText(document.getElementById('q')?.value || '').toLowerCase(),
    fCli: rawText(document.getElementById('fCli')?.value || ''),
    fEst: rawText(document.getElementById('fEst')?.value || ''),
    fOS: rawText(document.getElementById('fOS')?.value || ''),
    fFechaCir: rawText(document.getElementById('fFechaCir')?.value || ''),
  };
}

export function applyPatientFilters(rows, filterSnapshot, opts = {}) {
  const {
    includeSearch = true,
    includeClinic = true,
    includeObraSocial = true,
    includeEstadoSelect = true,
    includeQuickFilter = true,
    includeFechaCir = true,
    stateKeys = null,
    customPredicate = null,
  } = opts || {};
  const { q = '', fCli = '', fEst = '', fOS = '', fFechaCir = '' } = filterSnapshot || {};
  const forcedStateKeys = Array.isArray(stateKeys) && stateKeys.length
    ? stateKeys.map(normalizeWorkflowKey)
    : null;

  return rows.filter(p => {
    if (includeClinic && fCli && p.clinica !== fCli) return false;
    if (includeObraSocial && fOS && p.obraSocial !== fOS) return false;
    if (includeFechaCir && fFechaCir && String(p.fechaCir || '').slice(0, 10) !== fFechaCir) return false;
    if (includeSearch && q) {
      const nom = String(p.nombre || '').toLowerCase();
      const dni = String(p.dni || '').toLowerCase();
      const afi = String(p.afiliado || '').toLowerCase();
      if (!nom.includes(q) && !dni.includes(q) && !afi.includes(q)) return false;
    }
    if (includeEstadoSelect && fEst && !matchesWorkflowFilter(p, fEst)) return false;
    if (includeQuickFilter && quickFilter && quickFilter !== WORKFLOW_KEYS.TODOS && !matchesWorkflowFilter(p, quickFilter)) return false;
    if (forcedStateKeys && !forcedStateKeys.some(k => matchesWorkflowFilter(p, k))) return false;
    if (typeof customPredicate === 'function' && !customPredicate(p)) return false;
    const pa = proximaAccion(p);
    const rowKey = stateKey(p);
    if (hideFinalizadasSinAccion && [WORKFLOW_KEYS.FACTURADA, WORKFLOW_KEYS.FINALIZADA].includes(rowKey) && pa.label === 'Sin acción' && !alertas(p).length) return false;
    return true;
  });
}

// ── Filtrado de filas ─────────────────────────────────────────────────────
export function filtered(opts = {}) {
  const {
    includeSearch = true,
    includeClinic = true,
    includeObraSocial = true,
    includeEstadoSelect = true,
    includeQuickFilter = true,
    includeFechaCir = true,
    stateKeys = null,
    sort = true,
    customPredicate = null,
  } = opts || {};

  const filters = readDomFilterSnapshot();
  let rows = applyPatientFilters(DB.rows, filters, {
    includeSearch,
    includeClinic,
    includeObraSocial,
    includeEstadoSelect,
    includeQuickFilter,
    includeFechaCir,
    stateKeys,
    customPredicate,
  });

  if (sort) {
    const sortVal = (p, col) => {
      switch (col) {
        case 'paciente':
        case 'nombre': return rawText(p.nombre).toLowerCase();
        case 'dni': return rawText(p.dni);
        case 'afiliado': return rawText(p.afiliado);
        case 'ojo': return rawText(p.ojo).toUpperCase();
        case 'obraSocial': return rawText(p.obraSocial).toLowerCase();
        case 'clinica': return rawText(p.clinica).toLowerCase();
        case 'estadoActual': return estado(p);
        case 'proximaAccion': return proximaAccion(p).label;
        case 'fechaClave': return rawText(p.fechaCir || p.fechaLlegaLente || p.fechaSolLente || '');
        case 'fechaCir': return rawText(p.fechaCir || '');
        case 'hora':
        case 'hora_cirugia': return rawText(p.hora_cirugia || p.hora || '');
        default: return p[col] ?? '';
      }
    };
    rows.sort((a, b) => {
      let va = sortVal(a, sortCol), vb = sortVal(b, sortCol);
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
  }

  return rows;
}

// ── Validación de fila antes de guardar ───────────────────────────────────
export function validarFila(p) {
  if (p.clinica) p.clinica = normalizarClinica(p.clinica);
  if (!p.ojos) p.ojos = '2 ojos';
  if (!p.ojo) p.ojo = 'OI';
  ['fechaSolLente', 'fechaLlegaLente', 'fechaCir', 'fechaFacturada'].forEach(k => {
    p[k] = normDateField(p[k]);
  });

  const cir = normText(p.estadoCir);
  if (cir === 'REALIZADA' || cir === 'SI' || cir === 'SÍ') p.estadoCir = 'Realizada';
  else if (cir === 'PROGRAMADA') p.estadoCir = 'Programada';
  else p.estadoCir = '';

  const fac = normText(p.estadoFac);
  if (fac === 'FACTURADA' || fac === 'SI' || fac === 'SÍ' || fac === 'FINALIZADA') p.estadoFac = 'FACTURADA';
  else if (fac === 'REALIZADA' || fac === 'FALTA FACTURAR' || fac === 'SIN FACTURAR' || fac === 'NO' || !fac) p.estadoFac = '';
  else p.estadoFac = '';

  if (!isFacturadoCompleto(p.estadoFac) && p.fechaFacturada) p.fechaFacturada = '';
  if (!hasValidDate(p.fechaCir)) p.hora = '';
  if (!hasValidDate(p.fechaCir) && p.estadoCir !== 'Realizada') p.estadoCir = '';
}

// ── Badge CSS según estado ───────────────────────────────────────────────
export function bc(e) {
  const key = normalizeWorkflowKey(e);
  const map = {
    [WORKFLOW_KEYS.FALTA_DIOPTRIA]: 'b0',
    [WORKFLOW_KEYS.PEDIR_LENTE]: 'b2',
    [WORKFLOW_KEYS.ESPERANDO_LENTE]: 'b3',
    [WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR]: 'b4',
    [WORKFLOW_KEYS.FECHA_PROGRAMADA]: 'b5',
    [WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR]: 'b6',
    [WORKFLOW_KEYS.FACTURADA]: 'b7',
    [WORKFLOW_KEYS.FINALIZADA]: 'b7',
    [WORKFLOW_KEYS.DEVOLVER_LENTE]: 'b8',
    [WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO]: 'b9',
  };
  return map[key] || 'b3';
}

// ── Backup diario ─────────────────────────────────────────────────────────
export function backupDiario() {
  const key = `cirugias_backup_${hoyISO()}`;
  if (localStorage.getItem(key)) return;
  try {
    const data = JSON.stringify(DB);
    localStorage.setItem(key, data);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cirugias_backup_')) {
        const dateStr = k.replace('cirugias_backup_', '');
        if (new Date(dateStr) < cutoff) toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch (_) { }
}

// ── Estado de label normalizado ───────────────────────────────────────────
export function estadoLabelNorm(v) { return normText(v); }
export function estadoLabelCanon(v) {
  const key = normalizeWorkflowKey(v);
  if (key === WORKFLOW_KEYS.TODOS) return 'TODOS';
  if ([
    WORKFLOW_KEYS.PEDIR_LENTE,
    WORKFLOW_KEYS.ESPERANDO_LENTE,
    WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
    WORKFLOW_KEYS.FECHA_PROGRAMADA,
    WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    WORKFLOW_KEYS.FACTURADA,
    WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO,
    WORKFLOW_KEYS.FINALIZADA,
    WORKFLOW_KEYS.DEVOLVER_LENTE,
    WORKFLOW_KEYS.FALTA_DIOPTRIA,
  ].includes(key)) return stateLabelFromKey(key);
  return rawText(v).replace(/\s+/g, ' ');
}

// ── isPamiRow helper ──────────────────────────────────────────────────────
export function isPamiRow(p) {
  return normText(p?.obraSocial) === 'PAMI';
}
