'use strict';

import { escapeAttr, cleanDigits } from './utils.js';
import { connectorStartJob, connectorPollJob, renderJobStatus } from './connector.js';
import { toast } from './utils.js';

const RECETAS_DEFAULT = {
  diagnostico: 'H57',
  meds: ['GATIMICIN', 'TOLF', 'BRIMOPRESS', 'NATAX', 'DEXAMETASONA FABRA', 'TROPIOFTAL F']
};
const RECETAS_CREDS_KEY = 'pami_recetas_creds';
let RECETAS_CTX = { row: null };
let RECETAS_RUNNING = false;

function wireRecetasModalActions() {
  const runBtn = document.getElementById('btnRunRecetas');
  if (runBtn) runBtn.onclick = generarRecetasDesdeModal;
}

function isCaptchaError(msg) {
  return /captcha|refresque la página|refrescar la página|vuelva a intentarlo/i.test(String(msg || ''));
}

function getPamiRecetasCreds() {
  try { return JSON.parse(localStorage.getItem(RECETAS_CREDS_KEY) || '{}') || {}; } catch (_) { return {}; }
}

function isPamiRow(row) {
  const os = String(row?.obraSocial || row?.obra_social || '').toUpperCase();
  return os.includes('PAMI');
}

export function abrirModalRecetas(row) {
  if (!row) { toast('No hay paciente seleccionado para recetas'); return; }
  if (!isPamiRow(row)) { toast('El paciente no pertenece a PAMI'); return; }
  const afiliado = cleanDigits(row.afiliado || '');
  if (!afiliado) { toast('El paciente no tiene afiliado PAMI'); return; }
  RECETAS_CTX = { row };
  const creds = getPamiRecetasCreds();
  const meds = RECETAS_DEFAULT.meds;
  const body = document.getElementById('recetasBody');
  if (!body) { toast('No se encontró el modal de recetas'); return; }
  body.innerHTML = `
    <div id="recetasJobStatus" style="font-size:12px;color:#64748b;margin-bottom:8px">Listo para ejecutar en conector local.</div>
    <p style="font-size:12px;color:#6b7280;margin-bottom:8px">Paciente: <b>${escapeAttr(row.nombre || '')}</b></p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:0 0 10px">
      <label style="font-size:12px">Afiliado
        <input id="recAfiliado" class="input" type="text" value="${escapeAttr(afiliado)}" style="width:100%;margin-top:4px">
      </label>
      <label style="font-size:12px">Obra social
        <input id="recObraSocial" class="input" type="text" value="${escapeAttr(row.obraSocial || '')}" style="width:100%;margin-top:4px">
      </label>
      <label style="font-size:12px">Usuario PAMI
        <input id="recUser" class="input" type="text" value="${escapeAttr(creds.user || '')}" style="width:100%;margin-top:4px">
      </label>
      <label style="font-size:12px">Contraseña PAMI
        <input id="recPass" class="input" type="password" value="${escapeAttr(creds.pass || '')}" style="width:100%;margin-top:4px">
      </label>
    </div>
    <label style="font-size:12px;display:inline-flex;gap:6px;align-items:center;margin-bottom:10px">
      <input id="recRemember" type="checkbox" ${(creds.user || creds.pass) ? 'checked' : ''}> guardar credenciales en este navegador
    </label>
    <div style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin:0 0 10px">
      Si PAMI muestra captcha, validación o OTP, resolvelo en la ventana de Chrome. El proceso espera solo.
      <br>Si aparece "Error en el captcha", refrescá la página de PAMI en la ventana de Chrome y luego reintentá desde este botón.
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:0 0 10px">
      <label style="font-size:12px">Diagnóstico CIE10
        <input id="recDiag" class="input" type="text" value="${escapeAttr(RECETAS_DEFAULT.diagnostico)}" style="width:100%;margin-top:4px">
      </label>
    </div>
    <div style="font-size:12px;font-weight:700;margin:6px 0">Medicamentos (3 recetas, 2 por receta)</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:10px">
      ${meds.map((m, idx) => `<label style="font-size:12px">Receta ${Math.floor(idx/2)+1} - med${idx%2===0?'a':'b'}
        <input id="recMed${idx+1}" class="input" type="text" value="${escapeAttr(m)}" style="width:100%;margin-top:4px">
      </label>`).join('')}
    </div>`;
  const modal = document.getElementById('recetasModal');
  if (modal) modal.style.display = 'flex';
  wireRecetasModalActions();
}

export function cerrarModalRecetas() {
  const modal = document.getElementById('recetasModal');
  if (modal) modal.style.display = 'none';
}

function recetasGuardarCreds() {
  const remember = !!document.getElementById('recRemember')?.checked;
  const user = String(document.getElementById('recUser')?.value || '').trim();
  const pass = String(document.getElementById('recPass')?.value || '').trim();
  if (!remember) { localStorage.removeItem(RECETAS_CREDS_KEY); return { user, pass }; }
  localStorage.setItem(RECETAS_CREDS_KEY, JSON.stringify({ user, pass }));
  return { user, pass };
}

export function generarRecetasDesdeModal() {
  if (RECETAS_RUNNING) return;
  const row = RECETAS_CTX.row;
  if (!row) { toast('No hay paciente seleccionado para recetas'); return; }
  const credenciales = recetasGuardarCreds();
  if (!credenciales.user || !credenciales.pass) { toast('Completar usuario y contraseña PAMI'); return; }
  const afiliado = cleanDigits(document.getElementById('recAfiliado')?.value || row.afiliado || '');
  if (!afiliado) { toast('Completar afiliado'); return; }
  const diagnostico = String(document.getElementById('recDiag')?.value || '').trim() || RECETAS_DEFAULT.diagnostico;
  const meds = Array.from({ length: 6 }, (_, i) => String(document.getElementById(`recMed${i+1}`)?.value || '').trim());
  if (meds.some(x => !x)) { toast('Completar los 6 medicamentos'); return; }
  const payload = {
    credenciales,
    paciente: String(row.nombre || '').trim(),
    obraSocial: String(document.getElementById('recObraSocial')?.value || row.obraSocial || '').trim(),
    afiliado,
    diagnostico,
    medicamentos: [
      [meds[0], meds[1]],
      [meds[2], meds[3]],
      [meds[4], meds[5]]
    ]
  };
  renderJobStatus('recetasJobStatus', 'run', '⏳ Iniciando automatización de recetas...');
  const runBtn = document.getElementById('btnRunRecetas');
  RECETAS_RUNNING = true;
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = '⏳ Ejecutando recetas...'; }
  connectorStartJob('recetas', payload)
    .then(jobId => {
      toast('Recetas: ejecución iniciada');
      renderJobStatus('recetasJobStatus', 'run', `⏳ Ejecutando (job ${String(jobId).slice(0,8)})`);
      return connectorPollJob(jobId, s => renderJobStatus('recetasJobStatus', 'run', `⏳ Ejecutando: ${s.status || 'en curso'}`));
    })
    .then(() => {
      toast('Recetas completadas');
      renderJobStatus('recetasJobStatus', 'ok', '✅ Automatización completada');
    })
    .catch(err => {
      const msg = String(err?.message || 'Error ejecutando recetas');
      if (isCaptchaError(msg)) {
        const ayuda = 'Captcha inválido en PAMI. Refrescá la página en Chrome, resolvé captcha/OTP y reintentá.';
        toast('⚠️ ' + ayuda);
        renderJobStatus('recetasJobStatus', 'run', `⚠️ ${ayuda}`);
        return;
      }
      toast('❌ ' + msg);
      renderJobStatus('recetasJobStatus', /no detectado|conector local|iniciar/i.test(msg) ? 'off' : 'err', `❌ ${msg}`);
    })
    .finally(() => {
      RECETAS_RUNNING = false;
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = '▶ Ejecutar PAMI recetas'; }
    });
}

export function maybeAbrirRecetasPostDocs(row) {
  if (!isPamiRow(row)) return;
  if (!cleanDigits(row.afiliado || '')) return;
  setTimeout(() => abrirModalRecetas(row), 800);
}
