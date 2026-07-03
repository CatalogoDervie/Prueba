'use strict';

import { DB, getFechaFacturadaBase, normalizeId } from './state.js';
import { fd, hoyISO } from './utils.js';

const ID_FILTRO = 'fVitrectomiaPrincipal';
const SAVED_FILTERS_KEY = 'cirugias_saved_filters';

function activo(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return v === true || ['1', 'true', 'si', 'sí', 's'].includes(s);
}

function esCasoVitrectomia(p) {
  return !!p && (activo(p.extraVitrectomia) || activo(p.vitrectomia) || activo(p.extras && p.extras.vitrectomia));
}

function buscarPaciente(id) {
  const sid = normalizeId(id);
  return DB.rows.find(p => normalizeId(p.id) === sid) || null;
}

function limpiarFiltrosPersistidosObsoletos() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '{}') || {};
    delete saved.fFechaCir;
    delete saved.fEst;
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(saved));
  } catch (_) { /* configuración inválida: la app la recreará */ }
}

function limpiarEstadoOculto() {
  const estado = document.getElementById('fEst');
  if (estado) estado.value = '';
}

function dispatchChange(el) {
  if (!el) return;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function limpiarFechaCirugia(renderizar = true) {
  const fecha = document.getElementById('fFechaCir');
  if (!fecha || !fecha.value) return;
  fecha.value = '';
  if (renderizar) dispatchChange(fecha);
}

function sumarDiasISO(fechaISO, dias) {
  const [y, m, d] = String(fechaISO || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function asegurarAyudasFecha() {
  const input = document.getElementById('fFechaCir');
  const label = input?.closest('label');
  if (!input || !label || label.dataset.dateFilterEnhanced === '1') return;
  label.dataset.dateFilterEnhanced = '1';

  const textNode = Array.from(label.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = 'Fecha de cirugía ';

  const wrap = document.createElement('div');
  wrap.className = 'date-filter-shortcuts';
  wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px';
  wrap.innerHTML = `
    <button type="button" class="btn" data-date-preset="today" style="padding:4px 8px">Hoy</button>
    <button type="button" class="btn" data-date-preset="tomorrow" style="padding:4px 8px">Mañana</button>
    <button type="button" class="btn" data-date-preset="clear" style="padding:4px 8px">Limpiar fecha</button>
    <span style="font-size:11px;color:#64748b;align-self:center">Solo afecta la vista Operación.</span>`;
  label.appendChild(wrap);

  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-date-preset]');
    if (!btn) return;
    const preset = btn.dataset.datePreset;
    input.value = preset === 'today' ? hoyISO() : preset === 'tomorrow' ? sumarDiasISO(hoyISO(), 1) : '';
    dispatchChange(input);
  });
}

function asegurarCheckbox() {
  let filtro = document.getElementById(ID_FILTRO);
  if (filtro) return filtro;

  const contenedor = document.querySelector('.advanced-filters-body');
  if (!contenedor) return null;

  const label = document.createElement('label');
  label.className = 'filter-label';
  label.innerHTML = `<input type="checkbox" id="${ID_FILTRO}"> Solo vitrectomía`;

  const fechaProgramada = document.getElementById('fFechaCir')?.closest('label');
  if (fechaProgramada?.parentNode === contenedor) fechaProgramada.insertAdjacentElement('afterend', label);
  else contenedor.insertBefore(label, contenedor.querySelector('#showSilenced')?.closest('label') || null);

  return document.getElementById(ID_FILTRO);
}

function mostrarFechaFacturacion(tr, p) {
  const td = tr.querySelector('td[data-label="Fecha clave"]');
  if (!td) return;
  const main = td.querySelector('.cell-main');
  const sub = td.querySelector('.cell-sub');
  const fecha = getFechaFacturadaBase(p) || p.fechaFacturada || p.fechaFacturacion || '';
  if (main) main.textContent = fd(fecha) || '—';
  if (sub) sub.textContent = 'Facturación';
}

function aplicarVitrectomia() {
  const filtro = document.getElementById(ID_FILTRO);
  const tbody = document.getElementById('tbody');
  if (!filtro || !tbody) return;
  const usarFiltro = filtro.checked;
  let visibles = 0;

  tbody.querySelectorAll('tr[data-row-click]').forEach(tr => {
    const paciente = buscarPaciente(tr.dataset.rowClick);
    const mostrar = !usarFiltro || esCasoVitrectomia(paciente);
    tr.style.display = mostrar ? '' : 'none';
    if (mostrar) visibles += 1;
    if (usarFiltro && mostrar) mostrarFechaFacturacion(tr, paciente);
  });

  if (usarFiltro) {
    const tag = Array.from(document.querySelectorAll('.table-topbar .table-tag')).find(el => /visibles/i.test(el.textContent || ''));
    if (tag) tag.textContent = `${visibles} visibles`;
  }
}

let pintandoChip = false;
function asegurarChipFechaVisible() {
  if (pintandoChip) return;
  const bar = document.getElementById('activeFiltersBar');
  const input = document.getElementById('fFechaCir');
  if (!bar || !input) return;

  const existente = bar.querySelector('[data-clear-surgery-date]');
  if (!input.value) {
    existente?.remove();
    return;
  }
  if (existente) return;

  pintandoChip = true;
  bar.querySelector('.af-chip-soft')?.remove();
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'af-chip';
  chip.dataset.clearSurgeryDate = '1';
  chip.title = 'Quitar filtro de fecha de cirugía';
  chip.style.cursor = 'pointer';
  chip.textContent = `Fecha de cirugía: ${fd(input.value) || input.value} ×`;
  chip.addEventListener('click', () => limpiarFechaCirugia(true));
  bar.appendChild(chip);
  pintandoChip = false;
}

function iniciar() {
  limpiarEstadoOculto();
  asegurarAyudasFecha();

  const filtro = asegurarCheckbox();
  const tbody = document.getElementById('tbody');
  if (filtro && tbody && !window.vitrectomiaPrincipalLista) {
    window.vitrectomiaPrincipalLista = true;
    filtro.addEventListener('change', aplicarVitrectomia);
    new MutationObserver(aplicarVitrectomia).observe(tbody, { childList: true });
    aplicarVitrectomia();
  }

  const bar = document.getElementById('activeFiltersBar');
  if (bar && !bar.dataset.dateChipObserver) {
    bar.dataset.dateChipObserver = '1';
    new MutationObserver(asegurarChipFechaVisible).observe(bar, { childList: true, subtree: true });
  }
  document.getElementById('fFechaCir')?.addEventListener('change', asegurarChipFechaVisible);
  asegurarChipFechaVisible();
}

// Se ejecuta antes de que el usuario inicie sesión y antes de restoreFilters().
limpiarFiltrosPersistidosObsoletos();

// Los módulos manejan sus fechas internamente. La fecha global solo corresponde a Operación.
document.addEventListener('click', e => {
  const tab = e.target.closest('.tablink');
  if (!tab || (tab.dataset.tab || 'tabla') === 'tabla') return;
  limpiarFechaCirugia(false);
  limpiarEstadoOculto();
}, true);

window.addEventListener('beforeunload', limpiarFiltrosPersistidosObsoletos);
window.addEventListener('authReady', () => setTimeout(iniciar, 0));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
