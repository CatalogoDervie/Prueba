// whatsapp.js — Vista operativa de WhatsApp

'use strict';

import { DB, estado, stateKey, filtered, WORKFLOW_KEYS } from './state.js';
import { save } from './firebase-ui.js';
import { toast, idbSet, cleanDigits, escapeHtml, escapeAttr } from './utils.js';
import { maybeAbrirRecetasPostDocs } from './recetas.js';

let WA_ROWS = [];
let WA_ENVIADOS = 0;
let WA_ERRORES = 0;
let WA_STOP = false;
let WA_STATUS_MAP = {};
let WA_TRACKING_MAP = JSON.parse(localStorage.getItem('wa_tracking_map') || '{}');
let WA_CONFIRMED_MAP = JSON.parse(localStorage.getItem('wa_confirmed_map') || '{}');
let WA_PHONE_OVERRIDE = JSON.parse(localStorage.getItem('wa_phone_override') || '{}');
let WA_GLOBAL_DATE = localStorage.getItem('wa_global_date') || '';
let WA_PREF = {
  channel: localStorage.getItem('wa_channel') || 'desktop',
  delay: parseInt(localStorage.getItem('wa_delay_ms') || '4000', 10) || 4000,
  stageFilter: localStorage.getItem('wa_stage_filter') || WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
  sortKey: localStorage.getItem('wa_sort_key') || 'default',
};

const WA_STAGE_OPTIONS = [
  { key: WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR, label: 'Llegó lente - programar' },
  { key: WORKFLOW_KEYS.FECHA_PROGRAMADA, label: 'Fecha programada' },
  { key: WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR, label: 'Para facturar' },
  { key: WORKFLOW_KEYS.PEDIR_LENTE, label: 'Pedir lente' },
  { key: WORKFLOW_KEYS.ESPERANDO_LENTE, label: 'Esperando lente' },
  { key: 'ALL', label: 'Todos los operativos' },
];

function saveWaPrefs() {
  localStorage.setItem('wa_channel', WA_PREF.channel);
  localStorage.setItem('wa_delay_ms', String(WA_PREF.delay));
  localStorage.setItem('wa_stage_filter', WA_PREF.stageFilter || WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR);
  localStorage.setItem('wa_sort_key', WA_PREF.sortKey || 'default');
  localStorage.setItem('wa_tracking_map', JSON.stringify(WA_TRACKING_MAP));
  localStorage.setItem('wa_confirmed_map', JSON.stringify(WA_CONFIRMED_MAP));
  localStorage.setItem('wa_phone_override', JSON.stringify(WA_PHONE_OVERRIDE));
  localStorage.setItem('wa_global_date', WA_GLOBAL_DATE || '');
}

function normalizePhone(v) {
  let n = cleanDigits(v || '');
  if (!n) return '';
  if (n.startsWith('0')) n = n.replace(/^0+/, '');
  if (n.startsWith('54')) return n;
  if (n.length >= 10) return `54${n}`;
  return n;
}
function isValidPhone(v) { return cleanDigits(v).length >= 10; }
function normText(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim(); }
function waFmtTs(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (isNaN(dt)) return '—';
  return `${dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
}
function waPatientKey(r) { return String(r.sourceId || `${r.patient_id || ''}|${r.CLINICA || ''}|${normText(r.PACIENTE || '')}`); }
function waTracking(r) { return WA_TRACKING_MAP[waPatientKey(r)] || {}; }
function waTrackingText(r) {
  const t = waTracking(r);
  const bits = [];
  if (t.turnoAt) bits.push(`✅ Turno enviado (${waFmtTs(t.turnoAt)})`);
  if (t.docsAt) bits.push(`✅ Docs enviados (${waFmtTs(t.docsAt)})`);
  return bits.join('<br>') || '⏳ Sin envíos';
}
function waGetSourceRow(r) { return DB.rows.find(x => String(x.id) === String(r.sourceId)) || null; }
function waGetRowPhone(r) { const over = WA_PHONE_OVERRIDE[waPatientKey(r)]; return String((over ?? r.TELEFONO ?? '')).trim(); }
function normalizeHoraText(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  s = s.replace(/[^0-9:]/g, '');
  if (/^\d{1,2}$/.test(s)) s = `${s.padStart(2, '0')}:00`;
  else if (/^\d{3,4}$/.test(s)) s = `${s.slice(0, -2).padStart(2, '0')}:${s.slice(-2)}`;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return s;
  const hh = Math.min(Math.max(parseInt(m[1], 10) || 0, 0), 23);
  const mm = Math.min(Math.max(parseInt(m[2], 10) || 0, 0), 59);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function waGetRowHora(r) { const p = waGetSourceRow(r); return normalizeHoraText(p?.hora_cirugia || p?.hora || r.HORA || ''); }
function waStatusText(r) { return WA_STATUS_MAP[waPatientKey(r)] || '⏳ Pendiente'; }
function waStatusClass(r) {
  const txt = waStatusText(r);
  if (txt.startsWith('❌')) return 'wa-estado err';
  if (txt.startsWith('✅')) return 'wa-estado ok';
  return 'wa-estado pend';
}
function waSetStatus(r, msg) { WA_STATUS_MAP[waPatientKey(r)] = msg; }
function waPaintStatusInRow(input, r) {
  const tr = input?.closest('tr');
  const st = tr?.querySelector('.wa-estado');
  if (!st) return;
  st.className = waStatusClass(r);
  st.textContent = waStatusText(r);
}

function formatFechaLarga(fechaTexto) {
  const d = fechaTexto ? new Date(`${fechaTexto}T12:00:00`) : null;
  if (!d || isNaN(d)) return String(fechaTexto || '');
  const texto = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Argentina/Buenos_Aires'
  }).format(d).replace(',', '').trim();
  const p = texto.split(' ');
  const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  return `${cap(p[0] || '')} ${p[1] || ''} de ${cap(p[3] || p[2] || '')}`.trim();
}
function waOjoTexto(ojo) {
  const o = String(ojo || '').toUpperCase();
  if (o.includes('OD')) return 'Derecho';
  if (o.includes('OI')) return 'Izquierdo';
  return '';
}

function waBaseRows() {
  return filtered({
    includeQuickFilter: false,
    includeEstadoSelect: false,
    stateKeys: [
      WORKFLOW_KEYS.PEDIR_LENTE,
      WORKFLOW_KEYS.ESPERANDO_LENTE,
      WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR,
      WORKFLOW_KEYS.FECHA_PROGRAMADA,
      WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR,
    ]
  });
}

function waFromInternal() {
  const rows = waBaseRows().map(p => ({
    source: 'internal',
    sourceId: p.id,
    patient_id: String(p.dni || ''),
    PACIENTE: p.nombre || '',
    TELEFONO: p.tel || '',
    FECHA: p.fechaCir || '',
    HORA: (p.hora_cirugia || p.hora || ''),
    OJO: p.ojo || '',
    ESTADO: estado(p),
    ESTADO_KEY: stateKey(p),
    CLINICA: p.clinica || '',
  }));

  if (!WA_PREF.stageFilter || WA_PREF.stageFilter === 'ALL') return rows;
  return rows.filter(r => r.ESTADO_KEY === WA_PREF.stageFilter);
}

function waCounter() {
  const c = document.getElementById('waContador');
  if (c) c.innerText = `Enviados: ${WA_ENVIADOS} | Errores: ${WA_ERRORES}`;
}
function waResetCounters() { WA_ENVIADOS = 0; WA_ERRORES = 0; waCounter(); }
function waBuildUrl(phone, msg) {
  return WA_PREF.channel === 'web'
    ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`
    : `whatsapp://send?phone=${phone}&text=${encodeURIComponent(msg)}`;
}
function waDoOpen(phone, msg) {
  const url = waBuildUrl(phone, msg);
  if (WA_PREF.channel === 'web') window.open(url, '_blank', 'noopener,noreferrer');
  else window.location.href = url;
}
function waRenderTemplate(tpl, r, hora) {
  const src = waGetSourceRow(r);
  const ojo = (r.OJO || src?.ojo || '');
  const vars = {
    PACIENTE: r.PACIENTE || '',
    FECHA_LARGA: formatFechaLarga(WA_GLOBAL_DATE),
    HORA: hora || '',
    OJO: ojo,
    OJO_TEXTO: waOjoTexto(ojo)
  };
  return String(tpl || '').replace(/\{\{\s*(PACIENTE|FECHA_LARGA|HORA|OJO|OJO_TEXTO)\s*\}\}/g, (_, k) => String(vars[k] || ''));
}

const WA_CONFIRM_TPL = `Buenas tardes, {{PACIENTE}}.

Desde el *Centro de Ojos Esteves* le confirmamos su cirugía en *Gualeguaychú* para el día *{{FECHA_LARGA}}* a las *{{HORA}}HS* (presentarse 30 minutos antes).

Por favor confirme si puede asistir para enviarle los preparativos y documentación de la cirugía del *ojo {{OJO_TEXTO}}*.`;

const WA_SITE_DOMAIN = 'https://centrodeojos-estevesesteves.com.ar';
const WA_APP_PUBLIC_URL = `${WA_SITE_DOMAIN}/controldecirugias/`;
const WA_DOCS_PREP_URL = `${WA_SITE_DOMAIN}/preparacion/`;
const WA_DOCS_CONSENT_URL = `${WA_SITE_DOMAIN}/consentimiento/`;
const WA_DOCS_TPL = `Le enviamos los documentos para la cirugía del *ojo {{OJO_TEXTO}}* programada para el *{{FECHA_LARGA}}* a las *{{HORA}}HS*.

📎 Documentos:

Preparación quirúrgica
${WA_DOCS_PREP_URL}

Consentimiento informado
${WA_DOCS_CONSENT_URL}

Por favor lea con mucha atención la preparación y lleve impreso y firmado el consentimiento el día de la cirugía.

📍 Dirección (Gualeguaychú)
https://share.google/KQuwuBRJt0ZMQj7KX`;

function waMensajeTurno(r, hora) { return waRenderTemplate(WA_CONFIRM_TPL, r, hora); }
function waMensajeDocs(r, hora) { return waRenderTemplate(WA_DOCS_TPL, r, hora); }
function waValidateTurno(r, hora) {
  if (!WA_GLOBAL_DATE) return 'Seleccione Fecha de cirugía (global).';
  if (!hora) return 'Falta hora del paciente.';
  if (!/^\d{2}:\d{2}$/.test(hora)) return 'Hora inválida (HH:MM).';
  const phone = normalizePhone(waGetRowPhone(r));
  if (!isValidPhone(phone)) return 'Teléfono inválido.';
  return '';
}

async function waMarkTurno(r, iso) {
  const key = waPatientKey(r);
  WA_TRACKING_MAP[key] = Object.assign({}, WA_TRACKING_MAP[key] || {}, { turnoAt: iso });
  const p = waGetSourceRow(r);
  if (p) {
    p.wa_turno_enviado_at = iso;
    await save(p);
  } else {
    localStorage.setItem('cirugias_cache', JSON.stringify(DB));
    await idbSet('cirugias_cache', DB);
  }
  saveWaPrefs();
}

async function waMarkDocs(r, iso) {
  const key = waPatientKey(r);
  WA_TRACKING_MAP[key] = Object.assign({}, WA_TRACKING_MAP[key] || {}, { docsAt: iso });
  const p = waGetSourceRow(r);
  if (p) {
    p.wa_docs_enviado_at = iso;
    p.estadoCir = 'Programada';
    p.fechaCir = WA_GLOBAL_DATE || p.fechaCir || '';
    const hora = waGetRowHora(r);
    if (hora) {
      p.hora_cirugia = hora;
      p.hora = hora;
    }
    await save(p);
  } else {
    localStorage.setItem('cirugias_cache', JSON.stringify(DB));
    await idbSet('cirugias_cache', DB);
  }
  saveWaPrefs();
}

async function waEnviarTurno(i) {
  const r = WA_ROWS[i];
  if (!r) return false;
  const hora = waGetRowHora(r);
  const err = waValidateTurno(r, hora);
  if (err) {
    WA_ERRORES++;
    waSetStatus(r, `❌ ${err}`);
    waRender();
    return false;
  }
  const phone = normalizePhone(waGetRowPhone(r));
  waSetStatus(r, '✅ Turno enviado');
  const iso = new Date().toISOString();
  await waMarkTurno(r, iso);
  WA_ENVIADOS++;
  waRender();
  waDoOpen(phone, waMensajeTurno(r, hora));
  return true;
}

async function waEnviarDocs(i) {
  const r = WA_ROWS[i];
  if (!r) return false;
  const key = waPatientKey(r);
  if (!WA_CONFIRMED_MAP[key]) {
    WA_ERRORES++;
    waSetStatus(r, '❌ Marcar “Confirmó” primero');
    waRender();
    return false;
  }
  if (!WA_GLOBAL_DATE) {
    WA_ERRORES++;
    waSetStatus(r, '❌ Seleccione Fecha global');
    waRender();
    return false;
  }
  const hora = waGetRowHora(r);
  if (!hora || !/^\d{2}:\d{2}$/.test(hora)) {
    WA_ERRORES++;
    waSetStatus(r, '❌ Falta hora del paciente');
    waRender();
    return false;
  }
  const phone = normalizePhone(waGetRowPhone(r));
  if (!isValidPhone(phone)) {
    WA_ERRORES++;
    waSetStatus(r, '❌ Teléfono inválido');
    waRender();
    return false;
  }
  const iso = new Date().toISOString();
  await waMarkDocs(r, iso);
  waSetStatus(r, '✅ Docs enviados');
  WA_ENVIADOS++;
  waRender();
  waDoOpen(phone, waMensajeDocs(r, hora));
  const src = waGetSourceRow(r);
  if (src) maybeAbrirRecetasPostDocs(src);
  return true;
}

function waSavePhoneOverride(key, val) {
  const v = String(val || '').trim();
  if (!v) delete WA_PHONE_OVERRIDE[key];
  else WA_PHONE_OVERRIDE[key] = v;
  saveWaPrefs();
}

async function waSaveHora(r, val, inputEl = null) {
  const hora = normalizeHoraText(val || '');
  if (hora && !/^\d{2}:\d{2}$/.test(hora)) {
    waSetStatus(r, '❌ Hora inválida (HH:MM)');
    if (inputEl) waPaintStatusInRow(inputEl, r);
    toast('Hora inválida. Usá formato HH:MM, por ejemplo 09:30');
    return;
  }
  const p = waGetSourceRow(r);
  if (!p) return;
  p.hora_cirugia = hora;
  p.hora = hora;
  await save(p);
  if (inputEl) inputEl.value = hora;
  waSetStatus(r, '✅ Hora guardada');
  if (inputEl) waPaintStatusInRow(inputEl, r);
}

async function waLoop(kind) {
  WA_STOP = false;
  for (let i = 0; i < WA_ROWS.length; i++) {
    if (WA_STOP) break;
    if (kind === 'turnos') await waEnviarTurno(i);
    else await waEnviarDocs(i);
    await new Promise(r => setTimeout(r, WA_PREF.delay || 4000));
  }
}
function waStopLoop() { WA_STOP = true; }
function waResetTracking() {
  if (!confirm('¿Resetear tracking WhatsApp (turno/docs/confirmados/teléfonos override)?')) return;
  WA_TRACKING_MAP = {};
  WA_CONFIRMED_MAP = {};
  WA_PHONE_OVERRIDE = {};
  WA_STATUS_MAP = {};
  saveWaPrefs();
  waResetCounters();
  waRender();
}

function waRender() {
  const body = document.getElementById('waTbody');
  const meta = document.getElementById('waFilterMeta');
  if (!body) return;
  WA_ROWS = waFromInternal();
  if (WA_PREF.sortKey === 'hora') {
    WA_ROWS = WA_ROWS.slice().sort((a, b) => String(waGetRowHora(a) || '99:99').localeCompare(String(waGetRowHora(b) || '99:99')) || String(a.PACIENTE || '').localeCompare(String(b.PACIENTE || ''), 'es'));
  }
  if (meta) {
    const stageLabel = WA_STAGE_OPTIONS.find(x => x.key === WA_PREF.stageFilter)?.label || 'Todos los operativos';
    meta.textContent = `${stageLabel} · ${WA_ROWS.length} paciente(s) visibles`;
  }
  body.innerHTML = '';

  WA_ROWS.forEach((r, i) => {
    const key = waPatientKey(r);
    const confirmed = !!WA_CONFIRMED_MAP[key];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td style="text-align:left">${escapeHtml(r.PACIENTE || '')}<div style="color:#6b7280;font-size:11px">DNI: ${escapeHtml(r.patient_id || '—')}</div></td>
      <td>${escapeHtml(r.CLINICA || '')}</td>
      <td><input class="wa-phone" data-k="${escapeAttr(key)}" value="${escapeAttr(waGetRowPhone(r))}" placeholder="Teléfono"></td>
      <td>${escapeHtml(r.OJO || '—')}</td>
      <td><input class="wa-hora" data-id="${escapeAttr(r.sourceId || '')}" value="${escapeAttr(waGetRowHora(r))}" type="text" inputmode="numeric" maxlength="5" placeholder="09:30" title="Escribí la hora y salí del campo. Formato HH:MM"></td>
      <td><span class="badge">${escapeHtml(r.ESTADO || '—')}</span></td>
      <td><label style="display:flex;justify-content:center;gap:4px"><input type="checkbox" class="wa-confirm" data-k="${escapeAttr(key)}" ${confirmed ? 'checked' : ''}><span>Sí</span></label></td>
      <td class="wa-track">${waTrackingText(r)}</td>
      <td><div style="display:flex;flex-direction:column;gap:6px"><button class="btn wa-turno">📩 Confirmar turno</button><button class="btn wa-docs" ${confirmed ? '' : 'disabled'}>📎 Enviar documentos</button></div></td>
      <td class="${waStatusClass(r)}">${escapeHtml(waStatusText(r))}</td>`;
    body.appendChild(tr);

    tr.querySelector('.wa-turno').onclick = () => waEnviarTurno(i);
    tr.querySelector('.wa-docs').onclick = () => waEnviarDocs(i);
    tr.querySelector('.wa-confirm').onchange = e => {
      WA_CONFIRMED_MAP[key] = !!e.target.checked;
      saveWaPrefs();
      waRender();
    };
    const phoneInput = tr.querySelector('.wa-phone');
    phoneInput.onblur = () => waSavePhoneOverride(key, phoneInput.value);
    phoneInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); phoneInput.blur(); } };
    const horaInput = tr.querySelector('.wa-hora');
    horaInput.onblur = () => waSaveHora(r, horaInput.value, horaInput);
    horaInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); horaInput.blur(); } };
  });

  if (!WA_ROWS.length) {
    body.innerHTML = `<tr><td colspan="11"><div class="empty">No hay pacientes visibles para este filtro. Acá solo aplican búsqueda, clínica y obra social; la cola rápida de la tabla principal no vacía este módulo.</div></td></tr>`;
  }
  waCounter();
}

export function renderWhatsApp() {
  const el = document.getElementById('waView');
  if (!el) return;
  el.innerHTML = `
    <div class='wa-wrap whatsapp-confirmar'>
      <div class='wa-topline'>
        <h3 class='wa-title'>WhatsApp — Centro de Ojos Esteves</h3>
        <button id='waBackMain' class='btn'>← Volver a página principal</button>
      </div>

      <div style='font-size:12px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px'>
        <strong>Flujo sugerido:</strong> 1) confirmar turno, 2) marcar confirmación del paciente, 3) enviar documentos, 4) seguir tracking por paciente.
      </div>

      <div class='wa-grid'>
        <div class='wa-card span-6 wa-config-card'>
          <h4>⚙ Configuración de envío / Fecha de cirugía</h4>
          <div class='wa-tools' style='margin:0'>
            <label style='font-size:12px'>Fecha de cirugía * <input id='waGlobalDate' type='date' value='${escapeAttr(WA_GLOBAL_DATE)}'></label>
            <label style='font-size:12px'>Demora (seg): <input id='waDelay' type='number' min='1' step='1' value='${Math.round((WA_PREF.delay || 4000) / 1000)}' style='width:70px'></label>
            <label style='font-size:12px'>Cola del módulo
              <select id='waStageFilter' style='min-width:220px'>
                ${WA_STAGE_OPTIONS.map(opt => `<option value='${escapeAttr(opt.key)}' ${opt.key === WA_PREF.stageFilter ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
              </select>
            </label>
            <label style='font-size:12px'><input type='radio' name='waCh' value='desktop' ${WA_PREF.channel === 'desktop' ? 'checked' : ''}> WhatsApp Desktop</label>
            <label style='font-size:12px'><input type='radio' name='waCh' value='web' ${WA_PREF.channel === 'web' ? 'checked' : ''}> WhatsApp Web (abre pestaña nueva)</label>
            <label style='font-size:12px'>Orden
              <select id='waSortKey' style='min-width:130px'>
                <option value='default' ${WA_PREF.sortKey === 'default' ? 'selected' : ''}>Normal</option>
                <option value='hora' ${WA_PREF.sortKey === 'hora' ? 'selected' : ''}>Por hora</option>
              </select>
            </label>
          </div>
        </div>

        <div class='wa-card span-6'>
          <h4>Acciones masivas por etapa</h4>
          <div class='wa-actions-main' style='display:flex;gap:8px;flex-wrap:wrap'>
            <button id='waStartTurnos' class='btn primary'>1) 📩 Confirmar turnos</button>
            <button id='waStartDocs' class='btn primary'>2) 📎 Enviar documentos</button>
          </div>
          <div class='wa-actions-secondary' style='margin-top:8px'>
            <button id='waStop' class='btn'>Detener</button>
            <button id='waReset' class='btn'>Reset tracking</button>
          </div>
        </div>
      </div>

      <div id='waContador' style='margin:6px 0 2px;font-weight:700'>Enviados: ${WA_ENVIADOS} | Errores: ${WA_ERRORES}</div>
      <div id='waFilterMeta' class='wa-meta'></div>
      <div class='wa-meta'>Tracking y recetas post-documentos se mantienen activos. Dominio público del sistema: <a href='${WA_APP_PUBLIC_URL}' target='_blank' rel='noopener noreferrer'>${WA_APP_PUBLIC_URL}</a></div>

      <div class='wa-table-wrap'>
        <table class='wa-table'>
          <thead>
            <tr><th>#</th><th>Paciente</th><th>Clínica</th><th>Teléfono</th><th>Ojo</th><th>Hora</th><th>Estado</th><th>Confirmó</th><th>Tracking</th><th>Acciones</th><th>Estado envío</th></tr>
          </thead>
          <tbody id='waTbody'></tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('waGlobalDate').onchange = e => { WA_GLOBAL_DATE = e.target.value || ''; saveWaPrefs(); };
  document.getElementById('waDelay').onchange = e => {
    WA_PREF.delay = Math.max(1000, (parseInt(e.target.value || '4', 10) || 4) * 1000);
    saveWaPrefs();
  };
  document.getElementById('waStageFilter').onchange = e => {
    WA_PREF.stageFilter = e.target.value || WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR;
    saveWaPrefs();
    waResetCounters();
    waRender();
  };
  document.querySelectorAll('input[name="waCh"]').forEach(r => r.onchange = () => {
    WA_PREF.channel = r.value;
    saveWaPrefs();
  });
  document.getElementById('waSortKey').onchange = e => {
    WA_PREF.sortKey = e.target.value || 'default';
    saveWaPrefs();
    waRender();
  };
  document.getElementById('waStartTurnos').onclick = () => waLoop('turnos');
  document.getElementById('waStartDocs').onclick = () => waLoop('docs');
  document.getElementById('waStop').onclick = () => waStopLoop();
  document.getElementById('waReset').onclick = () => waResetTracking();
  document.getElementById('waBackMain').onclick = () => { document.querySelector('.tablink[data-tab="tabla"]')?.click(); };

  waRender();
}
