// Control de Cremas - Apps Script
// Modelo: una página por médica. Cada implementación apunta a UNA planilla.

const SPREADSHEET_ID = '18K0DbRbM9ztIzfTmUIAzAUltrsff96dfjaCcNiLCnVE';

const SHEETS = {
  CONFIG: 'Configuracion',
  PRODUCTOS: 'Productos',
  PACIENTES: 'Pacientes',
  VENTAS: 'Ventas',
  DETALLE_VENTAS: 'DetalleVentas',
  PAGOS: 'Pagos',
  COMPRAS: 'Compras',
  DETALLE_COMPRAS: 'DetalleCompras',
  MOV_STOCK: 'MovimientosStock',
  LISTAS: 'Listas'
};

const HEADERS = {
  Configuracion: ['Campo','Valor'],
  Productos: ['ID_PRODUCTO','CODIGO','PRODUCTO','DESCRIPCION','CATEGORIA','PRECIO_COMPRA_REVENTA','PRECIO_VENTA_SUGERIDO','PRECIO_VENTA_PROPIO','STOCK_ACTUAL','ACTIVO','CANT_DESC_1','DESC_1','CANT_DESC_2','DESC_2','FECHA_ACTUALIZACION'],
  Pacientes: ['ID_PACIENTE','FECHA_ALTA','APELLIDO','NOMBRE','DNI','TELEFONO','OBSERVACIONES','ACTIVO'],
  Ventas: ['ID_VENTA','FECHA','ID_PACIENTE','PACIENTE','FORMA_PAGO_PRINCIPAL','TOTAL_BRUTO','DESCUENTO_TOTAL','TOTAL_FINAL','TOTAL_PAGADO','SALDO','ESTADO','OBSERVACIONES'],
  DetalleVentas: ['ID_VENTA','ID_PRODUCTO','PRODUCTO','CANTIDAD','PRECIO_VENTA_UNIT','DESCUENTO_PRODUCTO','DESCUENTO_GENERAL','DESC_APLICADO','TOTAL_LINEA','COSTO_UNITARIO','COSTO_TOTAL','GANANCIA_LINEA'],
  Pagos: ['ID_PAGO','ID_VENTA','FECHA','PACIENTE','FORMA_PAGO','IMPORTE','OBSERVACIONES'],
  Compras: ['ID_COMPRA','FECHA','TOTAL_COMPRA','OBSERVACIONES'],
  DetalleCompras: ['ID_COMPRA','ID_PRODUCTO','PRODUCTO','CANTIDAD','PRECIO_COMPRA_UNIT','DESC_APLICADO','TOTAL_LINEA'],
  MovimientosStock: ['ID_MOVIMIENTO','FECHA','TIPO','ID_REFERENCIA','ID_PRODUCTO','PRODUCTO','CANTIDAD','STOCK_RESULTANTE','OBSERVACIONES'],
  Listas: ['FormasPago','EstadosVenta','Activo']
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Control de Cremas')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSS_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'PEGAR_ID_DE_LA_PLANILLA') {
    throw new Error('Falta configurar SPREADSHEET_ID con el ID de la planilla de la médica.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function testConexionPlanilla() {
  return 'Conexión correcta con: ' + getSS_().getName();
}

function inicializarSistema() {
  const ss = getSS_();
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0 || sh.getRange(1,1).getValue() === '') {
      sh.getRange(1,1,1,HEADERS[name].length).setValues([HEADERS[name]]);
    }
    if (name !== SHEETS.CONFIG) {
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,HEADERS[name].length).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
    }
  });

  const config = getSheet_(SHEETS.CONFIG);
  if (config.getLastRow() < 2) {
    config.getRange(1,1,8,2).setValues([
      ['Campo','Valor'],
      ['NombreSistema','Control de Cremas'],
      ['TextoPersona','Paciente'],
      ['PermitirStockNegativo','NO'],
      ['Proveedor','Mayorista'],
      ['ReglaPedidoBase','15 unidades del mismo producto = 20%'],
      ['Modo','Una página por médica'],
      ['FechaInstalacion', new Date()]
    ]);
  }

  const listas = getSheet_(SHEETS.LISTAS);
  if (listas.getLastRow() <= 1) {
    listas.getRange(1,1,5,3).setValues([
      ['FormasPago','EstadosVenta','Activo'],
      ['Efectivo','Pagada','SI'],
      ['Transferencia','Parcial','NO'],
      ['Crédito','Pendiente',''],
      ['Débito','Anulada','']
    ]);
  }
  return 'Sistema inicializado correctamente.';
}

function getAppData() {
  inicializarSistema();
  return {
    productos: getObjects_(SHEETS.PRODUCTOS).filter(p => String(p.ACTIVO || 'SI').toUpperCase() !== 'NO').map(normalizeProducto_),
    pacientes: getObjects_(SHEETS.PACIENTES).filter(p => String(p.ACTIVO || 'SI').toUpperCase() !== 'NO').map(normalizePaciente_),
    formasPago: ['Efectivo','Transferencia','Crédito','Débito'],
    dashboard: getDashboard_(),
    deudores: getDeudores_(),
    ventas: getVentasResumen_()
  };
}

function crearPaciente(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const apellido = clean_(data.apellido);
    const nombre = clean_(data.nombre);
    if (!apellido && !nombre) throw new Error('Cargá apellido o nombre.');
    const obj = {
      ID_PACIENTE: makeId_('PAC'),
      FECHA_ALTA: new Date(),
      APELLIDO: apellido,
      NOMBRE: nombre,
      DNI: clean_(data.dni),
      TELEFONO: clean_(data.telefono),
      OBSERVACIONES: clean_(data.observaciones),
      ACTIVO: 'SI'
    };
    appendObject_(SHEETS.PACIENTES, obj);
    return {ok:true, paciente: normalizePaciente_(obj)};
  } finally {
    lock.releaseLock();
  }
}

function actualizarProducto(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const id = clean_(data.idProducto);
    if (!id) throw new Error('Producto inválido.');
    const sh = getSheet_(SHEETS.PRODUCTOS);
    const values = getValues_(SHEETS.PRODUCTOS);
    const idx = headerIndex_(values[0]);
    const row = findRowIndex_(values, idx.ID_PRODUCTO, id);
    if (row < 0) throw new Error('No encontré el producto.');

    const updates = {
      PRECIO_COMPRA_REVENTA: toNumber_(data.precioCompra),
      PRECIO_VENTA_SUGERIDO: toNumber_(data.precioSugerido),
      PRECIO_VENTA_PROPIO: toNumber_(data.precioPropio),
      CANT_DESC_1: toNumber_(data.cantDesc1),
      DESC_1: toPercent_(data.desc1),
      CANT_DESC_2: toNumber_(data.cantDesc2),
      DESC_2: toPercent_(data.desc2),
      FECHA_ACTUALIZACION: new Date()
    };
    Object.keys(updates).forEach(k => {
      if (idx[k] !== undefined) sh.getRange(row + 1, idx[k] + 1).setValue(updates[k]);
    });
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

function guardarVenta(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const pacienteId = clean_(payload.pacienteId);
    const items = payload.items || [];
    if (!pacienteId) throw new Error('Seleccioná un paciente.');
    if (!items.length) throw new Error('Agregá al menos un producto.');

    const productoMap = {};
    getObjects_(SHEETS.PRODUCTOS).map(normalizeProducto_).forEach(p => productoMap[p.ID_PRODUCTO] = p);
    const paciente = getObjects_(SHEETS.PACIENTES).map(normalizePaciente_).find(p => p.ID_PACIENTE === pacienteId);
    if (!paciente) throw new Error('No encontré el paciente.');
    const pacienteNombre = `${paciente.APELLIDO || ''} ${paciente.NOMBRE || ''}`.trim();

    const generalDisc = toPercent_(payload.descuentoGeneral);
    let totalBruto = 0, descuentoTotal = 0, totalFinal = 0;
    const detalles = [];

    items.forEach(raw => {
      const prod = productoMap[clean_(raw.idProducto)];
      if (!prod) throw new Error('Producto inválido.');
      const cantidad = toNumber_(raw.cantidad);
      if (cantidad <= 0) throw new Error('Cantidad inválida en ' + prod.PRODUCTO);
      if (prod.STOCK_ACTUAL < cantidad) throw new Error(`No hay stock suficiente de ${prod.PRODUCTO}. Stock actual: ${prod.STOCK_ACTUAL}.`);
      const precioVenta = toNumber_(raw.precioVenta) || prod.PRECIO_VENTA_PROPIO || prod.PRECIO_VENTA_SUGERIDO;
      const descProducto = toPercent_(raw.descuentoProducto);
      const descAplicado = descProducto > 0 ? descProducto : generalDisc;
      const brutoLinea = cantidad * precioVenta;
      const totalLinea = round2_(brutoLinea * (1 - descAplicado));
      const costoUnit = prod.PRECIO_COMPRA_REVENTA || 0;
      const costoTotal = round2_(cantidad * costoUnit);
      const ganancia = round2_(totalLinea - costoTotal);
      totalBruto += brutoLinea;
      descuentoTotal += brutoLinea - totalLinea;
      totalFinal += totalLinea;
      detalles.push({ID_PRODUCTO:prod.ID_PRODUCTO, PRODUCTO:prod.PRODUCTO, CANTIDAD:cantidad, PRECIO_VENTA_UNIT:precioVenta, DESCUENTO_PRODUCTO:descProducto, DESCUENTO_GENERAL:generalDisc, DESC_APLICADO:descAplicado, TOTAL_LINEA:totalLinea, COSTO_UNITARIO:costoUnit, COSTO_TOTAL:costoTotal, GANANCIA_LINEA:ganancia});
    });

    const pagado = Math.min(toNumber_(payload.pagado), totalFinal);
    const saldo = round2_(totalFinal - pagado);
    const estado = saldo <= 0 ? 'Pagada' : (pagado > 0 ? 'Parcial' : 'Pendiente');
    const idVenta = makeId_('VTA');

    appendObject_(SHEETS.VENTAS, {
      ID_VENTA:idVenta, FECHA: payload.fecha ? new Date(payload.fecha) : new Date(), ID_PACIENTE:pacienteId, PACIENTE:pacienteNombre,
      FORMA_PAGO_PRINCIPAL: clean_(payload.formaPago) || 'Efectivo', TOTAL_BRUTO:round2_(totalBruto), DESCUENTO_TOTAL:round2_(descuentoTotal),
      TOTAL_FINAL:round2_(totalFinal), TOTAL_PAGADO:round2_(pagado), SALDO:saldo, ESTADO:estado, OBSERVACIONES:clean_(payload.observaciones)
    });

    detalles.forEach(d => {
      appendObject_(SHEETS.DETALLE_VENTAS, Object.assign({ID_VENTA:idVenta}, d));
      const stock = updateStock_(d.ID_PRODUCTO, -d.CANTIDAD);
      appendObject_(SHEETS.MOV_STOCK, {ID_MOVIMIENTO:makeId_('MOV'), FECHA:new Date(), TIPO:'VENTA', ID_REFERENCIA:idVenta, ID_PRODUCTO:d.ID_PRODUCTO, PRODUCTO:d.PRODUCTO, CANTIDAD:-d.CANTIDAD, STOCK_RESULTANTE:stock, OBSERVACIONES:'Venta/entrega a ' + pacienteNombre});
    });

    if (pagado > 0) {
      appendObject_(SHEETS.PAGOS, {ID_PAGO:makeId_('PAG'), ID_VENTA:idVenta, FECHA:new Date(), PACIENTE:pacienteNombre, FORMA_PAGO:clean_(payload.formaPago) || 'Efectivo', IMPORTE:round2_(pagado), OBSERVACIONES:'Pago al crear venta'});
    }
    return {ok:true, idVenta, totalFinal:round2_(totalFinal), saldo, estado};
  } finally {
    lock.releaseLock();
  }
}

function registrarPago(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const idVenta = clean_(payload.idVenta);
    const importe = toNumber_(payload.importe);
    if (!idVenta || importe <= 0) throw new Error('Venta o importe inválido.');
    const sh = getSheet_(SHEETS.VENTAS);
    const values = getValues_(SHEETS.VENTAS);
    const idx = headerIndex_(values[0]);
    const row = findRowIndex_(values, idx.ID_VENTA, idVenta);
    if (row < 0) throw new Error('No encontré la venta.');
    if (String(values[row][idx.ESTADO]) === 'Anulada') throw new Error('La venta está anulada.');
    const total = toNumber_(values[row][idx.TOTAL_FINAL]);
    const actual = toNumber_(values[row][idx.TOTAL_PAGADO]);
    const nuevo = Math.min(total, actual + importe);
    const saldo = round2_(total - nuevo);
    const estado = saldo <= 0 ? 'Pagada' : 'Parcial';
    sh.getRange(row+1, idx.TOTAL_PAGADO+1).setValue(round2_(nuevo));
    sh.getRange(row+1, idx.SALDO+1).setValue(saldo);
    sh.getRange(row+1, idx.ESTADO+1).setValue(estado);
    appendObject_(SHEETS.PAGOS, {ID_PAGO:makeId_('PAG'), ID_VENTA:idVenta, FECHA:new Date(), PACIENTE:values[row][idx.PACIENTE], FORMA_PAGO:clean_(payload.formaPago) || 'Efectivo', IMPORTE:round2_(importe), OBSERVACIONES:clean_(payload.observaciones)});
    return {ok:true, saldo, estado};
  } finally {
    lock.releaseLock();
  }
}

function anularVenta(idVenta) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    idVenta = clean_(idVenta);
    const sh = getSheet_(SHEETS.VENTAS);
    const values = getValues_(SHEETS.VENTAS);
    const idx = headerIndex_(values[0]);
    const row = findRowIndex_(values, idx.ID_VENTA, idVenta);
    if (row < 0) throw new Error('No encontré la venta.');
    if (String(values[row][idx.ESTADO]) === 'Anulada') throw new Error('La venta ya estaba anulada.');
    getObjects_(SHEETS.DETALLE_VENTAS).filter(d => d.ID_VENTA === idVenta).forEach(d => {
      const cant = toNumber_(d.CANTIDAD);
      const stock = updateStock_(d.ID_PRODUCTO, cant);
      appendObject_(SHEETS.MOV_STOCK, {ID_MOVIMIENTO:makeId_('MOV'), FECHA:new Date(), TIPO:'ANULA_VENTA', ID_REFERENCIA:idVenta, ID_PRODUCTO:d.ID_PRODUCTO, PRODUCTO:d.PRODUCTO, CANTIDAD:cant, STOCK_RESULTANTE:stock, OBSERVACIONES:'Anulación: vuelve stock'});
    });
    sh.getRange(row+1, idx.ESTADO+1).setValue('Anulada');
    sh.getRange(row+1, idx.SALDO+1).setValue(0);
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

function confirmarCompra(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const items = payload.items || [];
    if (!items.length) throw new Error('Agregá productos a la compra.');
    const productoMap = {};
    getObjects_(SHEETS.PRODUCTOS).map(normalizeProducto_).forEach(p => productoMap[p.ID_PRODUCTO] = p);
    const idCompra = makeId_('COM');
    let total = 0;
    const detalles = [];
    items.forEach(raw => {
      const prod = productoMap[clean_(raw.idProducto)];
      if (!prod) throw new Error('Producto inválido.');
      const cantidad = toNumber_(raw.cantidad);
      if (cantidad <= 0) throw new Error('Cantidad inválida en ' + prod.PRODUCTO);
      const precio = prod.PRECIO_COMPRA_REVENTA || 0;
      const desc = descuentoCompra_(prod, cantidad);
      const linea = round2_(cantidad * precio * (1 - desc));
      total += linea;
      detalles.push({ID_COMPRA:idCompra, ID_PRODUCTO:prod.ID_PRODUCTO, PRODUCTO:prod.PRODUCTO, CANTIDAD:cantidad, PRECIO_COMPRA_UNIT:precio, DESC_APLICADO:desc, TOTAL_LINEA:linea});
    });
    appendObject_(SHEETS.COMPRAS, {ID_COMPRA:idCompra, FECHA:payload.fecha ? new Date(payload.fecha) : new Date(), TOTAL_COMPRA:round2_(total), OBSERVACIONES:clean_(payload.observaciones)});
    detalles.forEach(d => {
      appendObject_(SHEETS.DETALLE_COMPRAS, d);
      const stock = updateStock_(d.ID_PRODUCTO, d.CANTIDAD);
      appendObject_(SHEETS.MOV_STOCK, {ID_MOVIMIENTO:makeId_('MOV'), FECHA:new Date(), TIPO:'COMPRA', ID_REFERENCIA:idCompra, ID_PRODUCTO:d.ID_PRODUCTO, PRODUCTO:d.PRODUCTO, CANTIDAD:d.CANTIDAD, STOCK_RESULTANTE:stock, OBSERVACIONES:'Compra confirmada'});
    });
    return {ok:true, idCompra, totalCompra:round2_(total)};
  } finally {
    lock.releaseLock();
  }
}

function getReportes(fechaDesde, fechaHasta) {
  const desde = fechaDesde ? new Date(fechaDesde) : new Date('2000-01-01');
  const hasta = fechaHasta ? new Date(fechaHasta) : new Date('2999-12-31');
  hasta.setHours(23,59,59,999);
  const ventas = getObjects_(SHEETS.VENTAS).filter(v => {
    const f = parseDate_(v.FECHA);
    return f >= desde && f <= hasta && String(v.ESTADO) !== 'Anulada';
  });
  const ids = {};
  ventas.forEach(v => ids[v.ID_VENTA] = true);
  const detalles = getObjects_(SHEETS.DETALLE_VENTAS).filter(d => ids[d.ID_VENTA]);
  const pagos = getObjects_(SHEETS.PAGOS).filter(p => {
    const f = parseDate_(p.FECHA);
    return f >= desde && f <= hasta;
  });
  const compras = getObjects_(SHEETS.COMPRAS).filter(c => {
    const f = parseDate_(c.FECHA);
    return f >= desde && f <= hasta;
  });
  const productos = {};
  detalles.forEach(d => {
    if (!productos[d.ID_PRODUCTO]) productos[d.ID_PRODUCTO] = {producto:d.PRODUCTO, cantidad:0, total:0, ganancia:0};
    productos[d.ID_PRODUCTO].cantidad += toNumber_(d.CANTIDAD);
    productos[d.ID_PRODUCTO].total += toNumber_(d.TOTAL_LINEA);
    productos[d.ID_PRODUCTO].ganancia += toNumber_(d.GANANCIA_LINEA);
  });
  return {totalVentas:sum_(ventas,'TOTAL_FINAL'), totalPagado:sum_(pagos,'IMPORTE'), totalSaldo:sum_(ventas,'SALDO'), totalGanancia:sum_(detalles,'GANANCIA_LINEA'), totalCompras:sum_(compras,'TOTAL_COMPRA'), cantidadVentas:ventas.length, productos:Object.values(productos).sort((a,b)=>b.cantidad-a.cantidad).slice(0,15), ventas:ventas.slice(-50).reverse()};
}

function getDashboard_() {
  const n = new Date();
  return getReportes(formatDate_(new Date(n.getFullYear(), n.getMonth(), 1)), formatDate_(new Date(n.getFullYear(), n.getMonth()+1, 0)));
}

function getDeudores_() {
  return getObjects_(SHEETS.VENTAS).filter(v => String(v.ESTADO) !== 'Anulada' && toNumber_(v.SALDO) > 0).map(v => ({ID_VENTA:v.ID_VENTA, FECHA:v.FECHA, PACIENTE:v.PACIENTE, TOTAL_FINAL:toNumber_(v.TOTAL_FINAL), TOTAL_PAGADO:toNumber_(v.TOTAL_PAGADO), SALDO:toNumber_(v.SALDO), ESTADO:v.ESTADO})).sort((a,b)=>b.SALDO-a.SALDO);
}

function getVentasResumen_() {
  return getObjects_(SHEETS.VENTAS).map(v => ({ID_VENTA:v.ID_VENTA, FECHA:v.FECHA, PACIENTE:v.PACIENTE, TOTAL_FINAL:toNumber_(v.TOTAL_FINAL), TOTAL_PAGADO:toNumber_(v.TOTAL_PAGADO), SALDO:toNumber_(v.SALDO), ESTADO:v.ESTADO})).slice(-50).reverse();
}

function descuentoCompra_(prod, cantidad) {
  const c2 = toNumber_(prod.CANT_DESC_2), d2 = toPercent_(prod.DESC_2);
  const c1 = toNumber_(prod.CANT_DESC_1), d1 = toPercent_(prod.DESC_1);
  if (c2 > 0 && cantidad >= c2) return d2;
  if (c1 > 0 && cantidad >= c1) return d1;
  return 0;
}

function updateStock_(idProducto, delta) {
  const sh = getSheet_(SHEETS.PRODUCTOS);
  const values = getValues_(SHEETS.PRODUCTOS);
  const idx = headerIndex_(values[0]);
  const row = findRowIndex_(values, idx.ID_PRODUCTO, idProducto);
  if (row < 0) throw new Error('No encontré el producto para actualizar stock.');
  const nuevo = toNumber_(values[row][idx.STOCK_ACTUAL]) + delta;
  if (nuevo < 0) throw new Error('La operación dejaría stock negativo.');
  sh.getRange(row+1, idx.STOCK_ACTUAL+1).setValue(nuevo);
  return nuevo;
}

function getSheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('Falta la hoja: ' + name);
  return sh;
}

function getValues_(sheetName) {
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  return values.length ? values : [HEADERS[sheetName] || []];
}

function getObjects_(sheetName) {
  const values = getValues_(sheetName);
  const headers = (values[0] || []).map(h => String(h).trim());
  return values.slice(1).filter(row => row.some(v => v !== '' && v !== null)).map(row => {
    const obj = {};
    headers.forEach((h,i) => obj[h] = serialize_(row[i]));
    return obj;
  });
}

function appendObject_(sheetName, obj) {
  const sh = getSheet_(sheetName);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
}

function headerIndex_(headers) { const o = {}; headers.forEach((h,i)=>o[String(h).trim()] = i); return o; }
function findRowIndex_(values, colIndex, value) { for (let i=1;i<values.length;i++) if (String(values[i][colIndex]) === String(value)) return i; return -1; }
function normalizeProducto_(p) { return {ID_PRODUCTO:String(p.ID_PRODUCTO||''), CODIGO:p.CODIGO||'', PRODUCTO:p.PRODUCTO||'', DESCRIPCION:p.DESCRIPCION||'', CATEGORIA:p.CATEGORIA||'', PRECIO_COMPRA_REVENTA:toNumber_(p.PRECIO_COMPRA_REVENTA), PRECIO_VENTA_SUGERIDO:toNumber_(p.PRECIO_VENTA_SUGERIDO), PRECIO_VENTA_PROPIO:toNumber_(p.PRECIO_VENTA_PROPIO), STOCK_ACTUAL:toNumber_(p.STOCK_ACTUAL), ACTIVO:p.ACTIVO||'SI', CANT_DESC_1:toNumber_(p.CANT_DESC_1), DESC_1:toPercent_(p.DESC_1), CANT_DESC_2:toNumber_(p.CANT_DESC_2), DESC_2:toPercent_(p.DESC_2)}; }
function normalizePaciente_(p) { return {ID_PACIENTE:String(p.ID_PACIENTE||''), FECHA_ALTA:p.FECHA_ALTA||'', APELLIDO:p.APELLIDO||'', NOMBRE:p.NOMBRE||'', DNI:p.DNI||'', TELEFONO:p.TELEFONO||'', OBSERVACIONES:p.OBSERVACIONES||'', ACTIVO:p.ACTIVO||'SI'}; }
function serialize_(v) { if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); if (v === null || v === undefined) return ''; return v; }
function parseDate_(v) { if (v instanceof Date) return v; if (!v) return new Date('1900-01-01'); return new Date(v); }
function toNumber_(v) { if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/\$/g,'').replace(/\./g,'').replace(',', '.').trim()); return isNaN(n) ? 0 : n; }
function toPercent_(v) { const n = toNumber_(v); if (n <= 0) return 0; return n > 1 ? n/100 : n; }
function clean_(v) { return String(v || '').trim(); }
function round2_(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function sum_(arr, field) { return round2_(arr.reduce((acc,x)=>acc + toNumber_(x[field]), 0)); }
function makeId_(prefix) { return prefix + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random()*10000); }
function formatDate_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
