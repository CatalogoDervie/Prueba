const P = window.PREQ = window.PREQ || {};

P.SIM_FIELD = 'simulacionPrequirurgicos';
P.CONFIG_DOC = 'prequirurgicos_simulacion';
P.STATUS = Object.freeze({
  PREQ: 'PREQUIRURGICOS_OK',
  TO_ORDER: 'A_PEDIR_LENTE',
  ORDERED: 'LENTE_PEDIDA',
  RECEIVED: 'LENTE_RECIBIDA',
  READY: 'HABILITADO_PROGRAMAR'
});
P.STATUS_LABEL = Object.freeze({
  [P.STATUS.PREQ]: 'PREQUIRÚRGICOS OK',
  [P.STATUS.TO_ORDER]: 'A PEDIR LENTE',
  [P.STATUS.ORDERED]: 'LENTE PEDIDA',
  [P.STATUS.RECEIVED]: 'LENTE RECIBIDA',
  [P.STATUS.READY]: 'HABILITADO PARA PROGRAMAR'
});
P.state = {
  auth: null,
  db: null,
  currentUser: null,
  allRows: [],
  config: {
    cupoPorMes: {},
    fechaVigencia: '2026-09-01',
    modo: 'simulacion'
  },
  unsubRows: null,
  unsubConfig: null,
  selectedIds: new Set()
};

P.$ = id => document.getElementById(id);
P.norm = value => String(value ?? '').trim();
P.upper = value => P.norm(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase();
P.escapeHtml = value => P.norm(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
P.nowISO = () => new Date().toISOString();
P.monthKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};
P.formatDate = value => {
  if (!value) return '—';
  let raw;
  if (typeof value?.toDate === 'function') {
    raw = value.toDate();
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(P.norm(value))) {
    const [y, m, d] = P.norm(value).split('-').map(Number);
    raw = new Date(y, m - 1, d, 12, 0, 0);
  } else {
    raw = new Date(value);
  }
  if (Number.isNaN(raw.getTime())) return P.norm(value) || '—';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(raw);
};
P.formatDateTime = value => {
  if (!value) return '—';
  const raw = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(raw.getTime())) return P.norm(value) || '—';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(raw);
};
P.addDaysISO = (value, days) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString();
};
P.toast = message => {
  const el = P.$('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(P.toast._t);
  P.toast._t = setTimeout(() => { el.hidden = true; }, 3200);
};
P.friendlyError = error => {
  const code = P.norm(error?.code);
  if (code.includes('invalid-credential')) return 'Correo o contraseña incorrectos.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Probá nuevamente más tarde.';
  if (code.includes('permission-denied')) {
    return 'Firestore rechazó la operación. Hay que habilitar este campo en las reglas.';
  }
  return error?.message || 'Ocurrió un error inesperado.';
};
P.waitConnector = async () => {
  if (window.firestoreConnector) return window.firestoreConnector;
  return new Promise(resolve => {
    const handler = () => {
      if (!window.firestoreConnector) return;
      window.removeEventListener('firestoreReady', handler);
      resolve(window.firestoreConnector);
    };
    window.addEventListener('firestoreReady', handler);
  });
};
P.patientSim = row => {
  const raw = row?.[P.SIM_FIELD];
  return raw && typeof raw === 'object' ? raw : null;
};
P.activeSimulation = row => {
  const sim = P.patientSim(row);
  return !!sim && sim.activo !== false && !!sim.fechaHoraIngreso;
};
P.isPami = row => P.upper(row.obraSocial) === 'PAMI';
P.realState = row => {
  const fac = P.upper(row.estadoFac);
  const cir = P.upper(row.estadoCir);
  if (fac === 'FACTURADA' || fac === 'FINALIZADA') return 'Facturada';
  if (cir === 'REALIZADA') return 'Cirugía realizada';
  if (row.fechaCir) return 'Cirugía programada';
  if (row.fechaLlegaLente || row.recepLente) return 'Lente recibida';
  if (row.fechaSolLente) return 'Lente pedida';
  return 'Sin pedido de lente';
};
P.queueRows = () => P.state.allRows
  .filter(P.activeSimulation)
  .sort((a, b) => {
    const aa = P.norm(P.patientSim(a)?.fechaHoraIngreso);
    const bb = P.norm(P.patientSim(b)?.fechaHoraIngreso);
    return aa.localeCompare(bb)
      || P.norm(a.id).localeCompare(P.norm(b.id), 'es', { numeric: true });
  });
P.quotaMonth = () => P.$('monthSelect').value || P.monthKey();
P.quotaTotal = () => Math.max(
  0,
  Number(P.state.config.cupoPorMes?.[P.quotaMonth()] || 0)
);
P.quotaAssigned = (rows = P.queueRows()) => rows.filter(
  row => P.norm(P.patientSim(row)?.mesCupo) === P.quotaMonth()
).length;
P.quotaAvailable = (rows = P.queueRows()) => Math.max(
  0,
  P.quotaTotal() - P.quotaAssigned(rows)
);
P.filteredQueue = () => {
  const q = P.upper(P.$('searchInput').value);
  const clinic = P.$('clinicFilter').value;
  const status = P.$('statusFilter').value;
  return P.queueRows().filter(row => {
    const sim = P.patientSim(row);
    const haystack = P.upper([row.nombre, row.dni, row.afiliado].join(' '));
    return (!q || haystack.includes(q))
      && (!clinic || row.clinica === clinic)
      && (!status || sim.estado === status);
  });
};
