(async function () {
    const [firebaseApp, firebaseDatabase, firebaseAuth] = await window.INVENTARIO_BOOT.loadFirebase();
    const { initializeApp } = firebaseApp;
    const { getDatabase, ref, onValue, push, update, remove } = firebaseDatabase;
    const { getAuth, onAuthStateChanged } = firebaseAuth;
    const { firebaseConfig, ADMIN_EMAILS } = window.INVENTARIO_CONFIG;

    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    const auth = getAuth(app);
    document.documentElement.dataset.financeJs = 'ready';
    const gastosRef = ref(db, 'gastos');
    const logsRef = ref(db, 'logs');
    const productosRef = ref(db, 'productos');
    const CATEGORIAS = {
      materiales: 'Materiales y filamento',
      maquinaria: 'Maquinaria y herramientas',
      embalaje: 'Embalaje y envíos',
      mantenimiento: 'Mantenimiento y repuestos',
      publicidad: 'Publicidad y diseño',
      servicios: 'Servicios y comisiones',
      otros: 'Otros'
    };

    const METODOS = {
      tarjeta: 'Tarjeta',
      efectivo: 'Efectivo',
      transferencia: 'Transferencia',
      paypal: 'PayPal',
      otro: 'Otro'
    };

    let gastos = {};
    let logs = {};
    let productos = {};
    let currentUser = null;
    let editId = null;
    let listenersStarted = false;
    let gastosFiltradosActuales = [];

    function localYmd(fecha = new Date()) {
      const d = new Date(fecha);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function escaparHtml(valor = '') {
      return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function euro(valor) {
      return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(valor || 0));
    }

    function numeroValido(valor) {
      if (valor === null || valor === undefined || valor === '') return null;
      const n = Number(valor);
      return Number.isFinite(n) ? n : null;
    }

    function fechaLog(log) {
      if (log?.timestamp) return localYmd(Number(log.timestamp));
      const texto = String(log?.fecha || '');
      const match = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : '';
    }

    function importeVenta(log) {
      const cantidad = Math.max(0, Number(log?.cantidad || 0));
      const detalles = String(log?.detalles || '');
      const producto = productos[log?.productoId] || {};

      const yoelMatch = detalles.match(/(?:yoel|Bea):?€?\s*([0-9]+(?:\.[0-9]+)?)/i);
      const ventaMatch = detalles.match(/Laura:?€?\s*([0-9]+(?:\.[0-9]+)?)/i);

      const totalYoelDirecto = numeroValido(log?.totalyoel ?? log?.totalBea);
      const totalVentaDirecto = numeroValido(log?.totalLaura);
      const yoelUnitario = numeroValido(log?.precioyoel ?? log?.precioBea)
        ?? (yoelMatch ? Number(yoelMatch[1]) : null)
        ?? numeroValido(producto?.yoel ?? producto?.bea)
        ?? 0;
      const ventaUnitaria = numeroValido(log?.precioLaura)
        ?? (ventaMatch ? Number(ventaMatch[1]) : null)
        ?? numeroValido(producto?.laura)
        ?? 0;

      return {
        cantidad,
        paraYoel: totalYoelDirecto ?? yoelUnitario * cantidad,
        cobrado: totalVentaDirecto ?? ventaUnitaria * cantidad
      };
    }

    function dentroPeriodo(fecha, desde, hasta) {
      return !!fecha && (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
    }

    function calcularVentas(desde, hasta) {
      const resultado = { unidades: 0, paraYoel: 0, cobrado: 0 };

      Object.values(logs || {}).forEach(log => {
        if (!['venta', 'venta-desde-reserva', 'eliminacion-venta', 'venta-propia', 'eliminacion-venta-propia'].includes(log?.tipo)) return;
        if (!dentroPeriodo(fechaLog(log), desde, hasta)) return;
        const importes = importeVenta(log);
        const signo = ['eliminacion-venta', 'eliminacion-venta-propia'].includes(log.tipo) ? -1 : 1;
        resultado.unidades += signo * importes.cantidad;
        resultado.paraYoel += signo * importes.paraYoel;
        resultado.cobrado += signo * importes.cobrado;
      });

      resultado.unidades = Math.max(0, resultado.unidades);
      resultado.paraYoel = Math.max(0, resultado.paraYoel);
      resultado.cobrado = Math.max(0, resultado.cobrado);
      return resultado;
    }

    function obtenerGastosPeriodo() {
      const desde = document.getElementById('fechaDesde').value;
      const hasta = document.getElementById('fechaHasta').value;

      return Object.entries(gastos || {})
        .map(([id, gasto]) => ({ id, ...(gasto || {}) }))
        .filter(gasto => dentroPeriodo(String(gasto.fecha || ''), desde, hasta));
    }

    function obtenerGastosFiltrados() {
      const categoria = document.getElementById('filtroCategoria').value;
      const texto = document.getElementById('buscarGasto').value.toLowerCase().trim();

      return obtenerGastosPeriodo()
        .filter(gasto => categoria === 'todos' || gasto.categoria === categoria)
        .filter(gasto => !texto || `${gasto.concepto || ''} ${gasto.proveedor || ''} ${gasto.notas || ''}`.toLowerCase().includes(texto))
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || Number(b.creadoEn || 0) - Number(a.creadoEn || 0));
    }

    function renderKpis(gastosFiltrados) {
      const desde = document.getElementById('fechaDesde').value;
      const hasta = document.getElementById('fechaHasta').value;
      const ventas = calcularVentas(desde, hasta);
      const totalGastos = gastosFiltrados.reduce((acc, gasto) => acc + Number(gasto.importe || 0), 0);
      const totalMateriales = gastosFiltrados
        .filter(gasto => gasto.categoria === 'materiales')
        .reduce((acc, gasto) => acc + Number(gasto.importe || 0), 0);
      const resultado = ventas.paraYoel - totalGastos;
      const vendedora = ventas.cobrado - ventas.paraYoel;

      document.getElementById('kpiIngresosYoel').textContent = euro(ventas.paraYoel);
      document.getElementById('kpiUnidades').textContent = `${ventas.unidades} unidad${ventas.unidades === 1 ? '' : 'es'} vendida${ventas.unidades === 1 ? '' : 's'}`;
      document.getElementById('kpiGastos').textContent = euro(totalGastos);
      document.getElementById('kpiGastosCount').textContent = `${gastosFiltrados.length} gasto${gastosFiltrados.length === 1 ? '' : 's'} registrado${gastosFiltrados.length === 1 ? '' : 's'}`;
      document.getElementById('kpiMateriales').textContent = euro(totalMateriales);
      document.getElementById('kpiResultado').textContent = euro(resultado);
      document.getElementById('kpiCobrado').textContent = euro(ventas.cobrado);
      document.getElementById('kpiVendedora').textContent = euro(vendedora);
      document.getElementById('resultadoCard').classList.toggle('negative', resultado < 0);
    }

    function renderCategorias(gastosFiltrados) {
      const wrap = document.getElementById('categoriasResumen');
      const totales = {};
      gastosFiltrados.forEach(gasto => {
        totales[gasto.categoria || 'otros'] = Number(totales[gasto.categoria || 'otros'] || 0) + Number(gasto.importe || 0);
      });
      const items = Object.entries(totales).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...items.map(([, total]) => total));

      if (!items.length) {
        wrap.innerHTML = '<div class="empty-finance compact">Sin gastos en este periodo.</div>';
        return;
      }

      wrap.innerHTML = items.map(([categoria, total]) => `
        <div class="category-row">
          <div class="category-label"><span>${escaparHtml(CATEGORIAS[categoria] || 'Otros')}</span><strong>${euro(total)}</strong></div>
          <div class="category-track"><div style="width:${Math.max(4, (total / max) * 100)}%"></div></div>
        </div>
      `).join('');
    }

    function renderMeses(gastosFiltrados) {
      const wrap = document.getElementById('mesesResumen');
      const desde = document.getElementById('fechaDesde').value;
      const hasta = document.getElementById('fechaHasta').value;
      const meses = {};

      Object.values(logs || {}).forEach(log => {
        if (!['venta', 'venta-desde-reserva', 'eliminacion-venta', 'venta-propia', 'eliminacion-venta-propia'].includes(log?.tipo)) return;
        const fecha = fechaLog(log);
        if (!dentroPeriodo(fecha, desde, hasta)) return;
        const mes = fecha.slice(0, 7);
        const importe = importeVenta(log);
        const signo = ['eliminacion-venta', 'eliminacion-venta-propia'].includes(log.tipo) ? -1 : 1;
        if (!meses[mes]) meses[mes] = { ingresos: 0, gastos: 0 };
        meses[mes].ingresos += signo * importe.paraYoel;
      });

      gastosFiltrados.forEach(gasto => {
        const mes = String(gasto.fecha || '').slice(0, 7);
        if (!meses[mes]) meses[mes] = { ingresos: 0, gastos: 0 };
        meses[mes].gastos += Number(gasto.importe || 0);
      });

      const items = Object.entries(meses).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
      if (!items.length) {
        wrap.innerHTML = '<div class="empty-finance compact">Sin movimientos para comparar.</div>';
        return;
      }

      wrap.innerHTML = items.map(([mes, datos]) => {
        const [anio, numeroMes] = mes.split('-');
        const nombre = new Date(Number(anio), Number(numeroMes) - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const neto = datos.ingresos - datos.gastos;
        return `
          <div class="month-row">
            <strong>${escaparHtml(nombre)}</strong>
            <span class="month-income">Ingresos ${euro(datos.ingresos)}</span>
            <span class="month-expense">Gastos ${euro(datos.gastos)}</span>
            <span class="month-net ${neto < 0 ? 'negative' : ''}">${neto < 0 ? 'Pérdida' : 'Neto'} ${euro(neto)}</span>
          </div>
        `;
      }).join('');
    }

    function renderTabla(gastosFiltrados) {
      const tbody = document.getElementById('tablaGastos');
      const empty = document.getElementById('gastosEmpty');
      const wrap = document.getElementById('gastosTableWrap');

      if (!gastosFiltrados.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        wrap.classList.add('hidden');
        return;
      }

      empty.classList.add('hidden');
      wrap.classList.remove('hidden');
      tbody.innerHTML = gastosFiltrados.map(gasto => `
        <tr>
          <td>${escaparHtml(gasto.fecha || '-')}</td>
          <td><strong>${escaparHtml(gasto.concepto || '')}</strong>${gasto.notas ? `<small>${escaparHtml(gasto.notas)}</small>` : ''}</td>
          <td><span class="category-pill">${escaparHtml(CATEGORIAS[gasto.categoria] || 'Otros')}</span></td>
          <td>${escaparHtml(gasto.proveedor || '-')}</td>
          <td>${escaparHtml(METODOS[gasto.metodoPago] || '-')}</td>
          <td class="expense-amount">${euro(gasto.importe)}</td>
          <td class="expense-actions">
            <button class="secondary" onclick="editarGasto('${gasto.id}')">Editar</button>
            <button class="danger-light" onclick="borrarGasto('${gasto.id}')">Borrar</button>
          </td>
        </tr>
      `).join('');
    }

    window.renderTodo = () => {
      const gastosPeriodo = obtenerGastosPeriodo();
      gastosFiltradosActuales = obtenerGastosFiltrados();
      renderKpis(gastosPeriodo);
      renderCategorias(gastosPeriodo);
      renderMeses(gastosPeriodo);
      renderTabla(gastosFiltradosActuales);
    };

    function limpiarFormulario() {
      editId = null;
      document.getElementById('formTitle').textContent = 'Nuevo gasto';
      document.getElementById('guardarGastoBtn').textContent = 'Guardar gasto';
      document.getElementById('cancelEditBtn').classList.add('hidden');
      document.getElementById('gastoFecha').value = localYmd();
      document.getElementById('gastoCategoria').value = 'materiales';
      document.getElementById('gastoConcepto').value = '';
      document.getElementById('gastoImporte').value = '';
      document.getElementById('gastoProveedor').value = '';
      document.getElementById('gastoMetodo').value = '';
      document.getElementById('gastoNotas').value = '';
    }

    async function guardarMovimiento(tipo, gastoId, concepto, importe, detalles = '') {
      await push(logsRef, {
        timestamp: Date.now(),
        tipo,
        productoId: gastoId,
        productoNombre: concepto,
        cantidad: 0,
        importeGasto: Number(importe || 0),
        usuario: currentUser?.email || '',
        detalles: `${detalles}${detalles ? ' | ' : ''}Importe:€${Number(importe || 0).toFixed(2)}`,
        fecha: new Date().toLocaleString('es-ES')
      });
    }

    window.guardarGasto = async () => {
      const fecha = document.getElementById('gastoFecha').value;
      const categoria = document.getElementById('gastoCategoria').value;
      const concepto = document.getElementById('gastoConcepto').value.trim();
      const importe = Number(document.getElementById('gastoImporte').value);
      const proveedor = document.getElementById('gastoProveedor').value.trim();
      const metodoPago = document.getElementById('gastoMetodo').value;
      const notas = document.getElementById('gastoNotas').value.trim();

      if (!fecha || !concepto || !Number.isFinite(importe) || importe <= 0) {
        return toast('Completa la fecha, el concepto y un importe válido.', 'error');
      }

      const btn = document.getElementById('guardarGastoBtn');
      btn.disabled = true;
      btn.textContent = 'Guardando…';

      try {
        const data = {
          fecha,
          categoria,
          concepto,
          importe: Number(importe.toFixed(2)),
          proveedor,
          metodoPago,
          notas,
          actualizadoEn: Date.now(),
          actualizadoPor: currentUser?.email || ''
        };

        if (editId) {
          const anterior = gastos[editId] || {};
          await update(ref(db, `gastos/${editId}`), data);
          await guardarMovimiento('gasto-editado', editId, concepto, importe, `Importe anterior: ${euro(anterior.importe)} | Nuevo: ${euro(importe)}`);
          toast('Gasto actualizado.', 'success');
        } else {
          data.creadoEn = Date.now();
          data.creadoPor = currentUser?.email || '';
          const nuevo = await push(gastosRef, data);
          await guardarMovimiento('gasto-creado', nuevo.key, concepto, importe, CATEGORIAS[categoria] || categoria);
          toast('Gasto guardado.', 'success');
        }

        limpiarFormulario();
      } catch (error) {
        console.error(error);
        toast('No se pudo guardar el gasto.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = editId ? 'Guardar cambios' : 'Guardar gasto';
      }
    };

    window.editarGasto = id => {
      const gasto = gastos[id];
      if (!gasto) return;
      editId = id;
      document.getElementById('formTitle').textContent = 'Editar gasto';
      document.getElementById('guardarGastoBtn').textContent = 'Guardar cambios';
      document.getElementById('cancelEditBtn').classList.remove('hidden');
      document.getElementById('gastoFecha').value = gasto.fecha || localYmd();
      document.getElementById('gastoCategoria').value = gasto.categoria || 'otros';
      document.getElementById('gastoConcepto').value = gasto.concepto || '';
      document.getElementById('gastoImporte').value = Number(gasto.importe || 0).toFixed(2);
      document.getElementById('gastoProveedor').value = gasto.proveedor || '';
      document.getElementById('gastoMetodo').value = gasto.metodoPago || '';
      document.getElementById('gastoNotas').value = gasto.notas || '';
      document.getElementById('nuevoGastoCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.cancelarEdicion = () => limpiarFormulario();

    window.borrarGasto = id => {
      const gasto = gastos[id];
      if (!gasto || !confirm(`¿Borrar el gasto "${gasto.concepto}" de ${euro(gasto.importe)}?`)) return;

      remove(ref(db, `gastos/${id}`))
        .then(() => guardarMovimiento('gasto-borrado', id, gasto.concepto, gasto.importe, CATEGORIAS[gasto.categoria] || gasto.categoria))
        .then(() => toast('Gasto eliminado.', 'success'))
        .catch(error => {
          console.error(error);
          toast('No se pudo borrar el gasto.', 'error');
        });
    };

    window.focusNuevoGasto = () => {
      document.getElementById('nuevoGastoCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => document.getElementById('gastoConcepto').focus(), 350);
    };

    window.setPeriodo = periodo => {
      const hoy = new Date();
      let desde = '';
      if (periodo === 'mes') desde = localYmd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
      if (periodo === 'anio') desde = `${hoy.getFullYear()}-01-01`;
      document.getElementById('fechaDesde').value = desde;
      document.getElementById('fechaHasta').value = periodo === 'todo' ? '' : localYmd(hoy);
      renderTodo();
    };

    window.exportarGastosCSV = () => {
      if (!gastosFiltradosActuales.length) return toast('No hay gastos para exportar.', 'error');
      const filas = [['Fecha', 'Concepto', 'Categoria', 'Proveedor', 'Forma de pago', 'Importe', 'Notas']];
      gastosFiltradosActuales.forEach(gasto => filas.push([
        gasto.fecha || '',
        gasto.concepto || '',
        CATEGORIAS[gasto.categoria] || gasto.categoria || '',
        gasto.proveedor || '',
        METODOS[gasto.metodoPago] || gasto.metodoPago || '',
        Number(gasto.importe || 0).toFixed(2),
        gasto.notas || ''
      ]));
      const csv = '\uFEFF' + filas.map(fila => fila.map(valor => `"${String(valor).replace(/"/g, '""')}"`).join(';')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `gastos-mundo-azul-${localYmd()}.csv`;
      enlace.click();
      URL.revokeObjectURL(url);
    };

    function toast(mensaje, tipo = 'success') {
      const el = document.getElementById('financeToast');
      el.textContent = mensaje;
      el.className = `finance-toast show ${tipo}`;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
    }

    function iniciarDatos() {
      if (listenersStarted) return;
      listenersStarted = true;
      onValue(gastosRef, snap => { gastos = snap.val() || {}; renderTodo(); });
      onValue(logsRef, snap => { logs = snap.val() || {}; renderTodo(); });
      onValue(productosRef, snap => { productos = snap.val() || {}; renderTodo(); });
    }

    onAuthStateChanged(auth, user => {
      const status = document.getElementById('financeStatus');
      if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
        document.body.classList.remove('auth-nav-visible');
        status.className = 'finance-loading error';
        status.textContent = 'Acceso reservado a administradores. Volviendo al inventario…';
        setTimeout(() => window.location.href = 'index.html', 1800);
        return;
      }

      currentUser = user;
      document.body.classList.add('app-logeada');
      document.body.classList.add('auth-nav-visible');
      status.classList.add('hidden');
      document.getElementById('financeApp').classList.remove('hidden');
      document.getElementById('fechaDesde').value = `${new Date().getFullYear()}-01-01`;
      document.getElementById('fechaHasta').value = localYmd();
      limpiarFormulario();
      iniciarDatos();
    });
})().catch(window.INVENTARIO_BOOT.showBootError);
