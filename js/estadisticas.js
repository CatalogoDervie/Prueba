'use strict';

import { DB, stateKey, WORKFLOW_KEYS, isFacturadoCompleto } from './state.js';
import { escapeHtml, escapeAttr, diffDays, fd, fdInput, hoyISO, downloadTextFile, toast } from './utils.js';

const KEY = 'indicadores_v8_filters';
const LEGACY_KEYS = ['indicadores_v7_filters', 'indicadores_v6_filters'];
const TARGET_VITRECTOMIAS_POR_CLINICA = 16;
const DATE_BASIS = Object.freeze({
  CIRUGIA_FACTURADA: 'CIRUGIA_FACTURADA',
  FACTURACION: 'FACTURACION',
  PROGRAMADA: 'PROGRAMADA'
});

function safeJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
  catch (_) { return {}; }
}
function monthKey(v) { return String(v || '').slice(0, 7); }
function monthDate(key) {
  if (!key) return null;
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return null;
  return new Date(y, m - 1, 1);
}
function currentMonthKey() { return hoyISO().slice(0, 7); }
function monthLabel(key) {
  const dt = monthDate(key);
  return dt ? new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit' }).format(dt) : '—';
}
function avg(values) { return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0; }
function median(values) {
  if (!values.length) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}
function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return v === true || ['1', 'true', 'si', 'sí', 's'].includes(s);
}
function hasVitrectomia(row) {
  return !!row && (truthy(row.extraVitrectomia) || truthy(row.vitrectomia) || truthy(row.extras?.vitrectomia));
}
function fechaISO(v) { return fdInput(v); }
function normalizeDateBasis(v) {
  return Object.values(DATE_BASIS).includes(v) ? v : DATE_BASIS.CIRUGIA_FACTURADA;
}

// Fecha real cargada por el usuario. No se infiere desde updatedAt ni desde fechaCir.
function fechaFacturadaReal(row) {
  return fechaISO(row?.fechaFacturada || row?.fechaFacturacion || '');
}
function fechaCirugiaFacturada(row) {
  return fechaISO(row?.fechaCirugiaFacturada || row?.fecha_cirugia_facturada || row?.fechaCirFacturada || row?.fechaCir || row?.fecha_cirugia || '');
}
function fechaProgramada(row) {
  return fechaISO(row?.fechaProgramada || row?.fecha_programada || row?.fechaCir || row?.fecha_cirugia || '');
}
function fechaEstadisticaFacturada(row, f) {
  const basis = normalizeDateBasis(typeof f === 'string' ? f : f?.dateBasis);
  if (basis === DATE_BASIS.FACTURACION) return fechaFacturadaReal(row);
  if (basis === DATE_BASIS.PROGRAMADA) return fechaProgramada(row);
  return fechaCirugiaFacturada(row);
}
function fechaOperativa(row, f) {
  if (fechaFacturadaReal(row) || isFacturadoCompleto(row?.estadoFac)) return fechaEstadisticaFacturada(row, f);
  return fechaProgramada(row) || fechaISO(row?.fechaLlegaLente) || fechaISO(row?.fechaSolLente);
}
function fechaCirugiaYaPaso(row) {
  const cir = fechaProgramada(row);
  const delta = cir ? diffDays(hoyISO(), cir) : null;
  return delta != null && delta >= 0;
}
function estadoCerradoParaEstadistica(row) {
  const k = stateKey(row);
  return k === WORKFLOW_KEYS.FINALIZADA || k === WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO || k === WORKFLOW_KEYS.FACTURADA;
}
function casoFacturadoValido(row) {
  return !!row && isFacturadoCompleto(row.estadoFac) && fechaCirugiaYaPaso(row) && estadoCerradoParaEstadistica(row);
}
function personKey(row) {
  const dni = String(row?.dni || '').replace(/\D+/g, '');
  return dni || String(row?.id || `${row?.nombre || ''}|${row?.afiliado || ''}`);
}
function csvCell(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

function stageOf(row) {
  const k = stateKey(row);
  if (k === WORKFLOW_KEYS.PEDIR_LENTE) return 'PEDIR LENTE';
  if (k === WORKFLOW_KEYS.ESPERANDO_LENTE) return 'ESPERANDO LENTE';
  if (k === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR) return 'LLEGÓ LENTE - PROGRAMAR';
  if (k === WORKFLOW_KEYS.FECHA_PROGRAMADA) return 'FECHA PROGRAMADA';
  if (k === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR) return 'REALIZADA - FALTA FACTURAR';
  if (k === WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO) return 'FACTURADA FALTA OTRO OJO';
  if (k === WORKFLOW_KEYS.FACTURADA) return 'FACTURADA';
  if (k === WORKFLOW_KEYS.FINALIZADA) return 'FINALIZADA';
  return 'OTROS';
}

function allMonths(rows, dateBasis) {
  return [...new Set(rows.map(r => monthKey(fechaOperativa(r, dateBasis))).filter(Boolean))].sort();
}
function normalizeVitFilter(v) { return ['ALL', 'CON', 'SIN'].includes(v) ? v : 'ALL'; }
function readFilters(rows) {
  const clinics = [...new Set(rows.map(r => r.clinica).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const obras = [...new Set(rows.map(r => r.obraSocial).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const saved = Object.assign({}, ...LEGACY_KEYS.map(safeJson), safeJson(KEY));
  const dateBasis = normalizeDateBasis(saved.dateBasis);
  const months = allMonths(rows, dateBasis);
  const screen = ['resumen', 'tiempos', 'produccion', 'detalle'].includes(saved.screen) ? saved.screen : 'resumen';
  const savedFrom = saved.fromMonth ?? saved.from;
  const savedTo = saved.toMonth ?? saved.to;
  return {
    screen,
    dateBasis,
    clinica: clinics.includes(saved.clinica) ? saved.clinica : '',
    obra: obras.includes(saved.obra) ? saved.obra : '',
    fromMonth: months.includes(savedFrom) ? savedFrom : (months[0] || ''),
    toMonth: months.includes(savedTo) ? savedTo : (months[months.length - 1] || ''),
    splitClinic: !!saved.splitClinic,
    detailFrom: fechaISO(saved.detailFrom || ''),
    detailTo: fechaISO(saved.detailTo || ''),
    detailVit: normalizeVitFilter(saved.detailVit),
    detailSearch: String(saved.detailSearch || ''),
    clinics,
    obras,
    months
  };
}
function persistableFilters(f) {
  return {
    screen: f.screen,
    dateBasis: normalizeDateBasis(f.dateBasis),
    clinica: f.clinica,
    obra: f.obra,
    fromMonth: f.fromMonth,
    toMonth: f.toMonth,
    splitClinic: !!f.splitClinic,
    detailFrom: f.detailFrom,
    detailTo: f.detailTo,
    detailVit: normalizeVitFilter(f.detailVit),
    detailSearch: String(f.detailSearch || '')
  };
}
function saveFilters(next) { localStorage.setItem(KEY, JSON.stringify(persistableFilters(next))); }

function applyGeneralFilters(rows, f) {
  return rows.filter(r => {
    if (f.clinica && r.clinica !== f.clinica) return false;
    if (f.obra && r.obraSocial !== f.obra) return false;
    return true;
  });
}
function applyOperationalPeriod(rows, f) {
  return rows.filter(r => {
    const mk = monthKey(fechaOperativa(r, f));
    if (f.fromMonth && mk && mk < f.fromMonth) return false;
    if (f.toMonth && mk && mk > f.toMonth) return false;
    return true;
  });
}
function applyBillingMonthPeriod(rows, f) {
  return rows.filter(r => {
    const mk = monthKey(fechaEstadisticaFacturada(r, f));
    if (!mk) return false;
    if (f.fromMonth && mk < f.fromMonth) return false;
    if (f.toMonth && mk > f.toMonth) return false;
    return true;
  });
}
function applyDetailFilters(rows, f) {
  const q = String(f.detailSearch || '').trim().toLowerCase();
  return rows.filter(r => {
    const statDate = fechaEstadisticaFacturada(r, f);
    if (!statDate) return false;
    if (f.detailFrom && statDate < f.detailFrom) return false;
    if (f.detailTo && statDate > f.detailTo) return false;
    if (f.detailVit === 'CON' && !hasVitrectomia(r)) return false;
    if (f.detailVit === 'SIN' && hasVitrectomia(r)) return false;
    if (q) {
      const haystack = [r.nombre, r.dni, r.afiliado, r.obraSocial, r.clinica, r.ojo]
        .map(v => String(v || '').toLowerCase()).join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const fa = fechaEstadisticaFacturada(a, f), fb = fechaEstadisticaFacturada(b, f);
    return fb.localeCompare(fa) || fechaFacturadaReal(b).localeCompare(fechaFacturadaReal(a)) || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
  });
}

function dateBasisLabel(f) {
  const basis = normalizeDateBasis(f?.dateBasis);
  if (basis === DATE_BASIS.FACTURACION) return 'fecha de facturación';
  if (basis === DATE_BASIS.PROGRAMADA) return 'fecha programada';
  return 'fecha de cirugía facturada';
}
function dateBasisColumnLabel(f) {
  const basis = normalizeDateBasis(f?.dateBasis);
  if (basis === DATE_BASIS.FACTURACION) return 'Fecha facturada';
  if (basis === DATE_BASIS.PROGRAMADA) return 'Fecha programada';
  return 'Fecha cirugía facturada';
}
function dateBasisOptions(f) {
  const selected = normalizeDateBasis(f?.dateBasis);
  return [
    [DATE_BASIS.CIRUGIA_FACTURADA, 'Fecha cirugía facturada'],
    [DATE_BASIS.FACTURACION, 'Fecha facturación'],
    [DATE_BASIS.PROGRAMADA, 'Fecha programada']
  ].map(([value, label]) => `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function summaryCard(label, value, help = '', tone = '') {
  return `<div class="stats-mini-card ${tone ? `stats-mini-card-${tone}` : ''}"><div class="stats-mini-label">${escapeHtml(label)}</div><div class="stats-mini-value">${escapeHtml(value)}</div>${help ? `<div class="stats-mini-help">${escapeHtml(help)}</div>` : ''}</div>`;
}
function barChartCard({ title, subtitle = '', series, percent = false, targetLine = null, targetLabel = '' }) {
  const labels = series[0]?.points.map(p => p.x) || [];
  const maxData = Math.max(1, ...series.flatMap(s => s.points.map(p => p.y || 0)), targetLine || 0);
  const barGroups = labels.length || 1;
  const w = Math.max(760, barGroups * 92);
  const h = 330;
  const left = 56, top = 24, bottom = 70;
  const chartH = h - top - bottom;
  const groupW = (w - left - 24) / Math.max(1, barGroups);
  const gap = Math.min(12, groupW * 0.16);
  const barW = Math.max(14, (groupW - gap * (series.length + 1)) / Math.max(1, series.length));
  const colors = ['#1d4ed8', '#16a34a', '#7c3aed', '#ea580c'];
  const legendItems = [...series.map((s, i) => ({ name: s.name, color: colors[i % colors.length] }))];
  let bars = '', valueLabels = '', xLabels = '';
  labels.forEach((label, i) => {
    const gx = left + i * groupW;
    series.forEach((s, idx) => {
      const v = Number(s.points[i]?.y || 0);
      const bh = maxData ? (v / maxData) * chartH : 0;
      const x = gx + gap + idx * (barW + gap);
      const y = top + chartH - bh;
      const color = colors[idx % colors.length];
      bars += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, bh).toFixed(2)}" rx="8" fill="${color}" opacity="0.92"></rect>`;
      valueLabels += `<text x="${(x + barW / 2).toFixed(2)}" y="${(y - 8).toFixed(2)}" text-anchor="middle" font-size="11" fill="#334155" font-weight="700">${escapeHtml(percent ? `${v}%` : String(v))}</text>`;
    });
    xLabels += `<text x="${(gx + groupW / 2).toFixed(2)}" y="${h - 24}" text-anchor="middle" font-size="11" fill="#475569" font-weight="600">${escapeHtml(label)}</text>`;
  });
  let targetSvg = '';
  if (targetLine != null) {
    const y = top + chartH - ((targetLine / maxData) * chartH);
    targetSvg = `<line x1="${left}" x2="${w - 16}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#dc2626" stroke-width="2" stroke-dasharray="8 6"></line><text x="${w - 20}" y="${(y - 8).toFixed(2)}" text-anchor="end" font-size="11" fill="#b91c1c" font-weight="700">${escapeHtml(targetLabel || `Meta ${targetLine}`)}</text>`;
    legendItems.push({ name: targetLabel || `Meta ${targetLine}`, color: '#dc2626', dashed: true });
  }
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => {
    const val = Math.round(maxData * r);
    const y = top + chartH - (chartH * r);
    return `<text x="${left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="#94a3b8">${percent && r === 1 ? '100%' : val}</text>`;
  }).join('');
  const legends = legendItems.map(item => `<span class="chart-legend-item"><i style="background:${item.color};${item.dashed ? 'border-top:2px dashed #dc2626;height:0;background:transparent' : ''}"></i>${escapeHtml(item.name)}</span>`).join('');
  return `<section class="stats-card"><div class="stats-card-head"><div><h4>${escapeHtml(title)}</h4>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div></div><div class="chart-legend">${legends}</div><div class="chart-scroll"><svg viewBox="0 0 ${w} ${h}" class="bar-chart-svg">${yTicks}${targetSvg}${bars}${valueLabels}${xLabels}</svg></div></section>`;
}
function simpleBarsCard(title, rows, suffix = '', help = '') {
  const max = Math.max(1, ...rows.map(r => r.value || 0));
  return `<section class="stats-card"><div class="stats-card-head"><div><h4>${escapeHtml(title)}</h4>${help ? `<p>${escapeHtml(help)}</p>` : ''}</div></div><div class="rank-list">${rows.map(r => `<div class="rank-row"><span class="rank-label">${escapeHtml(r.label)}</span><div class="rank-bar"><div class="rank-fill" style="width:${Math.max(4, (r.value / max) * 100)}%"></div></div><strong class="rank-value">${r.value}${escapeHtml(suffix)}</strong></div>`).join('') || '<div class="empty">Sin datos</div>'}</div></section>`;
}
function valuesByClinic(rows, getValue) {
  const map = new Map();
  rows.forEach(r => {
    const key = r.clinica || 'Sin clínica';
    const val = getValue(r);
    if (val == null || val < 0) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(val);
  });
  return [...map.entries()].map(([label, arr]) => ({ label, value: avg(arr) })).sort((a, b) => b.value - a.value);
}
function monthRange(offset = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: fdInput(first), to: fdInput(last) };
}
function detailToolbar(f) {
  const dateLabel = dateBasisColumnLabel(f);
  return `<div class="stats-toolbar" style="align-items:end">
    <label style="font-size:11px;color:#64748b">Buscar paciente, DNI o afiliado<input id="inDetailSearch" class="an-select" type="search" value="${escapeAttr(f.detailSearch)}" placeholder="Buscar..." style="display:block;min-width:230px;margin-top:4px"></label>
    <label style="font-size:11px;color:#64748b">Base de fecha<select id="inDateBasis" class="an-select" style="display:block;margin-top:4px">${dateBasisOptions(f)}</select></label>
    <label style="font-size:11px;color:#64748b">${escapeHtml(dateLabel)} desde<input id="inDetailFrom" class="an-select" type="date" value="${escapeAttr(f.detailFrom)}" style="display:block;margin-top:4px"></label>
    <label style="font-size:11px;color:#64748b">${escapeHtml(dateLabel)} hasta<input id="inDetailTo" class="an-select" type="date" value="${escapeAttr(f.detailTo)}" style="display:block;margin-top:4px"></label>
    <label style="font-size:11px;color:#64748b">Vitrectomía<select id="inDetailVit" class="an-select" style="display:block;margin-top:4px"><option value="ALL" ${f.detailVit === 'ALL' ? 'selected' : ''}>Todas</option><option value="CON" ${f.detailVit === 'CON' ? 'selected' : ''}>Con vitrectomía</option><option value="SIN" ${f.detailVit === 'SIN' ? 'selected' : ''}>Sin vitrectomía</option></select></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-detail-preset="month">Este mes</button><button class="btn" data-detail-preset="previous">Mes anterior</button><button class="btn" data-detail-preset="today">Hoy</button><button class="btn" data-detail-preset="clear">Limpiar fechas</button></div>
  </div>`;
}
function commonToolbar(f) {
  const common = `<select id="inCli" class="an-select"><option value="">Todas las clínicas</option>${f.clinics.map(v => `<option value="${escapeAttr(v)}" ${v === f.clinica ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select><select id="inObra" class="an-select"><option value="">Todas las obras sociales</option>${f.obras.map(v => `<option value="${escapeAttr(v)}" ${v === f.obra ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>`;
  if (f.screen === 'detalle') return `<div class="stats-toolbar">${common}<button class="btn" id="inClearGeneral">Limpiar clínica/obra social</button></div>${detailToolbar(f)}`;
  return `<div class="stats-toolbar">${common}<select id="inDateBasis" class="an-select">${dateBasisOptions(f)}</select><select id="inFrom" class="an-select"><option value="">Desde</option>${f.months.map(v => `<option value="${escapeAttr(v)}" ${v === f.fromMonth ? 'selected' : ''}>${escapeHtml(monthLabel(v))}</option>`).join('')}</select><select id="inTo" class="an-select"><option value="">Hasta</option>${f.months.map(v => `<option value="${escapeAttr(v)}" ${v === f.toMonth ? 'selected' : ''}>${escapeHtml(monthLabel(v))}</option>`).join('')}</select><label class="stats-check"><input type="checkbox" id="inSplit" ${f.splitClinic ? 'checked' : ''}> Comparar clínicas</label><button class="btn" id="inClearGeneral">Limpiar filtros</button></div>`;
}
function detailTable(rows, f) {
  const statLabel = dateBasisColumnLabel(f);
  return `<section class="stats-card" style="margin-top:12px"><div class="stats-card-head"><div><h4>Personas facturadas por ${escapeHtml(dateBasisLabel(f))}</h4><p>Ordenadas desde la fecha estadística más reciente. No se incluyen fechas inferidas por estado o última modificación.</p></div><button class="btn green" id="btnExportDetail">↓ Descargar CSV</button></div><div class="table-scroll"><table class="module-table" style="min-width:1260px"><thead><tr><th>${escapeHtml(statLabel)}</th><th>Fecha facturada</th><th>Paciente</th><th>DNI</th><th>Afiliado</th><th>Obra social</th><th>Clínica</th><th>Ojo</th><th>Fecha cirugía</th><th>Vitrectomía</th><th>Estado</th><th></th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr><td><strong>${escapeHtml(fd(fechaEstadisticaFacturada(r, f)) || fechaEstadisticaFacturada(r, f))}</strong></td><td>${escapeHtml(fd(fechaFacturadaReal(r)) || fechaFacturadaReal(r) || '—')}</td><td>${escapeHtml(r.nombre || '—')}</td><td>${escapeHtml(r.dni || '—')}</td><td>${escapeHtml(r.afiliado || '—')}</td><td>${escapeHtml(r.obraSocial || '—')}</td><td>${escapeHtml(r.clinica || '—')}</td><td>${escapeHtml(r.ojo || '—')}</td><td>${escapeHtml(fd(r.fechaCir) || '—')}</td><td><span class="badge ${hasVitrectomia(r) ? 'b6' : 'b1'}">${hasVitrectomia(r) ? 'Sí' : 'No'}</span></td><td>${escapeHtml(stageOf(r))}</td><td><button class="btn" data-open-detail-row="${escapeAttr(r.id)}">Ver</button></td></tr>`).join('') : '<tr><td colspan="12"><div class="empty">No hay personas facturadas para los filtros elegidos.</div></td></tr>'}</tbody></table></div></section>`;
}

export function renderEstadisticas() {
  const view = document.getElementById('statsView');
  if (!view) return;

  const all = DB.rows || [];
  const f = readFilters(all);
  const generalRows = applyGeneralFilters(all, f);
  const operationalRows = applyOperationalPeriod(generalRows, f);
  const billingRowsAll = generalRows.filter(casoFacturadoValido);
  const billingRowsPeriod = applyBillingMonthPeriod(billingRowsAll, f);
  const detailRows = applyDetailFilters(billingRowsAll, f);
  const clinicsInScope = [...new Set(generalRows.map(r => r.clinica || 'Sin clínica'))];
  const visibleClinics = f.splitClinic ? (clinicsInScope.length ? clinicsInScope : ['Sin clínica']) : ['Total'];

  const factMonths = [...new Set(billingRowsPeriod.map(r => monthKey(fechaEstadisticaFacturada(r, f))).filter(Boolean))].sort();
  const byMonthFact = selector => visibleClinics.map(cl => ({
    name: cl,
    points: factMonths.map(m => {
      const base = billingRowsPeriod.filter(r => monthKey(fechaEstadisticaFacturada(r, f)) === m && (cl === 'Total' || (r.clinica || 'Sin clínica') === cl));
      return { x: monthLabel(m), y: selector(base) };
    })
  }));

  const pedidoALlegadaDone = operationalRows.filter(r => r.fechaSolLente && r.fechaLlegaLente).map(r => diffDays(r.fechaLlegaLente, r.fechaSolLente)).filter(v => v != null && v >= 0);
  const llegadaAFechaDone = operationalRows.filter(r => r.fechaLlegaLente && r.fechaCir).map(r => diffDays(r.fechaCir, r.fechaLlegaLente)).filter(v => v != null && v >= 0);
  const cirugiaAFacturaDone = billingRowsPeriod.filter(r => r.fechaCir).map(r => diffDays(fechaFacturadaReal(r), r.fechaCir)).filter(v => v != null && v >= 0);
  const waitingOpen = operationalRows.filter(r => stateKey(r) === WORKFLOW_KEYS.ESPERANDO_LENTE).map(r => diffDays(hoyISO(), r.fechaSolLente)).filter(v => v != null && v >= 0);
  const arrivedOpen = operationalRows.filter(r => stateKey(r) === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR).map(r => diffDays(hoyISO(), r.fechaLlegaLente)).filter(v => v != null && v >= 0);
  const billingOpen = operationalRows.filter(r => stateKey(r) === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR).map(r => diffDays(hoyISO(), r.fechaCir)).filter(v => v != null && v >= 0);

  const stageCounts = operationalRows.reduce((acc, r) => { const k = stageOf(r); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const avgPedidoLlegadaByClinic = valuesByClinic(operationalRows.filter(r => r.fechaSolLente && r.fechaLlegaLente), r => diffDays(r.fechaLlegaLente, r.fechaSolLente));
  const avgLlegadaCirugiaByClinic = valuesByClinic(operationalRows.filter(r => r.fechaLlegaLente && r.fechaCir), r => diffDays(r.fechaCir, r.fechaLlegaLente));
  const avgCirugiaFacturaByClinic = valuesByClinic(billingRowsPeriod.filter(r => r.fechaCir), r => diffDays(fechaFacturadaReal(r), r.fechaCir));

  const factMonthly = byMonthFact(base => base.length);
  const vitMonthly = byMonthFact(base => base.filter(hasVitrectomia).length);
  const vitPctMonthly = byMonthFact(base => base.length ? Math.round((base.filter(hasVitrectomia).length / base.length) * 100) : 0);
  const totalFact = billingRowsPeriod.length;
  const totalVit = billingRowsPeriod.filter(hasVitrectomia).length;
  const pctVitTotal = totalFact ? Math.round((totalVit / totalFact) * 100) : 0;
  const focusMonth = factMonths.includes(currentMonthKey()) ? currentMonthKey() : (factMonths[factMonths.length - 1] || currentMonthKey());
  const focusMonthLabel = monthLabel(focusMonth);
  const targetMonth = TARGET_VITRECTOMIAS_POR_CLINICA * Math.max(1, f.splitClinic ? 1 : (f.clinica ? 1 : Math.max(1, clinicsInScope.length)));
  const vitCurrentMonth = billingRowsPeriod.filter(r => monthKey(fechaEstadisticaFacturada(r, f)) === focusMonth && hasVitrectomia(r)).length;
  const faltanVitCurrent = Math.max(0, targetMonth - vitCurrentMonth);

  const statusFacturadoSinFecha = generalRows.filter(r => casoFacturadoValido(r) && !fechaFacturadaReal(r)).length;
  const facturadasSinFechaEstadistica = billingRowsAll.filter(r => !fechaEstadisticaFacturada(r, f)).length;
  const noCerradasConFechaFacturada = generalRows.filter(r => fechaFacturadaReal(r) && !casoFacturadoValido(r)).length;
  const facturaAntesCirugia = billingRowsAll.filter(r => r.fechaCir && diffDays(fechaFacturadaReal(r), r.fechaCir) < 0).length;
  const uniqueDetail = new Set(detailRows.map(personKey)).size;
  const detailVit = detailRows.filter(hasVitrectomia).length;

  const header = `<div class="stats-shell"><div class="stats-title-wrap"><div><div class="stats-title">Indicadores</div><div class="stats-subtitle">Facturación y vitrectomías por ${escapeHtml(dateBasisLabel(f))}; sin fechas inferidas.</div></div></div>${commonToolbar(f)}<div class="stats-screens">${[['resumen', 'Resumen'], ['tiempos', 'Tiempos'], ['produccion', 'Facturación + vitrectomías'], ['detalle', 'Detalle facturado']].map(([key, label]) => `<button class="stats-screen-btn ${f.screen === key ? 'active' : ''}" data-screen="${key}">${label}</button>`).join('')}</div>`;

  let body = '';
  if (f.screen === 'resumen') {
    body = `<div class="stats-mini-grid">${summaryCard('Pedir lente', stageCounts['PEDIR LENTE'] || 0)}${summaryCard('Esperando lente', stageCounts['ESPERANDO LENTE'] || 0)}${summaryCard('Llegó lente - programar', stageCounts['LLEGÓ LENTE - PROGRAMAR'] || 0)}${summaryCard('Fecha programada', stageCounts['FECHA PROGRAMADA'] || 0)}${summaryCard('Realizada - falta facturar', stageCounts['REALIZADA - FALTA FACTURAR'] || 0)}${summaryCard('Facturadas en rango', billingRowsPeriod.length, dateBasisColumnLabel(f))}${summaryCard('Facturada sin fecha real', statusFacturadoSinFecha, 'Requiere revisión de calidad', statusFacturadoSinFecha ? 'warn' : 'ok')}</div><div class="stats-grid-2">${simpleBarsCard('Pedido → llegada por clínica', avgPedidoLlegadaByClinic, ' días', 'Promedio real calculado solo con casos que ya recibieron lente.')}<section class="stats-card"><div class="stats-card-head"><div><h4>Embudo operativo</h4><p>Estados separados tal como se trabajan en la operatoria diaria.</p></div></div><div class="stage-list">${['PEDIR LENTE', 'ESPERANDO LENTE', 'LLEGÓ LENTE - PROGRAMAR', 'FECHA PROGRAMADA', 'REALIZADA - FALTA FACTURAR', 'FACTURADA', 'FACTURADA FALTA OTRO OJO', 'FINALIZADA'].map(k => `<div class="stage-row"><span>${escapeHtml(k)}</span><strong>${stageCounts[k] || 0}</strong></div>`).join('')}</div></section></div>`;
  }
  if (f.screen === 'tiempos') {
    body = `<div class="stats-mini-grid">${summaryCard('Pedido → llegada', `${avg(pedidoALlegadaDone)} días`, 'Promedio real con lentes ya recibidas')}${summaryCard('Llegada → cirugía', `${avg(llegadaAFechaDone)} días`, 'Promedio real hasta la fecha quirúrgica')}${summaryCard('Cirugía → facturación', `${avg(cirugiaAFacturaDone)} días`, 'Solo con fecha facturada real')}${summaryCard('Espera abierta hoy', `${avg(waitingOpen)} días`, 'Pacientes que siguen esperando lente')}${summaryCard('Llegó y sigue sin fecha', `${avg(arrivedOpen)} días`, 'Lente recibida sin programación')}${summaryCard('Realizada y sin facturar', `${avg(billingOpen)} días`, 'Pendientes administrativos')}</div><div class="stats-grid-2">${simpleBarsCard('Pedido → llegada por clínica', avgPedidoLlegadaByClinic, ' días', 'Sirve para auditar al proveedor.')}${simpleBarsCard('Llegada → cirugía por clínica', avgLlegadaCirugiaByClinic, ' días', 'Demora desde llegada del lente hasta cirugía.')}</div><div class="stats-grid-2">${simpleBarsCard('Cirugía → facturación por clínica', avgCirugiaFacturaByClinic, ' días', 'Solo toma fechas de facturación efectivamente cargadas.')}<section class="stats-card"><div class="stats-card-head"><div><h4>Medianas y calidad</h4><p>Complementa los promedios para evitar que casos extremos distorsionen la lectura.</p></div></div><div class="stage-list"><div class="stage-row"><span>Mediana pedido → llegada</span><strong>${median(pedidoALlegadaDone)} días</strong></div><div class="stage-row"><span>Mediana llegada → cirugía</span><strong>${median(llegadaAFechaDone)} días</strong></div><div class="stage-row"><span>Mediana cirugía → facturación</span><strong>${median(cirugiaAFacturaDone)} días</strong></div><div class="stage-row"><span>Facturas anteriores a cirugía</span><strong>${facturaAntesCirugia}</strong></div></div></section></div>`;
  }
  if (f.screen === 'produccion') {
    body = `<div class="stats-mini-grid">${summaryCard('Total facturado en rango', totalFact, dateBasisColumnLabel(f))}${summaryCard('Vitrectomías facturadas', totalVit)}${summaryCard('% vitrectomías / facturadas', `${pctVitTotal}%`)}${summaryCard(`Meta ${focusMonthLabel}`, targetMonth, 'Objetivo mensual visible')}${summaryCard(`Vitrectomías ${focusMonthLabel}`, vitCurrentMonth, 'Hecho acumulado')}${summaryCard('Faltan para meta', faltanVitCurrent, faltanVitCurrent ? 'Restantes para objetivo' : 'Meta alcanzada', faltanVitCurrent ? 'warn' : 'ok')}${summaryCard('Sin fecha del filtro', facturadasSinFechaEstadistica, 'Facturadas que no entran en este criterio', facturadasSinFechaEstadistica ? 'warn' : 'ok')}${summaryCard('No cerradas excluidas', noCerradasConFechaFacturada, 'Con fecha facturada pero sin cierre válido', noCerradasConFechaFacturada ? 'warn' : 'ok')}</div><div class="stats-grid-2">${barChartCard({ title: 'Cirugías facturadas por mes', subtitle: `Base: ${dateBasisLabel(f)}.`, series: factMonthly })}${barChartCard({ title: 'Vitrectomías facturadas por mes', subtitle: `Cantidad facturada con vitrectomía por ${dateBasisLabel(f)}.`, series: vitMonthly, targetLine: targetMonth, targetLabel: `Meta ${targetMonth}` })}</div>${barChartCard({ title: '% vitrectomías sobre facturadas', subtitle: `Participación mensual sobre registros facturados por ${dateBasisLabel(f)}.`, series: vitPctMonthly, percent: true })}`;
  }
  if (f.screen === 'detalle') {
    body = `<div class="stats-mini-grid">${summaryCard('Registros visibles', detailRows.length, dateBasisColumnLabel(f))}${summaryCard('Personas únicas', uniqueDetail, 'Identificadas principalmente por DNI')}${summaryCard('Con vitrectomía', detailVit)}${summaryCard('Sin vitrectomía', detailRows.length - detailVit)}${summaryCard('Sin fecha del filtro', facturadasSinFechaEstadistica, 'No aparecen en esta tabla', facturadasSinFechaEstadistica ? 'warn' : 'ok')}</div>${detailTable(detailRows, f)}`;
  }

  view.innerHTML = `${header}${body}</div>`;

  const collect = () => ({
    ...f,
    dateBasis: normalizeDateBasis(document.getElementById('inDateBasis')?.value || f.dateBasis),
    clinica: document.getElementById('inCli')?.value || '',
    obra: document.getElementById('inObra')?.value || '',
    fromMonth: document.getElementById('inFrom')?.value ?? f.fromMonth,
    toMonth: document.getElementById('inTo')?.value ?? f.toMonth,
    splitClinic: document.getElementById('inSplit')?.checked ?? f.splitClinic,
    detailFrom: document.getElementById('inDetailFrom')?.value ?? f.detailFrom,
    detailTo: document.getElementById('inDetailTo')?.value ?? f.detailTo,
    detailVit: document.getElementById('inDetailVit')?.value ?? f.detailVit,
    detailSearch: document.getElementById('inDetailSearch')?.value ?? f.detailSearch
  });
  const rerender = () => { saveFilters(collect()); renderEstadisticas(); };

  ['inCli', 'inObra', 'inDateBasis', 'inFrom', 'inTo', 'inSplit', 'inDetailFrom', 'inDetailTo', 'inDetailVit'].forEach(id => document.getElementById(id)?.addEventListener('change', rerender));
  const search = document.getElementById('inDetailSearch');
  search?.addEventListener('input', () => {
    clearTimeout(window.__statsDetailSearchTimer);
    window.__statsDetailSearchTimer = setTimeout(rerender, 350);
  });
  document.getElementById('inClearGeneral')?.addEventListener('click', () => {
    const next = { ...f, clinica: '', obra: '' };
    if (f.screen !== 'detalle') {
      next.fromMonth = f.months[0] || '';
      next.toMonth = f.months[f.months.length - 1] || '';
      next.splitClinic = false;
    }
    saveFilters(next); renderEstadisticas();
  });
  view.querySelectorAll('[data-screen]').forEach(btn => btn.addEventListener('click', () => { saveFilters({ ...collect(), screen: btn.dataset.screen || 'resumen' }); renderEstadisticas(); }));
  view.querySelectorAll('[data-detail-preset]').forEach(btn => btn.addEventListener('click', () => {
    const next = collect();
    const preset = btn.dataset.detailPreset;
    if (preset === 'today') next.detailFrom = next.detailTo = hoyISO();
    else if (preset === 'month') Object.assign(next, { detailFrom: monthRange(0).from, detailTo: monthRange(0).to });
    else if (preset === 'previous') Object.assign(next, { detailFrom: monthRange(-1).from, detailTo: monthRange(-1).to });
    else Object.assign(next, { detailFrom: '', detailTo: '' });
    saveFilters(next); renderEstadisticas();
  }));
  view.querySelectorAll('[data-open-detail-row]').forEach(btn => btn.addEventListener('click', () => window.openSide?.(btn.dataset.openDetailRow)));
  document.getElementById('btnExportDetail')?.addEventListener('click', () => {
    const headers = [dateBasisColumnLabel(f), 'Fecha facturada', 'Paciente', 'DNI', 'Afiliado', 'Obra social', 'Clínica', 'Ojo', 'Fecha cirugía', 'Vitrectomía', 'Estado'];
    const lines = [headers, ...detailRows.map(r => [fechaEstadisticaFacturada(r, f), fechaFacturadaReal(r), r.nombre, r.dni, r.afiliado, r.obraSocial, r.clinica, r.ojo, fechaISO(r.fechaCir), hasVitrectomia(r) ? 'Sí' : 'No', stageOf(r)])];
    const csv = '\ufeff' + lines.map(row => row.map(csvCell).join(';')).join('\r\n');
    downloadTextFile(`detalle_facturado_${hoyISO()}.csv`, csv, 'text/csv;charset=utf-8');
    toast(`✓ Descargados ${detailRows.length} registros facturados`);
  });
}
