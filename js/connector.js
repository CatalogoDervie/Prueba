// connector.js — Conector local OPCIONAL (http://127.0.0.1:8765)
// El health-check NUNCA se ejecuta automáticamente.
// Solo se activa cuando el usuario presiona "Probar conector"
// o al lanzar una automatización manualmente.

'use strict';

const CONNECTOR_BASE = 'http://127.0.0.1:8765';
const PAGE_PATCH_VERSION = 'PAGE_PATCH_2026_04_30_FACTURAR_LENTESS_DUPLICAR';
let CONNECTOR_STATUS = 'off';

const BADGE_CFG = {
  ok:  { cls: 'ok',  icon: '🟢', label: 'Conector: activo' },
  off: { cls: 'off', icon: '⚫', label: 'Conector: no detectado' },
  run: { cls: 'run', icon: '🟠', label: 'Conector: ejecutando...' },
  err: { cls: 'err', icon: '🔴', label: 'Conector: error' },
};

const LENTESS_JOB_PAYLOADS = new Map();

function errorToText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(errorToText).filter(Boolean).join(' · ');
  if (typeof v === 'object') {
    if (v.msg) return errorToText(v.msg);
    if (v.message) return errorToText(v.message);
    if (v.detail) return errorToText(v.detail);
    if (v.error) return errorToText(v.error);
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function rawText(v) { return String(v ?? '').trim(); }
function cleanDigitsLocal(v) { return rawText(v).replace(/\D+/g, ''); }
function normalizeOjo(v) {
  const s = rawText(v).toUpperCase();
  if (s.includes('OD')) return 'OD';
  if (s.includes('OI')) return 'OI';
  if (s.includes('OS')) return 'OI';
  return s;
}
function normalizeHoraText(v) {
  let s = rawText(v).replace('.', ':').replace(/[^0-9:]/g, '');
  if (!s) return '';
  if (/^\d{1,2}$/.test(s)) s = `${s.padStart(2, '0')}:00`;
  else if (/^\d{3,4}$/.test(s)) s = `${s.slice(0, -2).padStart(2, '0')}:${s.slice(-2)}`;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return s;
  const hh = Math.min(Math.max(parseInt(m[1], 10) || 0, 0), 23);
  const mm = Math.min(Math.max(parseInt(m[2], 10) || 0, 0), 59);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function isoToDisplayDate(v) {
  const s = rawText(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function displayDateToIso(v) {
  let s = rawText(v);
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}
function fechaToEcoUS(fecha) {
  const iso = displayDateToIso(fecha).slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return rawText(fecha);
}
function normalizeEcoImageName(nombre) {
  const raw = rawText(nombre);
  if (!raw) return '';
  const base = raw.split(/[\\/]/).pop();
  const m = base.match(/DR\s*(\d+)/i);
  if (m) return `${parseInt(m[1], 10)}.png`;
  const n = base.match(/^(\d+)\.(?:jpe?g|png|bmp|webp)$/i);
  if (n) return `${parseInt(n[1], 10)}.png`;
  if (/^\d+$/.test(base)) return `${parseInt(base, 10)}.png`;
  return base;
}

function migrateEcoCatalogToPng() {
  try {
    const key = 'ecografia_image_catalog';
    const nuevo = Array.from({ length: 23 }, (_, i) => `${i + 1}.png`).join('\n');
    const raw = localStorage.getItem(key) || '';
    if (!raw || /DR\s*\d+\.jpe?g/i.test(raw)) {
      localStorage.setItem(key, nuevo);
      console.log(`[${PAGE_PATCH_VERSION}] Catálogo de ecografías migrado a PNG`);
    }
  } catch (e) {
    console.warn(`[${PAGE_PATCH_VERSION}] No se pudo migrar catálogo de ecografías`, e);
  }
}

function patchFacturarPayload(payload) {
  if (!payload || !Array.isArray(payload.pacientes)) return payload;
  const copy = JSON.parse(JSON.stringify(payload));

  // Normalización defensiva antes de enviar a FastAPI/Pydantic.
  // Evita: "Input should be a valid string" cuando se factura sin vitrectomía.
  copy.base_dir = rawText(copy.base_dir || copy.baseDir || '');
  copy.output_dir = rawText(copy.output_dir || copy.outputDir || '');
  copy.source = rawText(copy.source || 'github_facturar_tab');

  copy.pacientes = copy.pacientes.map(p => {
    const fechaFactura = rawText(p.fecha_facturacion || p.fechaFacturacion || p.fechaFacturada || p.fecha).slice(0, 10);
    const fechaIso = displayDateToIso(fechaFactura);
    const hora = normalizeHoraText(p.hora || p.hora_cirugia || p.horaCirugia || '');
    const generaEco = !!(p.generar_ecografia || p.tiene_vitrectomia || p.vitrectomia || p.generar?.ECOGRAFIA);

    p.id = rawText(p.id);
    p.nombre_completo = rawText(p.nombre_completo || p.nombre);
    p.dni = rawText(p.dni);
    p.afiliado = rawText(p.afiliado);
    p.ojo_operado = normalizeOjo(p.ojo_operado || p.ojo);
    p.dioptria = rawText(p.dioptria || p.lio);
    p.clinica = rawText(p.clinica);
    p.obra_social = rawText(p.obra_social || p.obraSocial);
    p.fecha = fechaIso || rawText(p.fecha);
    p.fecha_facturacion = fechaIso || rawText(p.fecha_facturacion || p.fechaFacturacion || p.fecha);
    p.hora = hora;
    p.facturar = !!p.facturar;

    // Flags consistentes para el conector.
    p.generar = Object.assign({}, p.generar || {}, { ECOGRAFIA: generaEco });
    p.generar_ecografia = generaEco;
    p.tiene_vitrectomia = generaEco;
    p.vitrectomia = generaEco;

    if (generaEco) {
      p.imagen_ecografia = normalizeEcoImageName(p.imagen_ecografia || p.ecografiaImagen || p.imagenEco || '');
      p.ecografia_mes = rawText(p.ecografia_mes || p.ecografiaMes || p.mes);
      p.mes = rawText(p.mes || p.ecografia_mes);
      p.fecha_hora_eco = rawText(p.fecha_hora_eco);
      if (!p.fecha_hora_eco && (p.fecha_facturacion || p.fecha) && hora) {
        p.fecha_hora_eco = `${fechaToEcoUS(p.fecha_facturacion || p.fecha)} ${hora}`;
      }
    } else {
      // Clave: sin vitrectomía todos los campos ECO deben ser strings vacíos, nunca null.
      p.imagen_ecografia = '';
      p.ecografiaImagen = '';
      p.imagenEco = '';
      p.ecografia_mes = '';
      p.ecografiaMes = '';
      p.mes = '';
      p.fecha_hora_eco = '';
    }
    return p;
  });
  return copy;
}

function prepareFacturarDateInput(input) {
  if (!input || input.dataset.facturarFechaPatch === '1') return;
  input.dataset.facturarFechaPatch = '1';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = 'dd/mm/aaaa';
  input.title = 'Podés escribir la fecha completa: 30/04/2026';
  input.style.minWidth = '112px';
  input.style.width = '112px';
  input.value = isoToDisplayDate(input.value);
}

function patchFacturarDateInputs() {
  document.querySelectorAll('input.facturar-fecha').forEach(prepareFacturarDateInput);
}

function installFacturarDatePatch() {
  if (window.__facturarFechaPatchInstalled) return;
  window.__facturarFechaPatchInstalled = true;

  migrateEcoCatalogToPng();
  patchFacturarDateInputs();

  document.addEventListener('change', ev => {
    const input = ev.target?.closest?.('input.facturar-fecha');
    if (!input) return;
    input.value = displayDateToIso(input.value);
  }, true);

  document.addEventListener('blur', ev => {
    const input = ev.target?.closest?.('input.facturar-fecha');
    if (!input) return;
    // Si el usuario sale del campo sin disparar change, igual normalizamos.
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(input.value) || /^\d{8}$/.test(input.value)) {
      input.value = displayDateToIso(input.value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, true);

  const obs = new MutationObserver(() => patchFacturarDateInputs());
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

async function duplicarPacienteLimpio(id) {
  const [{ DB, findRow, normalizeId }, { save }, { hoyISO, toast }, { render }] = await Promise.all([
    import('./state.js'),
    import('./firebase-ui.js'),
    import('./utils.js'),
    import('./render.js'),
  ]);

  const orig = findRow(id);
  if (!orig) return;

  const ojoOriginal = normalizeOjo(orig.ojo || '');
  const otroOjo = ojoOriginal === 'OD' ? 'OI' : 'OD';
  const yaExiste = DB.rows.some(x =>
    normalizeId(x.id) !== normalizeId(orig.id) &&
    rawText(x.dni) === rawText(orig.dni) &&
    normalizeOjo(x.ojo) === otroOjo
  );
  if (yaExiste) {
    toast(`Ya existe episodio para ${otroOjo}`);
    return;
  }

  orig.ojos = '2 ojos';
  const copia = {
    // Datos principales que se conservan hasta dioptría
    id: String(DB.nid++),
    clinica: orig.clinica || 'CDU',
    nombre: orig.nombre || '',
    dni: orig.dni || '',
    fnac: orig.fnac || '',
    tel: orig.tel || '',
    dir: orig.dir || '',
    obraSocial: orig.obraSocial || 'PAMI',
    afiliado: orig.afiliado || '',
    ojos: '2 ojos',
    ojo: otroOjo,
    dioptria: orig.dioptria || '',
    lio: orig.lio || '',

    // Nuevo episodio quirúrgico: se limpia todo lo operativo
    fechaSolLente: '',
    fechaLlegaLente: '',
    recepLente: '',
    fechaCir: '',
    hora: '',
    hora_cirugia: '',
    estadoCir: '',
    estadoFac: '',
    fechaFacturada: '',
    fechaFacturacion: '',
    facturarSeleccionado: false,
    extraSutura: false,
    extraInyeccion: false,
    extraVitrectomia: false,
    ecografiaImagen: '',
    ecografiaMes: '',
    notas: '',
    fechaCarga: hoyISO(),
  };

  DB.rows.push(copia);
  await save(orig);
  await save(copia);
  render();
  window.closeSide?.();
  setTimeout(() => window.openSide?.(copia.id), 100);
  toast(`✓ Duplicado limpio para ojo ${copia.ojo}`);
}

function installDuplicatePatch() {
  const apply = () => {
    window.duplicarPaciente = duplicarPacienteLimpio;
    console.log(`[${PAGE_PATCH_VERSION}] Duplicar paciente limpio activo`);
  };
  setTimeout(apply, 0);
  window.addEventListener('load', apply, { once: true });
}

function rowMatchesLentessPayload(row, payloadPaciente) {
  const afiRow = cleanDigitsLocal(row.afiliado || '');
  const afiPayload = cleanDigitsLocal(payloadPaciente.afiliado || '');
  const ojoRow = normalizeOjo(row.ojo || '');
  const ojoPayload = normalizeOjo(payloadPaciente.ojo || '');
  const lioRow = rawText(row.dioptria || row.lio || '');
  const lioPayload = rawText(payloadPaciente.lio || payloadPaciente.dioptria || '');
  return afiRow && afiRow === afiPayload && ojoRow === ojoPayload && (!lioPayload || lioRow === lioPayload);
}

async function marcarLentessComoPedido(payload) {
  const pacientes = Array.isArray(payload?.pacientes) ? payload.pacientes : [];
  if (!pacientes.length) return;

  const [{ DB, WORKFLOW_KEYS, stateKey }, { save }, { hoyISO, toast }, { render }] = await Promise.all([
    import('./state.js'),
    import('./firebase-ui.js'),
    import('./utils.js'),
    import('./render.js'),
  ]);

  let count = 0;
  for (const row of DB.rows) {
    const match = pacientes.some(p => rowMatchesLentessPayload(row, p));
    if (!match) continue;
    if (stateKey(row) === WORKFLOW_KEYS.PEDIR_LENTE || !row.fechaSolLente) {
      row.fechaSolLente = hoyISO();
      row.fechaLlegaLente = '';
      row.recepLente = '';
      await save(row);
      count += 1;
    }
  }

  if (count) {
    render();
    toast(`✅ Lentess correcto: ${count} paciente(s) pasaron a ESPERANDO LENTE`);
    console.log(`[${PAGE_PATCH_VERSION}] Lentess OK: ${count} paciente(s) actualizados`);
  }
}

installFacturarDatePatch();
installDuplicatePatch();

export function setConnectorBadge(state, msg) {
  CONNECTOR_STATUS = state;
  const el = document.getElementById('connectorBadge');
  if (!el) return;
  const cfg = BADGE_CFG[state] || BADGE_CFG.off;
  el.className = `connector-badge ${cfg.cls}`;
  el.textContent = `${cfg.icon} ${msg || cfg.label}`;
}

export function getConnectorStatus() { return CONNECTOR_STATUS; }

// ── Fetch hacia el conector local ─────────────────────────────────────────
export async function connectorFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), opts.timeoutMs || 12000);
  try {
    const res = await fetch(`${CONNECTOR_BASE}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const txt = await res.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { raw: txt || '' }; }
    if (!res.ok) {
      const detail = errorToText(data?.detail || data?.error || data?.message || data?.raw) || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return data;
  } catch (e) {
    const msg = errorToText(e?.message || e);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('abort') || e?.name === 'AbortError') {
      throw new Error('No se pudo conectar con el conector local. ¿Está abierto el Iniciar Conector del Escritorio?');
    }
    throw new Error(msg || 'Error desconocido del conector');
  } finally {
    clearTimeout(tm);
  }
}

// ── Health check — solo llamar bajo demanda ───────────────────────────────
export async function connectorHealthCheck() {
  try {
    await connectorFetch('/health', { method: 'GET', headers: {}, timeoutMs: 4000 });
    if (CONNECTOR_STATUS !== 'run') setConnectorBadge('ok');
    return true;
  } catch (e) {
    if (CONNECTOR_STATUS !== 'run') setConnectorBadge('off');
    return false;
  }
}

// ── Prueba manual — llamada desde el botón de UI ──────────────────────────
export async function probarConexion() {
  setConnectorBadge('run', 'Conector: probando...');
  const ok = await connectorHealthCheck();
  if (ok) {
    import('./utils.js').then(({ toast }) => toast('✅ Conector activo en http://127.0.0.1:8765'));
  } else {
    import('./utils.js').then(({ toast }) => toast('❌ Conector no responde — ¿Abriste el Iniciar Conector del Escritorio?'));
    mostrarAyudaConector();
  }
}

function mostrarAyudaConector() {
  alert(
    'El conector local NO está corriendo.\n\n' +
    'Para iniciarlo:\n' +
    '  1. Buscá el ícono "Iniciar Conector" en tu Escritorio\n' +
    '  2. Doble clic para abrirlo\n' +
    '  3. Dejá esa ventana abierta\n' +
    '  4. Volvé a intentar la automatización'
  );
}

// ── Iniciar un job en el conector ─────────────────────────────────────────
export async function connectorStartJob(kind, payload) {
  const healthy = await connectorHealthCheck();
  if (!healthy) {
    mostrarAyudaConector();
    throw new Error('Conector local no detectado. Abrí el ícono Iniciar Conector del Escritorio e intentá de nuevo.');
  }
  setConnectorBadge('run', 'Conector: iniciando job...');
  try {
    let finalPayload = payload;
    if (kind === 'facturar_docs') {
      finalPayload = patchFacturarPayload(payload);
      console.log(`[${PAGE_PATCH_VERSION}] payload facturar_docs corregido`, finalPayload);
    }

    const data = await connectorFetch(`/jobs/${kind}`, { method: 'POST', body: JSON.stringify(finalPayload), timeoutMs: 15000 });
    const jobId = data.job_id || data.id;
    if (!jobId) throw new Error('El conector no devolvió job_id. Revisá los logs del conector.');

    if (kind === 'lentess') {
      LENTESS_JOB_PAYLOADS.set(String(jobId), JSON.parse(JSON.stringify(finalPayload || {})));
    }

    return jobId;
  } catch (e) {
    setConnectorBadge('err', 'Conector: error al iniciar job');
    throw e;
  }
}

// ── Polling de resultado de un job ────────────────────────────────────────
export async function connectorPollJob(jobId, onUpdate) {
  const started = Date.now();
  const maxMs = 20 * 60 * 1000;
  const sid = String(jobId || '');
  while (Date.now() - started < maxMs) {
    const data = await connectorFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: 'GET', headers: {}, timeoutMs: 10000 });
    const st = String(data.status || '').toLowerCase();
    if (onUpdate) onUpdate(data);
    if (['completed', 'ok', 'done', 'success'].includes(st)) {
      setConnectorBadge('ok');
      if (LENTESS_JOB_PAYLOADS.has(sid)) {
        const lentessPayload = LENTESS_JOB_PAYLOADS.get(sid);
        LENTESS_JOB_PAYLOADS.delete(sid);
        await marcarLentessComoPedido(lentessPayload);
      }
      return data;
    }
    if (['error', 'failed', 'cancelled'].includes(st)) {
      if (LENTESS_JOB_PAYLOADS.has(sid)) LENTESS_JOB_PAYLOADS.delete(sid);
      setConnectorBadge('err', 'Conector: terminó con error');
      throw new Error(errorToText(data.error || data.detail || data.message) || 'La automatización terminó con error. Revisá los logs.');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (LENTESS_JOB_PAYLOADS.has(sid)) LENTESS_JOB_PAYLOADS.delete(sid);
  setConnectorBadge('err', 'Conector: tiempo agotado');
  throw new Error('La automatización tardó más de 20 minutos. Revisá Chrome y los logs.');
}

// ── Renderiza estado de un job en un contenedor ───────────────────────────
export function renderJobStatus(containerId, type, msg) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const colors = { ok: '#047857', run: '#c2410c', err: '#b91c1c', off: '#64748b', info: '#1d4ed8', warn: '#b45309' };
  el.style.color = colors[type] || colors.info;
  el.style.fontWeight = '600';
  el.textContent = msg;
}
