'use strict';

import { DB, getFechaFacturadaBase, normalizeId } from './state.js';
import { fd } from './utils.js';

const ID_FILTRO = 'fVitrectomiaPrincipal';

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

function mostrarFechaFacturacion(tr, p) {
  const td = tr.querySelector('td[data-label="Fecha clave"]');
  if (!td) return;
  const main = td.querySelector('.cell-main');
  const sub = td.querySelector('.cell-sub');
  const fecha = getFechaFacturadaBase(p) || p.fechaFacturada || '';
  if (main) main.textContent = fd(fecha) || '—';
  if (sub) sub.textContent = 'Facturación';
}

function aplicar() {
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

function iniciar() {
  const filtro = document.getElementById(ID_FILTRO);
  const tbody = document.getElementById('tbody');
  if (!filtro || !tbody || window.vitrectomiaPrincipalLista) return;
  window.vitrectomiaPrincipalLista = true;
  filtro.addEventListener('change', aplicar);
  new MutationObserver(aplicar).observe(tbody, { childList: true });
  aplicar();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
