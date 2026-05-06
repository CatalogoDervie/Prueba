'use strict';

import { DB, stateKey, WORKFLOW_KEYS, isFacturadoCompleto, getFechaFacturadaBase } from './state.js';
import { escapeHtml, escapeAttr, diffDays } from './utils.js';

const KEY = 'indicadores_v6_filters';
const TARGET_VITRECTOMIAS_POR_CLINICA = 16;

function monthKey(v) { return String(v || '').slice(0, 7); }
function monthDate(key) {
  if (!key) return null;
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return null;
  return new Date(y, m - 1, 1);
}
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
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

function allMonths(rows) {
  return [...new Set(rows.map(r => monthKey(getFechaFacturadaBase(r) || r.fechaCir || r.fechaLlegaLente || r.fechaSolLente)).filter(Boolean))].sort();
}

function readFilters(rows) {
  const clinics = [...new Set(rows.map(r => r.clinica).filter(Boolean))].sort();
  const obras = [...new Set(rows.map(r => r.obraSocial).filter(Boolean))].sort();
  const months = allMonths(rows);
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  return {
    screen: ['resumen', 'tiempos', 'produccion'].includes(saved.screen) ? saved.screen : 'resumen',
    clinica: clinics.includes(saved.clinica) ? saved.clinica : '',
    obra: obras.includes(saved.obra) ? saved.obra : '',
    from: months.includes(saved.from) ? saved.from : (months[0] || ''),
    to: months.includes(saved.to) ? saved.to : (months[months.length - 1] || ''),
    splitClinic: !!saved.splitClinic,
    clinics,
    obras,
    months
  };
}

function applyFilters(rows, f) {
  return rows.filter(r => {
    const mk = monthKey(getFechaFacturadaBase(r) || r.fechaCir || r.fechaLlegaLente || r.fechaSolLente);
    if (f.from && mk && mk < f.from) return false;
    if (f.to && mk && mk > f.to) return false;
    if (f.clinica && r.clinica !== f.clinica) return false;
    if (f.obra && r.obraSocial !== f.obra) return false;
    return true;
  });
}

function applyNonTemporalFilters(rows, f) {
  return rows.filter(r => {
    if (f.clinica && r.clinica !== f.clinica) return false;
    if (f.obra && r.obraSocial !== f.obra) return false;
    return true;
  });
}

function saveFilters(next) { localStorage.setItem(KEY, JSON.stringify(next)); }

function summaryCard(label, value, help = '', tone = '') {
  return `<div class="stats-mini-card ${tone ? `stats-mini-card-${tone}` : ''}"><div class="stats-mini-label">${escapeHtml(label)}</div><div class="stats-mini-value">${value}</div>${help ? `<div class="stats-mini-help">${escapeHtml(help)}</div>` : ''}</div>`;
}

function barChartCard({ title, subtitle = '', series, percent = false, targetLine = null, targetLabel = '' }) {
  const labels = series[0]?.points.map(p => p.x) || [];
  const maxData = Math.max(1, ...series.flatMap(s => s.points.map(p => p.y || 0)), targetLine || 0);
  const barGroups = labels.length || 1;
  const w = Math.max(760, barGroups * 92);
  const h = 330;
  const left = 56;
  const top = 24;
  const bottom = 70;
  const chartH = h - top - bottom;
  const groupW = (w - left - 24) / Math.max(1, barGroups);
  const gap = Math.min(12, groupW * 0.16);
  const barW = Math.max(14, (groupW - gap * (series.length + 1)) / Math.max(1, series.length));
  const colors = ['#1d4ed8', '#16a34a', '#7c3aed', '#ea580c'];
  const legendItems = [...series.map((s, i) => ({ name: s.name, color: colors[i % colors.length] }))];
  let bars = '';
  let valueLabels = '';
  let xLabels = '';
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
    targetSvg = `
      <line x1="${left}" x2="${w - 16}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#dc2626" stroke-width="2" stroke-dasharray="8 6"></line>
      <text x="${w - 20}" y="${(y - 8).toFixed(2)}" text-anchor="end" font-size="11" fill="#b91c1c" font-weight="700">${escapeHtml(targetLabel || `Meta ${targetLine}`)}</text>`;
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

export function renderEstadisticas() {
  const view = document.getElementById('statsView');
  if (!view) return;

  const all = DB.rows || [];
  const f = readFilters(all);
  const rows = applyFilters(all, f);
  const rowsNoTime = applyNonTemporalFilters(all, f);
  const clinicsInScope = [...new Set(rowsNoTime.map(r => r.clinica || 'Sin clínica'))];
  const visibleClinics = f.splitClinic ? clinicsInScope : ['Total'];
  const factRows = rows.filter(r => isFacturadoCompleto(r.estadoFac));
  const factMonths = [...new Set(factRows.map(r => monthKey(getFechaFacturadaBase(r))).filter(Boolean))].sort();

  const byMonthFact = selector => visibleClinics.map(cl => ({
    name: cl,
    points: factMonths.map(m => {
      const base = factRows.filter(r => monthKey(getFechaFacturadaBase(r)) === m && (cl === 'Total' || (r.clinica || 'Sin clínica') === cl));
      return { x: monthLabel(m), y: selector(base) };
    })
  }));

  const pedidoALlegadaDone = rows.filter(r => r.fechaSolLente && r.fechaLlegaLente)
    .map(r => diffDays(r.fechaLlegaLente, r.fechaSolLente))
    .filter(v => v != null && v >= 0);
  const llegadaAFechaDone = rows.filter(r => r.fechaLlegaLente && r.fechaCir)
    .map(r => diffDays(r.fechaCir, r.fechaLlegaLente))
    .filter(v => v != null && v >= 0);
  const cirugiaAFacturaDone = factRows.filter(r => r.fechaCir && getFechaFacturadaBase(r))
    .map(r => diffDays(getFechaFacturadaBase(r), r.fechaCir))
    .filter(v => v != null && v >= 0);

  const waitingOpen = rows.filter(r => stateKey(r) === WORKFLOW_KEYS.ESPERANDO_LENTE)
    .map(r => diffDays(new Date(), r.fechaSolLente))
    .filter(v => v != null && v >= 0);
  const arrivedOpen = rows.filter(r => stateKey(r) === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR)
    .map(r => diffDays(new Date(), r.fechaLlegaLente))
    .filter(v => v != null && v >= 0);
  const billingOpen = rows.filter(r => stateKey(r) === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR)
    .map(r => diffDays(new Date(), r.fechaCir))
    .filter(v => v != null && v >= 0);

  const stageCounts = rows.reduce((acc, r) => {
    const k = stageOf(r);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const avgPedidoLlegadaByClinic = valuesByClinic(rows.filter(r => r.fechaSolLente && r.fechaLlegaLente), r => diffDays(r.fechaLlegaLente, r.fechaSolLente));
  const avgLlegadaCirugiaByClinic = valuesByClinic(rows.filter(r => r.fechaLlegaLente && r.fechaCir), r => diffDays(r.fechaCir, r.fechaLlegaLente));
  const avgCirugiaFacturaByClinic = valuesByClinic(factRows.filter(r => r.fechaCir && getFechaFacturadaBase(r)), r => diffDays(getFechaFacturadaBase(r), r.fechaCir));

  const factMonthly = byMonthFact(base => base.length);
  const vitMonthly = byMonthFact(base => base.filter(r => !!r.extraVitrectomia).length);
  const vitPctMonthly = byMonthFact(base => {
    if (!base.length) return 0;
    const vit = base.filter(r => !!r.extraVitrectomia).length;
    return Math.round((vit / base.length) * 100);
  });

  const totalFact = factRows.length;
  const totalVit = factRows.filter(r => !!r.extraVitrectomia).length;
  const pctVitTotal = totalFact ? Math.round((totalVit / totalFact) * 100) : 0;

  const focusMonth = factMonths.includes(currentMonthKey()) ? currentMonthKey() : (factMonths[factMonths.length - 1] || currentMonthKey());
  const focusMonthLabel = monthLabel(focusMonth);
  const focusClinics = f.clinica ? [f.clinica] : (clinicsInScope.length ? clinicsInScope : ['CDU']);
  const targetMonth = TARGET_VITRECTOMIAS_POR_CLINICA * Math.max(1, f.splitClinic ? 1 : focusClinics.length);
  const vitCurrentMonth = factRows.filter(r => monthKey(getFechaFacturadaBase(r)) === focusMonth)
    .filter(r => f.clinica ? r.clinica === f.clinica : true)
    .filter(r => !!r.extraVitrectomia).length;
  const faltanVitCurrent = Math.max(0, targetMonth - vitCurrentMonth);

  const header = `
    <div class="stats-shell">
      <div class="stats-title-wrap">
        <div>
          <div class="stats-title">Estadísticas</div>
          <div class="stats-subtitle">Toda la analítica usa la misma lógica de estados que la operación diaria y prioriza lectura rápida.</div>
        </div>
      </div>
      <div class="stats-toolbar">
        <select id="inCli" class="an-select"><option value="">Todas las clínicas</option>${f.clinics.map(v => `<option ${v === f.clinica ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>
        <select id="inObra" class="an-select"><option value="">Todas las obras sociales</option>${f.obras.map(v => `<option ${v === f.obra ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>
        <select id="inFrom" class="an-select"><option value="">Desde</option>${f.months.map(v => `<option value="${escapeAttr(v)}" ${v === f.from ? 'selected' : ''}>${escapeHtml(monthLabel(v))}</option>`).join('')}</select>
        <select id="inTo" class="an-select"><option value="">Hasta</option>${f.months.map(v => `<option value="${escapeAttr(v)}" ${v === f.to ? 'selected' : ''}>${escapeHtml(monthLabel(v))}</option>`).join('')}</select>
        <label class="stats-check"><input type="checkbox" id="inSplit" ${f.splitClinic ? 'checked' : ''}> Comparar clínicas</label>
      </div>
      <div class="stats-screens">
        ${[['resumen', 'Resumen'], ['tiempos', 'Tiempos'], ['produccion', 'Facturación + vitrectomías']].map(([key, label]) => `<button class="stats-screen-btn ${f.screen === key ? 'active' : ''}" data-screen="${key}">${label}</button>`).join('')}
      </div>`;

  let body = '';

  if (f.screen === 'resumen') {
    body = `
      <div class="stats-mini-grid">
        ${summaryCard('Pedir lente', stageCounts['PEDIR LENTE'] || 0)}
        ${summaryCard('Esperando lente', stageCounts['ESPERANDO LENTE'] || 0)}
        ${summaryCard('Llegó lente - programar', stageCounts['LLEGÓ LENTE - PROGRAMAR'] || 0)}
        ${summaryCard('Fecha programada', stageCounts['FECHA PROGRAMADA'] || 0)}
        ${summaryCard('Realizada - falta facturar', stageCounts['REALIZADA - FALTA FACTURAR'] || 0)}
        ${summaryCard('Facturada', stageCounts['FACTURADA'] || 0, 'Cierre simple de episodio')}
        ${summaryCard('Facturada falta otro ojo', stageCounts['FACTURADA FALTA OTRO OJO'] || 0)}
        ${summaryCard('Finalizada', stageCounts['FINALIZADA'] || 0)}
      </div>
      <div class="stats-grid-2">
        ${simpleBarsCard('Pedido → llegada por clínica', avgPedidoLlegadaByClinic, ' días', 'Promedio real calculado solo con casos que ya recibieron lente.')}
        <section class="stats-card"><div class="stats-card-head"><div><h4>Embudo operativo</h4><p>Estados separados tal como se trabajan en la operatoria diaria.</p></div></div><div class="stage-list">
          ${['PEDIR LENTE', 'ESPERANDO LENTE', 'LLEGÓ LENTE - PROGRAMAR', 'FECHA PROGRAMADA', 'REALIZADA - FALTA FACTURAR', 'FACTURADA', 'FACTURADA FALTA OTRO OJO', 'FINALIZADA'].map(k => `<div class="stage-row"><span>${escapeHtml(k)}</span><strong>${stageCounts[k] || 0}</strong></div>`).join('')}
        </div></section>
      </div>`;
  }

  if (f.screen === 'tiempos') {
    body = `
      <div class="stats-mini-grid">
        ${summaryCard('Pedido → llegada', `${avg(pedidoALlegadaDone)} días`, 'Promedio real con lentes ya recibidas')}
        ${summaryCard('Llegada → cirugía', `${avg(llegadaAFechaDone)} días`, 'Promedio real desde que llega la lente hasta la fecha quirúrgica')}
        ${summaryCard('Cirugía → facturación', `${avg(cirugiaAFacturaDone)} días`, 'Promedio real con casos ya facturados')}
        ${summaryCard('Espera abierta hoy', `${avg(waitingOpen)} días`, 'Solo pacientes que siguen esperando lente')}
        ${summaryCard('Llegó y sigue sin fecha', `${avg(arrivedOpen)} días`, 'Pacientes con lente recibida y sin programación')}
        ${summaryCard('Realizada y sin facturar', `${avg(billingOpen)} días`, 'Casos abiertos pendientes administrativos')}
      </div>
      <div class="stats-grid-2">
        ${simpleBarsCard('Pedido → llegada por clínica', avgPedidoLlegadaByClinic, ' días', 'Sirve para auditar al proveedor y no depende del stock abierto.')}
        ${simpleBarsCard('Llegada → cirugía por clínica', avgLlegadaCirugiaByClinic, ' días', 'Refleja la demora variable desde que el lente llega hasta la fecha quirúrgica.')}
      </div>
      <div class="stats-grid-2">
        ${simpleBarsCard('Cirugía → facturación por clínica', avgCirugiaFacturaByClinic, ' días', 'Mide la velocidad del cierre administrativo.')}
        <section class="stats-card"><div class="stats-card-head"><div><h4>Lectura rápida</h4><p>Separación entre tiempos reales completados y cuellos de botella todavía abiertos.</p></div></div><div class="stage-list">
          <div class="stage-row"><span>Promedio pedido → llegada</span><strong>${avg(pedidoALlegadaDone)} días</strong></div>
          <div class="stage-row"><span>Promedio llegada → cirugía</span><strong>${avg(llegadaAFechaDone)} días</strong></div>
          <div class="stage-row"><span>Promedio cirugía → facturación</span><strong>${avg(cirugiaAFacturaDone)} días</strong></div>
          <div class="stage-row"><span>Mediana espera abierta de lentes</span><strong>${median(waitingOpen)} días</strong></div>
          <div class="stage-row"><span>Mediana sin fecha tras llegada</span><strong>${median(arrivedOpen)} días</strong></div>
        </div></section>
      </div>`;
  }

  if (f.screen === 'produccion') {
    body = `
      <div class="stats-mini-grid">
        ${summaryCard('Total facturadas', totalFact)}
        ${summaryCard('Vitrectomías facturadas', totalVit)}
        ${summaryCard('% vitrectomías / facturadas', `${pctVitTotal}%`)}
        ${summaryCard(`Meta ${focusMonthLabel}`, `${targetMonth}`, 'Objetivo mensual de vitrectomías en el alcance visible')}
        ${summaryCard(`Vitrectomías ${focusMonthLabel}`, `${vitCurrentMonth}`, 'Hecho acumulado del mes foco')}
        ${summaryCard('Faltan para meta', `${faltanVitCurrent}`, faltanVitCurrent ? 'Restantes para llegar al objetivo mensual' : 'Meta alcanzada o superada', faltanVitCurrent ? 'warn' : 'ok')}
      </div>
      <div class="stats-grid-2">
        ${barChartCard({ title: 'Cantidad de cirugías facturadas por mes', subtitle: 'Año-mes usando fecha de facturación real.', series: factMonthly })}
        ${barChartCard({ title: 'Vitrectomías por mes', subtitle: 'Misma base mensual para leer junto con facturación total.', series: vitMonthly, targetLine: targetMonth, targetLabel: `Meta ${targetMonth}` })}
      </div>
      ${barChartCard({ title: '% vitrectomías sobre facturadas', subtitle: 'Participación mensual sobre el total facturado. Se lee mejor junto a los dos gráficos superiores.', series: vitPctMonthly, percent: true })}`;
  }

  view.innerHTML = `${header}${body}</div>`;

  const bind = () => {
    saveFilters({
      ...f,
      clinica: document.getElementById('inCli')?.value || '',
      obra: document.getElementById('inObra')?.value || '',
      from: document.getElementById('inFrom')?.value || '',
      to: document.getElementById('inTo')?.value || '',
      splitClinic: !!document.getElementById('inSplit')?.checked,
      screen: f.screen
    });
    renderEstadisticas();
  };

  ['inCli', 'inObra', 'inFrom', 'inTo', 'inSplit'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', bind);
  });
  view.querySelectorAll('[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => {
      saveFilters({ ...f, screen: btn.dataset.screen || 'resumen' });
      renderEstadisticas();
    });
  });
}
