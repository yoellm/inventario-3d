(async function () {
    const [firebaseApp, firebaseDatabase, firebaseAuth] = await window.INVENTARIO_BOOT.loadFirebase();
    const { initializeApp } = firebaseApp;
    const { getDatabase, ref, onValue, remove } = firebaseDatabase;
    const { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } = firebaseAuth;
    const { firebaseConfig, ADMIN_EMAILS } = window.INVENTARIO_CONFIG;

    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    const auth = getAuth(app);

    const logsRef = ref(db, 'logs');
    const productosRef = ref(db, 'productos');

    let todosLogs = [];
    let todosProductos = {};
    let logsFiltradosActuales = [];
    let ordenActual = { campo: 'fecha', dir: 'desc' };
    let quickFilterActual = 'todos';

function tipoClase(tipo){
  switch(tipo){
    case 'venta':
    case 'venta-desde-reserva': return ['tipo-venta','log-venta'];
    case 'reserva': return ['tipo-reserva','log-reserva'];
    case 'cancelacion-reserva': return ['tipo-cancel-reserva','log-cancelacion'];
    case 'eliminacion-venta': return ['tipo-elim-venta','log-eliminacion'];
    case 'usuario-conectado': return ['tipo-backup','log-tipico'];
    case 'consulta-producto': return ['tipo-stock','log-tipico'];
    case 'backup-creado':
    case 'backup-restaurado': return ['tipo-backup','log-tipico'];
    case 'stock-anadido':
    case 'stock-modificado':
    case 'proximo-modificado': return ['tipo-stock','log-tipico'];
    case 'precio-laura':
    case 'precio-laura-global':
    case 'producto-creado':
    case 'producto-editado':
    case 'producto-borrado': return ['tipo-precio','log-tipico'];
    case 'gasto-creado':
    case 'gasto-editado':
    case 'gasto-borrado': return ['tipo-stock','log-tipico'];
    case 'liquidacion-cerrada':
    case 'reset-completo': return ['tipo-reset','log-tipico'];
    default: return ['',''];
  }
}

    function safeLower(v){ return String(v || '').toLowerCase().trim(); }

    function extraerImportes(log){
      const detalles = String(log?.detalles || '');
      const beaDirect = Number(log?.precioyoel ?? log?.totalyoel ?? log?.precioBea ?? log?.totalBea ?? 0);
      const lauraDirect = Number(log?.precioLaura ?? log?.totalLaura ?? 0);

      const beaMatch = detalles.match(/(?:yoel|Bea):€\s*([0-9]+(?:\.[0-9]+)?)/i);
      const lauraMatch = detalles.match(/Laura:€([0-9]+(?:\.[0-9]+)?)/);

      const cantidad = Number(log?.cantidad || 0);
      const beaUnit = beaDirect || (beaMatch ? Number(beaMatch[1]) : 0);
      const lauraUnit = lauraDirect || (lauraMatch ? Number(lauraMatch[1]) : 0);
      const bea = log?.totalyoel != null ? Number(log.totalyoel) : log?.totalBea != null ? Number(log.totalBea) : beaUnit * cantidad;
      const laura = log?.totalLaura != null ? Number(log.totalLaura) : lauraUnit * cantidad;
      const margen = laura - bea;
      return { bea, laura, margen };
    }

    function resumirDispositivo(userAgent){
      const ua = String(userAgent || '');
      const navegador = /Edg/i.test(ua) ? 'Edge' : /OPR|Opera/i.test(ua) ? 'Opera' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Navegador';
      const sistema = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iPhone/iPad' : /Mac OS|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'SO';
      return `${navegador} / ${sistema}`;
    }

    function detectarAlertas(logs){
      let correcciones = 0;
      let cambiosPrecio = 0;
      let ventasGrandes = 0;
      const ips = new Set();

      logs.forEach(log => {
        if (log.tipo === 'eliminacion-venta') correcciones++;
        if (log.tipo === 'precio-laura' || log.tipo === 'precio-laura-global') cambiosPrecio++;
        if (log.tipo === 'venta' && Number(log.cantidad || 0) >= 10) ventasGrandes++;
        if (log.ip && log.ip !== 'IP desconocida') ips.add(log.ip);
      });

      return {
        correcciones,
        cambiosPrecio,
        ventasGrandes,
        ipsDistintas: ips.size
      };
    }

    function actualizarAlertas(logs){
      const alertas = detectarAlertas(logs);
      document.getElementById('alertasInteligentes').innerHTML = `
        <div style="font-weight:bold;font-size:16px;margin-bottom:8px">🛡️ Alertas inteligentes</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <span class="mini-counter reset">Correcciones de venta: ${alertas.correcciones}</span>
          <span class="mini-counter backup">IPs distintas: ${alertas.ipsDistintas}</span>
          <span class="mini-counter precio">Cambios de precio: ${alertas.cambiosPrecio}</span>
          <span class="mini-counter venta">Ventas grandes (10+): ${alertas.ventasGrandes}</span>
        </div>
      `;
    }

    function actualizarTotalBea(){
      let totalBea = 0;
      Object.values(todosProductos || {}).forEach(p => {
        totalBea += Number(p?.yoel ?? p?.bea ?? 0);
      });
      document.getElementById('totalBeaIndex').textContent = totalBea.toFixed(2) + ' €';
    }

    function actualizarContadores(logs){
      const totalCantidad = logs.reduce((acc, log) => acc + Number(log?.cantidad || 0), 0);
      const totalLaura = logs.reduce((acc, log) => acc + Number(log?.lauraCalc || 0), 0);
      const totalMargen = logs.reduce((acc, log) => acc + Number(log?.margenCalc || 0), 0);

      const ventas = logs.filter(l => ['venta','venta-desde-reserva','eliminacion-venta'].includes(l.tipo)).length;
      const reservas = logs.filter(l => l.tipo === 'reserva' || l.tipo === 'cancelacion-reserva').length;
      const stock = logs.filter(l => ['stock-anadido','stock-modificado','proximo-modificado'].includes(l.tipo)).length;
      const precios = logs.filter(l => ['precio-laura','precio-laura-global','producto-creado','producto-editado','producto-borrado'].includes(l.tipo)).length;
      const backups = logs.filter(l => ['backup-creado','backup-restaurado'].includes(l.tipo)).length;
      const gastos = logs.filter(l => ['gasto-creado','gasto-editado','gasto-borrado'].includes(l.tipo)).length;
      const resets = logs.filter(l => ['liquidacion-cerrada','reset-completo'].includes(l.tipo)).length;

      document.getElementById('totalCantidadLogs').textContent = totalCantidad.toLocaleString('es-ES');
      document.getElementById('totalLauraLogs').textContent = totalLaura.toFixed(2) + ' €';
      document.getElementById('totalMargenLogs').textContent = totalMargen.toFixed(2) + ' €';
      document.getElementById('countVentas').textContent = ventas;
      document.getElementById('countReservas').textContent = reservas;
      document.getElementById('countStock').textContent = stock;
      document.getElementById('countPrecios').textContent = precios;
      document.getElementById('countBackups').textContent = backups;
      document.getElementById('countGastos').textContent = gastos;
      document.getElementById('countResets').textContent = resets;
    }

    function coincideQuickFilter(log){
      if (quickFilterActual === 'todos') return true;
      if (quickFilterActual === 'venta') return ['venta','venta-desde-reserva'].includes(log.tipo);
      if (quickFilterActual === 'stock-group') return ['stock-anadido','stock-modificado','proximo-modificado'].includes(log.tipo);
      if (quickFilterActual === 'precio-group') return ['precio-laura','precio-laura-global','producto-creado','producto-editado','producto-borrado'].includes(log.tipo);
      if (quickFilterActual === 'backup-group') return ['backup-creado','backup-restaurado'].includes(log.tipo);
      if (quickFilterActual === 'gastos-group') return ['gasto-creado','gasto-editado','gasto-borrado'].includes(log.tipo);
      return log.tipo === quickFilterActual;
    }

    function ordenarLogs(logs){
      const arr = [...logs];
      arr.sort((a,b) => {
        let va, vb;
        switch(ordenActual.campo){
          case 'fecha': va = Number(a.timestamp || 0); vb = Number(b.timestamp || 0); break;
          case 'tipo': va = safeLower(a.tipo); vb = safeLower(b.tipo); break;
          case 'producto': va = safeLower(a.productoNombre); vb = safeLower(b.productoNombre); break;
          case 'cantidad': va = Number(a.cantidad || 0); vb = Number(b.cantidad || 0); break;
          case 'usuario': va = safeLower(a.usuario); vb = safeLower(b.usuario); break;
          case 'bea': va = Number(a.beaCalc || 0); vb = Number(b.beaCalc || 0); break;
          case 'laura': va = Number(a.lauraCalc || 0); vb = Number(b.lauraCalc || 0); break;
          case 'margen': va = Number(a.margenCalc || 0); vb = Number(b.margenCalc || 0); break;
          case 'ip': va = safeLower(a.ip); vb = safeLower(b.ip); break;
          case 'dispositivo': va = safeLower(a.dispositivoResumen); vb = safeLower(b.dispositivoResumen); break;
          default: va = Number(a.timestamp || 0); vb = Number(b.timestamp || 0);
        }

        if (typeof va === 'string') {
          return ordenActual.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return ordenActual.dir === 'asc' ? va - vb : vb - va;
      });
      return arr;
    }

    function renderLogs(logs){
      const tabla = document.getElementById('tablaLogs');
      const count = document.getElementById('logCount');
      actualizarContadores(logs);
      actualizarAlertas(logs);

      if (!logs.length){
        tabla.innerHTML = '<tr><td colspan="12" class="empty-state">No hay logs con esos filtros</td></tr>';
        count.textContent = '0 movimientos encontrados';
        return;
      }

      let html = '';
      for (const log of logs){
        const [claseTipo, claseFila] = tipoClase(log.tipo || '');
        const productoUrl = log.productoId ? `index.html?editId=${encodeURIComponent(log.productoId)}` : '';

        html += `
          <tr class="${claseFila}">
            <td>${log.fecha || ''}</td>
            <td><span class="log-tipo ${claseTipo}">${String(log.tipo || '').replace(/-/g,' ').toUpperCase()}</span></td>
            <td style="text-align:left">${log.productoNombre || ''}</td>
            <td>${Number(log.cantidad || 0)}</td>
            <td>${log.usuario || ''}</td>
            <td class="money-bea">${log.beaCalc ? log.beaCalc.toFixed(2) + ' €' : '-'}</td>
            <td class="money-laura">${log.lauraCalc ? log.lauraCalc.toFixed(2) + ' €' : '-'}</td>
            <td class="money-margin">${log.lauraCalc || log.beaCalc ? log.margenCalc.toFixed(2) + ' €' : '-'}</td>
            <td>${log.ip || '-'}</td>
            <td>${log.dispositivoResumen || '-'}</td>
            <td>${productoUrl ? `<button class="product-link-btn" onclick="verProducto('${productoUrl}')">🔍</button>` : '-'}</td>
            <td style="text-align:left;font-size:11px">${log.detalles || ''}</td>
          </tr>
        `;
      }

      tabla.innerHTML = html;
      count.textContent = `${logs.length} movimientos encontrados`;
    }

    function refrescarQuickButtons(btnActivo){
      document.querySelectorAll('.quick-filters button').forEach(btn => btn.classList.remove('active-filter'));
      if (btnActivo) btnActivo.classList.add('active-filter');
    }

    window.setQuickFilter = (tipo, btn) => {
      quickFilterActual = tipo;
      refrescarQuickButtons(btn);
if (['usuario-conectado','consulta-producto','venta','venta-desde-reserva','reserva','cancelacion-reserva','eliminacion-venta','backup-creado','backup-restaurado','stock-anadido','stock-modificado','proximo-modificado','precio-laura','precio-laura-global','producto-creado','producto-editado','producto-borrado','gasto-creado','gasto-editado','gasto-borrado','liquidacion-cerrada','reset-completo','todos'].includes(tipo)) {
        document.getElementById('logTipo').value = tipo === 'todos' ? 'todos' : tipo;
      } else {
        document.getElementById('logTipo').value = 'todos';
      }
      aplicarFiltros();
    };

    window.ordenarPor = (campo) => {
      if (ordenActual.campo === campo) {
        ordenActual.dir = ordenActual.dir === 'asc' ? 'desc' : 'asc';
      } else {
        ordenActual.campo = campo;
        ordenActual.dir = campo === 'fecha' ? 'desc' : 'asc';
      }
      aplicarFiltros();
    };

    window.aplicarFiltros = () => {
      const texto = safeLower(document.getElementById('logBuscar').value);
      const tipo = document.getElementById('logTipo').value;
      const desde = document.getElementById('logFechaDesde').value;
      const hasta = document.getElementById('logFechaHasta').value;

      let filtrados = todosLogs.filter(log => {
        const fecha = String(log.fechaYmd || '');
        const coincideFecha = (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
        const coincideTexto =
          safeLower(log.productoNombre).includes(texto) ||
          safeLower(log.usuario).includes(texto) ||
          safeLower(log.detalles).includes(texto) ||
          safeLower(log.tipo).includes(texto) ||
          safeLower(log.ip).includes(texto) ||
          safeLower(log.dispositivoResumen).includes(texto);
        const coincideTipo = tipo === 'todos' || log.tipo === tipo;
        return coincideFecha && coincideTexto && coincideTipo && coincideQuickFilter(log);
      });

      filtrados = ordenarLogs(filtrados);
      logsFiltradosActuales = filtrados;
      renderLogs(filtrados);
    };

    window.recargarRangoRapido = (dias) => {
      const hoy = new Date();
      const desde = new Date(Date.now() - (dias - 1) * 24 * 60 * 60 * 1000);
      document.getElementById('logFechaDesde').value = desde.toISOString().split('T')[0];
      document.getElementById('logFechaHasta').value = hoy.toISOString().split('T')[0];
      aplicarFiltros();
    };

    window.limpiarFiltros = () => {
      document.getElementById('logBuscar').value = '';
      document.getElementById('logTipo').value = 'todos';
      quickFilterActual = 'todos';
      ordenActual = { campo: 'fecha', dir: 'desc' };
      recargarRangoRapido(7);
      const btn = document.getElementById('quick-all');
      refrescarQuickButtons(btn);
    };

    window.verProducto = (url) => {
      window.open(url, '_blank');
    };

    window.exportarCSV = () => {
      const filas = [["Fecha","Tipo","Producto","Cantidad","Usuario","Bea","Laura","Margen","IP","Dispositivo","Detalles"]];
      logsFiltradosActuales.forEach(log => {
        filas.push([
          log.fecha || '',
          log.tipo || '',
          log.productoNombre || '',
          Number(log.cantidad || 0),
          log.usuario || '',
          log.beaCalc ? log.beaCalc.toFixed(2) : '',
          log.lauraCalc ? log.lauraCalc.toFixed(2) : '',
          log.lauraCalc || log.beaCalc ? log.margenCalc.toFixed(2) : '',
          log.ip || '',
          log.dispositivoResumen || '',
          log.detalles || ''
        ]);
      });

      const csv = filas.map(f => f.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'logs-inventario-laura.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    window.login = () => {
      const email = document.getElementById('userEmail').value.trim();
      const pass = document.getElementById('userPass').value;
      if (!email || !pass) return alert('Email y contraseña requeridos');
      signInWithEmailAndPassword(auth, email, pass).catch(e => alert('Error: ' + e.message));
    };

    window.logout = () => {
      signOut(auth).catch(e => alert('Error: ' + e.message));
    };

    window.resetLogin = () => {
      document.getElementById('userEmail').value = '';
      document.getElementById('userPass').value = '';
    };

    window.irDebug = () => {
      window.open('https://nilose2014.github.io/inventario-laura/debug.html', '_blank');
    };

    window.limpiarTodosLogs = async () => {
      if (!confirm('⚠️ ¿BORRAR TODOS los logs permanentemente?\n\nEsta acción NO se puede deshacer.')) return;
      try {
        await remove(logsRef);
        todosLogs = [];
        logsFiltradosActuales = [];
        renderLogs([]);
        alert('✅ TODOS los logs han sido eliminados');
      } catch (error) {
        alert('❌ Error al limpiar logs: ' + error.message);
      }
    };

    onValue(productosRef, (snap) => {
      todosProductos = snap.val() || {};
      actualizarTotalBea();
    });

    onValue(logsRef, (snap) => {
      const nuevosLogs = [];
      snap.forEach(child => {
        const raw = child.val() || {};
        const timestamp = Number(raw.timestamp || 0);
        if (!timestamp) return;
        const fechaObj = new Date(timestamp);
        const fechaYmd = fechaObj.toISOString().split('T')[0];
        const importes = extraerImportes(raw);

        nuevosLogs.push({
          key: child.key,
          ...raw,
          timestamp,
          fechaYmd,
          fecha: raw.fecha || fechaObj.toLocaleString('es-ES'),
          productoNombre: raw.productoNombre || '',
          usuario: raw.usuario || '',
          detalles: raw.detalles || '',
          cantidad: Number(raw.cantidad || 0),
          tipo: raw.tipo || '',
          beaCalc: Number(importes.bea || 0),
          lauraCalc: Number(importes.laura || 0),
          margenCalc: Number(importes.margen || 0),
          ip: raw.ip || 'IP desconocida',
          dispositivo: raw.dispositivo || '',
          dispositivoResumen: resumirDispositivo(raw.dispositivo || '')
        });
      });

      todosLogs = nuevosLogs;
      aplicarFiltros();
    }, (error) => {
      const status = document.getElementById('status');
      status.className = 'error';
      status.textContent = '❌ Error cargando logs: ' + error.message;
    });

    onAuthStateChanged(auth, (user) => {
      const loginDiv = document.getElementById('loginDiv');
      const mainApp = document.getElementById('mainApp');
      const status = document.getElementById('status');

      if (user && ADMIN_EMAILS.includes(user.email)) {
        loginDiv.classList.add('hidden');
        mainApp.classList.remove('hidden');
        status.className = 'admin';
        status.innerHTML = `<strong>ADMIN</strong> ${user.email}<br>Logs cargados ✅`;
      } else {
        mainApp.classList.add('hidden');
        loginDiv.classList.remove('hidden');
      }
    });

    window.onload = () => {
      recargarRangoRapido(7);
      refrescarQuickButtons(document.getElementById('quick-all'));
    };
})().catch(window.INVENTARIO_BOOT.showBootError);
