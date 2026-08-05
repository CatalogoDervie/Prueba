import './preq-core.js';

const P = window.PREQ;

P.showLogin = (message = '') => {
  P.$('loginScreen').hidden = false;
  P.$('app').hidden = true;
  P.$('loginError').hidden = !message;
  P.$('loginError').textContent = message;
};
P.showApp = () => {
  P.$('loginScreen').hidden = true;
  P.$('app').hidden = false;
  P.$('userBadge').textContent = P.state.currentUser?.email || '';
  P.$('vigenciaText').textContent =
    ` Vigencia prevista: ${P.formatDate(P.state.config.fechaVigencia)}.`;
};
P.renderKpis = () => {
  const rows = P.queueRows();
  const assigned = P.quotaAssigned(rows);
  const available = P.quotaAvailable(rows);
  const pending = rows.filter(
    row => P.patientSim(row)?.estado === P.STATUS.PREQ
  ).length;
  const ready = rows.filter(
    row => P.patientSim(row)?.estado === P.STATUS.READY
  ).length;
  const cards = [
    ['En cola', rows.length, 'Ambas clínicas'],
    ['Cupo del mes', P.quotaTotal(), P.quotaMonth()],
    ['Cupo usado', assigned, '1 por ojo/cirugía'],
    ['Cupo disponible', available, available === 0 ? 'Sin disponibilidad' : 'Disponible'],
    ['Habilitados', ready, 'Para programar']
  ];
  P.$('kpis').innerHTML = cards.map(([label, value, sub]) => `
    <article class="kpi">
      <div class="label">${P.escapeHtml(label)}</div>
      <div class="value">${P.escapeHtml(value)}</div>
      <div class="sub">${P.escapeHtml(sub)}</div>
    </article>`).join('');
  P.$('quotaInput').value = String(P.quotaTotal());
  P.$('selectedText').textContent =
    `${P.state.selectedIds.size} seleccionados`;
  P.$('assignQuotaBtn').disabled =
    P.state.selectedIds.size === 0 || available === 0;
  document.title = `PREQUIRÚRGICOS OK · ${pending} pendientes`;
};
P.nextActionHtml = row => {
  const sim = P.patientSim(row);
  const id = P.escapeHtml(row.id);
  if (sim.estado === P.STATUS.PREQ) {
    return `<button class="btn danger" data-archive-id="${id}" type="button">Anular</button>`;
  }
  if (sim.estado === P.STATUS.TO_ORDER) {
    return `<button class="btn primary" data-next-id="${id}" type="button">Marcar pedida</button>`;
  }
  if (sim.estado === P.STATUS.ORDERED) {
    return `<button class="btn primary" data-next-id="${id}" type="button">Marcar recibida</button>`;
  }
  if (sim.estado === P.STATUS.RECEIVED) {
    return `<button class="btn success" data-next-id="${id}" type="button">Habilitar</button>`;
  }
  return '<span class="sub">Sin acciones pendientes</span>';
};
P.renderQueue = () => {
  const allQueue = P.queueRows();
  const visible = P.filteredQueue();
  const positions = new Map(
    allQueue.map((row, index) => [P.norm(row.id), index + 1])
  );
  P.$('queueBody').innerHTML = visible.map(row => {
    const sim = P.patientSim(row);
    const id = P.norm(row.id);
    const canSelect = sim.estado === P.STATUS.PREQ && !sim.mesCupo;
    return `<tr>
      <td class="check-col">
        <input type="checkbox" data-select-id="${P.escapeHtml(id)}"
          ${P.state.selectedIds.has(id) ? 'checked' : ''}
          ${canSelect ? '' : 'disabled'}>
      </td>
      <td><strong>${positions.get(id)}</strong></td>
      <td>${P.escapeHtml(P.formatDateTime(sim.fechaHoraIngreso))}</td>
      <td>
        <div class="name">${P.escapeHtml(row.nombre || 'Sin nombre')}</div>
        <div class="sub">DNI ${P.escapeHtml(row.dni || '—')} · Af. ${P.escapeHtml(row.afiliado || '—')}</div>
      </td>
      <td>${P.escapeHtml(row.clinica || '—')}</td>
      <td>${P.escapeHtml(row.ojo || '—')}</td>
      <td>${P.escapeHtml(P.realState(row))}</td>
      <td>${P.escapeHtml(P.formatDate(row.fechaCir))}</td>
      <td><span class="badge ${P.escapeHtml(sim.estado)}">${P.escapeHtml(P.STATUS_LABEL[sim.estado] || sim.estado)}</span></td>
      <td>${P.escapeHtml(sim.mesCupo || '—')}</td>
      <td>${P.escapeHtml(P.formatDate(sim.fechaEstimadaLlegada))}</td>
      <td><div class="row-actions">${P.nextActionHtml(row)}</div></td>
    </tr>`;
  }).join('');
  P.$('emptyState').hidden = visible.length > 0;

  document.querySelectorAll('[data-select-id]').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.selectId;
      if (input.checked) P.state.selectedIds.add(id);
      else P.state.selectedIds.delete(id);
      P.renderKpis();
    });
  });
  document.querySelectorAll('[data-next-id]').forEach(button => {
    button.addEventListener(
      'click',
      () => P.advanceState(button.dataset.nextId)
    );
  });
  document.querySelectorAll('[data-archive-id]').forEach(button => {
    button.addEventListener(
      'click',
      () => P.archiveEntry(button.dataset.archiveId)
    );
  });
  P.renderKpis();
};
P.renderCandidates = () => {
  const q = P.upper(P.$('candidateSearch').value);
  const candidates = P.state.allRows
    .filter(P.isPami)
    .filter(row => {
      if (!q) return true;
      return P.upper([row.nombre, row.dni, row.afiliado].join(' '))
        .includes(q);
    })
    .sort((a, b) => P.norm(a.nombre).localeCompare(P.norm(b.nombre), 'es'))
    .slice(0, 80);
  P.$('candidateList').innerHTML = candidates.map(row => {
    const already = P.activeSimulation(row);
    return `<article class="candidate ${already ? 'disabled' : ''}">
      <div>
        <div class="name">${P.escapeHtml(row.nombre || 'Sin nombre')}</div>
        <div class="sub">${P.escapeHtml(row.clinica || '—')} · ${P.escapeHtml(row.ojo || '—')} · DNI ${P.escapeHtml(row.dni || '—')} · Cirugía ${P.escapeHtml(P.formatDate(row.fechaCir))}</div>
      </div>
      <button class="btn ${already ? '' : 'success'}"
        data-add-id="${P.escapeHtml(row.id)}" type="button"
        ${already ? 'disabled' : ''}>
        ${already ? 'Ya está en cola' : 'Registrar ahora'}
      </button>
    </article>`;
  }).join('') || '<div class="empty">No se encontraron pacientes PAMI.</div>';
  document.querySelectorAll('[data-add-id]').forEach(button => {
    button.addEventListener('click', () => P.addToQueue(button.dataset.addId));
  });
};
