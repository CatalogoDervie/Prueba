// firebase-ui.js — Conexión Firestore, caché local, guardado y sincronización

'use strict';

import { idbSet, idbGet, idbDelete, toast } from './utils.js';
import {
  DB, setDB, FIRESTORE_ENABLED, setFirestoreEnabled,
  FIRESTORE_UNSUB, setFirestoreUnsub, APPS_SCRIPT_URL,
  normalizarData, backupDiario
} from './state.js';
// render() is called lazily to avoid circular dependency
async function render() { const m = await import('./render.js'); m.render(); }

// ── Badge de sincronización ───────────────────────────────────────────────
export function showSyncBadge(msg, color = 'blue') {
  const b = document.getElementById('syncBadge');
  if (!b) return;
  const colors = { green: '#059669', orange: '#d97706', red: '#dc2626', blue: '#1a56db' };
  b.textContent = msg;
  b.style.color = colors[color] || colors.blue;
  b.style.display = 'inline';
}

// ── Cola de escrituras offline ────────────────────────────────────────────
window.addEventListener('firestoreQueueFlushed', () => {
  showSyncBadge('✓ Todos los cambios sincronizados', 'green');
  setTimeout(() => showSyncBadge('✓ Firestore en línea', 'green'), 3000);
});

// ── Guardar localmente + Firestore ────────────────────────────────────────
let _backupDiarioHecho = false;
let _lastRealtimeSig = '';

export async function save(changedRow) {
  if (!_backupDiarioHecho) { backupDiario(); _backupDiarioHecho = true; }
  try {
    localStorage.setItem('cirugias_cache', JSON.stringify(DB));
  } catch (e) {
    console.warn('[save] localStorage lleno, usando IndexedDB:', e.message);
  }
  idbSet('cirugias_cache', DB);
  if (!changedRow) return;

  if (FIRESTORE_ENABLED && window.firestoreConnector) {
    showSyncBadge('⟳ Guardando...', 'blue');
    try {
      await window.firestoreConnector.upsertRow(changedRow);
      const pending = window.firestoreConnector.pendingCount?.() || 0;
      if (pending > 0) {
        showSyncBadge(`⚠ ${pending} cambio(s) pendiente(s)`, 'orange');
      } else {
        showSyncBadge('✓ Guardado', 'green');
      }
    } catch (e) {
      const pending = window.firestoreConnector.pendingCount?.() || '?';
      console.warn('[Firestore] guardado en cola offline:', e.message);
      showSyncBadge(`⚠ Sin conexión — ${pending} en cola`, 'orange');
    }
    return;
  }

  if (!APPS_SCRIPT_URL) return;
  showSyncBadge('⟳ Guardando...');
  const result = await apiCall('save', { row: changedRow });
  if (result && result.ok) showSyncBadge('✓ Guardado', 'green');
  else showSyncBadge('⚠ Error al guardar', 'red');
}

export async function deleteFromServer(id) {
  try {
    localStorage.setItem('cirugias_cache', JSON.stringify(DB));
  } catch (_) { /* ignore */ }
  idbSet('cirugias_cache', DB);
  if (FIRESTORE_ENABLED && window.firestoreConnector) {
    try {
      await window.firestoreConnector.deleteRow(id);
      showSyncBadge('✓ Eliminado', 'green');
    } catch (e) {
      console.warn('[Firestore] delete failed:', e);
      showSyncBadge('⚠ Error al eliminar', 'orange');
    }
    return;
  }
  if (!APPS_SCRIPT_URL) return;
  await apiCall('delete', { id });
}

// ── Apps Script fallback ──────────────────────────────────────────────────
async function apiCall(action, data = {}) {
  if (!APPS_SCRIPT_URL) return null;
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=' + action, {
      method: 'POST',
      body: JSON.stringify({ action, ...data })
    });
    return await res.json();
  } catch (e) {
    console.error('API error:', e);
    return null;
  }
}

// ── Carga inicial de datos ────────────────────────────────────────────────
export async function loadFromServer() {
  const fsc = window.firestoreConnector;
  if (fsc) {
    showSyncBadge('⟳ Conectando a Firestore...');
    try {
      const ready = await Promise.race([
        fsc.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      if (ready) {
        const cached = localStorage.getItem('cirugias_cache') || await idbGet('cirugias_cache');
        if (cached && DB.rows.length === 0) {
          const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
          if (parsed && Array.isArray(parsed.rows)) {
            parsed.rows.forEach(r => { r.id = String(r.id ?? ''); });
            setDB(parsed);
            showSyncBadge('⟳ Caché local cargado…', 'blue');
          }
        }
        setFirestoreEnabled(true);
        showSyncBadge('✓ Firestore conectado', 'green');
        return;
      }
    } catch (e) {
      console.warn('[Firestore] no disponible, usando caché:', e.message);
      showSyncBadge('⚠ Firestore no disponible — datos locales', 'orange');
    }
  }

  const cached = localStorage.getItem('cirugias_cache') || await idbGet('cirugias_cache');
  if (cached) {
    setDB(typeof cached === 'string' ? JSON.parse(cached) : cached);
    return;
  }

  if (!APPS_SCRIPT_URL) {
    setDB({ rows: [], nid: 200 });
    return;
  }

  showSyncBadge('⟳ Cargando desde servidor...');
  const result = await apiCall('getAll');
  if (result && result.rows) {
    result.rows.forEach(r => { r.id = parseInt(r.id) || 0; });
    const ids = result.rows.map(r => r.id).filter(Boolean);
    const maxId = ids.length ? Math.max(...ids) : 0;
    setDB({ rows: result.rows, nid: maxId + 1 });
    try { localStorage.setItem('cirugias_cache', JSON.stringify(DB)); } catch (_) { }
    idbSet('cirugias_cache', DB);
    showSyncBadge('✓ En línea', 'green');
  } else {
    showSyncBadge('⚠ Sin conexión — datos locales', 'orange');
  }
}

// ── Listener en tiempo real de Firestore ──────────────────────────────────
export function ensureFirestoreRealtimeSync() {
  if (!FIRESTORE_ENABLED || !window.firestoreConnector || FIRESTORE_UNSUB) return;
  const unsub = window.firestoreConnector.listenRows((rows) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    safeRows.forEach(r => { r.id = String(r.id ?? ''); });
    const signature = safeRows
      .map(r => `${r.id}|${r.updatedAt || ''}|${r.estadoFac || ''}|${r.estadoCir || ''}`)
      .sort()
      .join('~');
    if (signature && signature === _lastRealtimeSig) return;
    _lastRealtimeSig = signature;
    const ids = safeRows.map(r => parseInt(r.id, 10)).filter(n => Number.isFinite(n));
    const maxId = ids.length ? Math.max(...ids) : 0;
    DB.rows = safeRows;
    DB.nid = Math.max(DB.nid || 0, maxId + 1);
    try { localStorage.setItem('cirugias_cache', JSON.stringify(DB)); } catch (_) { }
    idbSet('cirugias_cache', DB);
    const pending = window.firestoreConnector.pendingCount?.() || 0;
    if (pending > 0) {
      showSyncBadge(`⟳ Sincronizando (${pending} pendiente(s))...`, 'blue');
    } else {
      showSyncBadge('✓ Firestore en línea', 'green');
    }
    // No re-renderizar si el usuario está editando un campo
    const activeEl = document.activeElement;
    const isEditing = activeEl &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA') &&
      activeEl.closest('#tbody,#sidePanel');
    if (!isEditing) {
      normalizarData();
      render();
    }
  }, (e) => {
    console.warn('[Firestore] listener error:', e);
    showSyncBadge('⚠ Conexión interrumpida — reconectando...', 'orange');
    setFirestoreUnsub(null);
    setTimeout(() => ensureFirestoreRealtimeSync(), 5000);
  });
  setFirestoreUnsub(unsub);
}

export async function activateFirestoreIfReady() {
  if (!window.firestoreConnector) return;
  try {
    const ready = await window.firestoreConnector.ready;
    if (!ready) return;
    if (!FIRESTORE_ENABLED) {
      setFirestoreEnabled(true);
      showSyncBadge('✓ Firestore conectado', 'green');
    }
    ensureFirestoreRealtimeSync();
    if (window.firestoreConnector.flushQueue) {
      setTimeout(() => window.firestoreConnector.flushQueue(), 500);
    }
  } catch (e) {
    console.warn('[Firestore] activate failed:', e);
  }
}

// ── Sincronizar ahora ─────────────────────────────────────────────────────
export async function sincronizarAhora() {
  showSyncBadge('⟳ Sincronizando...', 'blue');
  if (FIRESTORE_ENABLED && window.firestoreConnector?.forcSync) {
    try { await window.firestoreConnector.forcSync(); }
    catch (e) { console.warn('[Sync] forcSync error:', e.message); }
  }
  await loadFromServer();
  normalizarData();
  backupDiario();
  render();
  const pending = window.firestoreConnector?.pendingCount?.() || 0;
  if (pending > 0) {
    toast(`⚠ ${pending} cambio(s) aún pendientes`);
    showSyncBadge(`⚠ ${pending} pendiente(s)`, 'orange');
  } else {
    toast('✓ Datos sincronizados');
    showSyncBadge('✓ Sincronizado', 'green');
  }
}

// ── Reparar caché ─────────────────────────────────────────────────────────
export async function repararCache() {
  if (!confirm('¿Limpiar caché local y recargar datos desde Firestore?\n\nUsá esto si ves datos incorrectos.')) return;
  showSyncBadge('⟳ Limpiando caché...', 'blue');
  try {
    const preservar = ['apps_script_url', 'cirugias_settings', 'cirugias_alert_silences',
      'wa_channel', 'wa_delay_ms', 'wa_only_llego', 'wa_tracking_map', 'wa_confirmed_map',
      'wa_phone_override', 'wa_global_date', 'pami_recetas_creds', 'pami_lentess_creds', 'fsc_write_queue'];
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !preservar.includes(k)) keysToDelete.push(k);
    }
    keysToDelete.forEach(k => localStorage.removeItem(k));
    await idbDelete('cirugias_cache');
    setDB({ rows: [], nid: 200 });
    setFirestoreEnabled(false);
    if (FIRESTORE_UNSUB) { try { FIRESTORE_UNSUB(); } catch (_) { } setFirestoreUnsub(null); }
    await loadFromServer();
    normalizarData();
    render();
    ensureFirestoreRealtimeSync();
    toast('✓ Caché limpio y datos recargados');
    showSyncBadge('✓ Datos frescos desde Firestore', 'green');
  } catch (e) {
    console.error('[repararCache] error:', e);
    toast('⚠ Error al limpiar caché: ' + e.message);
    showSyncBadge('⚠ Error al limpiar caché', 'red');
  }
}

// ── Configurar URL Apps Script ────────────────────────────────────────────
export async function configurarURL() {
  const { APPS_SCRIPT_URL: current, setAppsScriptUrl } = await import('./state.js');
  const url = prompt('Pegá la URL de tu Google Apps Script Web App:\n(la que termina en /exec)', current);
  if (url && url.includes('script.google.com')) {
    setAppsScriptUrl(url.trim());
    alert('URL guardada. Recargando datos...');
    await loadFromServer();
    render();
  } else if (url !== null) {
    alert('URL inválida. Debe ser de script.google.com');
  }
}
