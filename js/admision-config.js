// admision-config.js — configuración compartida de Admisión y Lentess
'use strict';

import { DB } from './state.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const GENERAL_DOC = ['configuracion', 'general'];
const LENTESS_DOC = ['configuracion', 'lentess_entregas'];

function db() { return window.firestoreConnector?.getDb?.() || null; }
function norm(v) { return String(v ?? '').trim(); }
function upper(v) { return norm(v).toUpperCase(); }
function unique(arr) { return [...new Set((arr || []).map(norm).filter(Boolean))]; }
function makeId(v) {
  return norm(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `item_${Date.now()}`;
}
function rowsSedes() { return unique((DB.rows || []).map(r => r.clinica)); }
function rowsObras() { return unique((DB.rows || []).map(r => r.obraSocial)); }
function rowsObrasPorSede() {
  const out = {};
  (DB.rows || []).forEach(r => {
    const sede = norm(r.clinica);
    const os = norm(r.obraSocial);
    if (!sede || !os) return;
    if (!out[sede]) out[sede] = [];
    if (!out[sede].includes(os)) out[sede].push(os);
  });
  Object.keys(out).forEach(k => out[k].sort((a, b) => a.localeCompare(b, 'es')));
  return out;
}
function parseDias(v) {
  if (Array.isArray(v)) return v.map(x => norm(x).toLowerCase()).filter(Boolean);
  const s = norm(v).toLowerCase();
  if (!s) return ['lun','mar','mie','jue','vie'];
  if (s.includes('lunes') && s.includes('viernes')) return ['lun','mar','mie','jue','vie'];
  const map = { lunes:'lun', martes:'mar', miercoles:'mie', miércoles:'mie', jueves:'jue', viernes:'vie', sabado:'sab', sábado:'sab', domingo:'dom', l:'lun', m:'mar', x:'mie', j:'jue', v:'vie', s:'sab', d:'dom' };
  const out = s.split(/[;,\s]+/).map(x => map[x] || x).filter(x => ['lun','mar','mie','jue','vie','sab','dom'].includes(x));
  return out.length ? out : ['lun','mar','mie','jue','vie'];
}

export function normalizeGeneralConfig(data = {}) {
  const byRows = rowsObrasPorSede();
  const savedBySede = data.obrasPorSede && typeof data.obrasPorSede === 'object' ? data.obrasPorSede : {};
  const sedes = unique([...(data.sedes || []), ...Object.keys(savedBySede), ...rowsSedes(), 'CDU', 'Gualeguaychú']);
  const obrasPorSede = {};
  sedes.forEach(sede => {
    obrasPorSede[sede] = unique([...(savedBySede[sede] || []), ...(byRows[sede] || []), 'PAMI']);
  });
  const obrasSociales = unique([...(data.obrasSociales || []), ...rowsObras(), ...Object.values(obrasPorSede).flat(), 'PAMI', 'PARTICULAR']);
  return { ...data, sedes, obrasSociales, obrasPorSede, obraSocialDefault: data.obraSocialDefault || 'PAMI' };
}

export function getAdmisionOptions() {
  const cached = window.ADMISION_CONFIG_CACHE || {};
  return normalizeGeneralConfig(cached);
}

export async function loadAdmisionConfig() {
  const conn = db();
  if (!conn) {
    window.ADMISION_CONFIG_CACHE = normalizeGeneralConfig({});
    return window.ADMISION_CONFIG_CACHE;
  }
  const snap = await getDoc(doc(conn, ...GENERAL_DOC));
  window.ADMISION_CONFIG_CACHE = normalizeGeneralConfig(snap.exists() ? snap.data() : {});
  return window.ADMISION_CONFIG_CACHE;
}

export async function ensureAdmisionForPatient(row) {
  const clinica = norm(row?.clinica);
  const obraSocial = norm(row?.obraSocial);
  if (!clinica && !obraSocial) return;
  const conn = db();
  const current = conn ? await loadAdmisionConfig().catch(() => getAdmisionOptions()) : getAdmisionOptions();
  const cfg = normalizeGeneralConfig(current);
  if (clinica) cfg.sedes = unique([...(cfg.sedes || []), clinica]);
  if (obraSocial) cfg.obrasSociales = unique([...(cfg.obrasSociales || []), obraSocial]);
  if (clinica && obraSocial) {
    cfg.obrasPorSede = cfg.obrasPorSede || {};
    cfg.obrasPorSede[clinica] = unique([...(cfg.obrasPorSede[clinica] || []), obraSocial]);
  }
  window.ADMISION_CONFIG_CACHE = normalizeGeneralConfig(cfg);
  if (!conn) return;
  await setDoc(doc(conn, ...GENERAL_DOC), {
    sedes: window.ADMISION_CONFIG_CACHE.sedes,
    obrasSociales: window.ADMISION_CONFIG_CACHE.obrasSociales,
    obrasPorSede: window.ADMISION_CONFIG_CACHE.obrasPorSede,
    obraSocialDefault: 'PAMI',
    updatedAt: serverTimestamp(),
    updatedBy: norm(window.CURRENT_USER?.email)
  }, { merge: true });
}

export function normalizeEntrega(raw = {}) {
  const clinica = norm(raw.clinica || raw.sede);
  const nombre = norm(raw.nombre || raw.lugar || raw.nombreVisible);
  const fraseLugar = norm(raw.fraseLugar || raw.frase_lugar || raw.frasePami);
  return {
    id: norm(raw.id) || makeId(`${clinica}_${nombre}_${fraseLugar}`),
    clinica,
    nombre,
    fraseLugar,
    direccion: norm(raw.direccion || raw.domicilio || ''),
    dias: parseDias(raw.dias),
    desde: norm(raw.desde || '08:00'),
    hasta: norm(raw.hasta || '14:00'),
    personalAutorizado: norm(raw.personalAutorizado || raw.personal_autorizado || '')
  };
}

export async function loadLentessEntregas() {
  const conn = db();
  if (!conn) return [];
  const snap = await getDoc(doc(conn, ...LENTESS_DOC));
  const data = snap.exists() ? snap.data() : {};
  const lugares = Array.isArray(data.lugares) ? data.lugares : [];
  return lugares.map(normalizeEntrega).filter(l => l.clinica && l.nombre && l.fraseLugar);
}

export function entregaKey(entrega = {}) {
  const e = normalizeEntrega(entrega);
  return `${upper(e.clinica)}|${upper(e.fraseLugar)}|${upper(e.nombre)}`;
}

export function sameEntrega(a, b) { return entregaKey(a) === entregaKey(b); }

export function entregaForClinica(lugares, clinica, explicitId = '') {
  const sid = norm(explicitId);
  const sede = upper(clinica);
  const list = (lugares || []).map(normalizeEntrega).filter(l => l.clinica && l.fraseLugar);
  if (sid) return list.find(l => String(l.id) === sid) || null;
  return list.find(l => upper(l.clinica) === sede) || null;
}
