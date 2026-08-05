import './preq-ui.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const P = window.PREQ;

P.login = async event => {
  event.preventDefault();
  const email = P.$('loginEmail').value.trim();
  const password = P.$('loginPass').value;
  if (!email || !password) {
    P.showLogin('Completá correo y contraseña.');
    return;
  }
  const button = P.$('loginBtn');
  button.disabled = true;
  button.textContent = 'Ingresando…';
  try {
    await signInWithEmailAndPassword(P.state.auth, email, password);
  } catch (error) {
    P.showLogin(P.friendlyError(error));
  } finally {
    button.disabled = false;
    button.textContent = 'Ingresar';
  }
};
P.writeSimulation = async (row, sim) => {
  const ref = doc(P.state.db, 'cirugias', P.norm(row.id));
  await setDoc(ref, { [P.SIM_FIELD]: sim }, { merge: true });
};
P.addToQueue = async id => {
  const row = P.state.allRows.find(
    item => P.norm(item.id) === P.norm(id)
  );
  if (!row || !P.isPami(row)) return;
  const existing = P.patientSim(row);
  if (existing?.activo !== false && existing?.fechaHoraIngreso) {
    P.toast('Ese ojo ya está en la cola.');
    return;
  }
  const enteredAt = existing?.fechaHoraIngreso || P.nowISO();
  const sim = {
    version: 1,
    activo: true,
    fechaHoraIngreso: enteredAt,
    estado: P.STATUS.PREQ,
    mesCupo: '',
    fechaAsignacionCupo: '',
    fechaPedidoSim: '',
    fechaEstimadaLlegada: '',
    fechaRecepcionSim: '',
    fechaHabilitadoSim: '',
    fechaBaja: '',
    motivoBaja: '',
    updatedAt: P.nowISO(),
    updatedBy: P.state.currentUser?.email || ''
  };
  try {
    await P.writeSimulation(row, sim);
    P.$('addDialog').close();
    P.toast('Paciente agregado a PREQUIRÚRGICOS OK.');
  } catch (error) {
    P.toast(P.friendlyError(error));
  }
};
P.validateFifoSelection = () => {
  const pending = P.queueRows().filter(row => {
    const sim = P.patientSim(row);
    return sim.estado === P.STATUS.PREQ && !sim.mesCupo;
  });
  const selectedPending = pending.filter(
    row => P.state.selectedIds.has(P.norm(row.id))
  );
  if (!selectedPending.length) {
    throw new Error('Seleccioná al menos un paciente pendiente.');
  }
  const expectedIds = pending.slice(0, selectedPending.length)
    .map(row => P.norm(row.id));
  const selectedOrderedIds = selectedPending.map(row => P.norm(row.id));
  if (expectedIds.join('|') !== selectedOrderedIds.join('|')) {
    throw new Error(
      'La selección debe comenzar por el primer paciente pendiente y respetar el orden de la cola.'
    );
  }
  if (selectedPending.length > P.quotaAvailable()) {
    throw new Error(`El cupo disponible es ${P.quotaAvailable()}.`);
  }
  return selectedPending;
};
P.assignQuota = async () => {
  let rows;
  try {
    rows = P.validateFifoSelection();
  } catch (error) {
    P.toast(error.message);
    return;
  }
  const month = P.quotaMonth();
  const when = P.nowISO();
  P.$('assignQuotaBtn').disabled = true;
  try {
    for (const row of rows) {
      const sim = { ...P.patientSim(row) };
      sim.estado = P.STATUS.TO_ORDER;
      sim.mesCupo = month;
      sim.fechaAsignacionCupo = when;
      sim.updatedAt = when;
      sim.updatedBy = P.state.currentUser?.email || '';
      await P.writeSimulation(row, sim);
    }
    P.state.selectedIds.clear();
    P.toast(`${rows.length} paciente(s) pasaron a pedir lente.`);
  } catch (error) {
    P.toast(P.friendlyError(error));
  } finally {
    P.renderKpis();
  }
};
P.advanceState = async id => {
  const row = P.state.allRows.find(
    item => P.norm(item.id) === P.norm(id)
  );
  if (!row) return;
  const sim = { ...P.patientSim(row) };
  const when = P.nowISO();
  if (sim.estado === P.STATUS.TO_ORDER) {
    sim.estado = P.STATUS.ORDERED;
    sim.fechaPedidoSim = when;
    sim.fechaEstimadaLlegada = P.addDaysISO(when, 13);
  } else if (sim.estado === P.STATUS.ORDERED) {
    sim.estado = P.STATUS.RECEIVED;
    sim.fechaRecepcionSim = when;
  } else if (sim.estado === P.STATUS.RECEIVED) {
    sim.estado = P.STATUS.READY;
    sim.fechaHabilitadoSim = when;
  } else {
    return;
  }
  sim.updatedAt = when;
  sim.updatedBy = P.state.currentUser?.email || '';
  try {
    await P.writeSimulation(row, sim);
    P.toast(`Estado actualizado: ${P.STATUS_LABEL[sim.estado]}.`);
  } catch (error) {
    P.toast(P.friendlyError(error));
  }
};
P.archiveEntry = async id => {
  const row = P.state.allRows.find(
    item => P.norm(item.id) === P.norm(id)
  );
  if (!row) return;
  const reason = prompt('Motivo de anulación de la simulación:');
  if (reason === null) return;
  if (!reason.trim()) {
    P.toast('Ingresá un motivo para anular.');
    return;
  }
  const sim = { ...P.patientSim(row) };
  sim.activo = false;
  sim.fechaBaja = P.nowISO();
  sim.motivoBaja = reason.trim();
  sim.updatedAt = P.nowISO();
  sim.updatedBy = P.state.currentUser?.email || '';
  try {
    await P.writeSimulation(row, sim);
    P.state.selectedIds.delete(P.norm(id));
    P.toast('Ingreso anulado. La fecha original queda conservada.');
  } catch (error) {
    P.toast(P.friendlyError(error));
  }
};
P.saveQuota = async () => {
  const month = P.quotaMonth();
  const value = Math.max(0, Number(P.$('quotaInput').value || 0));
  const next = {
    ...P.state.config,
    cupoPorMes: {
      ...(P.state.config.cupoPorMes || {}),
      [month]: value
    },
    fechaVigencia: P.state.config.fechaVigencia || '2026-09-01',
    modo: 'simulacion',
    updatedAt: P.nowISO(),
    updatedBy: P.state.currentUser?.email || ''
  };
  try {
    await setDoc(
      doc(P.state.db, 'configuracion', P.CONFIG_DOC),
      next,
      { merge: true }
    );
    P.toast(`Cupo ${month} guardado: ${value}.`);
  } catch (error) {
    P.toast(P.friendlyError(error));
  }
};
P.exportCsv = () => {
  const rows = P.filteredQueue();
  const headers = [
    'Posición', 'Ingreso', 'Paciente', 'DNI', 'Afiliado', 'Clínica',
    'Ojo', 'Estado real', 'Fecha cirugía real', 'Estado simulado',
    'Mes cupo', 'Fecha pedido simulada', 'Llegada estimada',
    'Fecha recepción simulada'
  ];
  const allQueue = P.queueRows();
  const positions = new Map(
    allQueue.map((row, index) => [P.norm(row.id), index + 1])
  );
  const lines = [headers, ...rows.map(row => {
    const sim = P.patientSim(row);
    return [
      positions.get(P.norm(row.id)),
      P.formatDateTime(sim.fechaHoraIngreso),
      row.nombre,
      row.dni,
      row.afiliado,
      row.clinica,
      row.ojo,
      P.realState(row),
      row.fechaCir || '',
      P.STATUS_LABEL[sim.estado] || sim.estado,
      sim.mesCupo || '',
      sim.fechaPedidoSim || '',
      sim.fechaEstimadaLlegada || '',
      sim.fechaRecepcionSim || ''
    ];
  })].map(cols => cols.map(
    value => `"${P.norm(value).replaceAll('"', '""')}"`
  ).join(';')).join('\n');

  const blob = new Blob(['\ufeff' + lines], {
    type: 'text/csv;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `prequirurgicos_ok_${P.quotaMonth()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};
P.installListeners = () => {
  P.$('loginForm').addEventListener('submit', P.login);
  P.$('logoutBtn').addEventListener(
    'click',
    () => signOut(P.state.auth)
  );
  P.$('monthSelect').addEventListener('change', () => {
    P.state.selectedIds.clear();
    P.renderQueue();
  });
  P.$('saveQuotaBtn').addEventListener('click', P.saveQuota);
  P.$('searchInput').addEventListener('input', P.renderQueue);
  P.$('clinicFilter').addEventListener('change', P.renderQueue);
  P.$('statusFilter').addEventListener('change', P.renderQueue);
  P.$('clearFiltersBtn').addEventListener('click', () => {
    P.$('searchInput').value = '';
    P.$('clinicFilter').value = '';
    P.$('statusFilter').value = '';
    P.renderQueue();
  });
  P.$('openAddBtn').addEventListener('click', () => {
    P.$('candidateSearch').value = '';
    P.renderCandidates();
    P.$('addDialog').showModal();
  });
  P.$('candidateSearch').addEventListener('input', P.renderCandidates);
  P.$('assignQuotaBtn').addEventListener('click', P.assignQuota);
  P.$('exportBtn').addEventListener('click', P.exportCsv);
};
P.startRealtime = () => {
  if (P.state.unsubRows) P.state.unsubRows();
  if (P.state.unsubConfig) P.state.unsubConfig();

  P.state.unsubRows = onSnapshot(
    collection(P.state.db, 'cirugias'),
    snapshot => {
      P.state.allRows = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
      for (const id of [...P.state.selectedIds]) {
        const row = P.state.allRows.find(
          item => P.norm(item.id) === id
        );
        const sim = P.patientSim(row);
        if (!row || sim?.estado !== P.STATUS.PREQ || sim?.mesCupo) {
          P.state.selectedIds.delete(id);
        }
      }
      P.renderQueue();
      if (P.$('addDialog').open) P.renderCandidates();
    },
    error => P.toast(P.friendlyError(error))
  );
  P.state.unsubConfig = onSnapshot(
    doc(P.state.db, 'configuracion', P.CONFIG_DOC),
    snapshot => {
      if (snapshot.exists()) {
        P.state.config = {
          ...P.state.config,
          ...snapshot.data()
        };
      }
      P.$('vigenciaText').textContent =
        ` Vigencia prevista: ${P.formatDate(P.state.config.fechaVigencia)}.`;
      P.renderQueue();
    },
    error => P.toast(P.friendlyError(error))
  );
};
P.init = async () => {
  const connector = await P.waitConnector();
  const ready = await connector.ready;
  if (!ready) {
    P.showLogin('No se pudo iniciar Firebase.');
    return;
  }
  P.state.auth = connector.getAuth();
  P.state.db = connector.getDb();
  P.installListeners();

  onAuthStateChanged(P.state.auth, async user => {
    if (!user) {
      P.state.currentUser = null;
      if (P.state.unsubRows) P.state.unsubRows();
      if (P.state.unsubConfig) P.state.unsubConfig();
      P.showLogin('');
      return;
    }
    try {
      const profileSnap = await getDoc(
        doc(P.state.db, 'usuarios', user.uid)
      );
      const profile = profileSnap.exists() ? profileSnap.data() : null;
      if (!profile || profile.active !== true) {
        await signOut(P.state.auth);
        P.showLogin('Tu cuenta no está habilitada.');
        return;
      }
      P.state.currentUser = {
        uid: user.uid,
        email: user.email,
        profile
      };
      P.showApp();
      P.startRealtime();
    } catch (error) {
      await signOut(P.state.auth);
      P.showLogin(P.friendlyError(error));
    }
  });
};
