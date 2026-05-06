'use strict';

import { save } from './firebase-ui.js';
import { canViewRowHistory } from './authz.js';

import {
  collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const AUDIT_FIELDS = [
  'nombre', 'dni', 'afiliado', 'obraSocial', 'clinica', 'ojo', 'dioptria',
  'fechaCir', 'hora', 'estadoCir', 'estadoFac', 'fechaFacturacion', 'fechaFacturada',
  'extraVitrectomia', 'ecografiaImagen', 'ecografiaMes', 'facturarSeleccionado'
];

function same(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
function diffRows(before = {}, after = {}, fields = AUDIT_FIELDS) {
  return fields
    .filter(f => !same(before?.[f], after?.[f]))
    .map(f => ({ campo: f, antes: before?.[f] ?? null, despues: after?.[f] ?? null }));
}
function fmtDate(v) {
  if (!v) return '—';
  if (typeof v?.toDate === 'function') return v.toDate().toLocaleString('es-AR');
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toLocaleString('es-AR');
  return String(v);
}
function htmlVal(v) {
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

async function writeAuditDocs(rowAfter, cambios, contexto = {}) {
  const db = window.firestoreConnector?.getDb?.();
  const user = window.CURRENT_USER || {};
  if (!db || !rowAfter?.id || !cambios.length) return;

  const base = {
    fecha: new Date().toISOString(),
    usuarioUid: user.uid || '',
    usuarioEmail: user.email || '',
    usuarioNombre: user.profile?.nombre || user.profile?.displayName || '',
    usuarioRol: user.profile?.role || '',
    pacienteId: String(rowAfter.id || ''),
    pacienteNombre: String(rowAfter.nombre || ''),
    modulo: contexto.modulo || 'Operación',
    accion: contexto.accion || 'EDITAR_FILA',
    detalle: contexto.detalle || '',
    cambios
  };

  await addDoc(collection(db, 'cirugias', String(rowAfter.id), 'historial'), { ...base, fechaSrv: serverTimestamp() });
  await addDoc(collection(db, 'auditoria'), {
    fecha: base.fecha,
    usuarioEmail: base.usuarioEmail,
    usuarioUid: base.usuarioUid,
    usuarioRol: base.usuarioRol,
    accion: base.accion,
    pacienteId: base.pacienteId,
    pacienteNombre: base.pacienteNombre,
    antes: Object.fromEntries(cambios.map(c => [c.campo, c.antes])),
    despues: Object.fromEntries(cambios.map(c => [c.campo, c.despues])),
    modulo: base.modulo,
    detalle: base.detalle,
    fechaSrv: serverTimestamp()
  });
}

export async function saveWithAudit(rowBefore, rowAfter, contexto = {}) {
  const cambios = diffRows(rowBefore, rowAfter);
  if (!cambios.length && contexto.accion !== 'CREAR_PACIENTE') return;
  await save(rowAfter);
  const cambiosFinales = cambios.length ? cambios : [{ campo: 'paciente', antes: null, despues: rowAfter?.nombre || `ID ${rowAfter?.id || ''}` }];
  try { await writeAuditDocs(rowAfter, cambiosFinales, contexto); } catch (e) { console.warn('[audit] no se pudo registrar', e?.message || e); }
}

function fallbackHistory(row) {
  const items = [];
  if (row?.createdAt || row?.fechaCarga) {
    items.push({
      fecha: row.createdAt || row.fechaCarga,
      usuarioNombre: row.createdByName || row.createdByEmail || row.updatedByEmail || 'Usuario no registrado',
      modulo: 'Operación',
      accion: 'CREAR_PACIENTE',
      cambios: [{ campo: 'paciente', antes: null, despues: row.nombre || `ID ${row.id}` }]
    });
  }
  if (row?.updatedAt && row.updatedAt !== row.createdAt) {
    items.push({
      fecha: row.updatedAt,
      usuarioNombre: row.updatedByName || row.updatedByEmail || 'Usuario no registrado',
      modulo: 'Sistema',
      accion: 'ÚLTIMA_ACTUALIZACIÓN',
      cambios: [{ campo: 'registro', antes: null, despues: 'Paciente actualizado' }]
    });
  }
  return items;
}

function renderItems(items) {
  return items.length ? items.map(it => {
    const cambios = Array.isArray(it.cambios) ? it.cambios : [];
    return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:8px;background:#fff">
      <div style="font-weight:700;color:#0f172a">${fmtDate(it.fecha || it.fechaSrv)} · ${it.usuarioNombre || it.usuarioEmail || '—'}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">Módulo: ${it.modulo || '—'} · Acción: ${it.accion || '—'}${it.detalle ? ` · ${it.detalle}` : ''}</div>
      <ul style="margin:6px 0 0 18px">${cambios.map(c => `<li><strong>${c.campo}</strong>: ${htmlVal(c.antes)} → ${htmlVal(c.despues)}</li>`).join('')}</ul>
    </div>`;
  }).join('') : '<div class="empty">No hay historial para este paciente.</div>';
}

export async function openRowHistoryModal(row) {
  if (!row?.id || !canViewRowHistory()) return;
  const modal = document.getElementById('historyModal');
  const body = document.getElementById('historyBody');
  const ttl = document.getElementById('historyTitle');
  if (!modal || !body || !ttl) return;
  ttl.textContent = `Historial de modificaciones · ${row.nombre || `ID ${row.id}`}`;
  body.innerHTML = '<div class="empty">Cargando historial…</div>';
  modal.style.display = 'flex';

  try {
    const db = window.firestoreConnector?.getDb?.();
    if (!db) throw new Error('Firestore no disponible');
    const q = query(collection(db, 'cirugias', String(row.id), 'historial'), orderBy('fecha', 'desc'), limit(20));
    const snap = await getDocs(q);
    const items = snap.docs.map(d => d.data());
    body.innerHTML = renderItems(items.length ? items : fallbackHistory(row));
  } catch (e) {
    const fb = fallbackHistory(row);
    body.innerHTML = fb.length
      ? `<div style="font-size:12px;color:#b45309;margin-bottom:8px">No se pudo leer el historial detallado: ${String(e?.message || e)}. Se muestra información básica del registro.</div>${renderItems(fb)}`
      : `<div class="empty">No se pudo cargar historial: ${String(e?.message || e)}</div>`;
  }
}

export function closeRowHistoryModal() {
  const modal = document.getElementById('historyModal');
  if (modal) modal.style.display = 'none';
}
