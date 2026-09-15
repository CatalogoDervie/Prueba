'use strict';

// Ajuste visual acotado al flujo de "Duplicar segundo ojo".
// No modifica estados, filtros, facturación, pedidos de lentes ni exportaciones.

import { DB, normalizeId, getEstadoCirCalculado, isFacturadoCompleto } from './state.js';

const SECOND_EYE_NOTE_PREFIX = 'Segundo ojo duplicado desde';
let timer = null;

function normalizarOjo(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s.includes('OD')) return 'OD';
  if (s.includes('OI') || s.includes('OS')) return 'OI';
  return s;
}

function ojoTexto(ojo) {
  const o = normalizarOjo(ojo);
  if (o === 'OI') return 'OI — Izquierdo';
  if (o === 'OD') return 'OD — Derecho';
  return o || '—';
}

function esSegundoOjoDuplicado(p) {
  return String(p?.notas || '').trim().startsWith(SECOND_EYE_NOTE_PREFIX);
}

function mismoPaciente(a, b) {
  const dniA = String(a?.dni || '').trim();
  const dniB = String(b?.dni || '').trim();
  return !!dniA && dniA === dniB;
}

function obtenerRolEpisodio(p) {
  if (!p || p.ojos !== '2 ojos') return null;
  const ojo = normalizarOjo(p.ojo);
  if (!ojo) return null;
  const otroOjo = ojo === 'OI' ? 'OD' : 'OI';

  if (esSegundoOjoDuplicado(p)) {
    const original = DB.rows.find(x =>
      normalizeId(x.id) !== normalizeId(p.id) &&
      mismoPaciente(x, p) &&
      normalizarOjo(x.ojo) === otroOjo &&
      !esSegundoOjoDuplicado(x)
    ) || null;
    return { tipo: 'segundo', relacionado: original };
  }

  const segundo = DB.rows.find(x =>
    normalizeId(x.id) !== normalizeId(p.id) &&
    mismoPaciente(x, p) &&
    normalizarOjo(x.ojo) === otroOjo &&
    esSegundoOjoDuplicado(x)
  ) || null;

  return segundo ? { tipo: 'primero', relacionado: segundo } : null;
}

function estaOperado(p, rol) {
  if (rol?.tipo === 'primero') return true;
  if (isFacturadoCompleto(p?.estadoFac)) return true;
  return getEstadoCirCalculado(p) === 'Realizada';
}

function idPacienteAbierto(grupo) {
  const campo = grupo?.querySelector('[data-row-id]');
  return campo?.dataset?.rowId || '';
}

function ocultarPlanificacionDosOjos(grupo) {
  const ojosSel = grupo.querySelector('select[data-field="ojos"]');
  const filaOjos = ojosSel?.closest('.srow');
  if (filaOjos) filaOjos.style.display = 'none';

  grupo.querySelectorAll('.eye-two-only').forEach(el => {
    el.style.display = 'none';
  });
}

function mostrarSoloOjoDelEpisodio(grupo, p, rol) {
  const ojoSel = grupo.querySelector('select[data-field="ojo"]');
  const filaOjo = ojoSel?.closest('.srow');
  if (!filaOjo) return;

  const operado = estaOperado(p, rol);
  const label = filaOjo.querySelector('label');
  if (label) label.textContent = operado ? 'Ojo operado' : 'Ojo a operar';

  if (ojoSel) ojoSel.style.display = 'none';

  let valor = filaOjo.querySelector('[data-episodio-ojo]');
  if (!valor) {
    valor = document.createElement('div');
    valor.dataset.episodioOjo = '1';
    valor.style.cssText = 'flex:1;font-weight:700;color:#334155;padding:5px 0';
    filaOjo.appendChild(valor);
  }
  valor.textContent = ojoTexto(p.ojo);
}

function mostrarSoloDioptriaDelEpisodio(grupo, p) {
  const input = grupo.querySelector('input[data-field="dioptria"]');
  const fila = input?.closest('.srow');
  if (!fila) return;

  fila.style.display = '';
  const label = fila.querySelector('label');
  const ojo = normalizarOjo(p.ojo);
  if (label) label.textContent = ojo ? `Dioptría ${ojo}` : 'Dioptría';

  // Se conserva el campo estándar del episodio para no alterar los otros módulos.
  // Solo se evita mostrar nuevamente dioptría OI + dioptría OD.
  if (input && document.activeElement !== input) {
    input.value = String(p.dioptria || p.lio || '').trim();
  }
}

function ocultarDuplicarCuandoYaExisteSegundoOjo() {
  document.querySelectorAll('#sideFoot [data-qa-action="duplicar"]').forEach(btn => {
    btn.style.display = 'none';
  });
}

function aplicarVistaEpisodio() {
  const sideBody = document.getElementById('sideBody');
  if (!sideBody) return;

  const grupo = Array.from(sideBody.querySelectorAll('.sgroup'))
    .find(g => (g.querySelector('.sgroup-title')?.textContent || '').trim() === 'Cirugía');
  if (!grupo) return;

  const id = idPacienteAbierto(grupo);
  if (!id) return;
  const p = DB.rows.find(x => normalizeId(x.id) === normalizeId(id));
  if (!p) return;

  const rol = obtenerRolEpisodio(p);
  if (!rol) return; // Pacientes no duplicados: no se toca absolutamente nada.

  ocultarPlanificacionDosOjos(grupo);
  mostrarSoloOjoDelEpisodio(grupo, p, rol);
  mostrarSoloDioptriaDelEpisodio(grupo, p);
  ocultarDuplicarCuandoYaExisteSegundoOjo();
}

function programarAplicacion() {
  clearTimeout(timer);
  // Se ejecuta después del módulo que arma los campos OI/OD para poder ocultarlos
  // solo cuando el segundo episodio ya existe.
  timer = setTimeout(aplicarVistaEpisodio, 0);
}

function instalar() {
  const sideBody = document.getElementById('sideBody');
  const sideFoot = document.getElementById('sideFoot');

  if (sideBody && !sideBody.dataset.episodiosOjosObserver) {
    sideBody.dataset.episodiosOjosObserver = '1';
    new MutationObserver(programarAplicacion).observe(sideBody, { childList: true, subtree: true });
  }
  if (sideFoot && !sideFoot.dataset.episodiosOjosObserver) {
    sideFoot.dataset.episodiosOjosObserver = '1';
    new MutationObserver(programarAplicacion).observe(sideFoot, { childList: true, subtree: true });
  }

  programarAplicacion();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
else instalar();
window.addEventListener('authReady', () => setTimeout(instalar, 0));
