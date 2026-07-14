(async function () {
    const [firebaseApp, firebaseDatabase, firebaseAuth] = await window.INVENTARIO_BOOT.loadFirebase();
    const { initializeApp } = firebaseApp;
    const { getDatabase, ref, get, update, push, runTransaction } = firebaseDatabase;
    const { getAuth, onAuthStateChanged } = firebaseAuth;
    const { firebaseConfig, ADMIN_EMAILS } = window.INVENTARIO_CONFIG;

    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    const auth = getAuth(app);
    const productosRef = ref(db, 'productos');
    const productosPublicosRef = ref(db, 'productos_publicos');
    const logsRef = ref(db, 'logs');

    let scanner = null;
    let productoActual = null;
    let currentUser = null;

    function getQueryParam(name){
      const params = new URLSearchParams(window.location.search);
      return params.get(name);
    }

    function setStatus(id, text, kind = 'info') {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = kind;
      el.textContent = text;
    }

    function tieneSesionValida(user){
      return !!user;
    }

    function ocultarFichas(){
      document.getElementById('productoCard').classList.add('hidden');
      document.getElementById('publicCard').classList.add('hidden');
      document.getElementById('publicImagenWrap').innerHTML = '';
      document.getElementById('privadaImagenWrap').innerHTML = '';
    }

function renderImagenPublica(url){
  const wrap = document.getElementById('publicImagenWrap');
  wrap.innerHTML = '';
  if (!url) return;
  wrap.innerHTML = `<img src="${url}" alt="Foto producto" class="foto-producto foto-clickable" onclick="abrirFotoGrande('${url}')">`;
}

function renderImagenPrivada(url){
  const wrap = document.getElementById('privadaImagenWrap');
  wrap.innerHTML = '';
  if (!url) return;
  wrap.innerHTML = `<img src="${url}" alt="Foto producto" class="foto-privada foto-clickable" onclick="abrirFotoGrande('${url}')">`;
}

    function renderPublico(p){
      ocultarFichas();
      document.getElementById('publicCard').classList.remove('hidden');
      renderImagenPublica(p.imagen || '');
      document.getElementById('publicNombre').textContent = p.nombre || '-';
      document.getElementById('publicPrecio').textContent = `€${Number(p.laura || 0).toFixed(2)}`;

      const stock = Number(p.stock || 0);
      const badge = document.getElementById('publicStockBadge');
      badge.textContent = `Stock disponible: ${stock}`;

      if (stock <= 0) {
        badge.className = 'public-stock stock-out';
      } else if (stock <= 5) {
        badge.className = 'public-stock stock-low';
      } else {
        badge.className = 'public-stock stock-ok';
      }
    }

 async function pintarProducto(p, origen = 'consulta') {
  productoActual = p;
  ocultarFichas();

  if (!tieneSesionValida(currentUser)) {
    renderPublico(p);
    setStatus('scanStatus', `Producto detectado: ${p.nombre}`, 'success');
    return;
  }

  document.getElementById('productoCard').classList.remove('hidden');
  renderImagenPrivada(p.imagen || '');
  document.getElementById('prodNombre').textContent = p.nombre || '-';
  document.getElementById('prodStock').textContent = Number(p.stock || 0);
  document.getElementById('prodBea').textContent = `€${Number(p.yoel ?? p.bea ?? 0).toFixed(2)}`;
  document.getElementById('prodLaura').textContent = `€${Number(p.laura || 0).toFixed(2)}`;
  document.getElementById('cantidad').value = 1;
  setStatus('accionStatus', 'Producto listo para vender o reservar.', 'info');

  if (['qr', 'manual', 'url'].includes(origen)) {
    try {
      await guardarLog(
        'consulta-producto',
        p.id,
        p.nombre,
        0,
        currentUser.email,
        `Consulta desde scanner (${origen})`
      );
    } catch (e) {
      console.error('Error guardando log de consulta', e);
    }
  }
}

    async function obtenerIP(){
      try{
        const cache = sessionStorage.getItem('inventario_ip');
        if(cache) return cache;
        const r = await fetch('https://api.ipify.org?format=json');
        const data = await r.json();
        const ip = data.ip || 'IP desconocida';
        sessionStorage.setItem('inventario_ip', ip);
        return ip;
      }catch{
        return 'IP desconocida';
      }
    }

    function obtenerDispositivo(){
      try{
        return navigator.userAgent || 'Dispositivo desconocido';
      }catch{
        return 'Dispositivo desconocido';
      }
    }

    async function guardarLog(tipo, productoId, productoNombre, cantidad, usuario, detalles = '', extras = {}) {
      const ip = await obtenerIP();
      await push(logsRef, {
        timestamp: Date.now(),
        tipo,
        productoId,
        productoNombre: productoNombre || '',
        cantidad: Number(cantidad || 0),
        usuario: usuario || '',
        detalles,
        ip,
        dispositivo: obtenerDispositivo(),
        fecha: new Date().toLocaleString('es-ES'),
        ...extras
      });
    }

    async function buscarProductoPrivadoPorContenidoQR(contenido) {
      const texto = String(contenido || '').trim();
      const snap = await get(productosRef);
      const productos = snap.val() || {};

      if (productos[texto]) return { id: texto, ...productos[texto] };

      try {
        const url = new URL(texto);
        const scanId = url.searchParams.get('scanId') || url.searchParams.get('editId');
        if (scanId && productos[scanId]) return { id: scanId, ...productos[scanId] };
      } catch {}

      if (texto.startsWith('PROD:')) {
        const id = texto.replace('PROD:', '').trim();
        if (productos[id]) return { id, ...productos[id] };
      }

      const lower = texto.toLowerCase();
      for (const [id, p] of Object.entries(productos)) {
        if (String(p?.nombre || '').toLowerCase() === lower) {
          return { id, ...p };
        }
      }

      return null;
    }

    async function buscarProductoPublicoPorContenidoQR(contenido) {
      const texto = String(contenido || '').trim();
      const snap = await get(productosPublicosRef);
      const productos = snap.val() || {};

      if (productos[texto]) return { id: texto, ...productos[texto] };

      try {
        const url = new URL(texto);
        const scanId = url.searchParams.get('scanId') || url.searchParams.get('editId');
        if (scanId && productos[scanId]) return { id: scanId, ...productos[scanId] };
      } catch {}

      if (texto.startsWith('PROD:')) {
        const id = texto.replace('PROD:', '').trim();
        if (productos[id]) return { id, ...productos[id] };
      }

      const lower = texto.toLowerCase();
      for (const [id, p] of Object.entries(productos)) {
        if (String(p?.nombre || '').toLowerCase() === lower) {
          return { id, ...p };
        }
      }

      return null;
    }

    async function buscarProductoPorContenidoQR(contenido) {
      if (tieneSesionValida(currentUser)) {
        return await buscarProductoPrivadoPorContenidoQR(contenido);
      }
      return await buscarProductoPublicoPorContenidoQR(contenido);
    }

  async function procesarScan(texto) {
  await detenerEscaner();
  const producto = await buscarProductoPorContenidoQR(texto);
  if (!producto) {
    ocultarFichas();
    setStatus('scanStatus', `No encontré producto para este QR: ${texto}`, 'error');
    return;
  }
  await pintarProducto(producto, 'qr');
  document.getElementById('scanCard').classList.add('hidden');
  setStatus('scanStatus', `Producto detectado: ${producto.nombre}`, 'success');
}

    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      document.body.classList.toggle('auth-nav-visible', !!user);
      document.body.classList.toggle('nav-user-limitado', !user || !ADMIN_EMAILS.includes(user.email || ''));

      const status = document.getElementById('scanStatus');
      if (status) {
        if (user) {
          status.className = 'info';
          status.textContent = 'Sesión detectada. Ya puedes escanear, vender o reservar.';
        } else {
          status.className = 'info';
          status.textContent = 'Modo consulta: puedes ver nombre, precio de venta y stock.';
        }
      }

           const scanId = getQueryParam('scanId');
      if (scanId) {
        const producto = await buscarProductoPorContenidoQR(scanId);

        if (!producto) {
          document.getElementById('scanCard').classList.remove('hidden');
          setStatus('scanStatus', `Producto no encontrado para scanId: ${scanId}`, 'error');
          ocultarFichas();
          return;
        }

        await pintarProducto(producto, 'url');
      }
    });

    window.iniciarEscaner = async () => {
      document.getElementById('scanCard').classList.remove('hidden');

      if (!window.Html5Qrcode) {
        setStatus('scanStatus', 'No se cargó la librería de escaneo.', 'error');
        return;
      }

      try {
        scanner = new Html5Qrcode('reader');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 220 },
          async (decodedText) => {
            await procesarScan(decodedText);
          },
          () => {}
        );
        setStatus('scanStatus', 'Cámara activa. Apunta al QR del producto.', 'info');
      } catch (e) {
        setStatus('scanStatus', 'No pude abrir la cámara. Comprueba permisos y HTTPS.', 'error');
      }
    };

    window.detenerEscaner = async () => {
      try {
        if (scanner) {
          await scanner.stop();
          await scanner.clear();
          scanner = null;
        }
      } catch {}
    };

 window.buscarManual = async () => {
  const texto = prompt('Escribe ID, URL QR o nombre exacto del producto');
  if (!texto) return;
  const producto = await buscarProductoPorContenidoQR(texto);
  if (!producto) {
    document.getElementById('scanCard').classList.remove('hidden');
    setStatus('scanStatus', 'Producto no encontrado.', 'error');
    ocultarFichas();
    return;
  }
  await detenerEscaner();
  await pintarProducto(producto, 'manual');
  document.getElementById('scanCard').classList.add('hidden');
  setStatus('scanStatus', `Producto encontrado manualmente: ${producto.nombre}`, 'success');
};

    window.limpiarProducto = () => {
      productoActual = null;
      ocultarFichas();
      const accionStatus = document.getElementById('accionStatus');
      if (accionStatus) {
        accionStatus.className = '';
        accionStatus.textContent = '';
      }
    };
	
	window.abrirFotoGrande = (src) => {
  if (!src) return;
  const modal = document.getElementById('fotoModal');
  const img = document.getElementById('fotoModalImg');
  if (!modal || !img) return;

  img.src = src;
  modal.classList.remove('hidden');
};

window.cerrarFotoGrande = (event) => {
  const modal = document.getElementById('fotoModal');
  const img = document.getElementById('fotoModalImg');
  if (!modal || !img) return;

  if (event.target.id === 'fotoModal' || event.target === modal) {
    modal.classList.add('hidden');
    img.src = '';
  }
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('fotoModal');
    const img = document.getElementById('fotoModalImg');
    if (modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
      if (img) img.src = '';
    }
  }
});

    async function recargarProductoActual() {
  if (!productoActual?.id) return null;
  const snap = await get(ref(db, `productos/${productoActual.id}`));
  if (!snap.exists()) return null;
  const nuevo = { id: productoActual.id, ...snap.val() };
  productoActual = nuevo;
  await pintarProducto(nuevo, 'recarga');
  return nuevo;
}

    window.venderRapido = async () => {
      if (!productoActual || !currentUser) return;
      const cantidad = Math.max(1, Number(document.getElementById('cantidad').value || 1));
      const p = await recargarProductoActual();
      if (!p) return setStatus('accionStatus', 'El producto ya no existe.', 'error');

      const resultado = await runTransaction(ref(db, `productos/${p.id}`), (actual) => {
        if (!actual || Number(actual.stock || 0) < cantidad) return;
        const nuevoStockTx = Number(actual.stock || 0) - cantidad;
        return {
          ...actual,
          stock: nuevoStockTx,
          vendidos: Number(actual.vendidos || 0) + cantidad,
          vyoel: Number(actual.vyoel || actual.vBea || 0) + Number(actual.yoel ?? actual.bea ?? 0) * cantidad,
          vLaura: Number(actual.vLaura || 0) + Number(actual.laura || 0) * cantidad,
          ...(nuevoStockTx === 0 ? { emailAgotadoEnviado: true } : {})
        };
      });

      if (!resultado.committed) return setStatus('accionStatus', 'Stock insuficiente.', 'error');
      const actualizado = { id: p.id, ...(resultado.snapshot.val() || {}) };
      productoActual = actualizado;
      const nuevoStock = Number(actualizado.stock || 0);
      const importeYoel = Number(actualizado.yoel ?? actualizado.bea ?? 0);

      await update(ref(db, `productos_publicos/${p.id}`), {
        nombre: actualizado.nombre || '',
        laura: Number(actualizado.laura || 0),
        stock: nuevoStock,
        imagen: actualizado.imagen || ''
      });

      await guardarLog(
        'venta',
        p.id,
        p.nombre,
        cantidad,
        currentUser.email,
        `yoel:€${importeYoel.toFixed(2)} Laura:€${Number(actualizado.laura || 0).toFixed(2)} | Venta rápida QR`,
        {
          precioyoel: importeYoel,
          precioLaura: Number(actualizado.laura || 0),
          totalyoel: importeYoel * cantidad,
          totalLaura: Number(actualizado.laura || 0) * cantidad
        }
      );

      await recargarProductoActual();
      setStatus('accionStatus', `✅ Vendidas ${cantidad} unidades. Stock restante: ${nuevoStock}`, 'success');
    };

    window.reservarRapido = async () => {
      if (!productoActual || !currentUser) return;
      const cantidad = Math.max(1, Number(document.getElementById('cantidad').value || 1));
      const p = await recargarProductoActual();
      if (!p) return setStatus('accionStatus', 'El producto ya no existe.', 'error');

      const resultado = await runTransaction(ref(db, `productos/${p.id}`), (actual) => {
        if (!actual || Number(actual.stock || 0) < cantidad) return;
        return {
          ...actual,
          stock: Number(actual.stock || 0) - cantidad,
          reservados: Number(actual.reservados || 0) + cantidad
        };
      });

      if (!resultado.committed) return setStatus('accionStatus', 'Stock insuficiente.', 'error');
      const actualizado = { id: p.id, ...(resultado.snapshot.val() || {}) };
      productoActual = actualizado;
      const nuevoStock = Number(actualizado.stock || 0);

      await update(ref(db, `productos_publicos/${p.id}`), {
        nombre: actualizado.nombre || '',
        laura: Number(actualizado.laura || 0),
        stock: nuevoStock,
        imagen: actualizado.imagen || ''
      });

      await guardarLog('reserva', p.id, p.nombre, cantidad, currentUser.email, 'Reserva rápida QR');
      await recargarProductoActual();
      setStatus('accionStatus', `✅ Reservadas ${cantidad} unidades. Stock restante: ${nuevoStock}`, 'success');
    };
})().catch(window.INVENTARIO_BOOT.showBootError);
