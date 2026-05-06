'use strict';

import { canManageUsers } from './authz.js';
import { toast, escapeHtml, escapeAttr } from './utils.js';
import { DB } from './state.js';

import {
  collection, getDocs, doc, setDoc, updateDoc, serverTimestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

async function dbOrThrow() {
  const db = window.firestoreConnector?.getDb?.();
  if (!db) throw new Error('Firestore no disponible');
  return db;
}

function norm(v) { return String(v ?? '').trim(); }
function unique(arr) { return [...new Set((arr || []).map(norm).filter(Boolean))]; }
function makeId(v) {
  return norm(v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `item_${Date.now()}`;
}
function splitList(v) { return unique(String(v || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean)); }
function rowsSedes() { return unique(DB.rows.map(r => r.clinica)); }
function rowsObras() { return unique(DB.rows.map(r => r.obraSocial)); }
function rowsObrasPorSede() {
  const out = {};
  DB.rows.forEach(r => {
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
  if (!s) return ['lun', 'mar', 'mie', 'jue', 'vie'];
  if (s.includes('lunes') && s.includes('viernes')) return ['lun', 'mar', 'mie', 'jue', 'vie'];
  const map = { lunes:'lun', martes:'mar', miercoles:'mie', miércoles:'mie', jueves:'jue', viernes:'vie', sabado:'sab', sábado:'sab', domingo:'dom', l:'lun', m:'mar', x:'mie', j:'jue', v:'vie', s:'sab', d:'dom' };
  const out = s.split(/[;,\s]+/).map(x => map[x] || x).filter(x => ['lun','mar','mie','jue','vie','sab','dom'].includes(x));
  return out.length ? out : ['lun', 'mar', 'mie', 'jue', 'vie'];
}
function formatDias(v) { return parseDias(v).join(','); }
function normalizeGeneralConfig(data = {}) {
  const byRows = rowsObrasPorSede();
  const savedBySede = data.obrasPorSede && typeof data.obrasPorSede === 'object' ? data.obrasPorSede : {};
  const sedes = unique([...(data.sedes || []), ...Object.keys(savedBySede), ...rowsSedes()]);
  const obrasPorSede = {};
  sedes.forEach(sede => {
    obrasPorSede[sede] = unique([...(savedBySede[sede] || []), ...(byRows[sede] || [])]);
  });
  const obrasSociales = unique([...(data.obrasSociales || []), ...rowsObras(), ...Object.values(obrasPorSede).flat(), 'PAMI']);
  return { ...data, sedes, obrasSociales, obrasPorSede, obraSocialDefault: data.obraSocialDefault || 'PAMI' };
}
function normalizeLugar(l = {}) {
  const clinica = norm(l.clinica || l.sede);
  const nombre = norm(l.nombre || l.lugar || l.nombreVisible);
  const fraseLugar = norm(l.fraseLugar || l.frase_lugar || l.frasePami);
  return {
    id: norm(l.id) || makeId(`${clinica}_${nombre}_${fraseLugar}`),
    clinica,
    nombre,
    fraseLugar,
    direccion: norm(l.direccion || l.domicilio || ''),
    dias: parseDias(l.dias),
    desde: norm(l.desde) || '08:00',
    hasta: norm(l.hasta) || '14:00',
    personalAutorizado: norm(l.personalAutorizado || l.personal_autorizado || '')
  };
}
function normalizeLentessConfig(data = {}) {
  const lugares = Array.isArray(data.lugares) ? data.lugares.map(normalizeLugar).filter(l => l.clinica && l.nombre && l.fraseLugar) : [];
  return { lugares };
}

async function loadUsers() {
  const db = await dbOrThrow();
  const snap = await getDocs(collection(db, 'usuarios'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadGeneralConfig() {
  const db = await dbOrThrow();
  const ref = doc(db, 'configuracion', 'general');
  const snap = await getDoc(ref);
  return normalizeGeneralConfig(snap.exists() ? snap.data() : {});
}
async function saveGeneralConfig(payload) {
  const db = await dbOrThrow();
  await setDoc(doc(db, 'configuracion', 'general'), { ...normalizeGeneralConfig(payload), updatedAt: serverTimestamp(), updatedBy: norm(window.CURRENT_USER?.email) }, { merge: true });
}
async function loadLentessConfig() {
  const db = await dbOrThrow();
  const ref = doc(db, 'configuracion', 'lentess_entregas');
  const snap = await getDoc(ref);
  return normalizeLentessConfig(snap.exists() ? snap.data() : {});
}
async function saveLentessConfig(payload) {
  const db = await dbOrThrow();
  await setDoc(doc(db, 'configuracion', 'lentess_entregas'), { ...normalizeLentessConfig(payload), updatedAt: serverTimestamp(), updatedBy: norm(window.CURRENT_USER?.email) }, { merge: true });
}

function userIsAdmin(u) {
  return ['admin_principal', 'superadmin', 'administrador', 'admin'].includes(String(u.role || '').toLowerCase()) || u.admin === true;
}
function nextRoleForUser(u, isAdmin) {
  if (!isAdmin) return 'operador';
  return String(u.role || '').toLowerCase() === 'superadmin' ? 'superadmin' : 'admin_principal';
}
function renderUsers(users) {
  return `
    <section class="admin-card admin-users-card">
      <div class="admin-card-head">
        <div><h3>Usuarios</h3><p>Solo datos necesarios: mail, permiso de administrador y estado activo.</p></div>
      </div>
      <div class="admin-table-wrap">
        <table class="wa-table admin-table">
          <thead><tr><th>Mail</th><th style="width:150px">Administrador</th><th style="width:120px">Activo</th><th style="width:120px">Acción</th></tr></thead>
          <tbody>${users.map(u => `<tr>
            <td><strong>${escapeHtml(u.email || '')}</strong>${u.role === 'superadmin' ? '<div class="cell-sub">superadmin</div>' : ''}</td>
            <td><label class="admin-check"><input type="checkbox" data-u-id="${escapeAttr(u.id)}" data-field="admin" ${userIsAdmin(u) ? 'checked' : ''}> Sí</label></td>
            <td><label class="admin-check"><input type="checkbox" data-u-id="${escapeAttr(u.id)}" data-field="active" ${u.active ? 'checked' : ''}> Activo</label></td>
            <td><button class="btn" data-user-save="${escapeAttr(u.id)}">Guardar</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`;
}
function renderAdmision(cfg) {
  const sedes = unique([...(cfg.sedes || []), ...rowsSedes()]);
  const obrasGlobal = unique([...(cfg.obrasSociales || []), ...rowsObras(), 'PAMI']);
  const obrasPorSede = cfg.obrasPorSede || {};
  const sedeCards = sedes.length ? sedes.map(sede => {
    const obras = unique([...(obrasPorSede[sede] || []), ...(rowsObrasPorSede()[sede] || [])]);
    return `<div class="admin-mini-card">
      <div class="admin-mini-title">${escapeHtml(sede)}</div>
      <label>Obras sociales de esta sede</label>
      <textarea class="adm-obras-sede" data-sede="${escapeAttr(sede)}" rows="5">${escapeHtml(obras.join('\n'))}</textarea>
      <div class="admin-help">Una por línea. Si se escribe una nueva en un paciente de esta sede, se agrega automáticamente.</div>
    </div>`;
  }).join('') : `<div class="admin-empty">Todavía no hay sedes cargadas.</div>`;

  return `
    <section class="admin-card">
      <div class="admin-card-head">
        <div><h3>Admisión</h3><p>Sedes y obras sociales se toman de pacientes reales y de lo guardado manualmente. Nuevo paciente usa PAMI por defecto.</p></div>
      </div>
      <div class="admin-grid-2">
        <label>Sedes / clínicas
          <textarea id="admSedes" rows="6" placeholder="Una por línea">${escapeHtml(sedes.join('\n'))}</textarea>
        </label>
        <label>Obras sociales generales
          <textarea id="admObrasGlobal" rows="6" placeholder="Una por línea">${escapeHtml(obrasGlobal.join('\n'))}</textarea>
        </label>
      </div>
      <div class="admin-section-title">Obras sociales por sede</div>
      <div class="admin-sede-grid">${sedeCards}</div>
      <div class="admin-actions">
        <button id="admGuardar" class="btn primary">Guardar admisión</button>
        <button id="admSincronizar" class="btn">Sincronizar desde pacientes existentes</button>
      </div>
    </section>`;
}
function renderLentess(cfg, generalCfg) {
  const sedes = unique([...(generalCfg.sedes || []), ...rowsSedes()]);
  const lugares = Array.isArray(cfg.lugares) ? cfg.lugares : [];
  const rows = lugares.length ? lugares : [{ id: '', clinica: sedes[0] || '', nombre: '', fraseLugar: '', direccion: '', dias: ['lun','mar','mie','jue','vie'], desde: '08:00', hasta: '14:00', personalAutorizado: '' }];
  return `
    <section class="admin-card">
      <div class="admin-card-head">
        <div><h3>Lentess · lugares de entrega</h3><p>Datos que usa el runner: sede, frase clave de PAMI, dirección y horario. No se crean opciones automáticas.</p></div>
        <button id="lentessAddLugar" class="btn">+ Agregar lugar</button>
      </div>
      <div id="lentessAdminList" class="lentess-admin-list">
        ${rows.map((l, idx) => renderLugarRow(normalizeLugar(l), sedes, idx)).join('')}
      </div>
      <div class="admin-actions">
        <button id="lentessGuardar" class="btn primary">Guardar lugares de Lentess</button>
      </div>
    </section>`;
}
function renderLugarRow(l, sedes, idx) {
  const sedeOptions = unique([...sedes, l.clinica]).map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  return `<div class="lentess-lugar-row" data-lugar-row>
    <div class="lrow-head"><strong>Lugar ${idx + 1}</strong><button type="button" class="btn btn-small" data-remove-lugar>Eliminar</button></div>
    <div class="admin-grid-3">
      <label>Sede / clínica<input class="lentess-field" data-k="clinica" list="adminSedesList" value="${escapeAttr(l.clinica)}" placeholder="Ej: CDU"></label>
      <label>Nombre visible<input class="lentess-field" data-k="nombre" value="${escapeAttr(l.nombre)}" placeholder="Ej: Primera Junta"></label>
      <label>Frase clave PAMI<input class="lentess-field" data-k="fraseLugar" value="${escapeAttr(l.fraseLugar)}" placeholder="Ej: PRIMERA JUNTA"></label>
      <label>Dirección<input class="lentess-field" data-k="direccion" value="${escapeAttr(l.direccion || '')}" placeholder="Dirección que corresponde al lugar"></label>
      <label>Días<input class="lentess-field" data-k="dias" value="${escapeAttr(formatDias(l.dias))}" placeholder="lun,mar,mie,jue,vie"></label>
      <label>Desde<input class="lentess-field" data-k="desde" value="${escapeAttr(l.desde)}" placeholder="08:00"></label>
      <label>Hasta<input class="lentess-field" data-k="hasta" value="${escapeAttr(l.hasta)}" placeholder="14:00"></label>
      <label class="span-2">Personal autorizado<input class="lentess-field" data-k="personalAutorizado" value="${escapeAttr(l.personalAutorizado || '')}" placeholder="Nombre del personal autorizado"></label>
    </div>
  </div>`;
}
function collectLugares() {
  return [...document.querySelectorAll('[data-lugar-row]')].map(row => {
    const obj = {};
    row.querySelectorAll('.lentess-field').forEach(inp => obj[inp.dataset.k] = inp.value);
    const n = normalizeLugar(obj);
    n.id = makeId(`${n.clinica}_${n.nombre}_${n.fraseLugar}`);
    return n;
  }).filter(l => l.clinica && l.nombre && l.fraseLugar);
}
function installAdminCss() {
  if (document.getElementById('adminVistaStyles')) return;
  const st = document.createElement('style');
  st.id = 'adminVistaStyles';
  st.textContent = `
    .admin-shell{display:grid;gap:14px}
    .admin-card{background:#fff;border:1px solid #dbe5f4;border-radius:16px;padding:16px;box-shadow:0 8px 22px #0f172a0d}
    .admin-card h3{margin:0;color:#0f172a;font-size:17px;font-weight:900}.admin-card p{margin:4px 0 0;color:#64748b;font-size:12px}
    .admin-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
    .admin-table-wrap{overflow:auto}.admin-table input[type='checkbox']{width:16px;height:16px}.admin-check{display:inline-flex;gap:6px;align-items:center;font-size:13px}
    .admin-grid-2{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:12px}.admin-grid-3{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px}
    .admin-grid-2 label,.admin-grid-3 label{font-size:12px;font-weight:700;color:#334155}.admin-grid-2 input,.admin-grid-2 textarea,.admin-grid-3 input,.admin-mini-card textarea{width:100%;box-sizing:border-box;margin-top:5px;border:1px solid #cbd5e1;border-radius:10px;padding:9px;font-family:inherit;background:#fff}
    .admin-section-title{font-size:13px;font-weight:900;color:#0f172a;margin:14px 0 8px}.admin-sede-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}
    .admin-mini-card{border:1px solid #e2e8f0;border-radius:13px;background:#f8fbff;padding:12px}.admin-mini-title{font-size:14px;font-weight:900;margin-bottom:8px;color:#1e40af}.admin-help{font-size:11px;color:#64748b;margin-top:6px}
    .admin-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.admin-empty{padding:12px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;background:#f8fafc;font-size:12px}
    .lentess-admin-list{display:grid;gap:10px}.lentess-lugar-row{border:1px solid #dbe5f4;border-radius:14px;padding:12px;background:#f8fbff}.lrow-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.btn-small{padding:5px 9px;font-size:12px}.span-2{grid-column:span 2}
    @media(max-width:900px){.admin-grid-2,.admin-grid-3{grid-template-columns:1fr}.span-2{grid-column:auto}.admin-card-head{display:grid}}
  `;
  document.head.appendChild(st);
}

async function renderAdminContent() {
  const wrap = document.getElementById('adminView');
  if (!wrap) return;
  installAdminCss();
  if (!canManageUsers()) {
    wrap.innerHTML = '<div class="empty">No tenés permisos para Administración.</div>';
    return;
  }

  try {
    const [users, generalCfg, lentessCfg] = await Promise.all([loadUsers(), loadGeneralConfig(), loadLentessConfig()]);
    const sedesList = unique([...(generalCfg.sedes || []), ...rowsSedes()]);
    wrap.innerHTML = `
      <div class="admin-shell">
        <datalist id="adminSedesList">${sedesList.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
        ${renderUsers(users)}
        ${renderAdmision(generalCfg)}
        ${renderLentess(lentessCfg, generalCfg)}
      </div>`;

    wrap.querySelectorAll('[data-user-save]').forEach(btn => btn.addEventListener('click', async ev => {
      const uid = ev.target.dataset.userSave;
      const user = users.find(u => String(u.id) === String(uid));
      const isAdmin = !!wrap.querySelector(`[data-u-id="${CSS.escape(uid)}"][data-field="admin"]`)?.checked;
      const active = !!wrap.querySelector(`[data-u-id="${CSS.escape(uid)}"][data-field="active"]`)?.checked;
      const db = await dbOrThrow();
      await updateDoc(doc(db, 'usuarios', uid), { role: nextRoleForUser(user || {}, isAdmin), active, updatedAt: serverTimestamp() });
      toast('Usuario actualizado');
    }));

    document.getElementById('admGuardar')?.addEventListener('click', async () => {
      const current = await loadGeneralConfig();
      const sedes = splitList(document.getElementById('admSedes')?.value || '');
      const obrasSociales = splitList(document.getElementById('admObrasGlobal')?.value || '');
      const obrasPorSede = { ...(current.obrasPorSede || {}) };
      wrap.querySelectorAll('.adm-obras-sede').forEach(txt => {
        const sede = norm(txt.dataset.sede);
        if (sede) obrasPorSede[sede] = splitList(txt.value || '');
      });
      await saveGeneralConfig({ ...current, sedes, obrasSociales, obrasPorSede, obraSocialDefault: 'PAMI' });
      toast('Admisión guardada');
      renderAdminContent();
    });
    document.getElementById('admSincronizar')?.addEventListener('click', async () => {
      const current = await loadGeneralConfig();
      await saveGeneralConfig(current);
      toast('Sincronizado desde pacientes existentes');
      renderAdminContent();
    });

    document.getElementById('lentessAddLugar')?.addEventListener('click', () => {
      const list = document.getElementById('lentessAdminList');
      const idx = list.querySelectorAll('[data-lugar-row]').length;
      list.insertAdjacentHTML('beforeend', renderLugarRow(normalizeLugar({ clinica: sedesList[0] || '', dias: ['lun','mar','mie','jue','vie'] }), sedesList, idx));
    });
    wrap.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-remove-lugar]');
      if (!btn) return;
      const row = btn.closest('[data-lugar-row]');
      if (row) row.remove();
    });
    document.getElementById('lentessGuardar')?.addEventListener('click', async () => {
      const lugares = collectLugares();
      await saveLentessConfig({ lugares });
      toast('Lugares de Lentess guardados');
      renderAdminContent();
    });
  } catch (e) {
    wrap.innerHTML = `<div class="empty">Error cargando administración: ${escapeHtml(String(e?.message || e))}</div>`;
  }
}

export function renderAdministracion() {
  renderAdminContent();
}
