(async function () {
  const [firebaseApp, firebaseDatabase, firebaseAuth] = await window.INVENTARIO_BOOT.loadFirebase();
  const { initializeApp } = firebaseApp;
  const { getDatabase, ref, onValue, push, update, runTransaction } = firebaseDatabase;
  const { getAuth, onAuthStateChanged } = firebaseAuth;
  const { firebaseConfig, ADMIN_EMAILS } = window.INVENTARIO_CONFIG;

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const auth = getAuth(app);
  const productosRef = ref(db, 'productos');
  const logsRef = ref(db, 'logs');

  let productos = {};
  let ventas = [];
  let currentUser = null;
  let listenersStarted = false;

  const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const metodos = { efectivo: 'Efectivo', bizum: 'Bizum', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' };

  function localYmd(date = new Date()) {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  function normalizar(value = '') {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function timestampFecha(value) {
    const today = localYmd();
    const date = new Date(`${value}T12:00:00`);
    if (value === today) {
      const now = new Date();
      date.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    }
    return date.getTime();
  }

  function fechaLog(log) {
    return localYmd(Number(log?.timestamp || Date.now()));
  }

  function toast(message, type = 'success') {
    const element = document.getElementById('ventasPropiasToast');
    element.textContent = message;
    element.className = `operations-toast show ${type}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 3200);
  }

  function productoSeleccionado() {
    return productos[document.getElementById('ventaPropiaProducto').value] || null;
  }

  function ventaFueraInventarioActiva() {
    return document.getElementById('ventaPropiaSinInventario').checked;
  }

  window.actualizarModoVentaPropia = function () {
    const fueraInventario = ventaFueraInventarioActiva();
    document.getElementById('ventaPropiaInventarioPicker').classList.toggle('hidden', fueraInventario);
    document.getElementById('ventaPropiaStockInfo').classList.toggle('hidden', fueraInventario);
    document.getElementById('ventaPropiaNombreLibreField').classList.toggle('hidden', !fueraInventario);
    const button = document.getElementById('guardarVentaPropiaBtn');
    button.textContent = fueraInventario ? 'Registrar venta sin modificar stock' : 'Registrar venta y descontar stock';
    if (fueraInventario) {
      setTimeout(() => document.getElementById('ventaPropiaNombreLibre').focus(), 0);
    }
  };

  function importeTotalVentaPropia(sale) {
    return Math.max(0, Number(sale?.totalVentaPropia ?? sale?.totalyoel ?? sale?.totalLaura ?? 0));
  }

  function actualizarProductoSeleccionado(actualizarPrecio = false) {
    const product = productoSeleccionado();
    const info = document.getElementById('ventaPropiaStockInfo');
    if (!product) {
      info.textContent = 'Selecciona un producto para consultar el stock.';
      return;
    }
    const stock = Math.max(0, Number(product.stock || 0));
    info.textContent = `${product.nombre || 'Producto'} seleccionado · ${stock} unidad${stock === 1 ? '' : 'es'} disponible${stock === 1 ? '' : 's'}`;
    document.getElementById('ventaPropiaCantidad').max = Math.max(1, stock);
    if (actualizarPrecio) document.getElementById('ventaPropiaPrecio').value = Number(product.yoel || 0).toFixed(2);
    actualizarTotal();
  }

  function actualizarTotal() {
    const quantity = Math.max(0, Number(document.getElementById('ventaPropiaCantidad').value || 0));
    const unitPrice = Math.max(0, Number(document.getElementById('ventaPropiaPrecio').value || 0));
    document.getElementById('ventaPropiaTotal').textContent = money.format(quantity * unitPrice);
  }

  function renderProductos() {
    const selectedInput = document.getElementById('ventaPropiaProducto');
    const selected = selectedInput.value;
    const search = normalizar(document.getElementById('buscarProductoVentaPropia').value);
    if (selected && !productos[selected]) selectedInput.value = '';

    const entries = Object.entries(productos)
      .filter(([, product]) => String(product?.nombre || '').trim())
      .filter(([, product]) => !search || normalizar(product.nombre).includes(search))
      .sort((a, b) => String(a[1].nombre).localeCompare(String(b[1].nombre), 'es', { sensitivity: 'base' }));

    const cards = entries.map(([id, product]) => {
      const stock = Math.max(0, Number(product.stock || 0));
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `product-choice${id === selectedInput.value ? ' selected' : ''}${stock <= 0 ? ' out-of-stock' : ''}`;
      card.disabled = stock <= 0;
      card.setAttribute('aria-pressed', id === selectedInput.value ? 'true' : 'false');
      card.addEventListener('click', () => {
        selectedInput.value = id;
        actualizarProductoSeleccionado(true);
        renderProductos();
      });

      const imageWrap = document.createElement('span');
      imageWrap.className = 'product-choice-image';
      const fallback = document.createElement('span');
      fallback.className = 'product-choice-fallback';
      fallback.textContent = String(product.nombre || '?').trim().charAt(0).toUpperCase() || '?';
      imageWrap.appendChild(fallback);
      if (product.imagen) {
        const image = document.createElement('img');
        image.src = product.imagen;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('load', () => fallback.classList.add('hidden'));
        image.addEventListener('error', () => image.remove());
        imageWrap.appendChild(image);
      }

      const info = document.createElement('span');
      info.className = 'product-choice-info';
      const name = document.createElement('strong');
      name.textContent = product.nombre;
      const meta = document.createElement('span');
      meta.textContent = `Tu precio: ${money.format(Number(product.yoel || 0))}`;
      info.append(name, meta);

      const availability = document.createElement('span');
      availability.className = `product-choice-stock ${stock <= 0 ? 'out' : stock <= 3 ? 'low' : 'available'}`;
      availability.textContent = stock <= 0 ? 'Agotado' : `${stock} en stock`;
      card.append(imageWrap, info, availability);
      return card;
    });

    document.getElementById('ventaPropiaProductosGrid').replaceChildren(...cards);
    document.getElementById('ventaPropiaProductosEmpty').classList.toggle('hidden', cards.length > 0);
    actualizarProductoSeleccionado();
  }

  function createProductCell(sale) {
    const cell = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'direct-sale-product-cell';
    const imageWrap = document.createElement('span');
    imageWrap.className = 'direct-sale-history-image';
    const fallback = document.createElement('span');
    fallback.textContent = String(sale.productoNombre || '?').trim().charAt(0).toUpperCase() || '?';
    imageWrap.appendChild(fallback);
    const imageUrl = sale.productoImagen || productos[sale.productoId]?.imagen || '';
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('load', () => fallback.classList.add('hidden'));
      image.addEventListener('error', () => image.remove());
      imageWrap.appendChild(image);
    }
    const name = document.createElement('span');
    name.textContent = sale.productoNombre || 'Producto';
    wrap.append(imageWrap, name);
    if (sale.ventaSinInventario) {
      const badge = document.createElement('span');
      badge.className = 'direct-sale-custom-badge';
      badge.textContent = 'Fuera de inventario';
      wrap.appendChild(badge);
    }
    cell.appendChild(wrap);
    return cell;
  }

  function ventasFiltradas() {
    const search = normalizar(document.getElementById('buscarVentaPropia').value);
    const from = document.getElementById('ventasPropiasDesde').value;
    const to = document.getElementById('ventasPropiasHasta').value;
    return ventas.filter(sale => {
      const date = fechaLog(sale);
      return (!search || normalizar(sale.productoNombre).includes(search)) && (!from || date >= from) && (!to || date <= to);
    });
  }

  function createCell(text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function renderVentas() {
    const list = ventasFiltradas();
    const body = document.getElementById('ventasPropiasTabla');
    const rows = list.map(sale => {
      const row = document.createElement('tr');
      if (sale.anulada) row.className = 'direct-sale-cancelled';
      const date = new Date(Number(sale.timestamp || Date.now())).toLocaleDateString('es-ES');
      const quantity = Math.max(0, Number(sale.cantidad || 0));
      const total = importeTotalVentaPropia(sale);
      const unitPrice = Number(sale.precioVentaPropia ?? (quantity ? total / quantity : 0));
      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `direct-sale-status ${sale.anulada ? 'cancelled' : 'active'}`;
      badge.textContent = sale.anulada ? 'Corregida' : 'Registrada';
      statusCell.appendChild(badge);
      const action = document.createElement('td');
      if (!sale.anulada) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'material-outlined direct-sale-undo';
        button.textContent = 'Corregir';
        button.addEventListener('click', () => window.corregirVentaPropia(sale.id, button));
        action.appendChild(button);
      } else {
        action.textContent = '—';
      }
      row.append(
        createCell(date),
        createProductCell(sale),
        createCell(quantity),
        createCell(money.format(unitPrice)),
        createCell(money.format(total), 'direct-sale-money'),
        createCell(metodos[sale.metodoCobro] || sale.metodoCobro || '—'),
        statusCell,
        action
      );
      return row;
    });
    body.replaceChildren(...rows);
    document.getElementById('ventasPropiasTableWrap').classList.toggle('hidden', list.length === 0);
    document.getElementById('ventasPropiasEmpty').classList.toggle('hidden', list.length > 0);

    const active = list.filter(sale => !sale.anulada);
    document.getElementById('ventasPropiasIngresos').textContent = money.format(active.reduce((sum, sale) => sum + importeTotalVentaPropia(sale), 0));
    document.getElementById('ventasPropiasUnidades').textContent = active.reduce((sum, sale) => sum + Number(sale.cantidad || 0), 0);
    document.getElementById('ventasPropiasOperaciones').textContent = active.length;
  }

  async function syncPublicStock(productId, stock) {
    try {
      await update(ref(db, `productos_publicos/${productId}`), { stock: Math.max(0, Number(stock || 0)) });
    } catch (error) {
      console.warn('No se pudo sincronizar el stock público:', error);
    }
  }

  window.registrarVentaPropia = async function () {
    const fueraInventario = ventaFueraInventarioActiva();
    const productId = document.getElementById('ventaPropiaProducto').value;
    const product = productos[productId];
    const customName = document.getElementById('ventaPropiaNombreLibre').value.trim();
    const quantity = Number(document.getElementById('ventaPropiaCantidad').value);
    const unitPrice = Number(document.getElementById('ventaPropiaPrecio').value);
    const dateValue = document.getElementById('ventaPropiaFecha').value;
    const paymentMethod = document.getElementById('ventaPropiaMetodo').value;
    const notes = document.getElementById('ventaPropiaNotas').value.trim();
    if (fueraInventario && !customName) return toast('Escribe el nombre o concepto de la venta.', 'error');
    if (!fueraInventario && !product) return toast('Selecciona un producto.', 'error');
    if (!Number.isInteger(quantity) || quantity <= 0) return toast('La cantidad no es válida.', 'error');
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return toast('El precio no es válido.', 'error');
    if (!dateValue) return toast('Selecciona la fecha de la venta.', 'error');

    const button = document.getElementById('guardarVentaPropiaBtn');
    button.disabled = true;
    button.textContent = 'Registrando…';
    try {
      let updatedProduct = null;
      if (!fueraInventario) {
        const result = await runTransaction(ref(db, `productos/${productId}`), current => {
          if (!current || Number(current.stock || 0) < quantity) return;
          return { ...current, stock: Number(current.stock || 0) - quantity };
        });
        if (!result.committed) throw new Error('No hay stock suficiente para registrar esta venta.');

        updatedProduct = result.snapshot.val() || {};
        productos[productId] = updatedProduct;
        await syncPublicStock(productId, updatedProduct.stock);
      }

      const timestamp = timestampFecha(dateValue);
      const total = quantity * unitPrice;
      await push(logsRef, {
        timestamp,
        fecha: new Date(timestamp).toLocaleString('es-ES'),
        tipo: 'venta-propia',
        productoId: fueraInventario ? '' : productId,
        productoNombre: fueraInventario ? customName : (product.nombre || 'Producto'),
        productoImagen: fueraInventario ? '' : (product.imagen || ''),
        cantidad: quantity,
        precioVentaPropia: unitPrice,
        precioyoel: unitPrice,
        precioBaseProducto: fueraInventario ? 0 : Number(product.yoel || 0),
        totalVentaPropia: total,
        totalyoel: total,
        totalCobrado: total,
        metodoCobro: paymentMethod,
        ventaSinInventario: fueraInventario,
        porEncargo: fueraInventario,
        stockModificado: !fueraInventario,
        usuario: currentUser?.email || '',
        detalles: notes || `${fueraInventario ? 'Venta propia por encargo fuera de inventario' : 'Venta propia'} · ${metodos[paymentMethod] || paymentMethod}`
      });

      document.getElementById('ventaPropiaCantidad').value = 1;
      document.getElementById('ventaPropiaNotas').value = '';
      document.getElementById('ventaPropiaNombreLibre').value = '';
      document.getElementById('ventaPropiaSinInventario').checked = false;
      actualizarModoVentaPropia();
      renderProductos();
      actualizarTotal();
      toast(fueraInventario
        ? 'Venta por encargo registrada. El inventario no se ha modificado.'
        : `Venta registrada. Stock restante: ${Number(updatedProduct.stock || 0)}.`);
    } catch (error) {
      console.error(error);
      toast(error.message || 'No se pudo registrar la venta.', 'error');
    } finally {
      button.disabled = false;
      actualizarModoVentaPropia();
    }
  };

  window.corregirVentaPropia = async function (saleId, button) {
    const sale = ventas.find(item => item.id === saleId);
    if (!sale || sale.anulada) return;
    const fueraInventario = sale.ventaSinInventario === true || !sale.productoId;
    const correctionEffect = fueraInventario
      ? 'Se anulará el ingreso. El stock no se modificará.'
      : 'El stock volverá a sumarse.';
    if (!confirm(`¿Corregir la venta de ${sale.cantidad} unidad(es) de "${sale.productoNombre}"?\n\n${correctionEffect}`)) return;
    sale.anulada = true;
    button.disabled = true;
    try {
      if (!fueraInventario) {
        const result = await runTransaction(ref(db, `productos/${sale.productoId}`), current => {
          if (!current) return;
          return { ...current, stock: Number(current.stock || 0) + Number(sale.cantidad || 0), emailAgotadoEnviado: false };
        });
        if (!result.committed) throw new Error('El producto ya no existe.');
        const updatedProduct = result.snapshot.val() || {};
        productos[sale.productoId] = updatedProduct;
        await syncPublicStock(sale.productoId, updatedProduct.stock);
      }

      const correctionRef = push(logsRef);
      const total = importeTotalVentaPropia(sale);
      const changes = {};
      changes[`logs/${saleId}/anulada`] = true;
      changes[`logs/${saleId}/anuladaEn`] = Date.now();
      changes[`logs/${saleId}/anuladaPor`] = currentUser?.email || '';
      changes[`logs/${correctionRef.key}`] = {
        timestamp: Date.now(),
        fecha: new Date().toLocaleString('es-ES'),
        tipo: 'eliminacion-venta-propia',
        ventaOriginalId: saleId,
        productoId: sale.productoId,
        productoNombre: sale.productoNombre,
        productoImagen: sale.productoImagen || productos[sale.productoId]?.imagen || '',
        cantidad: Number(sale.cantidad || 0),
        precioVentaPropia: Number(sale.precioVentaPropia || 0),
        precioyoel: Number(sale.precioVentaPropia || (Number(sale.cantidad || 0) ? total / Number(sale.cantidad || 0) : 0)),
        totalVentaPropia: total,
        totalyoel: total,
        totalCobrado: total,
        ventaSinInventario: fueraInventario,
        stockModificado: !fueraInventario,
        usuario: currentUser?.email || '',
        detalles: fueraInventario
          ? 'Corrección de venta propia fuera de inventario; ingreso anulado sin modificar stock'
          : 'Corrección de venta propia; stock devuelto'
      };
      await update(ref(db), changes);
      renderProductos();
      renderVentas();
      toast(fueraInventario
        ? 'Venta corregida. El ingreso se ha anulado sin modificar el stock.'
        : 'Venta corregida y stock restaurado.');
    } catch (error) {
      sale.anulada = false;
      button.disabled = false;
      console.error(error);
      toast(error.message || 'No se pudo corregir la venta.', 'error');
    }
  };

  window.limpiarFiltrosVentasPropias = function () {
    document.getElementById('buscarVentaPropia').value = '';
    document.getElementById('ventasPropiasDesde').value = `${new Date().getFullYear()}-01-01`;
    document.getElementById('ventasPropiasHasta').value = localYmd();
    renderVentas();
  };

  function startListeners() {
    if (listenersStarted) return;
    listenersStarted = true;
    onValue(productosRef, snapshot => {
      productos = snapshot.val() || {};
      renderProductos();
    });
    onValue(logsRef, snapshot => {
      ventas = Object.entries(snapshot.val() || {})
        .filter(([, log]) => log?.tipo === 'venta-propia')
        .map(([id, log]) => ({ id, ...(log || {}) }))
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
      renderVentas();
    });
  }

  document.getElementById('buscarProductoVentaPropia').addEventListener('input', renderProductos);
  document.getElementById('ventaPropiaCantidad').addEventListener('input', actualizarTotal);
  document.getElementById('ventaPropiaPrecio').addEventListener('input', actualizarTotal);
  ['buscarVentaPropia', 'ventasPropiasDesde', 'ventasPropiasHasta'].forEach(id => {
    document.getElementById(id).addEventListener(id === 'buscarVentaPropia' ? 'input' : 'change', renderVentas);
  });

  document.getElementById('ventaPropiaFecha').value = localYmd();
  document.getElementById('ventasPropiasDesde').value = `${new Date().getFullYear()}-01-01`;
  document.getElementById('ventasPropiasHasta').value = localYmd();
  actualizarTotal();
  actualizarModoVentaPropia();

  onAuthStateChanged(auth, user => {
    const status = document.getElementById('ventasPropiasStatus');
    if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
      document.body.classList.remove('auth-nav-visible');
      status.className = 'page-status error';
      status.textContent = 'Comprobando sesión…';
      window.INVENTARIO_BOOT.redirectToLogin();
      return;
    }
    currentUser = user;
    document.body.classList.add('es-admin');
    document.body.classList.add('auth-nav-visible');
    status.classList.add('hidden');
    document.getElementById('ventasPropiasApp').classList.remove('hidden');
    startListeners();
  });
})().catch(window.INVENTARIO_BOOT.showBootError);
