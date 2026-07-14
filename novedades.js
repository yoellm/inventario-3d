(async function () {
  const [firebaseApp, firebaseDatabase, firebaseAuth] = await window.INVENTARIO_BOOT.loadFirebase();
  const { initializeApp } = firebaseApp;
  const { getDatabase, ref, onValue, update } = firebaseDatabase;
  const { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } = firebaseAuth;
  const { firebaseConfig, ADMIN_EMAILS, USER_EMAILS } = window.INVENTARIO_CONFIG;

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const auth = getAuth(app);
  const productosRef = ref(db, 'productos');

  let productos = {};
  let novedades = [];
  let currentRole = null;
  let listenerIniciado = false;

  const normalizarEmail = value => String(value || '').trim().toLowerCase();
  const admins = ADMIN_EMAILS.map(normalizarEmail);
  const users = USER_EMAILS.map(normalizarEmail);

  function getRole(email) {
    const value = normalizarEmail(email);
    if (admins.includes(value)) return 'admin';
    if (users.includes(value)) return 'user';
    return null;
  }

  function normalizarTexto(value = '') {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function fechaLocal(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setStatus(type, message) {
    const status = document.getElementById('status');
    status.className = `page-status ${type}`;
    status.textContent = message;
  }

  function reconstruirNovedades() {
    novedades = [];
    Object.entries(productos || {}).forEach(([productoId, producto]) => {
      Object.entries(producto?.historialNovedades || {}).forEach(([id, item]) => {
        const timestamp = Number(item?.timestamp || 0);
        novedades.push({
          id,
          productoId,
          productoNombre: String(item?.productoNombre || producto?.nombre || 'Producto'),
          imagen: String(item?.imagen || producto?.imagen || ''),
          cantidadAnadida: Math.max(0, Number(item?.cantidadAnadida ?? item?.cantidad ?? 0)),
          stockAnterior: Math.max(0, Number(item?.stockAnterior || 0)),
          stockTotal: Math.max(0, Number(item?.stockTotal || 0)),
          timestamp,
          fechaDia: String(item?.fechaDia || fechaLocal(timestamp)),
          usuario: String(item?.usuario || '')
        });
      });
    });
    novedades.sort((a, b) => b.timestamp - a.timestamp);
  }

  function novedadesFiltradas() {
    const texto = normalizarTexto(document.getElementById('buscarNovedades').value);
    const desde = document.getElementById('novedadesDesde').value;
    const hasta = document.getElementById('novedadesHasta').value;
    return novedades.filter(item => {
      const fecha = item.fechaDia || fechaLocal(item.timestamp);
      return (!texto || normalizarTexto(item.productoNombre).includes(texto)) &&
        (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
    });
  }

  function crearImagen(item) {
    const container = document.createElement('div');
    container.className = 'novedad-image';
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.src = item.imagen || 'logo.png';
    if (!item.imagen) image.className = 'placeholder';
    image.addEventListener('error', () => {
      image.src = 'logo.png';
      image.className = 'placeholder';
    }, { once: true });
    container.appendChild(image);
    return container;
  }

  function crearFila(label, value, className = '') {
    const row = document.createElement('div');
    row.className = 'novedad-row';
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    text.textContent = label;
    strong.textContent = value;
    if (className) strong.className = className;
    row.append(text, strong);
    return row;
  }

  function crearTarjeta(item) {
    const card = document.createElement('article');
    card.className = 'novedad-card';
    const info = document.createElement('div');
    info.className = 'novedad-info';
    const name = document.createElement('h3');
    name.className = 'novedad-name';
    name.textContent = item.productoNombre;
    const time = document.createElement('div');
    time.className = 'novedad-time';
    const date = new Date(item.timestamp || Date.now());
    time.textContent = `${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${item.usuario ? ` · ${item.usuario}` : ''}`;
    info.append(
      name,
      crearFila('Añadidas', `+${item.cantidadAnadida}`, 'added'),
      crearFila('Stock anterior', item.stockAnterior),
      crearFila('Stock total', item.stockTotal),
      time
    );
    card.append(crearImagen(item), info);
    return card;
  }

  window.renderNovedades = function () {
    const lista = novedadesFiltradas();
    const content = document.getElementById('novedadesContenido');
    const empty = document.getElementById('novedadesEmpty');
    const groups = new Map();

    lista.forEach(item => {
      const key = item.fechaDia || fechaLocal(item.timestamp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const sections = [...groups.entries()].map(([dateKey, items]) => {
      const section = document.createElement('section');
      section.className = 'novedades-day';
      const title = document.createElement('div');
      title.className = 'novedades-day-title';
      title.textContent = new Date(`${dateKey}T12:00:00`).toLocaleDateString('es-ES', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
      });
      const grid = document.createElement('div');
      grid.className = 'novedades-grid';
      grid.replaceChildren(...items.map(crearTarjeta));
      section.append(title, grid);
      return section;
    });

    content.replaceChildren(...sections);
    content.classList.toggle('hidden', lista.length === 0);
    empty.classList.toggle('hidden', lista.length > 0);

    document.getElementById('totalNovedades').textContent = lista.length;
    document.getElementById('totalUnidadesNuevas').textContent = lista.reduce((sum, item) => sum + item.cantidadAnadida, 0);
    document.getElementById('totalProductosNuevos').textContent = new Set(lista.map(item => item.productoId)).size;
    document.getElementById('novedadesResultCount').textContent = `${lista.length} entrada${lista.length === 1 ? '' : 's'}`;
  };

  function iniciarListener() {
    if (listenerIniciado) return;
    listenerIniciado = true;
    onValue(productosRef, snapshot => {
      productos = snapshot.val() || {};
      reconstruirNovedades();
      window.renderNovedades();
    }, error => {
      console.error('No se pudieron cargar las novedades:', error);
      setStatus('error', `No se pudieron cargar las novedades: ${error.message}`);
    });
  }

  window.login = async function () {
    const email = document.getElementById('userEmail').value.trim();
    const password = document.getElementById('userPass').value;
    const loginStatus = document.getElementById('loginStatus');
    loginStatus.textContent = '';
    if (!email || !password) {
      loginStatus.textContent = 'Introduce el email y la contraseña.';
      return;
    }
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      loginStatus.textContent = 'No se pudo iniciar sesión. Revisa los datos introducidos.';
      console.error(error);
    }
  };

  window.resetLogin = function () {
    document.getElementById('userEmail').value = '';
    document.getElementById('userPass').value = '';
    document.getElementById('loginStatus').textContent = '';
  };
  window.logout = () => signOut(auth);
  window.imprimirNovedades = () => window.print();
  window.filtrarUltimosDias = function (days) {
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - (Math.max(1, Number(days)) - 1));
    document.getElementById('novedadesDesde').value = fechaLocal(start.getTime());
    document.getElementById('novedadesHasta').value = fechaLocal(today.getTime());
    window.renderNovedades();
  };
  window.filtrarNovedadesHoy = () => window.filtrarUltimosDias(1);
  window.limpiarNovedadesFiltros = function () {
    document.getElementById('buscarNovedades').value = '';
    document.getElementById('novedadesDesde').value = '';
    document.getElementById('novedadesHasta').value = '';
    window.renderNovedades();
  };

  window.borrarTodasNovedades = async function () {
    if (currentRole !== 'admin') return;
    if (!novedades.length) return alert('No hay novedades para borrar.');
    if (!confirm(`¿Borrar las ${novedades.length} entradas del historial de stock?\n\nEl stock actual no cambiará.`)) return;
    const changes = {};
    Object.entries(productos).forEach(([id, producto]) => {
      if (producto?.historialNovedades) changes[`productos/${id}/historialNovedades`] = null;
    });
    try {
      await update(ref(db), changes);
    } catch (error) {
      console.error(error);
      alert('No se pudo borrar el historial de novedades.');
    }
  };

  ['buscarNovedades', 'novedadesDesde', 'novedadesHasta'].forEach(id => {
    document.getElementById(id).addEventListener(id === 'buscarNovedades' ? 'input' : 'change', window.renderNovedades);
  });
  document.getElementById('userPass').addEventListener('keydown', event => {
    if (event.key === 'Enter') window.login();
  });

  onAuthStateChanged(auth, async user => {
    currentRole = user ? getRole(user.email) : null;
    const loginDiv = document.getElementById('loginDiv');
    const novedadesApp = document.getElementById('novedadesApp');
    document.body.classList.toggle('es-admin', currentRole === 'admin');
    document.body.classList.toggle('es-user', currentRole === 'user');
    document.body.classList.toggle('auth-nav-visible', !!currentRole);
    document.getElementById('borrarNovedadesBtn').classList.toggle('hidden', currentRole !== 'admin');

    if (!user || !currentRole) {
      novedadesApp.classList.add('hidden');
      if (user && !currentRole) {
        await signOut(auth).catch(() => {});
      }
      window.INVENTARIO_BOOT.redirectToLogin();
      return;
    }

    loginDiv.classList.add('hidden');
    novedadesApp.classList.remove('hidden');
    setStatus(currentRole, `${currentRole === 'admin' ? 'Administrador' : 'Usuario'} · ${user.email} · Novedades sincronizadas`);
    iniciarListener();
  });
})().catch(window.INVENTARIO_BOOT.showBootError);
