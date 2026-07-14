(async function () {
const [firebaseApp, firebaseDatabase, firebaseAuth] = await window.INVENTARIO_BOOT.loadFirebase();
const { initializeApp } = firebaseApp;
const { getDatabase, ref, onValue } = firebaseDatabase;
const { getAuth, onAuthStateChanged } = firebaseAuth;
const { firebaseConfig, ADMIN_EMAILS } = window.INVENTARIO_CONFIG;

if (window.Chart) {
  Chart.defaults.color = '#aeb8c5';
  Chart.defaults.borderColor = '#2b3644';
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const productosRef = ref(db, "productos");
const logsRef = ref(db, "logs");

let productos = {};
let logs = {};
let filasFiltradas = [];
let totalVendidosGlobalRef = 0;
let ventasChart = null;
let ingresosChart = null;
let mesesChart = null;
let beneficioMesesChart = null;
let historialGlobal = null;
let rankingMostrarTodos = false;
let rankingPagina = 1;
const rankingPorPagina = 15;

function formatEuro(n){ return '€' + Number(n || 0).toFixed(2); }
function ymd(date){
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function esFechaDentro(fechaYmd, desde, hasta){
  if (desde && fechaYmd < desde) return false;
  if (hasta && fechaYmd > hasta) return false;
  return true;
}
function normalizarNombre(s){ return String(s || '').toLowerCase().trim(); }

function renderMiniFoto(url, small = false){
  if (!url) {
    return small
      ? '<span class="no-foto-sm">Sin foto</span>'
      : '<span class="no-foto">Sin foto</span>';
  }
  const cls = small ? 'prod-thumb-sm' : 'prod-thumb';
  return `<img src="${url}" alt="Foto producto" class="${cls}" loading="lazy" referrerpolicy="no-referrer">`;
}

function renderFotoGrande(url){
  if (!url) return '<div class="destacado-no-foto">Sin foto</div>';
  return `<img src="${url}" alt="Foto producto" class="destacado-foto" loading="lazy" referrerpolicy="no-referrer">`;
}

function irEditarProducto(id){
  window.location.href = `index.html?editId=${encodeURIComponent(id)}`;
}
window.irEditarProducto = irEditarProducto;

onAuthStateChanged(auth, (user) => {
  const status = document.getElementById('status');
  if (!user || !ADMIN_EMAILS.includes(user.email)) {
    status.className = 'error';
    status.textContent = '❌ Solo el ADMIN puede ver esta página';
    setTimeout(() => window.location.href = 'index.html', 2000);
    return;
  }
  status.className = 'admin';
  status.textContent = `👑 ADMIN: ${user.email} - Estadísticas completas cargadas ✅`;
  prepararFechas();
  cargarDatos();
});

function prepararFechas(){
  const hoy = new Date();
  const inicioAnio = new Date(hoy.getFullYear(), 0, 1);
  document.getElementById('logFechaDesde').value = ymd(inicioAnio);
  document.getElementById('logFechaHasta').value = ymd(hoy);
}

function cargarDatos(){
  onValue(productosRef, snap => {
    productos = snap.val() || {};
    renderTodo();
  }, error => {
    const status = document.getElementById('status');
    status.className = 'error';
    status.textContent = '❌ Error cargando productos: ' + error.message;
  });

  onValue(logsRef, snap => {
    logs = snap.val() || {};
    renderTodo();
  }, error => {
    const status = document.getElementById('status');
    status.className = 'error';
    status.textContent = '❌ Error cargando logs: ' + error.message;
  });
}

window.renderTodo = () => {
  const data = construirFilas();
  filasFiltradas = filtrarYOrdenar(data);
  totalVendidosGlobalRef = filasFiltradas.reduce((acc, p) => acc + p.vendidos, 0);
  renderResumenFechas();
  renderProductoDestacado(filasFiltradas);
  renderKPIs(filasFiltradas);
  renderTablaPrincipal(filasFiltradas);
  renderTopVendidos(filasFiltradas);
  renderTopReservados(filasFiltradas);
  renderAlertas(filasFiltradas);
  renderChartsYPeriodos();
  renderResumenMensual();
  renderRankingMeses();
};

window.aplicarFiltros = () => renderTodo();

window.limpiarFiltros = () => {
  document.getElementById('buscarProducto').value = '';
  document.getElementById('filtroEstado').value = 'todos';
  document.getElementById('ordenarPor').value = 'vendidos-desc';
  prepararFechas();
  renderTodo();
};

function construirFilas(){
  historialGlobal = calcularHistorialDesdeLogs();

  return Object.entries(productos).map(([id, p]) => {
    const stock = Number(p.stock || 0);
    const proximo = Number(p.proximo || 0);
    const reservados = Number(p.reservados || 0);
    const hist = historialGlobal.porProducto[id] || { vendidos: 0, yoelTotal: 0, lauraTotal: 0 };

    return {
      id,
      nombre: p.nombre || hist.nombre || '',
      imagen: p.imagen || '',
      stock,
      proximo,
      reservados,
      vendidos: Math.max(0, Number(hist.vendidos || 0)),
      yoelTotal: Math.max(0, Number(hist.yoelTotal || 0)),
      lauraTotal: Math.max(0, Number(hist.lauraTotal || 0)),
      porcentaje: 0
    };
  });
}

function calcularHistorialDesdeLogs(desde = '', hasta = ''){
  const entries = Object.entries(logs || {}).map(([key, log]) => ({ key, ...(log || {}) }));
  entries.sort((a,b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  const porProducto = {};
  const ventasPorDia = {};
  const ingresosPorDia = {};
  const lastKnownPrices = {};

  for (const log of entries) {
    if (!log || !log.tipo || !log.timestamp) continue;

    const productoId = log.productoId || '';
    const productoNombre = log.productoNombre || '';
    const fecha = ymd(log.timestamp);
    const cantidad = Number(log.cantidad || 0);
    const detalles = String(log.detalles || '');

    if (!porProducto[productoId]) {
      porProducto[productoId] = {
        nombre: productoNombre,
        vendidos: 0,
        yoelTotal: 0,
        lauraTotal: 0
      };
    }

    const yoelMatch = detalles.match(/yoel:?€?\s*([0-9]+(?:\.[0-9]+)?)/i);
    const lauraMatch = detalles.match(/Laura:?€?\s*([0-9]+(?:\.[0-9]+)?)/i);

    if (yoelMatch || lauraMatch) {
      lastKnownPrices[productoId] = {
        yoel: yoelMatch ? Number(yoelMatch[1]) : Number(lastKnownPrices[productoId]?.yoel || 0),
        laura: lauraMatch ? Number(lauraMatch[1]) : Number(lastKnownPrices[productoId]?.laura || 0)
      };
    }

    const dentroRango = esFechaDentro(fecha, desde, hasta);
    if (!dentroRango) continue;

    const productoActual = productos[productoId] || {};
    const yoelUnit = Number(lastKnownPrices[productoId]?.yoel || productoActual.yoel || 0);
    const lauraUnit = Number(lastKnownPrices[productoId]?.laura || productoActual.laura || 0);

    let totalyoel = Number(log.totalyoel);
    let totalLaura = Number(log.totalLaura);

    if (!Number.isFinite(totalyoel)) totalyoel = yoelUnit * cantidad;
    if (!Number.isFinite(totalLaura)) totalLaura = lauraUnit * cantidad;

    if (log.tipo === 'venta' || log.tipo === 'venta-desde-reserva') {
      porProducto[productoId].vendidos += cantidad;
      porProducto[productoId].yoelTotal += totalyoel;
      porProducto[productoId].lauraTotal += totalLaura;

      ventasPorDia[fecha] = Number(ventasPorDia[fecha] || 0) + cantidad;
      ingresosPorDia[fecha] = Number(ingresosPorDia[fecha] || 0) + totalLaura;
    }

    if (log.tipo === 'eliminacion-venta') {
      porProducto[productoId].vendidos -= cantidad;
      porProducto[productoId].yoelTotal -= totalyoel;
      porProducto[productoId].lauraTotal -= totalLaura;

      ventasPorDia[fecha] = Number(ventasPorDia[fecha] || 0) - cantidad;
      ingresosPorDia[fecha] = Number(ingresosPorDia[fecha] || 0) - totalLaura;
    }
  }

  Object.values(porProducto).forEach(p => {
    p.vendidos = Math.max(0, Number(p.vendidos || 0));
    p.yoelTotal = Number(p.yoelTotal || 0);
    p.lauraTotal = Number(p.lauraTotal || 0);
  });

  return { porProducto, ventasPorDia, ingresosPorDia };
}

function filtrarYOrdenar(data){
  const buscar = normalizarNombre(document.getElementById('buscarProducto').value);
  const estado = document.getElementById('filtroEstado').value;
  const orden = document.getElementById('ordenarPor').value;

  let rows = data.filter(p => {
    const coincideTexto = !buscar || normalizarNombre(p.nombre).includes(buscar);
    if (!coincideTexto) return false;

    switch (estado) {
      case 'agotados': return p.stock === 0;
      case 'stock-bajo': return p.stock > 0 && p.stock <= 5;
      case 'reservados': return p.reservados > 0;
      case 'proximo': return p.proximo > 0;
      case 'sin-ventas': return p.vendidos === 0;
      case 'con-ventas': return p.vendidos > 0;
      default: return true;
    }
  });

  const [campo, dir] = orden.split('-');
  rows.sort((a,b) => {
    let va, vb;
    switch (campo) {
      case 'nombre': va = a.nombre.toLowerCase(); vb = b.nombre.toLowerCase(); return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      case 'vendidos': va = a.vendidos; vb = b.vendidos; break;
      case 'laura': va = a.lauraTotal; vb = b.lauraTotal; break;
      case 'yoel': va = a.yoelTotal; vb = b.yoelTotal; break;
      case 'stock': va = a.stock; vb = b.stock; break;
      case 'reservados': va = a.reservados; vb = b.reservados; break;
      default: va = a.vendidos; vb = b.vendidos;
    }
    return dir === 'asc' ? va - vb : vb - va;
  });

  const totalVendidos = rows.reduce((acc,p) => acc + p.vendidos, 0);
  rows = rows.map(p => ({
    ...p,
    porcentaje: totalVendidos > 0 ? ((p.vendidos / totalVendidos) * 100) : 0
  }));

  return rows;
}

function renderResumenFechas(){
  const desde = document.getElementById('logFechaDesde').value;
  const hasta = document.getElementById('logFechaHasta').value;
  document.getElementById('resumenFechas').textContent = `Rango de logs usado para gráficos y periodos: ${desde || 'sin inicio'} → ${hasta || 'sin fin'}`;
}

function renderProductoDestacado(rows){
  const wrap = document.getElementById('productoDestacadoWrap');

  if (!rows.length) {
    wrap.innerHTML = '<div class="empty">No hay productos para destacar</div>';
    return;
  }

  const top = [...rows].sort((a,b) => {
    if (b.vendidos !== a.vendidos) return b.vendidos - a.vendidos;
    return b.lauraTotal - a.lauraTotal;
  })[0];

  let estadoTexto = 'OK';
  if (top.stock === 0) estadoTexto = 'AGOTADO';
  else if (top.stock <= 5) estadoTexto = 'STOCK BAJO';
  else if (top.proximo > 0) estadoTexto = 'CON PRÓXIMO STOCK';

  wrap.innerHTML = `
    <div class="destacado-wrap">
      <div class="destacado-foto-box">
        ${renderFotoGrande(top.imagen)}
      </div>

      <div class="destacado-info">
        <div class="destacado-titulo">🏆 Producto más vendido del filtro actual</div>
        <div class="destacado-nombre">${top.nombre}</div>

        <div class="destacado-kpis">
          <div class="destacado-kpi green">
            <div class="label">Unidades vendidas</div>
            <div class="value">${top.vendidos}</div>
          </div>
          <div class="destacado-kpi blue">
            <div class="label">Ingresos Laura</div>
            <div class="value">${formatEuro(top.lauraTotal)}</div>
          </div>
          <div class="destacado-kpi yellow">
            <div class="label">Stock actual</div>
            <div class="value">${top.stock}</div>
          </div>
          <div class="destacado-kpi cyan">
            <div class="label">Reservados / Próximo</div>
            <div class="value">${top.reservados} / ${top.proximo}</div>
          </div>
        </div>

        <div style="font-size:14px;font-weight:bold;color:#475569">
          Estado: ${estadoTexto} · yoel: ${formatEuro(top.yoelTotal)} · Cuota: ${top.porcentaje.toFixed(1)}%
        </div>

        <div class="destacado-acciones">
          <button class="orange" onclick="irEditarProducto('${top.id}')">✏️ Modificar producto</button>
          <button onclick="window.scrollTo({top: document.getElementById('tablaEstadisticas').offsetTop - 120, behavior:'smooth'})">📋 Ver en ranking</button>
        </div>
      </div>
    </div>
  `;
}

function renderKPIs(rows){
  const totalyoel = rows.reduce((acc,p) => acc + p.yoelTotal, 0);
  const totalLaura = rows.reduce((acc,p) => acc + p.lauraTotal, 0);
  const totalVendidos = rows.reduce((acc,p) => acc + p.vendidos, 0);
  const totalReservados = rows.reduce((acc,p) => acc + p.reservados, 0);
  const agotados = rows.filter(p => p.stock === 0).length;
  const stockBajo = rows.filter(p => p.stock > 0 && p.stock <= 5).length;
  const stockActual = rows.reduce((acc,p) => acc + p.stock, 0);
  const diferencia = totalLaura - totalyoel;

  document.getElementById('kpiyoel').textContent = formatEuro(totalyoel);
  document.getElementById('kpiLaura').textContent = formatEuro(totalLaura);
  document.getElementById('kpiDiferencia').textContent = formatEuro(diferencia);
  document.getElementById('kpiVendidos').textContent = totalVendidos;
  document.getElementById('kpiReservados').textContent = totalReservados;
  document.getElementById('kpiAgotados').textContent = agotados;
  document.getElementById('kpiStockBajo').textContent = stockBajo;
  document.getElementById('kpiStockActual').textContent = stockActual;
}


window.filtrarRankingEnVivo = () => {
  rankingPagina = 1;
  renderTablaPrincipal(filasFiltradas);
};

window.toggleVerTodosRanking = () => {
  rankingMostrarTodos = !rankingMostrarTodos;
  rankingPagina = 1;
  const btn = document.getElementById('btnVerTodosRanking');
  if (btn) btn.textContent = rankingMostrarTodos ? 'Ver menos' : 'Ver todos';
  renderTablaPrincipal(filasFiltradas);
};

window.irPaginaRanking = (direccion) => {
  const texto = normalizarNombre(document.getElementById('buscarRanking')?.value || '');
  const base = (filasFiltradas || []).filter(p => !texto || normalizarNombre(p.nombre).includes(texto));
  const totalPaginas = Math.max(1, Math.ceil(base.length / rankingPorPagina));
  rankingPagina = Math.min(totalPaginas, Math.max(1, rankingPagina + Number(direccion || 0)));
  renderTablaPrincipal(filasFiltradas);
};

function renderTablaPrincipal(rows){
  const tabla = document.getElementById('tablaEstadisticas');
  const buscarRanking = normalizarNombre(document.getElementById('buscarRanking')?.value || '');
  const resumenInfo = document.getElementById('rankingResumenInfo');
  const pageInfo = document.getElementById('rankingPageInfo');
  const prevBtn = document.getElementById('btnRankingPrev');
  const nextBtn = document.getElementById('btnRankingNext');

  let ranking = [...rows];
  if (buscarRanking) {
    ranking = ranking.filter(p => normalizarNombre(p.nombre).includes(buscarRanking));
  }

  const totalProductos = ranking.length;
  const totalPaginas = rankingMostrarTodos ? Math.max(1, Math.ceil(totalProductos / rankingPorPagina)) : 1;
  if (rankingPagina > totalPaginas) rankingPagina = totalPaginas;
  if (rankingPagina < 1) rankingPagina = 1;

  let rankingPintar = ranking;
  if (!rankingMostrarTodos) {
    rankingPintar = ranking.slice(0, rankingPorPagina);
  } else {
    const inicio = (rankingPagina - 1) * rankingPorPagina;
    const fin = inicio + rankingPorPagina;
    rankingPintar = ranking.slice(inicio, fin);
  }

  if (resumenInfo) {
    const cantidadMostrada = rankingPintar.length;
    resumenInfo.textContent = `Mostrando ${cantidadMostrada} de ${totalProductos} productos`;
  }

  if (pageInfo) {
    pageInfo.textContent = rankingMostrarTodos
      ? `Página ${rankingPagina} de ${totalPaginas}`
      : `Vista rápida · Top ${Math.min(rankingPorPagina, totalProductos)}`;
  }

  if (prevBtn) prevBtn.style.display = rankingMostrarTodos ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = rankingMostrarTodos ? 'inline-flex' : 'none';
  if (prevBtn) prevBtn.disabled = rankingPagina <= 1;
  if (nextBtn) nextBtn.disabled = rankingPagina >= totalPaginas;

  if (!rankingPintar.length) {
    tabla.innerHTML = '<tr><td colspan="12" class="empty">❌ No hay productos con ese filtro</td></tr>';
    return;
  }

  const startIndex = rankingMostrarTodos ? (rankingPagina - 1) * rankingPorPagina : 0;

  tabla.innerHTML = rankingPintar.map((p, i) => {
    const posicionReal = startIndex + i;
    const clasePos = posicionReal === 0 ? 'pos1' : posicionReal === 1 ? 'pos2' : posicionReal === 2 ? 'pos3' : '';
    let estado = '<span class="badge green">OK</span>';
    if (p.stock === 0) estado = '<span class="badge red">AGOTADO</span>';
    else if (p.stock <= 5) estado = '<span class="badge yellow">STOCK BAJO</span>';
    else if (p.proximo > 0) estado = '<span class="badge blue">PRÓXIMO</span>';

    return `
      <tr class="${clasePos}">
        <td style="font-weight:bold">${posicionReal + 1}</td>
        <td>${renderMiniFoto(p.imagen, false)}</td>
        <td style="text-align:left;font-weight:bold">${p.nombre}</td>
        <td>${p.stock}</td>
        <td>${p.proximo}</td>
        <td>${p.reservados}</td>
        <td style="font-size:17px;color:#28a745;font-weight:bold">${p.vendidos}</td>
        <td style="color:#28a745;font-weight:bold">${formatEuro(p.yoelTotal)}</td>
        <td style="color:#007bff;font-weight:bold">${formatEuro(p.lauraTotal)}</td>
        <td style="color:#f59e0b;font-weight:bold">${p.porcentaje.toFixed(1)}%</td>
        <td>${estado}</td>
        <td><button class="edit-btn" onclick="irEditarProducto('${p.id}')">✏️ Modificar</button></td>
      </tr>
    `;
  }).join('');
}

function renderTopVendidos(rows){
  const tbody = document.getElementById('tablaTopVendidos');
  const top = [...rows].filter(p => p.vendidos > 0).sort((a,b) => b.vendidos - a.vendidos).slice(0,10);
  tbody.innerHTML = top.length
    ? top.map((p,i) => `<tr><td>${i+1}</td><td>${renderMiniFoto(p.imagen, true)}</td><td style="text-align:left">${p.nombre}</td><td>${p.vendidos}</td><td><button class="edit-btn" onclick="irEditarProducto('${p.id}')">✏️</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Sin ventas</td></tr>';
}

function renderTopReservados(rows){
  const tbody = document.getElementById('tablaTopReservados');
  const top = [...rows].filter(p => p.reservados > 0).sort((a,b) => b.reservados - a.reservados).slice(0,10);
  tbody.innerHTML = top.length
    ? top.map((p,i) => `<tr><td>${i+1}</td><td>${renderMiniFoto(p.imagen, true)}</td><td style="text-align:left">${p.nombre}</td><td>${p.reservados}</td><td><button class="edit-btn" onclick="irEditarProducto('${p.id}')">✏️</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Sin reservas</td></tr>';
}

function renderAlertas(rows){
  const wrap = document.getElementById('alertasWrap');
  const agotados = rows.filter(p => p.stock === 0).map(p => `⛔ ${p.nombre}`);
  const stockBajo = rows.filter(p => p.stock > 0 && p.stock <= 5).map(p => `⚠️ ${p.nombre} (${p.stock})`);
  const conReservas = rows.filter(p => p.reservados > 0).map(p => `⏳ ${p.nombre} (${p.reservados})`);
  const conProximo = rows.filter(p => p.proximo > 0).map(p => `📦 ${p.nombre} (+${p.proximo})`);

  const bloques = [
    { titulo: 'Agotados', lista: agotados },
    { titulo: 'Stock bajo', lista: stockBajo },
    { titulo: 'Con reservas', lista: conReservas },
    { titulo: 'Con próximo stock', lista: conProximo }
  ];

  wrap.innerHTML = bloques.map(b => `
    <div style="margin-bottom:14px">
      <div style="font-weight:bold;margin-bottom:6px">${b.titulo}</div>
      <div style="font-size:13px;color:#475569">${b.lista.length ? b.lista.slice(0,8).join('<br>') : 'Ninguno'}</div>
    </div>
  `).join('');
}

function obtenerLogsFiltrados(){
  const desde = document.getElementById('logFechaDesde').value;
  const hasta = document.getElementById('logFechaHasta').value;
  return Object.values(logs || {}).filter(log => {
    if (!log || !log.timestamp) return false;
    const fecha = ymd(log.timestamp);
    return esFechaDentro(fecha, desde, hasta);
  });
}

function renderChartsYPeriodos(){
  const desde = document.getElementById('logFechaDesde').value;
  const hasta = document.getElementById('logFechaHasta').value;
  const historialRango = calcularHistorialDesdeLogs(desde, hasta);

  const ventasPorDia = historialRango.ventasPorDia;
  const ingresosPorDia = historialRango.ingresosPorDia;

  const etiquetas = Array.from(new Set([...Object.keys(ventasPorDia), ...Object.keys(ingresosPorDia)])).sort();
  const datosVentas = etiquetas.map(k => Number(ventasPorDia[k] || 0));
  const datosIngresos = etiquetas.map(k => Number((ingresosPorDia[k] || 0).toFixed(2)));

  dibujarChart('chartVentasPorDia', 'bar', etiquetas, datosVentas, 'Unidades vendidas netas', 'ventas');
  dibujarChart('chartIngresosPorDia', 'line', etiquetas, datosIngresos, 'Ingresos Laura € netos', 'ingresos');

  const resumenMeses = calcularResumenMensual(desde, hasta);
  dibujarChartMeses(resumenMeses);
  dibujarChartBeneficioMeses(resumenMeses);

  renderPeriodos(desde, hasta);
}

function getNetosEnPeriodo(desde, hasta){
  const hist = calcularHistorialDesdeLogs(desde, hasta);
  const ventas = Object.values(hist.ventasPorDia).reduce((acc, n) => acc + Number(n || 0), 0);
  const ingresosLaura = Object.values(hist.ingresosPorDia).reduce((acc, n) => acc + Number(n || 0), 0);
  const ingresosyoel = Object.values(hist.porProducto || {}).reduce((acc, p) => acc + Number(p?.yoelTotal || 0), 0);
  const diferencia = ingresosLaura - ingresosyoel;
  return {
    ventas: Math.max(0, ventas),
    ingresosyoel: Math.max(0, ingresosyoel),
    ingresosLaura: Math.max(0, ingresosLaura),
    diferencia
  };
}

function dibujarChart(canvasId, type, labels, data, label, kind){
  const ctx = document.getElementById(canvasId);
  if (kind === 'ventas' && ventasChart) ventasChart.destroy();
  if (kind === 'ingresos' && ingresosChart) ingresosChart.destroy();

  const chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{ label, data, borderWidth: 2, fill: false, tension: 0.25 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });

  if (kind === 'ventas') ventasChart = chart;
  if (kind === 'ingresos') ingresosChart = chart;
}

function renderPeriodos(desdeFiltro, hastaFiltro){
  const tbody = document.getElementById('tablaPeriodos');
  const hoy = new Date();
  hoy.setHours(0,0,0,0);

  const formatFecha = (d) => d.toLocaleDateString('es-ES');
  const formatMes = (d) => d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const makeDate = (base) => {
    const d = new Date(base);
    d.setHours(0,0,0,0);
    return d;
  };

  const addDays = (base, days) => {
    const d = makeDate(base);
    d.setDate(d.getDate() + days);
    return d;
  };

  const periodosBase = [
    { desde: makeDate(hoy), hasta: makeDate(hoy), label: "Hoy" },
    { desde: addDays(hoy, -1), hasta: addDays(hoy, -1), label: "Ayer" },
    { desde: addDays(hoy, -2), hasta: addDays(hoy, -2), label: "Anteayer" },
    { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1), hasta: makeDate(hoy), label: formatMes(hoy) },
    { desde: new Date(hoy.getFullYear(), hoy.getMonth()-1, 1), hasta: new Date(hoy.getFullYear(), hoy.getMonth(), 0), label: formatMes(new Date(hoy.getFullYear(), hoy.getMonth()-1, 1)) },
    { desde: new Date(hoy.getFullYear(), hoy.getMonth()-2, 1), hasta: new Date(hoy.getFullYear(), hoy.getMonth()-1, 0), label: formatMes(new Date(hoy.getFullYear(), hoy.getMonth()-2, 1)) }
  ];

  const rows = periodosBase.map(p => {
    const desde = ymd(p.desde);
    const hasta = ymd(p.hasta);

    const neto = getNetosEnPeriodo(desde, hasta);
    const diffClass = neto.diferencia > 0 ? 'money-positive' : (neto.diferencia < 0 ? 'money-negative' : 'money-neutral');

    return `<tr>
      <td><strong>${p.label}</strong><br><small>${formatFecha(p.desde)} → ${formatFecha(p.hasta)}</small></td>
      <td>${neto.ventas}</td>
      <td>${formatEuro(neto.ingresosyoel)}</td>
      <td>${formatEuro(neto.ingresosLaura)}</td>
      <td><span class="${diffClass}">${formatEuro(neto.diferencia)}</span></td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows || '<tr><td colspan="5" class="empty">Sin movimientos</td></tr>';
}


function getClaveMes(fechaYmd){
  const [y, m] = String(fechaYmd).split('-');
  return `${y}-${m}`;
}

function nombreMesDesdeClave(clave){
  const [y, m] = clave.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

function calcularResumenMensual(desde = '', hasta = ''){
  const desdeBase = desde ? new Date(desde + 'T00:00:00') : new Date(new Date().getFullYear(), 0, 1);
  const hastaBase = hasta ? new Date(hasta + 'T00:00:00') : new Date();
  desdeBase.setHours(0,0,0,0);
  hastaBase.setHours(0,0,0,0);

  const mesesMap = {};
  const cursor = new Date(desdeBase.getFullYear(), desdeBase.getMonth(), 1);
  const ultimoMes = new Date(hastaBase.getFullYear(), hastaBase.getMonth(), 1);

  while (cursor <= ultimoMes) {
    const clave = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2,'0')}`;
    mesesMap[clave] = { ventas: 0, ingresosLaura: 0, ingresosyoel: 0 };
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const entriesLogs = Object.values(logs || {}).filter(log => {
    if (!log || !log.timestamp) return false;
    const fecha = ymd(log.timestamp);
    return esFechaDentro(fecha, desde, hasta);
  }).sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0));

  const lastKnownPrices = {};

  for (const log of entriesLogs) {
    const productoId = log.productoId || '';
    const fecha = ymd(log.timestamp);
    const mes = getClaveMes(fecha);
    if (!mesesMap[mes]) mesesMap[mes] = { ventas: 0, ingresosLaura: 0, ingresosyoel: 0 };

    const detalles = String(log.detalles || '');
    const yoelMatch = detalles.match(/yoel:?€?\s*([0-9]+(?:\.[0-9]+)?)/i);
    const lauraMatch = detalles.match(/Laura:?€?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (yoelMatch || lauraMatch) {
      lastKnownPrices[productoId] = {
        yoel: yoelMatch ? Number(yoelMatch[1]) : Number(lastKnownPrices[productoId]?.yoel || 0),
        laura: lauraMatch ? Number(lauraMatch[1]) : Number(lastKnownPrices[productoId]?.laura || 0)
      };
    }

    const cantidad = Number(log.cantidad || 0);
    const productoActual = productos[productoId] || {};
    const yoelUnit = Number(lastKnownPrices[productoId]?.yoel || productoActual.yoel || 0);
    const lauraUnit = Number(lastKnownPrices[productoId]?.laura || productoActual.laura || 0);

    let totalyoel = Number(log.totalyoel);
    let totalLaura = Number(log.totalLaura);
    if (!Number.isFinite(totalyoel)) totalyoel = yoelUnit * cantidad;
    if (!Number.isFinite(totalLaura)) totalLaura = lauraUnit * cantidad;

    if (log.tipo === 'venta' || log.tipo === 'venta-desde-reserva') {
      mesesMap[mes].ventas += cantidad;
      mesesMap[mes].ingresosLaura += totalLaura;
      mesesMap[mes].ingresosyoel += totalyoel;
    }

    if (log.tipo === 'eliminacion-venta') {
      mesesMap[mes].ventas -= cantidad;
      mesesMap[mes].ingresosLaura -= totalLaura;
      mesesMap[mes].ingresosyoel -= totalyoel;
    }
  }

  return Object.entries(mesesMap)
    .map(([clave, datos]) => ({
      clave,
      nombre: nombreMesDesdeClave(clave),
      ventas: Math.max(0, Number(datos.ventas || 0)),
      ingresosyoel: Number(datos.ingresosyoel || 0),
      ingresosLaura: Number(datos.ingresosLaura || 0),
      diferencia: Number(datos.ingresosLaura || 0) - Number(datos.ingresosyoel || 0)
    }))
    .sort((a,b) => a.clave.localeCompare(b.clave));
}

function dibujarChartMeses(resumenMeses){
  const ctx = document.getElementById('chartMeses');
  if (!ctx) return;
  if (mesesChart) mesesChart.destroy();

  const labels = resumenMeses.map(m => m.nombre);
  const dataLaura = resumenMeses.map(m => Number(m.ingresosLaura.toFixed(2)));
  const datayoel = resumenMeses.map(m => Number(m.ingresosyoel.toFixed(2)));

  mesesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Laura €',
          data: dataLaura,
          borderWidth: 1
        },
        {
          label: 'yoel €',
          data: datayoel,
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function dibujarChartBeneficioMeses(resumenMeses){
  const ctx = document.getElementById('chartBeneficioMeses');
  if (!ctx) return;
  if (beneficioMesesChart) beneficioMesesChart.destroy();

  const labels = resumenMeses.map(m => m.nombre);
  const dataBeneficio = resumenMeses.map(m => Number(m.diferencia.toFixed(2)));

  beneficioMesesChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Beneficio € (Laura - yoel)',
        data: dataBeneficio,
        borderWidth: 2,
        fill: false,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderRankingMeses(){
  const desde = document.getElementById('logFechaDesde').value;
  const hasta = document.getElementById('logFechaHasta').value;
  const resumenMeses = calcularResumenMensual(desde, hasta);
  const tbody = document.getElementById('tablaRankingMeses');
  if (!tbody) return;

  const ranking = [...resumenMeses].sort((a,b) => b.diferencia - a.diferencia);

  if (!ranking.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Sin meses con movimientos</td></tr>';
    return;
  }

  tbody.innerHTML = ranking.map((m, i) => {
    const clase = m.diferencia > 0 ? 'money-positive' : (m.diferencia < 0 ? 'money-negative' : 'money-neutral');
    return `<tr>
      <td>${i + 1}</td>
      <td style="text-align:left">${m.nombre}</td>
      <td>${formatEuro(m.ingresosLaura)}</td>
      <td>${formatEuro(m.ingresosyoel)}</td>
      <td><span class="${clase}">${formatEuro(m.diferencia)}</span></td>
      <td>${m.ventas}</td>
    </tr>`;
  }).join('');
}

function renderResumenMensual(){
  const desde = document.getElementById('logFechaDesde').value;
  const hasta = document.getElementById('logFechaHasta').value;
  const resumenMeses = calcularResumenMensual(desde, hasta);
  const wrap = document.getElementById('resumenMeses');
  if (!wrap) return;

  if (!resumenMeses.length) {
    wrap.innerHTML = 'Sin meses con movimientos en el rango actual.';
    return;
  }

  const mejorMes = [...resumenMeses].sort((a,b) => b.ingresosLaura - a.ingresosLaura)[0];
  const mesActual = resumenMeses[resumenMeses.length - 1];
  const mesPrevio = resumenMeses.length > 1 ? resumenMeses[resumenMeses.length - 2] : null;

  let crecimientoHtml = 'Crecimiento mensual: sin mes previo para comparar.';
  let alertaHtml = '📊 Alerta mensual: sin mes previo para comparar.';
  if (mesPrevio) {
    const base = Number(mesPrevio.ingresosLaura || 0);
    const actual = Number(mesActual.ingresosLaura || 0);
    let crecimiento = 0;
    if (base === 0) crecimiento = actual > 0 ? 100 : 0;
    else crecimiento = ((actual - base) / base) * 100;

    const clase = crecimiento > 0 ? 'money-positive' : (crecimiento < 0 ? 'money-negative' : 'money-neutral');
    const signo = crecimiento > 0 ? '+' : '';
    crecimientoHtml = `Crecimiento mensual: <span class="${clase}">${signo}${crecimiento.toFixed(1)}%</span> (${mesPrevio.nombre} → ${mesActual.nombre})`;

    if (actual < base) alertaHtml = `🚨 Alerta mensual: <span class="money-negative">${mesActual.nombre}</span> va peor que <strong>${mesPrevio.nombre}</strong>.`;
    else if (actual > base) alertaHtml = `✅ Alerta mensual: <span class="money-positive">${mesActual.nombre}</span> mejora frente a <strong>${mesPrevio.nombre}</strong>.`;
    else alertaHtml = `➖ Alerta mensual: ${mesActual.nombre} está igual que ${mesPrevio.nombre}.`;
  }

  const añoActual = new Date().getFullYear();
  const mesesAño = resumenMeses.filter(m => m.clave.startsWith(String(añoActual)));
  const totalAñoLaura = mesesAño.reduce((acc,m)=>acc+m.ingresosLaura,0);
  const totalAñoyoel = mesesAño.reduce((acc,m)=>acc+m.ingresosyoel,0);
  const totalAñoBeneficio = totalAñoLaura - totalAñoyoel;
  const claseBeneficio = totalAñoBeneficio > 0 ? 'money-positive' : (totalAñoBeneficio < 0 ? 'money-negative' : 'money-neutral');

  wrap.innerHTML = `
    <div>🏆 Mejor mes automático: <strong>${mejorMes.nombre}</strong> con <strong>${formatEuro(mejorMes.ingresosLaura)}</strong> de Laura.</div>
    <div style="margin-top:6px">${crecimientoHtml}</div>
    <div style="margin-top:6px">${alertaHtml}</div>
    <div style="margin-top:6px">📅 Año en curso (${añoActual}): Laura ${formatEuro(totalAñoLaura)} · yoel ${formatEuro(totalAñoyoel)} · Beneficio <span class="${claseBeneficio}">${formatEuro(totalAñoBeneficio)}</span></div>
  `;
}

window.volver = () => window.location.href = 'index.html';
window.imprimir = () => window.print();

window.descargarCSV = () => {
  const filas = [["Pos","Producto","Stock","Proximo","Reservados","Vendidos","yoel","Laura","Porcentaje","Imagen"]];
  filasFiltradas.forEach((p, i) => {
    filas.push([
      i + 1,
      p.nombre,
      p.stock,
      p.proximo,
      p.reservados,
      p.vendidos,
      p.yoelTotal.toFixed(2),
      p.lauraTotal.toFixed(2),
      p.porcentaje.toFixed(1) + '%',
      p.imagen || ''
    ]);
  });

  const csv = filas.map(f => f.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'estadisticas-inventario-laura.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

window.descargarPDF = async () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const element = document.body;
  const canvas = await html2canvas(element, { scale: 1.5, useCORS: true, logging: false, windowWidth: document.body.scrollWidth, windowHeight: document.body.scrollHeight });
  const imgData = canvas.toDataURL('image/png');
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 8;
  const imgWidth = pageWidth - margin * 2;
  const imgHeight = canvas.height * imgWidth / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;
  doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
  heightLeft -= (pageHeight - margin * 2);

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + margin;
    doc.addPage();
    doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - margin * 2);
  }

  doc.save('estadisticas-7-inventario-laura.pdf');
};
})().catch(window.INVENTARIO_BOOT.showBootError);
