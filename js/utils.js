// utils.js — Utilidades compartidas: escape, formato de fechas, helpers

'use strict';

// ── Escape HTML para contenido de texto en el DOM ──────────────────────────
export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// ── Escape para atributos HTML (value="", title="", data-*) ───────────────
export function escapeAttr(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// ── Serializa un valor como string JSON seguro para usar en onclick="fn(X)" ─
export function jsq(v) {
  return JSON.stringify(String(v ?? ''));
}

// ── Retorna la fecha de hoy en formato ISO YYYY-MM-DD ─────────────────────
export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Parsea una fecha como objeto Date sin hora (00:00:00) ─────────────────
export function parseDateOnly(d) {
  if (!d) return null;
  if (d instanceof Date && !isNaN(d)) {
    const t = new Date(d);
    t.setHours(0, 0, 0, 0);
    return t;
  }
  const v = String(d).trim();
  let dt = null;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10), month = parseInt(m[2], 10) - 1, year = parseInt(m[3], 10);
    dt = new Date(year, month, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) return null;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, mo, da] = v.slice(0, 10).split('-').map(n => parseInt(n, 10));
    dt = new Date(y, mo - 1, da);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) return null;
  } else {
    const temp = new Date(v);
    if (!isNaN(temp)) dt = temp;
  }
  if (!dt || isNaN(dt)) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function toDateOnly(d) {
  const dt = parseDateOnly(d);
  return dt ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) : null;
}

// ── Diferencia en días entre dos fechas ──────────────────────────────────
export function diffDays(a, b) {
  const da = toDateOnly(a), db = toDateOnly(b);
  if (!da || !db) return null;
  return Math.floor((da - db) / 86400000);
}

export function daysSince(d) {
  const dt = parseDateOnly(d);
  if (!dt) return -1;
  const h = parseDateOnly(hoyISO());
  return Math.floor((h - dt) / 86400000);
}

// ── Formatea fecha para mostrar (DD/MM/YYYY o '') ─────────────────────────
export function fd(d) {
  const dt = parseDateOnly(d);
  if (!dt) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

// ── Formatea fecha para input type=date (YYYY-MM-DD o '') ─────────────────
export function fdInput(d) {
  const dt = parseDateOnly(d);
  if (!dt) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// ── Timestamp para nombres de archivo ────────────────────────────────────
export function nowTag() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// ── Descarga un archivo de texto ─────────────────────────────────────────
export function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// ── Solo dígitos ──────────────────────────────────────────────────────────
export function cleanDigits(v) {
  return String(v || '').replace(/\D+/g, '');
}

// ── Detecta delimitador CSV ───────────────────────────────────────────────
export function detectDelimiter(line) {
  const c = (line.match(/,/g) || []).length;
  const sc = (line.match(/;/g) || []).length;
  const t = (line.match(/\t/g) || []).length;
  return t >= sc && t >= c ? '\t' : (sc > c ? ';' : ',');
}

export function parseDelimitedRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const d = detectDelimiter(lines[0]);
  const headers = lines[0].split(d).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(d);
    const out = {};
    headers.forEach((h, i) => out[h] = String(cols[i] || '').trim());
    return out;
  });
}

// ── Toast de notificación ─────────────────────────────────────────────────
let _toastTimer = null;
export function toast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────
function configureIDB() {
  return new Promise(res => {
    if (!window.indexedDB) return res(null);
    const req = indexedDB.open('cirugias_db', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });
}

export async function idbSet(key, val) {
  const db = await configureIDB();
  if (!db) return;
  await new Promise(r => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => r();
    tx.onerror = () => r();
  });
}

export async function idbGet(key) {
  const db = await configureIDB();
  if (!db) return null;
  return await new Promise(r => {
    const tx = db.transaction('kv', 'readonly');
    const q = tx.objectStore('kv').get(key);
    q.onsuccess = () => r(q.result || null);
    q.onerror = () => r(null);
  });
}

export async function idbDelete(key) {
  const db = await configureIDB();
  if (!db) return;
  await new Promise(r => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => r();
    tx.onerror = () => r();
  });
}
