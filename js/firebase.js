// firebase.js — Firestore connector seguro — Control de Cirugías
// Arquitectura: offline-first con cola persistente + Firebase Auth + Firestore moderno
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, doc, setDoc, getDocs,
  deleteDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { CLIENT_CONFIG } from './cliente-config.js';

const firebaseConfig = CLIENT_CONFIG.firebase;

const QUEUE_KEY = 'fsc_write_queue';
function queueLoad() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function queueSave(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch(e) { console.warn('[Queue] no se pudo persistir:', e.message); } }
function queueAdd(op) {
  const q = queueLoad();
  if (op.type === 'upsert') {
    const idx = q.findIndex(x => x.type === 'upsert' && String(x.row.id) === String(op.row.id));
    if (idx !== -1) { q[idx] = op; queueSave(q); return; }
  }
  q.push(op); queueSave(q);
}

let readyResolve;
const readyPromise = new Promise(r => { readyResolve = r; });
let app, db, auth, cirugiasRef, _initOk = false;

(async () => {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
    cirugiasRef = collection(db, 'cirugias');
    _initOk = true;
    readyResolve(true);
  } catch(e) {
    console.error('[Firebase] init error:', e);
    readyResolve(false);
  }
})();

function normVal(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
  return v;
}
function normRow(raw, docId) {
  const row = {};
  for (const [k, v] of Object.entries(raw || {})) row[k] = normVal(v);
  row.id = String(row.id ?? docId ?? '');
  return row;
}
function sanitize(row) {
  const out = { ...row };
  const now = new Date().toISOString();
  out.id = String(out.id || '');
  if (!out.createdAt) out.createdAt = now;
  out.updatedAt = now;
  for (const k of Object.keys(out)) { if (out[k] === undefined) out[k] = null; }
  return out;
}
async function withRetry(fn, retries = 4, baseMs = 500) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < retries) {
        const delay = baseMs * Math.pow(2, i - 1);
        console.warn(`[Firestore] intento ${i}/${retries} → esperando ${delay}ms`, e.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

let _flushRunning = false;
async function flushQueue() {
  if (_flushRunning || !_initOk) return;
  const q = queueLoad();
  if (!q.length) return;
  _flushRunning = true;
  const remaining = [...q];
  for (const op of q) {
    try {
      if (op.type === 'upsert') {
        const s = sanitize(op.row);
        await withRetry(() => setDoc(doc(cirugiasRef, s.id), { ...s, _srv: serverTimestamp() }, { merge: true }));
      } else if (op.type === 'delete') {
        await withRetry(() => deleteDoc(doc(cirugiasRef, String(op.id))));
      }
      const idx = remaining.findIndex(x => x._qid === op._qid);
      if (idx !== -1) remaining.splice(idx, 1);
      queueSave(remaining);
    } catch (e) {
      console.error('[Queue] op falló permanentemente:', e.message);
    }
  }
  _flushRunning = false;
  if (queueLoad().length === 0) window.dispatchEvent(new CustomEvent('firestoreQueueFlushed'));
}

window.addEventListener('online', () => setTimeout(flushQueue, 1500));

async function upsertRow(row) {
  const s = sanitize(row);
  const id = String(s.id || Date.now());
  s.id = id;
  const qid = `upsert_${id}_${Date.now()}`;
  queueAdd({ _qid: qid, type: 'upsert', row: s, ts: new Date().toISOString() });
  if (!_initOk) return id;
  await withRetry(() => setDoc(doc(cirugiasRef, id), { ...s, _srv: serverTimestamp() }, { merge: true }));
  queueSave(queueLoad().filter(x => x._qid !== qid));
  return id;
}

async function deleteRow(id) {
  const sid = String(id);
  const qid = `del_${sid}_${Date.now()}`;
  queueAdd({ _qid: qid, type: 'delete', id: sid, ts: new Date().toISOString() });
  if (!_initOk) return;
  await withRetry(() => deleteDoc(doc(cirugiasRef, sid)));
  queueSave(queueLoad().filter(x => x._qid !== qid));
}

async function replaceAllRows(rows = []) {
  const CHUNK = 20;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(rows.slice(i, i + CHUNK).map(r => upsertRow(r)));
  }
}

function listenRows(onRows, onErr) {
  if (!_initOk) return () => {};
  return onSnapshot(
    cirugiasRef,
    { includeMetadataChanges: false },
    snap => onRows(snap.docs.map(d => normRow(d.data(), d.id))),
    onErr || (e => console.error('[Firestore] listener:', e))
  );
}

async function exportAllRows() {
  if (!_initOk) throw new Error('Firestore no inicializado');
  const snap = await getDocs(cirugiasRef);
  return snap.docs.map(d => normRow(d.data(), d.id));
}

function pendingCount() { return queueLoad().length; }
async function forcSync() { await flushQueue(); }

window.firestoreConnector = {
  ready: readyPromise,
  upsertRow, replaceAllRows, deleteRow, listenRows, exportAllRows,
  pendingCount, forcSync, flushQueue,
  getAuth: () => auth,
  getDb: () => db
};

readyPromise.then(ok => {
  window.dispatchEvent(new CustomEvent('firestoreReady', { detail: { ok } }));
  if (ok) setTimeout(flushQueue, 2000);
});
