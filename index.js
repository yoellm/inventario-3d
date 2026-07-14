(async function () {
const [firebaseApp, firebaseDatabase, firebaseAuth, firebaseStorage] = await window.INVENTARIO_BOOT.loadFirebase();
const { initializeApp } = firebaseApp;
const { getDatabase, ref, get, onValue, update, remove, push, set, runTransaction } = firebaseDatabase;
const { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } = firebaseAuth;
const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = firebaseStorage;
const { firebaseConfig, ADMIN_EMAILS, USER_EMAILS } = window.INVENTARIO_CONFIG;

  // Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
await setPersistence(auth, browserLocalPersistence).catch(error => {
  console.warn('No se pudo guardar la sesión en este navegador:', error);
});
const storage = getStorage(app);
document.documentElement.dataset.inventarioJs = 'ready';
const productosRef = ref(db, "productos");
const logsRef = ref(db, "logs");
const backupRef = ref(db, "backup/ultimo");
const liquidacionesRef = ref(db, "liquidaciones");
const gastosRef = ref(db, "gastos");

let productos = {};
let totalesGlobales = { yoel: 0, laura: 0, vendidos: 0, reservados: 0 };
let editId = null;
let ocultosIndexCount = 0;
let currentUser = null;
let userRole = null;
let loginLogHecho = false;
let ultimoBackup = null;
let productosVisiblesCount = 0;
let stockVisibleTotal = 0;
let renderPendiente = false;
let buscarTimeout = null;
let dataListenerIniciado = false;
let emailInicializado = false;
let proxUpdateTimers = {};
let emailEnviadoReciente = {};
let ultimoQRTexto = '';
let ultimoQRNombre = '';
let ultimaQRImagen = '';
let productoModalActualId = null;
let liquidaciones = {};
let liquidacionesListenerIniciado = false;

const EMAILJS_CONFIG = {
  service: 'service_s97v5kt',
  template: 'template_b10obbg',
  publicKey: '6UIB6irPVv61It5pA'
};
function avisarAppUsuario(email = '') {
  try {
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'auth',
        email: String(email || '').trim().toLowerCase()
      }));
    }
  } catch (error) {
    console.log('No se pudo avisar a la app:', error);
  }
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function construirProductoPublico(producto) {
  return {
    nombre: producto?.nombre || '',
    laura: Number(producto?.laura || 0),
    stock: Number(producto?.stock || 0),
    imagen: producto?.imagen || '',
    porEncargo: producto?.porEncargo === true
  };
}

async function syncProductoPublico(id, producto) {
  if (!id) return;
  await set(ref(db, 'productos_publicos/' + id), construirProductoPublico(producto));
}

async function syncTodosProductosPublicosDesdeProductos(productosObj) {
  const updates = {};
  Object.entries(productosObj || {}).forEach(([id, producto]) => {
    updates['productos_publicos/' + id + '/nombre'] = producto?.nombre || '';
    updates['productos_publicos/' + id + '/laura'] = Number(producto?.laura || 0);
    updates['productos_publicos/' + id + '/stock'] = Number(producto?.stock || 0);
    updates['productos_publicos/' + id + '/imagen'] = producto?.imagen || '';
    updates['productos_publicos/' + id + '/porEncargo'] = producto?.porEncargo === true;
  });
  await update(ref(db), updates);
}

function fechaLocalNovedad(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function registrarNovedadStock(id, producto, cantidad, stockAnterior, stockTotal) {
  const unidades = Math.max(0, Number(cantidad || 0));
  if (!id || unidades <= 0) return;
  try {
    const timestamp = Date.now();
    const novedadRef = push(ref(db, `productos/${id}/historialNovedades`));
    const data = {
      productoId: id,
      productoNombre: producto?.nombre || 'Producto',
      imagen: producto?.imagen || '',
      cantidadAnadida: unidades,
      stockAnterior: Math.max(0, Number(stockAnterior || 0)),
      stockTotal: Math.max(0, Number(stockTotal || 0)),
      timestamp,
      fechaDia: fechaLocalNovedad(timestamp),
      usuario: currentUser?.email || ''
    };
    await set(novedadRef, data);
    if (productos[id]) {
      productos[id].historialNovedades = productos[id].historialNovedades || {};
      productos[id].historialNovedades[novedadRef.key] = data;
    }
  } catch (error) {
    console.warn('El stock se actualizó, pero no se pudo registrar la novedad:', error);
  }
}

function estaEnAppMovil() {
  return !!(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function');
}
function escaparHtml(texto = '') {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.mostrarCargaNativa = (title = 'Preparando archivo...', text = 'Espera un momento', percent = 8) => {
  const overlay = document.getElementById('nativeLoadingOverlay');
  const titleEl = document.getElementById('nativeLoadingTitle');
  const textEl = document.getElementById('nativeLoadingText');
  const barEl = document.getElementById('nativeLoadingBar');
  const percentEl = document.getElementById('nativeLoadingPercent');

  if (!overlay || !titleEl || !textEl || !barEl || !percentEl) return;

  overlay.style.display = 'flex';
  titleEl.textContent = title;
  textEl.textContent = text;

  const seguro = Math.max(0, Math.min(100, Number(percent || 0)));
  barEl.style.width = `${seguro}%`;
  percentEl.textContent = `${Math.round(seguro)}%`;
};

window.actualizarCargaNativa = ({ title, text, percent } = {}) => {
  const titleEl = document.getElementById('nativeLoadingTitle');
  const textEl = document.getElementById('nativeLoadingText');
  const barEl = document.getElementById('nativeLoadingBar');
  const percentEl = document.getElementById('nativeLoadingPercent');

  if (titleEl && title !== undefined) titleEl.textContent = title;
  if (textEl && text !== undefined) textEl.textContent = text;

  if (percent !== undefined && barEl && percentEl) {
    const seguro = Math.max(0, Math.min(100, Number(percent || 0)));
    barEl.style.width = `${seguro}%`;
    percentEl.textContent = `${Math.round(seguro)}%`;
  }
};

window.ocultarCargaNativa = () => {
  const overlay = document.getElementById('nativeLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
};

window.recibirEstadoNativo = (payload) => {
  try {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!data || data.type !== 'NATIVE_PROGRESS') return;

    if (data.action === 'show') {
      mostrarCargaNativa(data.title, data.text, data.percent);
      return;
    }

    if (data.action === 'update') {
      actualizarCargaNativa(data);
      return;
    }

    if (data.action === 'hide') {
      ocultarCargaNativa();
      return;
    }
  } catch (e) {
    console.log('Error progreso nativo:', e);
  }
};

function cargarImagenEnObjeto(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function comprimirImagen(file, maxSize = 1200, quality = 0.78) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await cargarImagenEnObjeto(dataUrl);
  let width = img.width;
  let height = img.height;

  if (width > height && width > maxSize) {
    height = Math.round(height * (maxSize / width));
    width = maxSize;
  } else if (height >= width && height > maxSize) {
    width = Math.round(width * (maxSize / height));
    height = maxSize;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
  });
}

async function subirImagenProducto(file, nombreProducto) {
  const blob = await comprimirImagen(file, 1200, 0.78);
  const nombreSeguro = String(nombreProducto || 'producto')
    .replace(/[^\w\-]+/g, '_')
    .toLowerCase();

  const ruta = `productos/${Date.now()}_${nombreSeguro}.jpg`;
  const archivoRef = storageRef(storage, ruta);
  await uploadBytes(archivoRef, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(archivoRef);
}

window.irEstadisticas = () => {
  window.open('estadisticas.html', '_blank');
};

window.irLogs = () => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede ver LOGS', 'error');
  window.open('logs.html', '_blank');
};

window.irFinanzas = () => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede ver finanzas', 'error');
  window.location.href = 'gastos.html';
};

window.abrirScannerMovil = () => {
  try {
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
    window.open(baseUrl + 'scanner.html', '_blank');
  } catch (error) {
    console.error(error);
    showToast('✖ Error abriendo el scanner', 'error');
  }
};

window.abrirCatalogo = () => {
  window.open('catalogo.html', '_blank');
};

window.subirFotoRapidaDesdeArchivo = async (id, file) => {
  if (!currentUser || !['admin', 'user'].includes(userRole)) {
    return showToast('✖ Debes iniciar sesión', 'error');
  }

  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    return showToast('✖ El archivo no es una imagen', 'error');
  }

  try {
    showToast('⌛ Comprimiendo y subiendo foto...', 'info', 3000);

    const producto = productos[id];
    const imagenUrl = await subirImagenProducto(file, producto?.nombre || 'producto');

    await update(ref(db, 'productos/' + id), { imagen: imagenUrl });
    productos[id].imagen = imagenUrl;

    await syncProductoPublico(id, productos[id]);
    await guardarLog('foto-subida', id, producto?.nombre || '', 0, currentUser?.email || '', 'Foto actualizada');

    programarRender();
    showToast('✅ Foto subida correctamente', 'success');
  } catch (error) {
    console.error(error);
    showToast('✖ Error subiendo foto', 'error', 3500);
  }
};

window.subirFotoRapida = async (id) => {
  try {
    if (!id) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      await subirFotoRapidaDesdeArchivo(id, file);
    };

    input.click();
  } catch (error) {
    console.error(error);
    showToast('✖ Error abriendo selector de imagen', 'error');
  }
};

window.borrarFotoProducto = async (id) => {
  try {
    if (!id) return;

    const p = productos[id];
    if (!p || !p.imagen) {
      return showToast('✖ No hay foto para borrar', 'error');
    }

    openConfirm({
      title: '🗑️ Borrar foto',
      message: `¿Seguro que quieres eliminar la foto de "${p.nombre}"?`,
      confirmText: 'Borrar',
      danger: true,
      onConfirm: async () => {
        try {
          await update(ref(db, 'productos/' + id), {
            imagen: ''
          });

          productos[id].imagen = '';

          await syncProductoPublico(id, productos[id]);
          await guardarLog('foto-borrada', id, p.nombre, 0, currentUser.email);

          programarRender();
          showToast('✅ Foto eliminada', 'success');
        } catch (err) {
          console.error(err);
          showToast('✖ Error borrando foto', 'error');
        }
      }
    });
  } catch (error) {
    console.error(error);
    showToast('✖ Error eliminando foto', 'error');
  }
};

window.dragOverFoto = (event) => {
  event.preventDefault();
  event.stopPropagation();
  const zona = event.currentTarget;
  if (zona) zona.classList.add('drag-over');
};

window.dragLeaveFoto = (event) => {
  event.preventDefault();
  event.stopPropagation();
  const zona = event.currentTarget;
  if (zona) zona.classList.remove('drag-over');
};

window.dropFotoProducto = async (event, id) => {
  event.preventDefault();
  event.stopPropagation();

  const zona = event.currentTarget;
  if (zona) zona.classList.remove('drag-over');

  if (!currentUser || !['admin', 'user'].includes(userRole)) {
    return showToast('✖ Debes iniciar sesión', 'error');
  }

  const files = event.dataTransfer?.files;
  if (!files || !files.length) {
    return showToast('✖ No se detectó ningún archivo', 'error');
  }

  const file = files[0];
  await subirFotoRapidaDesdeArchivo(id, file);
};

window.descargarCatalogo = async () => {
  try {
    const productosLista = Object.values(productos || {})
      .map(p => ({
        nombre: String(p?.nombre || '').trim(),
        laura: Number(p?.laura || 0),
        imagen: String(p?.imagen || '').trim()
      }))
      .filter(p => p.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    if (!productosLista.length) {
      return showToast('✖ No hay productos para generar catálogo', 'error');
    }

    const tarjetasHTMLDesktop = productosLista.map(p => `
      <article class="catalog-card">
        <div class="catalog-image-wrap">
          ${p.imagen
            ? `<img src="${p.imagen}" alt="${escaparHtml(p.nombre)}" class="catalog-image">`
            : `<div class="catalog-no-image">Sin foto</div>`
          }
        </div>
        <div class="catalog-body">
          <h3 class="catalog-name">${escaparHtml(p.nombre)}</h3>
          <div class="catalog-price">€${p.laura.toFixed(2)}</div>
        </div>
      </article>
    `).join('');

    const filasMovil = productosLista.map(p => `
      <tr>
        <td>${escaparHtml(p.nombre)}</td>
        <td>€${p.laura.toFixed(2)}</td>
      </tr>
    `).join('');

    const htmlMovil = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Catálogo Mundo Azul</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  font-family:Arial,sans-serif;
  color:#111827;
  background:#ffffff;
  padding:22px;
}
.wrap{
  max-width:900px;
  margin:0 auto;
}
h1{
  margin:0 0 8px 0;
  font-size:28px;
}
.sub{
  margin:0 0 18px 0;
  color:#475569;
  font-size:14px;
}
table{
  width:100%;
  border-collapse:collapse;
  table-layout:fixed;
}
th,td{
  border:1px solid #dbe4f0;
  padding:10px;
  font-size:14px;
}
th{
  background:#2563eb;
  color:#fff;
  text-align:left;
}
td:last-child, th:last-child{
  width:140px;
  text-align:right;
  white-space:nowrap;
}
@page{
  margin:18px;
}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Catálogo Mundo Azul</h1>
    <p class="sub">Versión móvil PDF · Nombre y precio</p>
    <table>
      <thead>
        <tr>
          <th>Producto</th>
          <th>Precio</th>
        </tr>
      </thead>
      <tbody>
        ${filasMovil}
      </tbody>
    </table>
  </div>
</body>
</html>`;

    const htmlDesktop = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Catálogo Mundo Azul</title>
<style>
:root{
  --bg:#eef3ff;
  --card:#ffffff;
  --text:#0f172a;
  --muted:#64748b;
  --border:#dbe4f0;
  --shadow:0 14px 32px rgba(15,23,42,.10);
}
*{box-sizing:border-box}
body{
  margin:0;
  font-family:Inter,Segoe UI,Arial,sans-serif;
  color:var(--text);
  background:#ffffff;
  padding:24px;
}
.catalog-shell{
  max-width:1400px;
  margin:0 auto;
}
.catalog-header{
  display:flex;
  align-items:center;
  gap:18px;
  padding:20px 24px;
  border-radius:28px;
  margin-bottom:24px;
  background:linear-gradient(135deg,#1d4ed8 0%, #2563eb 45%, #4f46e5 100%);
  box-shadow:0 24px 56px rgba(37,99,235,.20);
}
.catalog-header h1{
  margin:0;
  color:#fff;
  font-size:34px;
  line-height:1.1;
}
.catalog-header p{
  margin:8px 0 0 0;
  color:rgba(255,255,255,.9);
  font-weight:600;
}
.catalog-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:18px;
}
.catalog-card{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:24px;
  overflow:hidden;
  box-shadow:var(--shadow);
  break-inside:avoid;
}
.catalog-image-wrap{
  aspect-ratio:1/1;
  background:#f8fafc;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:14px;
}
.catalog-image{
  width:100%;
  height:100%;
  object-fit:cover;
  border-radius:18px;
}
.catalog-no-image{
  width:100%;
  height:100%;
  border:2px dashed #cbd5e1;
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  color:var(--muted);
  font-weight:800;
  background:#fff;
}
.catalog-body{
  padding:16px;
  text-align:center;
}
.catalog-name{
  margin:0 0 12px 0;
  font-size:20px;
  line-height:1.2;
  min-height:48px;
  display:flex;
  align-items:center;
  justify-content:center;
}
.catalog-price{
  display:inline-block;
  padding:10px 16px;
  border-radius:999px;
  background:#111827;
  color:#fff;
  font-size:26px;
  font-weight:900;
}
.print-note{
  margin:0 0 18px 0;
  text-align:center;
  color:#475569;
  font-weight:700;
}
@media print{
  body{
    padding:12mm;
  }
  .catalog-header{
    box-shadow:none;
  }
  .catalog-card{
    box-shadow:none;
  }
  .print-note{
    display:none;
  }
}
</style>
</head>
<body>
  <div class="catalog-shell">
    <header class="catalog-header">
      <div>
        <h1>Catálogo Mundo Azul</h1>
        <p>Nombre · Foto · Precio venta</p>
      </div>
    </header>

    <p class="print-note">Se abrirá la ventana de impresión. Elige "Guardar como PDF".</p>

    <section class="catalog-grid">
      ${tarjetasHTMLDesktop}
    </section>
  </div>
</body>
</html>`;

   if (estaEnAppMovil()) {
  mostrarCargaNativa('Preparando catálogo PDF...', 'Preparando productos e imágenes', 12);

  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: 'GENERAR_CATALOGO_PDF',
    fileName: `catalogo-mundo-azul-${new Date().toISOString().slice(0,10)}.pdf`,
    items: productosLista
  }));
  return;
}

    const w = window.open('', '_blank');
    if (!w) {
      return showToast('✖ El navegador bloqueó la ventana emergente', 'error');
    }

    w.document.open();
    w.document.write(htmlDesktop);
    w.document.close();

    setTimeout(() => {
      w.focus();
      w.print();
    }, 500);

    showToast('✅ Catálogo preparado para guardar en PDF', 'success');
  } catch (error) {
    console.error(error);
    ocultarCargaNativa();
    showToast('✖ Error generando catálogo PDF', 'error');
  }
};

async function obtenerIP() {
  try {
    const cache = sessionStorage.getItem("inventario_ip");
    if (cache) return cache;
    const r = await fetch("https://api.ipify.org?format=json");
    const data = await r.json();
    const ip = data.ip || "IP desconocida";
    sessionStorage.setItem("inventario_ip", ip);
    return ip;
  } catch {
    return "IP desconocida";
  }
}

function obtenerDispositivo() {
  try {
    return navigator.userAgent || "Dispositivo desconocido";
  } catch {
    return "Dispositivo desconocido";
  }
}

window.guardarLog = async (tipo, productoId, productoNombre, cantidad, usuario, detalles = '', extras = {}) => {
  const ip = await obtenerIP();

  const logData = {
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
  };

  await push(logsRef, logData);
};

window.toggleClearBtn = () => {
  const buscar = document.getElementById('buscar');
  const clearBtn = document.getElementById('buscar-clear');
  clearBtn.style.display = buscar.value.length > 0 ? 'block' : 'none';
};

window.handleBuscarInput = () => {
  toggleClearBtn();
  clearTimeout(buscarTimeout);
  buscarTimeout = setTimeout(() => {
    programarRender();
  }, 180);
};

window.clearSearch = () => {
  const buscar = document.getElementById('buscar');
  buscar.value = '';
  document.getElementById('buscar-clear').style.display = 'none';
  programarRender();
  showToast('Búsqueda limpiada', 'info', 1200);
};

window.actualizarContadoresFiltrados = (count, stockTotal) => {
  document.getElementById('productosVisibles').textContent = `${count} productos`;
  document.getElementById('stockVisible').textContent = `${stockTotal} unidades`;
};

window.abrirEditorProducto = () => {
  const modal = document.getElementById('productEditorModal');
  modal.classList.add('show');
  requestAnimationFrame(() => document.getElementById('nombre')?.focus());
};

window.cerrarEditorProducto = () => {
  document.getElementById('productEditorModal').classList.remove('show');
};

window.abrirNuevoProducto = () => {
  if (userRole !== 'admin') return showToast('Solo ADMIN puede crear productos', 'error');
  limpiarFormulario(false);
  document.getElementById('productFormTitle').textContent = 'Nuevo producto';
  document.getElementById('productFormSubtitle').textContent = 'Añade el stock, los importes y una fotografía.';
  document.getElementById('guardarBtn').textContent = 'Crear producto';
  abrirEditorProducto();
};

window.showToast = (message, type = 'info', duration = 2400) => {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 260);
  }, duration);
};

window.closeModal = () => {
  const modal = document.getElementById('appModal');
  modal.classList.remove('show');
  document.getElementById('modalFields').innerHTML = '';
  document.getElementById('modalMessage').textContent = '';
  document.getElementById('modalConfirmBtn').onclick = null;
  document.getElementById('modalCancelBtn').onclick = null;

  const extraBtns = modal.querySelectorAll('.reserva-extra-btn');
  extraBtns.forEach(btn => btn.remove());
};

window.openModal = ({ title, message = '', fields = [], confirmText = 'Guardar', danger = false, onConfirm }) => {
  const modal = document.getElementById('appModal');
  const titleEl = document.getElementById('modalTitle');
  const messageEl = document.getElementById('modalMessage');
  const fieldsEl = document.getElementById('modalFields');
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const cancelBtn = document.getElementById('modalCancelBtn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  fieldsEl.innerHTML = '';
  confirmBtn.textContent = confirmText;
  confirmBtn.className = danger ? 'modal-danger' : '';

  for (const field of fields) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-field';
    wrap.innerHTML = `
      <label for="modal-field-${field.name}">${field.label}</label>
      <input id="modal-field-${field.name}" type="${field.type || 'text'}" value="${field.value ?? ''}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.step !== undefined ? `step="${field.step}"` : ''}>
    `;
    fieldsEl.appendChild(wrap);
  }

  cancelBtn.onclick = closeModal;
  confirmBtn.onclick = async () => {
    const values = {};
    for (const field of fields) {
      values[field.name] = document.getElementById(`modal-field-${field.name}`).value;
    }
    await onConfirm(values);
    closeModal();
  };

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  modal.classList.add('show');
  setTimeout(() => {
    const firstInput = fieldsEl.querySelector('input');
    if (firstInput) firstInput.focus();
  }, 20);
};

window.openConfirm = ({ title, message, confirmText = 'Aceptar', danger = false, onConfirm }) => {
  openModal({ title, message, fields: [], confirmText, danger, onConfirm: async () => { await onConfirm(); } });
};

window.cerrarQRModal = () => {
  document.getElementById('qrModal').classList.remove('show');
  document.getElementById('qrCanvasWrap').innerHTML = '';
  document.getElementById('qrTexto').textContent = '';
  document.getElementById('qrProductoNombre').textContent = '';
  document.getElementById('qrImagenWrap').innerHTML = '';
};

window.abrirFotoModal = (src) => {
  if (!src) return;
  document.getElementById('fotoModalImg').src = src;
  document.getElementById('fotoModal').classList.add('show');
};

window.cerrarFotoModal = () => {
  document.getElementById('fotoModal').classList.remove('show');
  document.getElementById('fotoModalImg').src = '';
};

window.verQRProducto = async (id) => {
  const p = productos[id];
  if (!p) return showToast('✖ Producto no encontrado', 'error');

  const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
  const qrText = `${baseUrl}scanner.html?scanId=${id}`;

  ultimoQRTexto = qrText;
  ultimoQRNombre = p.nombre || 'Producto';
  ultimaQRImagen = p.imagen || '';

  const modal = document.getElementById('qrModal');
  const wrap = document.getElementById('qrCanvasWrap');
  const nombre = document.getElementById('qrProductoNombre');
  const texto = document.getElementById('qrTexto');
  const qrImagenWrap = document.getElementById('qrImagenWrap');

  wrap.innerHTML = '';
  qrImagenWrap.innerHTML = '';
  nombre.textContent = p.nombre || '';
  texto.textContent = qrText;

  if (p.imagen) {
    qrImagenWrap.innerHTML = `<img src="${p.imagen}" class="foto-qr" alt="Foto producto">`;
  }

  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);

  try {
    await QRCode.toCanvas(canvas, qrText, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    modal.classList.add('show');
  } catch (e) {
    showToast('✖ Error generando QR', 'error');
  }
};

window.imprimirQRActual = () => {
  const canvas = document.querySelector('#qrCanvasWrap canvas');
  if (!canvas || !ultimoQRTexto) return showToast('✖ No hay QR para imprimir', 'error');

  const img = canvas.toDataURL('image/png');
  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>QR ${ultimoQRNombre}</title>
      <style>
        body{font-family:Arial;text-align:center;padding:20px}
        h2{margin-bottom:6px}
        .small{font-size:12px;color:#666;word-break:break-all}
        .foto{width:140px;height:140px;object-fit:cover;border-radius:12px;border:1px solid #ddd;display:block;margin:0 auto 12px auto}
        img.qr{width:260px;height:260px}
      </style>
    </head>
    <body>
      <h2>${ultimoQRNombre}</h2>
      ${ultimaQRImagen ? `<img class="foto" src="${ultimaQRImagen}" alt="Foto">` : ''}
      <img class="qr" src="${img}" alt="QR">
      <div class="small">${ultimoQRTexto}</div>
      <script>
        window.onload = () => { window.print(); };
      <\/script>
    </body>
    </html>
  `);
  w.document.close();
};

window.descargarTodosLosQR = async () => {
  try {
    const ids = Object.keys(productos || {});
    if (!ids.length) return showToast('✖ No hay productos para generar QR', 'error');

    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

   if (estaEnAppMovil()) {
  const items = ids.map(id => {
    const p = productos[id] || {};
    return {
      id,
      nombre: String(p.nombre || 'Producto'),
      imagen: String(p.imagen || ''),
      qrText: `${baseUrl}scanner.html?scanId=${id}`
    };
  });

  mostrarCargaNativa('Preparando ZIP de QR...', 'Iniciando generación', 5);

  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: 'GENERAR_QRS_ZIP',
    fileName: `qrs-inventario-laura-${new Date().toISOString().slice(0,10)}.zip`,
    items
  }));

  return;
}

    if (!window.JSZip) return showToast('✖ No se cargó JSZip', 'error');

    showToast('⌛ Generando ZIP de QR...', 'info', 3000);

    const zip = new JSZip();
    const carpeta = zip.folder('qrs-inventario-laura');

    let generados = 0;

    for (const id of ids) {
      const p = productos[id];
      if (!p) continue;

      const qrText = `${baseUrl}scanner.html?scanId=${id}`;
      const nombreProducto = String(p.nombre || 'Producto');

      const finalCanvas = document.createElement('canvas');
      const ctx = finalCanvas.getContext('2d');

      const width = 900;
      const height = 1050;
      finalCanvas.width = width;
      finalCanvas.height = height;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#111111';
      ctx.textAlign = 'center';

      ctx.font = 'bold 52px Arial';
      ctx.fillText('📫 QR del producto', width / 2, 90);

      ctx.font = 'bold 46px Arial';
      const maxTextWidth = width - 80;
      let nombrePintar = nombreProducto;

      while (ctx.measureText(nombrePintar).width > maxTextWidth && nombrePintar.length > 3) {
        nombrePintar = nombrePintar.slice(0, -1);
      }
      if (nombrePintar !== nombreProducto) nombrePintar += '...';

      ctx.fillText(nombrePintar, width / 2, 165);

      const qrCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrCanvas, qrText, {
        width: 620,
        margin: 2,
        errorCorrectionLevel: 'M'
      });

      const qrSize = 620;
      const qrX = (width - qrSize) / 2;
      const qrY = 240;
      ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

      ctx.fillStyle = '#475569';
      ctx.font = '20px Arial';
      ctx.fillText(id, width / 2, height - 40);

      const dataUrl = finalCanvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];

      const nombreSeguro = nombreProducto
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 80);

      carpeta.file(`${nombreSeguro}__${id}.png`, base64, { base64: true });
      carpeta.file(`${nombreSeguro}__${id}.txt`, qrText);

      generados++;
    }

    const contenidoZip = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(contenidoZip);

    const a = document.createElement('a');
    a.href = url;
    a.download = `qrs-inventario-laura-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);

    showToast(`✅ ZIP descargado con ${generados} QR`, 'success', 3500);
  } catch (error) {
    console.error(error);
    showToast('✖ Error generando los QR', 'error', 3500);
  }
};

window.programarRender = () => {
  if (renderPendiente) return;
  renderPendiente = true;
  requestAnimationFrame(() => {
    renderPendiente = false;
    renderTablaSolo();
  });
};

window.anadirProximoStock = async (id) => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede añadir stock próximo', 'error');
  const p = productos[id];
  const inputProx = document.querySelector(`input[data-producto="${id}"]`);
  const cantidad = Number(inputProx?.value) || 0;
  if (cantidad <= 0) return showToast('✖ Cantidad inválida', 'error');

  const stockAnterior = Number(p.stock || 0);
  const nuevoStock = stockAnterior + cantidad;
  await update(ref(db,'productos/'+id), { stock:nuevoStock, proximo:0, emailAgotadoEnviado:false });
  productos[id].stock = nuevoStock;
  productos[id].proximo = 0;
  productos[id].emailAgotadoEnviado = false;
  await registrarNovedadStock(id, productos[id], cantidad, stockAnterior, nuevoStock);
  await syncProductoPublico(id, productos[id]);

  if (inputProx) {
    inputProx.value = '0';
    inputProx.classList.remove('tiene-valor');
  }

  await guardarLog('stock-anadido', id, p.nombre, cantidad, currentUser.email, `Stock real: ${nuevoStock}`);
  showToast(`✅ Añadidas ${cantidad} unidades. Nuevo stock: ${nuevoStock}`, 'success');
};

window.modificarProximoStock = (id) => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede modificar stock próximo', 'error');
  const p = productos[id];
  openModal({
    title: '📌 Editar stock próximo',
    fields: [
      { name: 'proximo', label: `Próximo para ${p.nombre}`, type: 'number', value: p?.proximo || 0, min: 0 }
    ],
    onConfirm: async (values) => {
      const proximo = Math.max(0, Number(values.proximo));
      if (isNaN(proximo)) return showToast('✖ Stock próximo inválido', 'error');
      await update(ref(db,'productos/'+id), { proximo });
      productos[id].proximo = proximo;
      await guardarLog('proximo-modificado', id, productos[id].nombre, proximo, currentUser.email);
      showToast(`✅ Próximo actualizado: ${proximo}`, 'success');
    }
  });
};

window.updateProxInputVisual = (input) => {
  const valor = Number(input.value);
  if (valor > 0) input.classList.add('tiene-valor');
  else input.classList.remove('tiene-valor');
};

function productoOcultoEnIndex(producto) {
  return !!producto?.ocultoIndex;
}

function actualizarPanelOcultosIndex() {
  const seccion = document.getElementById('ocultosIndexSection');
  const btnTop = document.getElementById('btnGestionOcultosTop');
  const esAdmin = userRole === 'admin';

  if (seccion) {
    seccion.classList.toggle('hidden', !esAdmin);
  }

  if (btnTop) {
    btnTop.style.display = esAdmin ? 'inline-flex' : 'none';
  }

  renderOcultosIndex();
}

window.scrollToOcultosIndex = () => {
  const seccion = document.getElementById('ocultosIndexSection');
  if (!seccion || userRole !== 'admin') return;
  seccion.classList.remove('hidden');
  seccion.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.renderOcultosIndex = () => {
  const tbody = document.getElementById('tablaOcultosIndex');
  const empty = document.getElementById('ocultosIndexEmpty');
  const wrap = document.getElementById('ocultosIndexTableWrap');
  const count = document.getElementById('ocultosIndexCount');
  const filtro = (document.getElementById('buscarOcultosIndex')?.value || '').toLowerCase().trim();

  if (!tbody || !empty || !wrap || !count) return;

  if (userRole !== 'admin') {
    tbody.innerHTML = '';
    count.textContent = 'Ocultos: 0';
    empty.classList.add('hidden');
    wrap.classList.add('hidden');
    return;
  }

  const ocultos = Object.entries(productos || {})
    .filter(([, p]) => productoOcultoEnIndex(p))
    .filter(([, p]) => String(p?.nombre || '').toLowerCase().includes(filtro))
    .sort((a, b) => String(a[1]?.nombre || '').localeCompare(String(b[1]?.nombre || ''), 'es'));

  ocultosIndexCount = Object.values(productos || {}).filter(productoOcultoEnIndex).length;
  count.textContent = `Ocultos: ${ocultos.length}${filtro ? ` de ${ocultosIndexCount}` : ''}`;

  if (!ocultos.length) {
    tbody.innerHTML = '';
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = filtro
      ? 'No hay productos ocultos que coincidan con la búsqueda.'
      : 'No hay productos ocultos en el index.';
    return;
  }

  wrap.classList.remove('hidden');
  empty.classList.add('hidden');

  tbody.innerHTML = ocultos.map(([id, p]) => `
    <tr class="fila-oculta-index">
      <td>
        <button class="producto-link" onclick="abrirFichaProducto('${id}')">${escaparHtml(p?.nombre || '')}</button>
      </td>
      <td>
        ${p?.imagen
          ? `<img src="${p.imagen}" class="foto-mini foto-clickable" alt="foto" onclick="abrirFotoModal('${p.imagen}')">`
          : '<span class="sin-foto">-</span>'
        }
      </td>
      <td>${Number(p?.stock || 0)}</td>
      <td>${Number(p?.proximo || 0)}</td>
      <td>${Number(p?.reservados || 0)}</td>
      <td>${Number(p?.vendidos || 0)}</td>
      <td>${Number(p?.yoel || 0).toFixed(2)}</td>
      <td>${Number(p?.laura || 0).toFixed(2)}</td>
      <td>
        <button class="green" onclick="toggleOcultoIndex('${id}', false)">👁️ Mostrar en index</button>
      </td>
    </tr>
  `).join('');
};

window.renderTablaSolo = () => {
  const filtro = document.getElementById('buscar').value.toLowerCase().trim();
  const productosOrdenados = ordenarProductos(productos);
  const tabla = document.getElementById('tabla');

  let html = '';
  productosVisiblesCount = 0;
  stockVisibleTotal = 0;

  for (const [id, p] of productosOrdenados) {
    const nombreLc = (p?.nombre || '').toLowerCase();
    if (!nombreLc.includes(filtro)) continue;
    if (productoOcultoEnIndex(p)) continue;

    productosVisiblesCount++;
    stockVisibleTotal += Number(p.stock || 0);

    const stockDisponible = Number(p.stock || 0);
    const proximoDisponible = Number(p.proximo || 0);
    const stockClass = stockDisponible <= 0 ? 'sin-stock' : stockDisponible <= 5 ? 'stock-bajo' : '';
    const stockCellClass = userRole === 'admin' ? 'stock-editable' : '';
    const tieneProximo = proximoDisponible > 0;

    let filaClass = (p.reservados || 0) > 0 ? 'reservado' : stockClass;

    if (stockDisponible <= 0 && proximoDisponible > 0) {
      filaClass += ' en-reposicion';
    }

    html += `
<tr class="${filaClass}">
<td class="product-main-cell">
  <div class="product-main">
    <div class="product-media">
      <div 
        class="foto-drop-zone ${p.imagen ? 'con-foto' : 'sin-foto-drop'}"
        ondragover="dragOverFoto(event)"
        ondragleave="dragLeaveFoto(event)"
        ondrop="dropFotoProducto(event,'${id}')"
        title="Arrastra una imagen aquí"
      >
        ${p.imagen
          ? `<img src="${p.imagen}" class="foto-mini foto-clickable" alt="foto" onclick="abrirFotoModal('${p.imagen}')">`
          : `<span class="sin-foto">-</span>`
        }
      </div>

      <div class="foto-acciones">
        <button class="btn-foto icon-btn-xs" onclick="subirFotoRapida('${id}')" title="Subir foto" aria-label="Subir foto">＋</button>
        ${['admin','user'].includes(userRole) && p.imagen
          ? `<button class="red icon-btn-xs borrar-foto-btn" onclick="borrarFotoProducto('${id}')" title="Borrar foto">✕</button>`
          : ''
        }
      </div>
    </div>
    <button class="producto-link" onclick="abrirFichaProducto('${id}')">
      ${escaparHtml(p.nombre || '')}
      ${p.porEncargo === true ? '<span class="inventory-order-chip">Por encargo</span>' : ''}
    </button>
  </div>
</td>

<td class="stock-cell ${stockCellClass}">
  <span class="stock-value">${stockDisponible}</span>
  ${userRole==='admin' ? `<button class="stock-edit-btn icon-btn-xs" onclick="modificarStock('${id}')" title="Editar stock" aria-label="Editar stock">✎</button>` : ''}
</td>

<td>
  <div class="prox-group">
    <input type="number" min="0" value="${proximoDisponible}" data-producto="${id}" class="prox-input ${tieneProximo ? 'tiene-valor' : ''}" onchange="updateProxInput('${id}',this.value)" oninput="updateProxInputVisual(this)" title="Stock futuro">
    ${userRole==='admin' ? `
      <button class="prox-btn icon-btn-xs" onclick="anadirProximoStock('${id}')" title="Añadir al stock real" aria-label="Añadir al stock real">＋</button>
      <button class="prox-edit-btn icon-btn-xs" onclick="modificarProximoStock('${id}')" title="Editar próximo" aria-label="Editar próximo">✎</button>
    ` : ''}
  </div>
</td>

<td class="reservados">
  ${p.reservados || 0}
  ${(p.reservados || 0) > 0 ? `
    <div class="accion-group" style="margin-top:6px">
      <button class="icon-btn-xs" onclick="verReserva('${id}')" title="Ver ficha reserva" aria-label="Ver reserva">i</button>
      <button class="cancelar-reserva icon-btn-xs" onclick="cancelarReserva('${id}',1)" title="Cancelar 1 reserva" aria-label="Cancelar reserva">×</button>
      <button class="confirmar-btn icon-btn-xs" onclick="venderReserva('${id}')" title="Marcar reserva como vendida" aria-label="Vender reserva">✓</button>
    </div>
  ` : ''}
</td>

<td class="vendidos">
  ${p.vendidos || 0}
  ${(p.vendidos || 0) > 0 ? `<button class="undo-btn" onclick="eliminarUnaVenta('${id}')" title="Deshacer 1 venta" aria-label="Deshacer una venta">↶</button>` : ''}
</td>

<td>${Number(p.yoel || 0).toFixed(2)}</td>

<td class="editable laura-negro">
  <div class="precio-wrap">
    <strong>${Number(p.laura || 0).toFixed(2)}</strong>
    <button class="icon-btn-xs" onclick="modificarPrecioLaura('${id}')" title="Editar precio de venta" aria-label="Editar precio de venta">€</button>
  </div>
</td>

<td class="operation-cell">
  <div class="operation-actions">
    <input type="number" min="1" max="${Math.max(stockDisponible,1)}" value="1" class="cantidad-input">
    <button class="reservar-btn btn-reservar" onclick="reservar('${id}',this.closest('.operation-actions').querySelector('.cantidad-input').value)" title="Reservar">Reservar</button>
    <button class="btn-vender" onclick="vender('${id}',this.closest('.operation-actions').querySelector('.cantidad-input').value)" title="Vender">Vender</button>
  </div>
</td>

<td>
  <button class="qr-btn" onclick="verQRProducto('${id}')" title="Ver QR del producto">QR</button>
</td>

<td class="col-acciones">
  ${userRole === 'admin' ? `
    <button class="icon-btn" onclick="editar('${id}')" title="Editar" aria-label="Editar producto">✎</button>
    <button class="purple-btn icon-btn" onclick="toggleOcultoIndex('${id}')" title="Ocultar solo del inventario" aria-label="Ocultar producto">◉</button>
    <button class="red icon-btn" onclick="borrar('${id}')" title="Borrar" aria-label="Borrar producto">×</button>
  ` : ''}
</td>
</tr>`;
  }

  tabla.innerHTML = html;
  actualizarContadoresFiltrados(productosVisiblesCount, stockVisibleTotal);
};

window.updateProxInput = (id, value) => {
  const proximo = Math.max(0, Number(value));
  clearTimeout(proxUpdateTimers[id]);
  proxUpdateTimers[id] = setTimeout(() => {
    update(ref(db,'productos/'+id), { proximo });
    if (productos[id]) productos[id].proximo = proximo;
  }, 250);
  const input = document.querySelector(`input[data-producto="${id}"]`);
  if (input) updateProxInputVisual(input);
};

window.eliminarUnaVenta = async (id) => {
  const p = productos[id];
  const vendidos = Number(p.vendidos || 0);
  if (vendidos === 0) return showToast('✖ No hay ventas para eliminar', 'error');

  openConfirm({
    title: '↩️ Corregir venta',
    message: `Se eliminará 1 venta de "${p.nombre}", volverá 1 unidad al stock y se descontarán los importes de Yoel y del total cobrado.`,
    confirmText: 'Corregir',
    onConfirm: async () => {
      const nuevoStock = Number(p.stock || 0) + 1;
      const nuevosVendidos = vendidos - 1;
      const nuevoVyoel = Math.max(0, Number(p.vyoel || 0) - Number(p.yoel || 0));
      const nuevoVLaura = Math.max(0, Number(p.vLaura || 0) - Number(p.laura || 0));

      await update(ref(db, 'productos/' + id), {
        stock: nuevoStock,
        vendidos: nuevosVendidos,
        vyoel: nuevoVyoel,
        vLaura: nuevoVLaura,
        emailAgotadoEnviado:false
      });

      productos[id].stock = nuevoStock;
      productos[id].vendidos = nuevosVendidos;
      productos[id].vyoel = nuevoVyoel;
      productos[id].vLaura = nuevoVLaura;
      productos[id].emailAgotadoEnviado = false;

      await syncProductoPublico(id, productos[id]);

      await guardarLog(
        'eliminacion-venta',
        id,
        p.nombre,
        1,
        currentUser.email,
        `Stock devuelto: ${nuevoStock}`,
        {
          precioyoel: Number(p.yoel || 0),
          precioLaura: Number(p.laura || 0),
          totalyoel: Number(p.yoel || 0),
          totalLaura: Number(p.laura || 0)
        }
      );

      showToast(`✅ Eliminada 1 venta. Stock: ${nuevoStock}`, 'success');
    }
  });
};

window.hacerBackup = async () => {
  if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) return alert('✖ Solo un administrador puede hacer backup');
  try {
    const [logsSnap, liquidacionesSnap, gastosSnap] = await Promise.all([get(logsRef), get(liquidacionesRef), get(gastosRef)]);
    const backupData = {
      productos,
      totalesGlobales,
      logs: logsSnap.val() || {},
      liquidaciones: liquidacionesSnap.val() || {},
      gastos: gastosSnap.val() || {},
      fecha: new Date().toISOString(),
      usuario: currentUser.email,
      timestamp: Date.now()
    };

    await set(backupRef, {
      productos,
      liquidaciones: backupData.liquidaciones,
      gastos: backupData.gastos,
      fecha: backupData.fecha,
      usuario: backupData.usuario,
      timestamp: backupData.timestamp
    });
    document.getElementById('backupText').textContent = `${Object.keys(productos).length} productos · ${Object.keys(backupData.logs).length} movimientos · ${Object.keys(backupData.liquidaciones).length} liquidaciones · ${Object.keys(backupData.gastos).length} gastos`;
    document.getElementById('backupDate').innerHTML = `<strong>📮 Backup creado: ${new Date().toLocaleString('es-ES')}</strong>`;

    const oldLinks = document.querySelectorAll('.download-link');
    oldLinks.forEach(link => link.remove());

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-inventario-${new Date().toISOString().slice(0,10)}.json`;
    a.textContent = '💾 DESCARGAR BACKUP';
    a.className = 'download-link';
    document.getElementById('backupArea').appendChild(a);

    ultimoBackup = backupData;
    await guardarLog('backup-creado', null, 'BACKUP', 1, currentUser.email);
    showToast('✅ Backup completado y descargado', 'success');
  } catch(error) {
    alert('✖ Error en backup: ' + error.message);
  }
};

window.restaurarBackup = async (event) => {
  if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) return showToast('✖ Solo un administrador puede restaurar', 'error');
  const file = event.target.files[0];
  if (!file) return;

  openConfirm({
    title: '📛 Restaurar backup',
    message: 'Se reemplazarán TODOS los productos y se mantendrán los logs.',
    confirmText: 'Restaurar',
    danger: true,
    onConfirm: async () => {
      try {
        const text = await file.text();
        const backupData = JSON.parse(text);
        const productosRestaurados = backupData.productos || {};
        await set(ref(db,'productos'), productosRestaurados);

        const publicos = {};
        Object.entries(productosRestaurados).forEach(([id, producto]) => {
          publicos[id] = construirProductoPublico(producto);
        });
        await set(ref(db,'productos_publicos'), publicos);

        if (backupData.liquidaciones && typeof backupData.liquidaciones === 'object') {
          await set(liquidacionesRef, backupData.liquidaciones);
        }

        if (backupData.gastos && typeof backupData.gastos === 'object') {
          await set(gastosRef, backupData.gastos);
        }

        await guardarLog('backup-restaurado', null, 'BACKUP', 1, currentUser.email);
        showToast('✅ Restauración completada. Recargando...', 'success');
        setTimeout(() => location.reload(), 700);
      } catch(error) {
        showToast('✖ Error restaurando: ' + error.message, 'error', 3500);
      }
    }
  });
};

window.cargarBackupFirebase = () => {
  if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) return;
  onValue(backupRef, (snap) => {
    if (snap.exists()) {
      ultimoBackup = snap.val();
      document.getElementById('backupText').textContent = `${Object.keys(ultimoBackup.productos || {}).length} productos · ${Object.keys(ultimoBackup.liquidaciones || {}).length} liquidaciones · ${Object.keys(ultimoBackup.gastos || {}).length} gastos`;
      const fecha = new Date(ultimoBackup.timestamp).toLocaleString('es-ES');
      document.getElementById('backupDate').innerHTML = `<strong>📮 Último backup Firebase: ${fecha}</strong>`;
    }
  });
};

async function enviarEmail(datos) {
  if (!window.emailjs) return console.log('EmailJS cargando...');

  const dedupeKey = `${datos.subject || ''}__${datos.producto || ''}__${datos.stock ?? ''}__${datos.detalles || ''}`;
  if (emailEnviadoReciente[dedupeKey]) {
    console.log('⚠️ Email duplicado evitado:', dedupeKey);
    return;
  }
  emailEnviadoReciente[dedupeKey] = true;
  setTimeout(() => {
    delete emailEnviadoReciente[dedupeKey];
  }, 8000);

  if (!emailInicializado) {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    emailInicializado = true;
  }

  try {
    await emailjs.send(EMAILJS_CONFIG.service, EMAILJS_CONFIG.template, datos);
    console.log('✅ Email enviado:', datos.subject);
  } catch(err) {
    console.log('✖ Error email:', err);
    delete emailEnviadoReciente[dedupeKey];
  }
}

window.onscroll = () => {
  const btn = document.getElementById('scrollTopBtn');
  if (window.scrollY > 300) btn.classList.add('show');
  else btn.classList.remove('show');
};

document.getElementById('scrollTopBtn').onclick = () => window.scrollTo({ top:0, behavior:'smooth' });
  
onAuthStateChanged(auth, (user) => {
   const loginDiv = document.getElementById('loginDiv');
   const mainApp = document.getElementById('mainApp');
   document.body.classList.remove('auth-nav-visible');
  
   console.log("¡EJECUTANDO checkUserRole!");
    if (user) {
      console.log("Es usuario");
      currentUser = user;
      document.body.classList.add('app-logeada');
  
      loginDiv.classList.add('hidden');
      loginDiv.style.display = 'none';
  
      mainApp.classList.remove('hidden');
      mainApp.style.display = 'block';
  
      //avisarAppUsuario(user.email || '');
  
      if (!loginLogHecho) {
        loginLogHecho = true;
        //try {
          //await guardarLog('usuario-conectado', null, 'LOGIN', 0, user.email, 'Inicio de sesión correcto');
        //} catch (e) {
        //  console.error('Error guardando log de conexión', e);
        //}
      }
      console.log("Comprobamos el ROL....");
      checkUserRole();
    } else {
      currentUser = null;
      loginLogHecho = false;
      document.body.classList.remove('app-logeada');
  
      mainApp.classList.add('hidden');
      mainApp.style.display = 'none';
  
      loginDiv.classList.remove('hidden');
      loginDiv.style.display = 'block';
  
      avisarAppUsuario('');
      refrescarEstadoBloqueoPreciosLaura();
  
      dataListenerIniciado = false;
    }
});

window.login = () => {
  const email = document.getElementById('userEmail').value.trim();
  const pass = document.getElementById('userPass').value;
  if (!email || !pass) return showToast('✖ Email y contraseña requeridos', 'error');
  signInWithEmailAndPassword(auth, email, pass).catch(e => showToast('✖ Error: ' + e.message, 'error', 3500));
};

window.logout = () => signOut(auth).catch(e => alert('✖ Error: ' + e.message));

window.resetLogin = () => {
  document.getElementById('userEmail').value = '';
  document.getElementById('userPass').value = '';
};

window.togglePassword = () => {
  const input = document.getElementById('userPass');
  const btn = document.querySelector('.toggle-pass-btn');
  if (!input || !btn) return;

  const visible = input.type === 'text';

  input.type = visible ? 'password' : 'text';
  btn.textContent = visible ? 'Mostrar' : 'Ocultar';
  btn.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  btn.setAttribute('aria-pressed', String(!visible));
  btn.classList.toggle('visible', !visible);
};

document.getElementById('userPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});

document.getElementById('userEmail').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});

function checkUserRole() {
  const esAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email);
  const esUsuarioRegistrado = currentUser && USER_EMAILS.includes(currentUser.email);

  // LOG DE PRUEBA: Abre la consola con F12 para ver esto
  console.log("Usuario actual:", currentUser ? currentUser.email : "Nadie");
  console.log("¿Es Admin?:", esAdmin);

  if (esAdmin) {
    userRole = 'admin';

    document.getElementById('backupSection').classList.remove('hidden');
    document.getElementById('liquidacionesSection').classList.remove('hidden');
    document.getElementById('btnEstadisticasTop').style.display = 'inline-flex';
    document.getElementById('btnLogsTop').style.display = 'inline-flex';
    document.getElementById('btnFinanzasTop').style.display = 'inline-flex';
    document.getElementById('btnEstadisticas').style.display = 'inline-flex';
    document.getElementById('btnLogs').style.display = 'inline-flex';
    document.getElementById('btnFinanzas').style.display = 'inline-flex';
    const btnGestionOcultosTop = document.getElementById('btnGestionOcultosTop');
    if (btnGestionOcultosTop) btnGestionOcultosTop.style.display = 'inline-flex';
  } else if (esUsuarioRegistrado) {
    userRole = 'user';

    document.getElementById('backupSection').classList.add('hidden');
    document.getElementById('liquidacionesSection').classList.add('hidden');
    document.getElementById('btnEstadisticasTop').style.display = 'none';
    document.getElementById('btnLogsTop').style.display = 'none';
    document.getElementById('btnFinanzasTop').style.display = 'none';
    document.getElementById('btnEstadisticas').style.display = 'none';
    document.getElementById('btnLogs').style.display = 'none';
    document.getElementById('btnFinanzas').style.display = 'none';
    const btnGestionOcultosTop = document.getElementById('btnGestionOcultosTop');
    if (btnGestionOcultosTop) btnGestionOcultosTop.style.display = 'none';
  } else {
    userRole = null;

    document.getElementById('backupSection').classList.add('hidden');
    document.getElementById('liquidacionesSection').classList.add('hidden');
    document.getElementById('btnEstadisticasTop').style.display = 'none';
    document.getElementById('btnLogsTop').style.display = 'none';
    document.getElementById('btnFinanzasTop').style.display = 'none';
    document.getElementById('btnEstadisticas').style.display = 'none';
    document.getElementById('btnLogs').style.display = 'none';
    document.getElementById('btnFinanzas').style.display = 'none';
    const btnGestionOcultosTop = document.getElementById('btnGestionOcultosTop');
    if (btnGestionOcultosTop) btnGestionOcultosTop.style.display = 'none';
    showToast('✖ Este usuario no está autorizado', 'error', 3500);
    signOut(auth);
    return;
  }

  document.body.classList.add('auth-nav-visible');

  const requestedPage = window.INVENTARIO_BOOT.requestedPrivatePage(userRole);
  if (requestedPage) {
    window.location.replace(requestedPage);
    return;
  }

  updateUI();
  toggleNuevoProducto();
  loadData();

  if (esAdmin) cargarBackupFirebase();
  if (esAdmin) cargarLiquidaciones();
}

function toggleNuevoProducto() {
  document.getElementById('nuevoProductoDiv').style.display = userRole === 'admin' ? 'flex' : 'none';
}

function updateUI() {
  const esSoloUser = userRole !== 'admin';
  document.body.classList.toggle('solo-user', esSoloUser);
  document.body.classList.toggle('nav-user-limitado', esSoloUser);

  const status = document.getElementById('status');
  const guardarBtn = document.getElementById('guardarBtn');
  const resetBtn = document.getElementById('resetBtn');
  const precioGlobalBtn = document.getElementById('precioGlobalBtn');
  const thAcciones = document.getElementById('thAcciones');

  if (userRole === 'admin') {
    if (thAcciones) thAcciones.style.display = '';
    status.innerHTML = `<strong>Administrador · ${currentUser.email}</strong><span>Inventario, liquidaciones, estadísticas, copias y configuración</span>`;
    status.className = 'admin';
    guardarBtn.disabled = false;
    guardarBtn.className = '';
    resetBtn.disabled = false;
    resetBtn.className = 'material-outlined';
    precioGlobalBtn.disabled = false;
  } else {
    if (thAcciones) thAcciones.style.display = 'none';
    status.innerHTML = `<strong>Ventas · ${currentUser.email}</strong><span>Busca un producto para vender, reservar o consultar el stock</span>`;
    status.className = 'user';
    guardarBtn.disabled = true;
    guardarBtn.className = 'disabled';
    resetBtn.disabled = true;
    resetBtn.className = 'disabled';
    precioGlobalBtn.disabled = false;
    precioGlobalBtn.className = '';
  }
}

function loadData() {
  if (dataListenerIniciado) return;
  dataListenerIniciado = true;

  onValue(productosRef, async (snap) => {
    productos = snap.val() || {};

    const editFromUrl = getQueryParam('editId');
    if (editFromUrl && userRole === 'admin' && productos[editFromUrl]) {
      editar(editFromUrl);
      const url = new URL(window.location.href);
      url.searchParams.delete('editId');
      window.history.replaceState({}, '', url.toString());
    }

    totalesGlobales.yoel = 0;
    totalesGlobales.laura = 0;
    totalesGlobales.vendidos = 0;
    totalesGlobales.reservados = 0;

    Object.values(productos).forEach(p => {
      const vyoelReal = Number(p.vyoel || 0);
      const vLauraReal = Number(p.vLaura || 0);
      const vendidosReal = Number(p.vendidos || 0);
      const reservadosReal = Number(p.reservados || 0);
      totalesGlobales.yoel += vyoelReal;
      totalesGlobales.laura += vLauraReal;
      totalesGlobales.vendidos += vendidosReal;
      totalesGlobales.reservados += reservadosReal;
    });

    if (currentUser && userRole === 'admin') {
      try {
        await syncTodosProductosPublicosDesdeProductos(productos);
      } catch (e) {
        console.error('Error sincronizando productos_publicos:', e);
      }
    }

    actualizarTotales(totalesGlobales.yoel, totalesGlobales.laura, totalesGlobales.vendidos, totalesGlobales.reservados);
    programarRender();
    actualizarPanelOcultosIndex();
    refrescarFichaProductoSiAbierta();
    window.mostrarModalPreciosLauraObligatorio();
  }, (error) => {
    document.getElementById('status').textContent = '✖ Error de conexión';
    document.getElementById('status').className = 'error';
    console.error(error);
  });
}


function obtenerProductosSinPrecioLaura() {
  return Object.entries(productos || {}).filter(([id, p]) => {
    const yoel = Number(p?.yoel || 0);
    const laura = Number(p?.laura || 0);
    return yoel > 0 && laura <= 0;
  }).sort((a, b) => String(a[1]?.nombre || '').localeCompare(String(b[1]?.nombre || ''), 'es'));
}

function refrescarEstadoBloqueoPreciosLaura() {
  const pendientes = obtenerProductosSinPrecioLaura();
  const modal = document.getElementById('modalPreciosLauraObligatorio');
  const mainApp = document.getElementById('mainApp');

 const debeBloquear = !!currentUser && userRole === 'user' && pendientes.length > 0;

  document.body.classList.toggle('bloqueo-precios-laura-activo', debeBloquear);

  if (modal) {
    modal.classList.toggle('show', debeBloquear);
    modal.style.display = debeBloquear ? 'flex' : 'none';
  }

  if (mainApp) {
    mainApp.classList.toggle('precios-laura-bloqueado', debeBloquear);
  }
}

window.mostrarModalPreciosLauraObligatorio = () => {
  const lista = document.getElementById('preciosLauraObligatorioLista');
  const count = document.getElementById('preciosLauraObligatorioCount');
  const pendientes = obtenerProductosSinPrecioLaura();

  if (!lista || !count) return;

  if (!currentUser || userRole !== 'user' || !pendientes.length) {
    refrescarEstadoBloqueoPreciosLaura();
    return;
  }

  count.textContent = pendientes.length === 1
    ? '1 producto pendiente'
    : `${pendientes.length} productos pendientes`;

  lista.innerHTML = pendientes.map(([id, p]) => {
    const nombre = escaparHtml(p?.nombre || '');
    const imagen = String(p?.imagen || '').trim();
    const yoel = Number(p?.yoel || 0).toFixed(2);

    return `
      <div class="precio-laura-obligatorio-item">
        <div class="precio-laura-obligatorio-foto-wrap">
          ${imagen
            ? `<img src="${imagen}" alt="${nombre}" class="precio-laura-obligatorio-foto">`
            : `<div class="precio-laura-obligatorio-foto precio-laura-obligatorio-foto-vacia">Sin foto</div>`
          }
        </div>

        <div class="precio-laura-obligatorio-info">
          <div class="precio-laura-obligatorio-nombre">${nombre}</div>
          <div class="precio-laura-obligatorio-yoel">Para Yoel: €${yoel}</div>
        </div>

        <div class="precio-laura-obligatorio-input-wrap">
          <label for="precioLauraObligatorio_${id}">Precio de venta €</label>
          <input
            id="precioLauraObligatorio_${id}"
            class="precio-laura-obligatorio-input"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            placeholder="0.00"
            value=""
            oninput="limpiarErrorPrecioLauraObligatorio('${id}')"
          >
        </div>
      </div>
    `;
  }).join('');

  refrescarEstadoBloqueoPreciosLaura();
};

window.limpiarErrorPrecioLauraObligatorio = (id) => {
  const input = document.getElementById(`precioLauraObligatorio_${id}`);
  if (!input) return;
  input.classList.remove('precio-laura-obligatorio-input-error');
};

window.guardarPreciosLauraObligatorio = async () => {
  const pendientes = obtenerProductosSinPrecioLaura();
  if (!pendientes.length) {
    refrescarEstadoBloqueoPreciosLaura();
    return;
  }

  const updates = {};
  let hayErrores = false;
  let primerInputError = null;

  for (const [id, p] of pendientes) {
    const input = document.getElementById(`precioLauraObligatorio_${id}`);
    const valor = Number(input?.value);

    if (!input || !Number.isFinite(valor) || valor <= 0) {
      hayErrores = true;
      if (input) {
        input.classList.add('precio-laura-obligatorio-input-error');
        if (!primerInputError) primerInputError = input;
      }
      continue;
    }

    updates[`productos/${id}/laura`] = valor;
    updates[`productos_publicos/${id}/laura`] = valor;
  }

  if (hayErrores) {
    showToast('✖ Debes completar todos los precios Laura', 'error', 3000);
    if (primerInputError) primerInputError.focus();
    return;
  }

  const btn = document.getElementById('btnGuardarPreciosLauraObligatorio');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Guardando...';
  }

  try {
    await update(ref(db), updates);

    for (const [id] of pendientes) {
      const nuevoPrecio = Number(updates[`productos/${id}/laura`]);
      if (productos[id]) productos[id].laura = nuevoPrecio;
      await guardarLog('precio-laura', id, productos[id]?.nombre || '', nuevoPrecio, currentUser?.email || '', 'Precio Laura completado desde aviso obligatorio');
    }

    showToast('✅ Precios Laura guardados', 'success');
    window.mostrarModalPreciosLauraObligatorio();
    refrescarFichaProductoSiAbierta();
    programarRender();
  } catch (error) {
    console.error(error);
    showToast('✖ Error guardando precios Laura', 'error', 3500);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Guardar y continuar';
    }
  }
};


function ordenarProductos(productosObj) {
  const orden = document.getElementById('ordenar').value;
  const entradas = Object.entries(productosObj);

  return entradas.sort((a,b) => {
    const pA = a[1], pB = b[1];
    const [campo, dir] = orden.split('-');
    let valorA, valorB;

    switch (campo) {
      case 'nombre':
        valorA = (pA.nombre || '').toLowerCase();
        valorB = (pB.nombre || '').toLowerCase();
        return dir === 'asc' ? valorA.localeCompare(valorB) : valorB.localeCompare(valorA);
      case 'stock':
      case 'vendidos':
      case 'reservados':
      case 'proximo':
        valorA = Number(pA[campo] || 0);
        valorB = Number(pB[campo] || 0);
        break;
      case 'yoel':
        valorA = Number(pA.yoel || 0);
        valorB = Number(pB.yoel || 0);
        break;
      case 'laura':
        valorA = Number(pA.laura || 0);
        valorB = Number(pB.laura || 0);
        break;
      default:
        valorA = 0;
        valorB = 0;
    }

    return dir === 'asc' ? valorA - valorB : valorB - valorA;
  });
}

function actualizarTotales(totalyoel, totalLaura, totalVendidos, totalReservados) {
  document.getElementById('tyoelSup').textContent = `€${totalyoel.toFixed(2)}`;
  document.getElementById('tLauraSup').textContent = `€${totalLaura.toFixed(2)}`;
  document.getElementById('tTotalReservadosSup').textContent = totalReservados;
  document.getElementById('tTotalVendidosSup').textContent = totalVendidos;
  document.getElementById('tyoel').textContent = `€${totalyoel.toFixed(2)}`;
  document.getElementById('tLaura').textContent = `€${totalLaura.toFixed(2)}`;
  document.getElementById('tTotalReservados').textContent = totalReservados;
  document.getElementById('tTotalVendidos').textContent = totalVendidos;

  const diferencia = totalLaura - totalyoel;
  const diferenciaSup = document.getElementById('tDiferenciaSup');
  const diferenciaBoxSup = document.getElementById('diferenciaBoxSup');
  const diferenciaInf = document.getElementById('tDiferencia');
  const diferenciaBoxInf = document.getElementById('diferenciaBox');

  diferenciaSup.textContent = `€${diferencia.toFixed(2)}`;
  diferenciaInf.textContent = `€${diferencia.toFixed(2)}`;

  if (diferencia > 0) {
    diferenciaSup.className = 'diferencia-positiva';
    diferenciaBoxSup.className = 'total-box-superior diferencia yoel';
    diferenciaInf.className = 'diferencia-positiva';
    diferenciaBoxInf.className = 'total-box diferencia-positiva';
  } else if (diferencia < 0) {
    diferenciaSup.className = 'diferencia-negativa';
    diferenciaBoxSup.className = 'total-box-superior diferencia';
    diferenciaInf.className = 'diferencia-negativa';
    diferenciaBoxInf.className = 'total-box diferencia-negativa';
  } else {
    diferenciaSup.className = '';
    diferenciaBoxSup.className = 'total-box-superior diferencia';
    diferenciaInf.className = '';
    diferenciaBoxInf.className = 'total-box';
  }

  renderResumenLiquidacionActual();
}

window.reservar = async (id, cant) => {
  const p = productos[id];
  cant = Number(cant);

  if (cant <= 0 || Number(p.stock || 0) < cant) {
    return showToast('✖ Stock insuficiente', 'error');
  }

  openModal({
    title: '🔔 Confirmar reserva',
    message: `Vas a reservar ${cant} unidad(es) de "${p.nombre}". Completa la ficha antes de confirmar.`,
    confirmText: 'Guardar reserva',
    fields: [
      { name: 'clienteNombre', label: 'Nombre', type: 'text', value: '' },
      { name: 'clienteTelefono', label: 'Teléfono', type: 'text', value: '' },
      { name: 'adelanto', label: 'Adelanto €', type: 'number', value: '0', min: 0, step: '0.01' },
      { name: 'fechaRecogida', label: 'Fecha de recogida', type: 'date', value: '' },
      { name: 'comentarios', label: 'Comentarios', type: 'text', value: '' }
    ],
    onConfirm: async (values) => {
      const nombre = String(values.clienteNombre || '').trim();
      const telefono = String(values.clienteTelefono || '').trim();
      const adelanto = Math.max(0, Number(values.adelanto || 0));
      const fechaRecogida = String(values.fechaRecogida || '').trim();
      const comentarios = String(values.comentarios || '').trim();

      if (!nombre) {
        showToast('✖ El nombre es obligatorio', 'error');
        return;
      }

      const reservaNueva = {
        id: 'res_' + Date.now(),
        nombre,
        telefono,
        adelanto,
        fechaRecogida,
        comentarios,
        cantidad: cant,
        vendida: false,
        creadaPor: currentUser?.email || '',
        creadaEn: Date.now()
      };

      const resultado = await runTransaction(ref(db, 'productos/' + id), (actual) => {
        if (!actual || Number(actual.stock || 0) < cant) return;
        const reservasDetalleActual = Array.isArray(actual.reservasDetalle) ? [...actual.reservasDetalle] : [];
        reservasDetalleActual.push(reservaNueva);
        return {
          ...actual,
          stock: Number(actual.stock || 0) - cant,
          reservados: Number(actual.reservados || 0) + cant,
          reservasDetalle: reservasDetalleActual
        };
      });

      if (!resultado.committed) {
        showToast('✖ El stock cambió y ya no hay unidades suficientes', 'error', 3500);
        return;
      }

      productos[id] = { ...(productos[id] || {}), ...(resultado.snapshot.val() || {}) };
      const nuevoStock = Number(productos[id].stock || 0);

      await syncProductoPublico(id, productos[id]);

      await guardarLog(
        'reserva',
        id,
        p.nombre,
        cant,
        currentUser.email,
        `Reserva de ${nombre} | Tel:${telefono} | Adelanto:€${adelanto.toFixed(2)} | Recogida:${fechaRecogida || '-'} | ${comentarios || 'Sin comentarios'}`
      );

      await enviarEmail({
        producto: p.nombre,
        stock: nuevoStock,
        detalles: `${cant} uds. RESERVADAS | Cliente: ${nombre} | Tel: ${telefono} | Adelanto: €${adelanto.toFixed(2)} | Recogida: ${fechaRecogida || '-'} | Stock disponible: ${nuevoStock}`,
        subject: '🔔 RESERVA - ' + p.nombre,
        fecha: new Date().toLocaleString('es-ES')
      });

      showToast(`✅ Reserva guardada para ${nombre}`, 'success');
      programarRender();
    }
  });
};

window.verReserva = (id) => {
  const p = productos[id];
  if (!p) return showToast('✖ Producto no encontrado', 'error');

  const reservas = Array.isArray(p.reservasDetalle) ? p.reservasDetalle : [];
  if (!reservas.length) return showToast('✖ No hay ficha de reserva', 'error');

  const ultima = reservas.find(r => !r.vendida) || reservas[reservas.length - 1];
  const hayPendiente = reservas.some(r => !r.vendida);

  openModal({
    title: 'ℹ️ Datos de la reserva',
    message: '',
    confirmText: 'Cerrar',
    fields: [
      { name: 'clienteNombre', label: 'Nombre', type: 'text', value: ultima.nombre || '' },
      { name: 'clienteTelefono', label: 'Teléfono', type: 'text', value: ultima.telefono || '' },
      { name: 'adelanto', label: 'Adelanto €', type: 'number', value: Number(ultima.adelanto || 0).toFixed(2), min: 0, step: '0.01' },
      { name: 'fechaRecogida', label: 'Fecha recogida', type: 'date', value: ultima.fechaRecogida || '' },
      { name: 'comentarios', label: 'Comentarios', type: 'text', value: ultima.comentarios || '' }
    ],
    onConfirm: async () => {}
  });

  setTimeout(() => {
    const ids = [
      'modal-field-clienteNombre',
      'modal-field-clienteTelefono',
      'modal-field-adelanto',
      'modal-field-fechaRecogida',
      'modal-field-comentarios'
    ];

    ids.forEach(idCampo => {
      const el = document.getElementById(idCampo);
      if (el) el.setAttribute('readonly', true);
    });

    const actions = document.querySelector('#appModal .modal-actions');
    if (!actions) return;

    const oldExtraBtns = actions.querySelectorAll('.reserva-extra-btn');
    oldExtraBtns.forEach(btn => btn.remove());

    if (hayPendiente) {
      const btnEliminar = document.createElement('button');
      btnEliminar.textContent = '🗑️ Eliminar reserva';
      btnEliminar.className = 'modal-danger reserva-extra-btn';
      btnEliminar.onclick = async () => {
        closeModal();
        setTimeout(() => cancelarReserva(id, Number(ultima.cantidad || 1)), 120);
      };

      const btnVender = document.createElement('button');
      btnVender.textContent = '✔️ Vender reserva';
      btnVender.className = 'reserva-extra-btn';
      btnVender.onclick = async () => {
        closeModal();
        setTimeout(() => venderReserva(id), 120);
      };

      actions.insertBefore(btnEliminar, document.getElementById('modalConfirmBtn'));
      actions.insertBefore(btnVender, document.getElementById('modalConfirmBtn'));
    }
  }, 30);
};

window.venderReserva = async (id) => {
  const p = productos[id];
  if (!p) return showToast('✖ Producto no encontrado', 'error');

  const reservas = Array.isArray(p.reservasDetalle) ? [...p.reservasDetalle] : [];
  const idx = reservas.findIndex(r => !r.vendida);

  if (idx === -1) return showToast('✖ No hay reservas pendientes', 'error');

  const reserva = reservas[idx];
  const cantidad = Number(reserva.cantidad || 1);

  openConfirm({
    title: '✔ Convertir reserva en venta',
    message: `¿Marcar como vendida la reserva de "${reserva.nombre}" (${cantidad} ud.)?`,
    confirmText: 'Marcar vendida',
    onConfirm: async () => {
      const resultado = await runTransaction(ref(db, 'productos/' + id), (actual) => {
        if (!actual) return;
        const detalle = Array.isArray(actual.reservasDetalle) ? [...actual.reservasDetalle] : [];
        const indiceActual = detalle.findIndex(r => r?.id === reserva.id && !r.vendida);
        if (indiceActual === -1) return;

        detalle[indiceActual] = {
          ...detalle[indiceActual],
          vendida: true,
          vendidaEn: Date.now(),
          vendidaPor: currentUser?.email || ''
        };

        return {
          ...actual,
          reservados: Math.max(0, Number(actual.reservados || 0) - cantidad),
          vendidos: Number(actual.vendidos || 0) + cantidad,
          vyoel: Number(actual.vyoel || 0) + Number(actual.yoel || 0) * cantidad,
          vLaura: Number(actual.vLaura || 0) + Number(actual.laura || 0) * cantidad,
          reservasDetalle: detalle
        };
      });

      if (!resultado.committed) return showToast('✖ La reserva ya no está pendiente', 'error');
      productos[id] = { ...(productos[id] || {}), ...(resultado.snapshot.val() || {}) };
      const actualizado = productos[id];

      await guardarLog(
        'venta-desde-reserva',
        id,
        p.nombre,
        cantidad,
        currentUser.email,
        `Reserva entregada a ${reserva.nombre} | Tel:${reserva.telefono || '-'} | Adelanto:€${Number(reserva.adelanto || 0).toFixed(2)}`,
        {
          precioyoel: Number(actualizado.yoel || 0),
          precioLaura: Number(actualizado.laura || 0),
          totalyoel: Number(actualizado.yoel || 0) * cantidad,
          totalLaura: Number(actualizado.laura || 0) * cantidad
        }
      );

      showToast(`✅ Reserva de ${reserva.nombre} marcada como vendida`, 'success');
      programarRender();
    }
  });
};

window.vender = async (id, cant) => {
  cant = Number(cant);
  if (!Number.isInteger(cant) || cant <= 0) return showToast('✖ Cantidad inválida', 'error');

  let stockAnterior = 0;
  let debeMarcarAgotado = false;
  const resultado = await runTransaction(ref(db, 'productos/' + id), (actual) => {
    if (!actual || Number(actual.stock || 0) < cant) return;

    stockAnterior = Number(actual.stock || 0);
    const nuevoStockTx = stockAnterior - cant;
    debeMarcarAgotado = nuevoStockTx === 0 && !actual.emailAgotadoEnviado;

    return {
      ...actual,
      stock: nuevoStockTx,
      vendidos: Number(actual.vendidos || 0) + cant,
      vyoel: Number(actual.vyoel || 0) + Number(actual.yoel || 0) * cant,
      vLaura: Number(actual.vLaura || 0) + Number(actual.laura || 0) * cant,
      ...(debeMarcarAgotado ? { emailAgotadoEnviado: true } : {})
    };
  });

  if (!resultado.committed) return showToast('✖ Stock insuficiente o producto no disponible', 'error');

  const p = { id, ...(resultado.snapshot.val() || {}) };
  const nuevoStock = Number(p.stock || 0);
  productos[id] = { ...(productos[id] || {}), ...p };
  await syncProductoPublico(id, productos[id]);

  await guardarLog(
    'venta',
    id,
    p.nombre,
    cant,
    currentUser.email,
    `yoel:€${Number(p.yoel || 0).toFixed(2)} Laura:€${Number(p.laura || 0).toFixed(2)}`,
    {
      precioyoel: Number(p.yoel || 0),
      precioLaura: Number(p.laura || 0),
      totalyoel: Number(p.yoel || 0) * cant,
      totalLaura: Number(p.laura || 0) * cant
    }
  );

  await enviarEmail({
    producto:p.nombre,
    stock:nuevoStock,
    detalles:`${cant} uds. | yoel: €${Number(p.yoel || 0).toFixed(2)} | Laura: €${Number(p.laura || 0).toFixed(2)}`,
    subject:'🛍️ VENTA - ' + p.nombre,
    fecha:new Date().toLocaleString('es-ES')
  });

  if (debeMarcarAgotado) {
    await enviarEmail({
      producto:p.nombre,
      stock:0,
      detalles:`⚠️ PRODUCTO AGOTADO | yoel: €${Number(p.yoel || 0).toFixed(2)} | Laura: €${Number(p.laura || 0).toFixed(2)}`,
      subject:'⚠️ AGOTADO - ' + p.nombre,
      fecha:new Date().toLocaleString('es-ES')
    });
  }

  showToast(`✅ Vendidas ${cant} unidad${cant === 1 ? '' : 'es'} · quedan ${nuevoStock}`, 'success');
};

window.cancelarReserva = async (id, cant) => {
  cant = Number(cant);
  if (!Number.isInteger(cant) || cant <= 0) return showToast('✖ Cantidad inválida', 'error');

  const resultado = await runTransaction(ref(db, 'productos/' + id), (actual) => {
    if (!actual || cant > Number(actual.reservados || 0)) return;

    let pendientesAQuitar = cant;
    const nuevasReservas = [];
    const detalleActual = Array.isArray(actual.reservasDetalle) ? actual.reservasDetalle : [];

    for (const reserva of detalleActual) {
      if (reserva?.vendida || pendientesAQuitar <= 0) {
        nuevasReservas.push(reserva);
        continue;
      }

      const cantidadReserva = Math.max(1, Number(reserva?.cantidad || 1));
      const quitar = Math.min(cantidadReserva, pendientesAQuitar);
      const restante = cantidadReserva - quitar;
      pendientesAQuitar -= quitar;

      if (restante > 0) nuevasReservas.push({ ...reserva, cantidad: restante });
    }

    if (pendientesAQuitar > 0) return;

    return {
      ...actual,
      stock: Number(actual.stock || 0) + cant,
      reservados: Number(actual.reservados || 0) - cant,
      reservasDetalle: nuevasReservas,
      emailAgotadoEnviado: false
    };
  });

  if (!resultado.committed) return showToast('✖ No se pudo cancelar esa cantidad', 'error');
  productos[id] = { ...(productos[id] || {}), ...(resultado.snapshot.val() || {}) };
  const p = productos[id];
  const nuevoStock = Number(p.stock || 0);

  await syncProductoPublico(id, productos[id]);

  await guardarLog('cancelacion-reserva', id, p.nombre, cant, currentUser.email);
  showToast(`✅ Canceladas ${cant} unidades. Stock: ${nuevoStock}`, 'success');
  programarRender();
};

window.modificarStock = (id) => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede modificar stock', 'error');
  const p = productos[id];
  openModal({
    title: '📌 Editar stock',
    fields: [
      { name: 'stock', label: `Stock para ${p.nombre}`, type: 'number', value: p?.stock || 0, min: 0 }
    ],
    onConfirm: async (values) => {
      const stock = Math.max(0, Number(values.stock));
      if (isNaN(stock)) return showToast('✖ Stock inválido', 'error');
      const stockAnterior = Math.max(0, Number(productos[id]?.stock || 0));
      const updates = { stock };
      if (stock > 0 && productos[id]?.emailAgotadoEnviado) {
        updates.emailAgotadoEnviado = false;
      }
      await update(ref(db,'productos/'+id), updates);
      productos[id] = { ...productos[id], ...updates };
      if (stock > stockAnterior) {
        await registrarNovedadStock(id, productos[id], stock - stockAnterior, stockAnterior, stock);
      }
      await syncProductoPublico(id, productos[id]);
      await guardarLog('stock-modificado', id, productos[id].nombre, stock, currentUser.email);
      showToast(`✅ Stock actualizado: ${stock}`, 'success');
    }
  });
};

window.guardar = async () => {
console.log('Prueba guardado...')
  if (userRole !== 'admin') return alert('✖ Solo ADMIN puede crear/editar');
  const nombre = document.getElementById('nombre').value.trim();
  if (!nombre) return alert('✖ Nombre requerido');

  let imagenActual = editId ? (productos[editId]?.imagen || '') : '';
  const file = document.getElementById('fotoProducto').files[0];

  try {
    if (file) {
      showToast('⌛ Comprimiendo y subiendo foto...', 'info', 3000);
      imagenActual = await subirImagenProducto(file, nombre);
    }
    console.log('Guardando...')

    const data = {
      nombre,
      stock: Math.max(0, Number(document.getElementById('stock').value) || 0),
      proximo: Math.max(0, Number(document.getElementById('proximo').value) || 0),
      yoel: Math.max(0, Number(document.getElementById('yoel').value) || 0),
      laura: Math.max(0, Number(document.getElementById('laura').value) || 0),
      porEncargo: document.getElementById('porEncargo').checked,
      imagen: imagenActual,
      vendidos: editId ? Number(productos[editId]?.vendidos || 0) : 0,
      reservados: editId ? Number(productos[editId]?.reservados || 0) : 0,
      vyoel: editId ? Number(productos[editId]?.vyoel || 0) : 0,
      vLaura: editId ? Number(productos[editId]?.vLaura || 0) : 0,
      reservasDetalle: editId ? (Array.isArray(productos[editId]?.reservasDetalle) ? productos[editId].reservasDetalle : []) : [],
      emailAgotadoEnviado: editId ? !!productos[editId]?.emailAgotadoEnviado : false,
      ocultoIndex: editId ? !!productos[editId]?.ocultoIndex : false,
      historialNovedades: editId ? (productos[editId]?.historialNovedades || {}) : {}
    };

console.log('Probamos a guardar')
    if (editId) {
      const stockAnterior = Math.max(0, Number(productos[editId]?.stock || 0));
      await update(ref(db,'productos/'+editId), data);
      productos[editId] = data;
      if (data.stock > stockAnterior) {
        await registrarNovedadStock(editId, data, data.stock - stockAnterior, stockAnterior, data.stock);
      }
      await syncProductoPublico(editId, data);
      await guardarLog('producto-editado', editId, nombre, 0, currentUser.email);
      limpiarFormulario();
      showToast('✅ Actualizado', 'success');
    } else {
	  console.log(data)
      const newRef = await push(productosRef, data);
      productos[newRef.key] = data;
      if (data.stock > 0) {
        await registrarNovedadStock(newRef.key, data, data.stock, 0, data.stock);
      }
      await syncProductoPublico(newRef.key, data);
      await guardarLog('producto-creado', newRef.key, nombre, 0, currentUser.email);
      limpiarFormulario();
      showToast('✅ Guardado', 'success');
    }
  } catch (error) {
    console.error(error);
    showToast('✖ Error guardando producto/foto', 'error', 3500);
  }
};

window.modificarPrecioLaura = (id) => {
  if (!currentUser || !['admin', 'user'].includes(userRole)) {
    return showToast('✖ No tienes permiso para modificar el precio Laura', 'error');
  }

  const p = productos[id];
  openModal({
    title: '💵 Editar precio Laura',
    fields: [
      { name: 'precio', label: `Precio de venta para ${p.nombre}`, type: 'number', value: p?.laura || 0, min: 0, step: '0.01' }
    ],
    onConfirm: async (values) => {
      const precio = Math.max(0, Number(values.precio));
      if (isNaN(precio)) return showToast('✖ Precio inválido', 'error');
      await update(ref(db,'productos/'+id), { laura:precio });
      productos[id].laura = precio;
      await syncProductoPublico(id, productos[id]);
      await guardarLog('precio-laura', id, productos[id].nombre, precio, currentUser.email);
      showToast(`✅ Laura: €${precio.toFixed(2)}`, 'success');
      refrescarFichaProductoSiAbierta();
      programarRender();
    }
  });
};

window.modificarPrecioLauraGlobal = () => {
  openModal({
    title: '💷 Precio de venta global',
    fields: [
      { name: 'precio', label: 'Nuevo precio de venta para TODOS', type: 'number', value: 0, min: 0, step: '0.01' }
    ],
    onConfirm: async (values) => {
      const precio = Math.max(0, Number(values.precio));
      if (isNaN(precio)) return showToast('✖ Precio inválido', 'error');
      const updates = {};
      Object.entries(productos).forEach(([id]) => {
        updates[`productos/${id}/laura`] = precio;
        updates[`productos_publicos/${id}/laura`] = precio;
      });
      await update(ref(db), updates);
      for (const [id, p] of Object.entries(productos)) {
        productos[id].laura = precio;
        await guardarLog('precio-laura-global', id, p.nombre, precio, currentUser.email);
      }
      showToast(`✅ Laura GLOBAL: €${precio.toFixed(2)}`, 'success');
    }
  });
};

window.editar = (id) => {
  if (userRole !== 'admin') return alert('✖ Solo ADMIN puede editar');
  const p = productos[id];
  document.getElementById('nombre').value = p.nombre || '';
  document.getElementById('stock').value = p.stock || 0;
  document.getElementById('proximo').value = p.proximo || 0;
  document.getElementById('yoel').value = p.yoel || 0;
  document.getElementById('laura').value = p.laura || 0;
  document.getElementById('porEncargo').checked = p.porEncargo === true;
  document.getElementById('fotoProducto').value = '';
  editId = id;
  document.getElementById('productFormTitle').textContent = 'Editar producto';
  document.getElementById('productFormSubtitle').textContent = `Modifica la información de ${p.nombre || 'este producto'}.`;
  document.getElementById('guardarBtn').textContent = 'Guardar cambios';
  abrirEditorProducto();
};

window.borrar = (id) => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede borrar', 'error');
  const nombre = productos[id]?.nombre || 'Producto';
  openConfirm({
    title: '🗑️ Borrar producto',
    message: `¿Seguro que quieres borrar "${nombre}"?`,
    confirmText: 'Borrar',
    danger: true,
    onConfirm: async () => {
      await guardarLog('producto-borrado', id, productos[id].nombre, 0, currentUser.email);
      await remove(ref(db,'productos/'+id));
      await remove(ref(db,'productos_publicos/'+id));
      delete productos[id];
      showToast('✅ Borrado', 'success');
    }
  });
};

window.toggleOcultoIndex = async (id, forzarEstado = null) => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede ocultar o mostrar en index', 'error');

  const producto = productos[id];
  if (!producto) return showToast('✖ Producto no encontrado', 'error');

  const nuevoEstado = typeof forzarEstado === 'boolean' ? forzarEstado : !productoOcultoEnIndex(producto);

  await update(ref(db, 'productos/' + id), { ocultoIndex: nuevoEstado });
  productos[id].ocultoIndex = nuevoEstado;

  await guardarLog(
    nuevoEstado ? 'producto-oculto-index' : 'producto-visible-index',
    id,
    producto.nombre || 'Producto',
    0,
    currentUser.email,
    nuevoEstado ? 'Ocultado solo del index' : 'Mostrado otra vez en index'
  );

  renderTablaSolo();
  renderOcultosIndex();
  showToast(
    nuevoEstado ? `🙈 "${producto.nombre}" oculto solo del index` : `👁️ "${producto.nombre}" visible otra vez en index`,
    'success'
  );
};

function dinero(valor) {
  return `${Number(valor || 0).toFixed(2)} €`;
}

function ultimaLiquidacionTimestamp() {
  return Object.values(liquidaciones || {}).reduce((ultimo, item) => {
    return Math.max(ultimo, Number(item?.timestamp || 0));
  }, 0);
}

function renderResumenLiquidacionActual() {
  const wrap = document.getElementById('liquidacionActualResumen');
  if (!wrap) return;

  const cobrado = Number(totalesGlobales.laura || 0);
  const paraYoel = Number(totalesGlobales.yoel || 0);
  const ganancia = cobrado - paraYoel;
  const unidades = Number(totalesGlobales.vendidos || 0);

  wrap.innerHTML = `
    <div><span>Unidades pendientes</span><strong>${unidades}</strong></div>
    <div><span>Total cobrado</span><strong>${dinero(cobrado)}</strong></div>
    <div><span>A entregar a Yoel</span><strong>${dinero(paraYoel)}</strong></div>
    <div><span>Ganancia vendedora</span><strong>${dinero(ganancia)}</strong></div>
  `;
}

function cargarLiquidaciones() {
  if (liquidacionesListenerIniciado || userRole !== 'admin') return;
  liquidacionesListenerIniciado = true;

  onValue(liquidacionesRef, (snap) => {
    liquidaciones = snap.val() || {};
    renderLiquidaciones();
  }, (error) => {
    console.error('Error cargando liquidaciones:', error);
    showToast('✖ No se pudo cargar el historial de liquidaciones', 'error', 3500);
  });
}

window.renderLiquidaciones = () => {
  const tbody = document.getElementById('tablaLiquidaciones');
  const empty = document.getElementById('liquidacionesEmpty');
  const tableWrap = document.getElementById('liquidacionesTableWrap');
  if (!tbody || !empty || !tableWrap) return;

  const items = Object.entries(liquidaciones || {})
    .map(([id, item]) => ({ id, ...(item || {}) }))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

  if (!items.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  tableWrap.classList.remove('hidden');
  tbody.innerHTML = items.slice(0, 30).map(item => {
    const fecha = new Date(Number(item.timestamp || Date.now())).toLocaleString('es-ES');
    const pagada = item.estado !== 'pendiente';
    return `
      <tr>
        <td>${escaparHtml(fecha)}</td>
        <td>${Number(item.unidades || 0)}</td>
        <td><strong>${dinero(item.totalCobrado)}</strong></td>
        <td><strong>${dinero(item.paraYoel)}</strong></td>
        <td>${dinero(item.gananciaVendedora)}</td>
        <td><span class="liquidacion-estado ${pagada ? 'pagada' : 'pendiente'}">${pagada ? 'Pagada' : 'Pendiente'}</span></td>
        <td>${pagada
          ? '<span class="liquidacion-ok">✓ Entregada</span>'
          : `<button class="green" onclick="marcarLiquidacionPagada('${item.id}')">Marcar pagada</button>`
        }</td>
      </tr>
    `;
  }).join('');
};

window.marcarLiquidacionPagada = async (id) => {
  if (userRole !== 'admin') return;
  await update(ref(db, `liquidaciones/${id}`), {
    estado: 'pagada',
    pagadaEn: Date.now(),
    pagadaPor: currentUser?.email || ''
  });
  showToast('✅ Liquidación marcada como pagada', 'success');
};

window.cerrarLiquidacion = () => {
  if (userRole !== 'admin') return showToast('✖ Solo ADMIN puede cerrar una liquidación', 'error');

  const cobrado = Number(totalesGlobales.laura || 0);
  const paraYoel = Number(totalesGlobales.yoel || 0);
  const unidades = Number(totalesGlobales.vendidos || 0);
  const ganancia = cobrado - paraYoel;

  if (unidades <= 0 && cobrado <= 0 && paraYoel <= 0) {
    return showToast('No hay ventas pendientes de liquidar', 'info', 2800);
  }

  openModal({
    title: '🤝 Cerrar liquidación',
    message: `${unidades} unidades · Cobrado ${dinero(cobrado)} · Para Yoel ${dinero(paraYoel)} · Ganancia ${dinero(ganancia)}. Solo se pondrán a cero las ventas pendientes; el stock y las reservas se conservarán.`,
    confirmText: 'Confirmar y guardar',
    fields: [
      { name: 'notas', label: 'Observaciones (opcional)', type: 'text', value: '' }
    ],
    onConfirm: async (values) => {
      const timestamp = Date.now();
      const nuevaRef = push(liquidacionesRef);
      const detalleProductos = {};
      const updates = {};

      Object.entries(productos).forEach(([id, p]) => {
        const vendidos = Number(p?.vendidos || 0);
        const totalYoel = Number(p?.vyoel || 0);
        const totalVenta = Number(p?.vLaura || 0);
        if (vendidos > 0 || totalYoel > 0 || totalVenta > 0) {
          detalleProductos[id] = {
            nombre: p?.nombre || '',
            unidades: vendidos,
            paraYoel: totalYoel,
            totalCobrado: totalVenta,
            gananciaVendedora: totalVenta - totalYoel
          };
        }

        updates[`productos/${id}/vyoel`] = 0;
        updates[`productos/${id}/vLaura`] = 0;
        updates[`productos/${id}/vendidos`] = 0;
      });

      const liquidacion = {
        timestamp,
        fecha: new Date(timestamp).toLocaleString('es-ES'),
        periodoDesde: ultimaLiquidacionTimestamp() || null,
        unidades,
        totalCobrado: cobrado,
        paraYoel,
        gananciaVendedora: ganancia,
        estado: 'pagada',
        pagadaEn: timestamp,
        creadaPor: currentUser?.email || '',
        notas: String(values.notas || '').trim(),
        detalleProductos
      };

      updates[`liquidaciones/${nuevaRef.key}`] = liquidacion;

      await update(ref(db), updates);

      Object.values(productos).forEach(p => {
        p.vyoel = 0;
        p.vLaura = 0;
        p.vendidos = 0;
      });

      await guardarLog(
        'liquidacion-cerrada',
        null,
        'LIQUIDACIÓN',
        unidades,
        currentUser.email,
        `Cobrado:${dinero(cobrado)} | Para Yoel:${dinero(paraYoel)} | Ganancia:${dinero(ganancia)}`,
        { liquidacionId: nuevaRef.key, totalCobrado: cobrado, totalyoel: paraYoel, gananciaVendedora: ganancia }
      );

      showToast('✅ Liquidación guardada. Stock y reservas conservados.', 'success', 4000);
    }
  });
};

// Compatibilidad con enlaces o versiones antiguas que todavía llamen a resetear().
window.resetear = window.cerrarLiquidacion;

window.abrirFichaProducto = (id) => {
  const p = productos[id];
  if (!p) return showToast('✖ Producto no encontrado', 'error');

  const btnReserva = document.getElementById('btnVerReservaFicha');
  const btnVenta = document.getElementById('btnEliminarVentaFicha');

  if ((p.reservados || 0) > 0) {
    btnReserva.classList.remove('hidden');
  } else {
    btnReserva.classList.add('hidden');
  }

  if ((p.vendidos || 0) > 0) {
    btnVenta.classList.remove('hidden');
  } else {
    btnVenta.classList.add('hidden');
  }

  productoModalActualId = id;

  document.getElementById('productoModalNombre').textContent = p.nombre || 'Producto';
  document.getElementById('productoModalStock').textContent = Number(p.stock || 0);
  document.getElementById('productoModalProximo').textContent = Number(p.proximo || 0);
  document.getElementById('productoModalReservados').textContent = Number(p.reservados || 0);
  document.getElementById('productoModalVendidos').textContent = Number(p.vendidos || 0);
  document.getElementById('productoModalyoel').textContent = Number(p.yoel || 0).toFixed(2);
  document.getElementById('productoModalLaura').textContent = Number(p.laura || 0).toFixed(2);

  const img = document.getElementById('productoModalImg');
  if (p.imagen) {
    img.src = p.imagen;
    img.style.display = 'block';
  } else {
    img.src = '';
    img.style.display = 'none';
  }

  document.getElementById('productoModalCantReserva').value = 1;
  document.getElementById('productoModalCantVenta').value = 1;

  const editarBtn = document.getElementById('productoModalEditarBtn');
const borrarBtn = document.getElementById('productoModalBorrarBtn');
const editarLauraBtn = document.getElementById('btnEditarLauraFicha');
const ocultarIndexBtn = document.getElementById('btnOcultarIndexFicha');

if (userRole === 'admin') {
  editarBtn.classList.remove('hidden');
  borrarBtn.classList.remove('hidden');
  editarLauraBtn.classList.remove('hidden');
  ocultarIndexBtn.classList.remove('hidden');
  ocultarIndexBtn.textContent = productoOcultoEnIndex(p) ? '👁️ Index' : '🙈 Index';
  ocultarIndexBtn.title = productoOcultoEnIndex(p) ? 'Mostrar otra vez en index' : 'Ocultar solo del index';
} else if (userRole === 'user') {
  editarBtn.classList.add('hidden');
  borrarBtn.classList.add('hidden');
  editarLauraBtn.classList.remove('hidden');
  ocultarIndexBtn.classList.add('hidden');
} else {
  editarBtn.classList.add('hidden');
  borrarBtn.classList.add('hidden');
  editarLauraBtn.classList.add('hidden');
  ocultarIndexBtn.classList.add('hidden');
}

  document.getElementById('productoModal').classList.add('show');
};

window.cerrarFichaProducto = () => {
  document.getElementById('productoModal').classList.remove('show');
  productoModalActualId = null;
};

window.reservarDesdeFicha = () => {
  if (!productoModalActualId) return;

  const id = productoModalActualId;
  const cant = document.getElementById('productoModalCantReserva').value || 1;

  cerrarFichaProducto();

  setTimeout(() => {
    reservar(id, cant);
  }, 180);
};

window.venderDesdeFicha = () => {
  if (!productoModalActualId) return;

  const id = productoModalActualId;
  const cant = document.getElementById('productoModalCantVenta').value || 1;

  cerrarFichaProducto();

  setTimeout(() => {
    vender(id, cant);
  }, 180);
};

window.verQRProductoDesdeFicha = () => {
  if (!productoModalActualId) return;

  const id = productoModalActualId;

  cerrarFichaProducto();

  setTimeout(() => {
    verQRProducto(id);
  }, 180);
};
window.modificarPrecioLauraDesdeFicha = () => {
  if (!productoModalActualId) return;

  if (!currentUser || !['admin', 'user'].includes(userRole)) {
    return showToast('✖ No tienes permiso para modificar el precio Laura', 'error');
  }

  const id = productoModalActualId;
  const p = productos[id];
  if (!p) return showToast('✖ Producto no encontrado', 'error');

  cerrarFichaProducto();

  setTimeout(() => {
    openModal({
      title: '💵 Editar precio Laura',
      fields: [
        {
          name: 'precio',
          label: `Precio de venta para ${p.nombre}`,
          type: 'number',
          value: p?.laura || 0,
          min: 0,
          step: '0.01'
        }
      ],
      onConfirm: async (values) => {
        const precio = Math.max(0, Number(values.precio));
        if (isNaN(precio)) return showToast('✖ Precio inválido', 'error');

        await update(ref(db, 'productos/' + id), { laura: precio });
        productos[id].laura = precio;

        await syncProductoPublico(id, productos[id]);
        await guardarLog('precio-laura', id, productos[id].nombre, precio, currentUser.email);

        document.getElementById('productoModalLaura').textContent = precio.toFixed(2);
        programarRender();

        showToast(`✅ Laura: €${precio.toFixed(2)}`, 'success');
      }
    });
  }, 180);
};

window.toggleOcultoIndexDesdeFicha = async () => {
  if (!productoModalActualId) return;
  await toggleOcultoIndex(productoModalActualId);
  const p = productos[productoModalActualId];
  const btn = document.getElementById('btnOcultarIndexFicha');
  if (btn && p) {
    btn.textContent = productoOcultoEnIndex(p) ? '👁️ Index' : '🙈 Index';
    btn.title = productoOcultoEnIndex(p) ? 'Mostrar otra vez en index' : 'Ocultar solo del index';
  }
};

window.editarDesdeFicha = () => {
  if (!productoModalActualId) return;

  const id = productoModalActualId;

  cerrarFichaProducto();

  setTimeout(() => {
    editar(id);
  }, 180);
};

window.borrarDesdeFicha = () => {
  if (!productoModalActualId) return;

  const id = productoModalActualId;

  cerrarFichaProducto();

  setTimeout(() => {
    borrar(id);
  }, 180);
};

window.verReservaDesdeFicha = () => {
  if (!productoModalActualId) return;

  const id = productoModalActualId;

  // 🔴 cerrar ficha primero
  cerrarFichaProducto();

  // ⏱️ pequeño delay para que no se solapen modales
  setTimeout(() => {
    verReserva(id);
  }, 180);
};

window.eliminarVentaDesdeFicha = () => {
  if (!productoModalActualId) return;

  const id = productoModalActualId;

  // cerrar ficha primero
  cerrarFichaProducto();

  // pequeño retraso para evitar solape de modales
  setTimeout(() => {
    eliminarUnaVenta(id);
  }, 180);
};

window.refrescarFichaProductoSiAbierta = () => {
  if (!productoModalActualId) return;
  const p = productos[productoModalActualId];
  if (!p) {
    cerrarFichaProducto();
    return;
  }

  document.getElementById('productoModalNombre').textContent = p.nombre || 'Producto';
  document.getElementById('productoModalStock').textContent = Number(p.stock || 0);
  document.getElementById('productoModalProximo').textContent = Number(p.proximo || 0);
  document.getElementById('productoModalReservados').textContent = Number(p.reservados || 0);
  document.getElementById('productoModalVendidos').textContent = Number(p.vendidos || 0);
  document.getElementById('productoModalyoel').textContent = Number(p.yoel || 0).toFixed(2);
  document.getElementById('productoModalLaura').textContent = Number(p.laura || 0).toFixed(2);

  const img = document.getElementById('productoModalImg');
  if (p.imagen) {
    img.src = p.imagen;
    img.style.display = 'block';
  } else {
    img.src = '';
    img.style.display = 'none';
  }
};

document.getElementById('productoModal').onclick = (e) => {
  if (e.target.id === 'productoModal') cerrarFichaProducto();
};

document.getElementById('productEditorModal').onclick = (e) => {
  if (e.target.id === 'productEditorModal') cancelarEdit();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('productEditorModal').classList.contains('show')) {
    cancelarEdit();
  }
});

function limpiarFormulario(cerrarModal = true) {
  document.getElementById('nombre').value = '';
  document.getElementById('stock').value = '';
  document.getElementById('proximo').value = '';
  document.getElementById('yoel').value = '';
  document.getElementById('laura').value = '';
  document.getElementById('porEncargo').checked = false;
  document.getElementById('fotoProducto').value = '';
  editId = null;
  document.getElementById('productFormTitle').textContent = 'Nuevo producto';
  document.getElementById('productFormSubtitle').textContent = 'Añade el stock, los importes y una fotografía.';
  document.getElementById('guardarBtn').textContent = 'Crear producto';
  if (cerrarModal) cerrarEditorProducto();
}

window.cancelarEdit = () => {
  limpiarFormulario();
  showToast('Edición cancelada', 'info', 1200);
};
})().catch(window.INVENTARIO_BOOT.showBootError);
