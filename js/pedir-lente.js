'use strict';

import { estado, getDioptria, filtered, WORKFLOW_KEYS, stateKey, isSecondEyeBlockedByBilling } from './state.js';
import { escapeHtml, escapeAttr, toast, cleanDigits } from './utils.js';
import { connectorStartJob, connectorPollJob, renderJobStatus } from './connector.js';
import { loadLentessEntregas, entregaForClinica } from './admision-config.js';

const KEY = 'pedir_lente_screen_filter';
const LENTESS_CREDS_KEY = 'pami_recetas_creds';

function getModuleFilter() {
  const saved = localStorage.getItem(KEY) || WORKFLOW_KEYS.PEDIR_LENTE;
  return [WORKFLOW_KEYS.PEDIR_LENTE, WORKFLOW_KEYS.ESPERANDO_LENTE, WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR, 'ALL'].includes(saved) ? saved : WORKFLOW_KEYS.PEDIR_LENTE;
}
function setModuleFilter(v) { localStorage.setItem(KEY, v); }
function baseRows() {
  return filtered({
    includeQuickFilter: false,
    includeEstadoSelect: false,
    stateKeys: [WORKFLOW_KEYS.PEDIR_LENTE, WORKFLOW_KEYS.ESPERANDO_LENTE, WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR],
    customPredicate: p => !isSecondEyeBlockedByBilling(p)
  });
}
function rowsFor(filterKey) { const rows = baseRows(); return filterKey === 'ALL' ? rows : rows.filter(p => stateKey(p) === filterKey); }
function badgeFor(filterKey) { if (filterKey === WORKFLOW_KEYS.PEDIR_LENTE) return 'b2'; if (filterKey === WORKFLOW_KEYS.ESPERANDO_LENTE) return 'b3'; if (filterKey === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR) return 'b4'; return 'b3'; }
function getCreds() { try { return JSON.parse(localStorage.getItem(LENTESS_CREDS_KEY) || '{}') || {}; } catch { return {}; } }
function saveCreds(user, pass) { localStorage.setItem(LENTESS_CREDS_KEY, JSON.stringify({ user: String(user || '').trim(), pass: String(pass || '').trim() })); }
function normalizeOjo(v) { const s = String(v || '').toUpperCase(); if (s.includes('OD')) return 'OD'; if (s.includes('OI')) return 'OI'; return s.trim(); }
function lentePayload(row) { return { sourceId: row.id, nombre: String(row.nombre || '').trim(), afiliado: cleanDigits(row.afiliado || ''), ojo: normalizeOjo(row.ojo || ''), lio: String(getDioptria(row) || '').trim(), clinica: String(row.clinica || '').trim() }; }
function validateLentessRows(rows) { return rows.map(r => ({ row: r, p: lentePayload(r) })).filter(x => !x.p.afiliado || !x.p.ojo || !x.p.lio); }
function ensureLentessModal() {
  let modal = document.getElementById('lentessModuloModal');
  if (modal) return modal;
  const creds = getCreds();
  modal = document.createElement('div');
  modal.id = 'lentessModuloModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;align-items:center;justify-content:center;padding:18px';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(15,23,42,.25);width:min(1080px,96vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <div><div style="font-weight:800;color:#0f172a">Ejecutar Lentess con filtros actuales</div><div id="lentessModuloSub" style="font-size:12px;color:#64748b;margin-top:2px"></div></div>
        <button id="lentessModuloClose" class="btn">Cerrar</button>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:end">
        <label style="font-size:12px">Usuario PAMI<input id="lentessUser" class="input" value="${escapeAttr(creds.user || '')}" style="width:100%;margin-top:4px"></label>
        <label style="font-size:12px">Contraseña PAMI<input id="lentessPass" class="input" type="password" value="${escapeAttr(creds.pass || '')}" style="width:100%;margin-top:4px"></label>
        <div style="font-size:11px;color:#64748b">Usa el mismo conector local que Facturar: <b>POST /jobs/lentess</b>. La página solo envía afiliado, ojo y LIO seleccionados.</div>
      </div>
      <div style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid #e2e8f0">
        <button id="lentessModuloCheckAll" class="btn">Tildar todos</button><button id="lentessModuloUncheckAll" class="btn">Destildar todos</button><button id="lentessModuloRun" class="btn primary">▶ Enviar seleccionados al conector</button><span id="lentessModuloStatus" style="font-size:12px;color:#64748b">Seleccioná qué pacientes mandar.</span>
      </div>
      <div style="padding:0 16px 16px;overflow:auto"><table class="module-table" style="width:100%;margin-top:10px"><thead><tr><th><input id="lentessModuloHeadChk" type="checkbox" checked></th><th>#</th><th>Paciente</th><th>Afiliado</th><th>Ojo</th><th>LIO</th><th>DNI</th><th>Clínica</th><th>Obra social</th><th>Estado</th></tr></thead><tbody id="lentessModuloTbody"></tbody></table></div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#lentessModuloClose')?.addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', ev => { if (ev.target === modal) modal.style.display = 'none'; });
  return modal;
}
function selectedModalRows(rows) { return rows.filter(r => document.querySelector(`.lentess-row-check[data-id="${CSS.escape(String(r.id || ''))}"]`)?.checked); }
function openLentessModulo(rows, screen) {
  const modal = ensureLentessModal();
  const tbody = modal.querySelector('#lentessModuloTbody');
  const sub = modal.querySelector('#lentessModuloSub');
  if (!tbody || !sub) return;
  sub.textContent = `${rows.length} paciente(s) visibles según búsqueda, clínica, obra social y filtro interno actual.`;
  tbody.innerHTML = rows.length ? rows.map((p, i) => {
    const lp = lentePayload(p);
    const ok = lp.afiliado && lp.ojo && lp.lio;
    return `<tr>
      <td><input type="checkbox" class="lentess-row-check" data-id="${escapeAttr(p.id)}" ${ok ? 'checked' : ''} ${ok ? '' : 'disabled'}></td>
      <td>${i + 1}</td><td>${escapeHtml(p.nombre || '—')}</td><td>${escapeHtml(lp.afiliado || '—')}</td><td>${escapeHtml(lp.ojo || '—')}</td><td>${escapeHtml(lp.lio || '—')}</td><td>${escapeHtml(p.dni || '—')}</td><td>${escapeHtml(p.clinica || '—')}</td><td>${escapeHtml(p.obraSocial || '—')}</td><td><span class="badge ${badgeFor(stateKey(p))}">${escapeHtml(estado(p))}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="10"><div class="empty">No hay pacientes para enviar con los filtros actuales.</div></td></tr>';
  modal.style.display = 'flex';
  const setAll = checked => modal.querySelectorAll('.lentess-row-check:not(:disabled)').forEach(x => x.checked = checked);
  modal.querySelector('#lentessModuloCheckAll').onclick = () => setAll(true);
  modal.querySelector('#lentessModuloUncheckAll').onclick = () => setAll(false);
  modal.querySelector('#lentessModuloHeadChk').onchange = ev => setAll(ev.target.checked);
  modal.querySelector('#lentessModuloRun').onclick = async () => {
    const selected = selectedModalRows(rows);
    if (!selected.length) { toast('Tildá al menos un paciente válido para enviar a Lentess'); return; }
    const user = String(modal.querySelector('#lentessUser')?.value || '').trim();
    const pass = String(modal.querySelector('#lentessPass')?.value || '').trim();
    if (!user || !pass) { toast('Completá usuario y contraseña PAMI'); return; }
    const invalid = validateLentessRows(selected);
    if (invalid.length) { toast(`Hay ${invalid.length} paciente(s) sin afiliado, ojo o LIO`); return; }
    saveCreds(user, pass);
    const selectedPayload = selected.map(lentePayload);
    const sedesSeleccionadas = [...new Set(selectedPayload.map(p => String(p.clinica || '').trim()).filter(Boolean))];
    if (sedesSeleccionadas.length !== 1) { toast('Lentess: no mezcles pacientes de distintas sedes en una misma ejecución'); return; }
    const entregas = await loadLentessEntregas().catch(() => []);
    const entrega = entregaForClinica(entregas, sedesSeleccionadas[0]);
    if (!entrega) { toast(`Configurá un lugar de entrega Lentess para la sede ${sedesSeleccionadas[0]} en Administración`); return; }
    const payload = { entrega, credenciales: { user, pass }, pacientes: selectedPayload };
    try {
      renderJobStatus('lentessModuloStatus', 'run', `⏳ Enviando ${selected.length} paciente(s) al conector...`);
      const jobId = await connectorStartJob('lentess', payload);
      renderJobStatus('lentessModuloStatus', 'run', `⏳ Job Lentess iniciado: ${String(jobId).slice(0, 8)}`);
      await connectorPollJob(jobId, s => renderJobStatus('lentessModuloStatus', 'run', `⏳ Ejecutando Lentess: ${s.status || 'en curso'}`));
      renderJobStatus('lentessModuloStatus', 'ok', '✅ Lentess ejecutado correctamente');
      toast('✅ Lentess ejecutado correctamente');
    } catch (e) {
      const msg = String(e?.message || e);
      renderJobStatus('lentessModuloStatus', 'err', `❌ ${msg}`);
      toast(`❌ ${msg}`);
    }
  };
}

export function renderPedirLente() {
  const view = document.getElementById('pedirLenteView');
  if (!view) return;
  const screen = getModuleFilter();
  const all = baseRows();
  const rows = rowsFor(screen);
  const counts = {
    [WORKFLOW_KEYS.PEDIR_LENTE]: all.filter(p => stateKey(p) === WORKFLOW_KEYS.PEDIR_LENTE).length,
    [WORKFLOW_KEYS.ESPERANDO_LENTE]: all.filter(p => stateKey(p) === WORKFLOW_KEYS.ESPERANDO_LENTE).length,
    [WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR]: all.filter(p => stateKey(p) === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR).length,
  };
  const filterButtons = [
    { key: WORKFLOW_KEYS.PEDIR_LENTE, label: 'Pedir lente', n: counts[WORKFLOW_KEYS.PEDIR_LENTE] },
    { key: WORKFLOW_KEYS.ESPERANDO_LENTE, label: 'Esperando lente', n: counts[WORKFLOW_KEYS.ESPERANDO_LENTE] },
    { key: WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR, label: 'Llegó lente - programar', n: counts[WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR] },
    { key: 'ALL', label: 'Ver todo', n: all.length },
  ];
  view.innerHTML = `
    <div class="module-shell"><div class="module-topline"><div><div class="module-title">Circuito de lentes</div><div class="module-subtitle">Incluye 3 etapas: pedir, esperando y llegó lente para programar. Usa búsqueda/clínica/obra social globales, pero maneja su filtro interno sin heredar la cola rápida de operación.</div></div><button class="btn primary" id="btnAbrirLentessModulo">🧿 Ejecutar Lentess con filtros actuales</button></div>
      <div class="stats-mini-grid"><div class="stats-mini-card"><div class="stats-mini-label">Pedir lente</div><div class="stats-mini-value">${counts[WORKFLOW_KEYS.PEDIR_LENTE]}</div></div><div class="stats-mini-card"><div class="stats-mini-label">Esperando lente</div><div class="stats-mini-value">${counts[WORKFLOW_KEYS.ESPERANDO_LENTE]}</div></div><div class="stats-mini-card"><div class="stats-mini-label">Llegó lente - programar</div><div class="stats-mini-value">${counts[WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR]}</div></div><div class="stats-mini-card"><div class="stats-mini-label">Total módulo</div><div class="stats-mini-value">${all.length}</div></div></div>
      <div class="module-chip-row">${filterButtons.map(item => `<button class="stats-screen-btn ${screen === item.key ? 'active' : ''}" data-pl-filter="${escapeAttr(item.key)}">${escapeHtml(item.label)} <span class="stats-chip-count">${item.n}</span></button>`).join('')}</div>
      <div class="tablewrap compact-module-table"><div class="table-scroll"><table class="module-table"><thead><tr><th>#</th><th>Paciente</th><th>Clínica</th><th>Ojo</th><th>Dioptría</th><th>Obra social</th><th>Fecha pedido</th><th>Fecha llegó</th><th>Estado</th></tr></thead><tbody>${rows.length ? rows.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.nombre || '—')}<div class="cell-sub">DNI ${escapeHtml(p.dni || '—')} · Afiliado ${escapeHtml(p.afiliado || '—')}</div></td><td>${escapeHtml(p.clinica || '—')}</td><td>${escapeHtml(p.ojo || '—')}</td><td>${escapeHtml(getDioptria(p) || '—')}</td><td>${escapeHtml(p.obraSocial || '—')}</td><td>${escapeHtml(p.fechaSolLente || '—')}</td><td>${escapeHtml(p.fechaLlegaLente || '—')}</td><td><span class="badge ${badgeFor(stateKey(p))}">${escapeHtml(estado(p))}</span></td></tr>`).join('') : `<tr><td colspan="9"><div class="empty">No hay pacientes en esta etapa con los filtros globales actuales.</div></td></tr>`}</tbody></table></div></div>
    </div>`;
  view.querySelectorAll('[data-pl-filter]').forEach(btn => btn.addEventListener('click', () => { setModuleFilter(btn.dataset.plFilter || WORKFLOW_KEYS.PEDIR_LENTE); renderPedirLente(); }));
  document.getElementById('btnAbrirLentessModulo')?.addEventListener('click', () => openLentessModulo(rows, screen));
}
