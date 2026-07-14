(async function () {
  const [firebaseApp, firebaseDatabase, firebaseAuth] = await window.INVENTARIO_BOOT.loadFirebase();
  const { initializeApp } = firebaseApp;
  const { getDatabase, ref, onValue } = firebaseDatabase;
  const { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } = firebaseAuth;
  const { firebaseConfig, ADMIN_EMAILS, USER_EMAILS } = window.INVENTARIO_CONFIG;

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const auth = getAuth(app);
  const productosRef = ref(db, 'productos');

  let productos = {};
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

  function setStatus(type, message) {
    const status = document.getElementById('status');
    status.className = `page-status ${type}`;
    status.textContent = message;
  }

  function estadoStock(stock) {
    if (stock <= 0) return { key: 'out', label: 'Agotado' };
    if (stock <= 5) return { key: 'low', label: 'Stock bajo' };
    return { key: 'available', label: 'Disponible' };
  }

  function listaFiltrada() {
    const texto = normalizarTexto(document.getElementById('buscarStock').value);
    const filtro = document.getElementById('filtroStock').value;
    const orden = document.getElementById('ordenStock').value;

    const lista = Object.entries(productos || {})
      .map(([id, producto]) => ({
        id,
        nombre: String(producto?.nombre || '').trim(),
        stock: Math.max(0, Number(producto?.stock || 0))
      }))
      .filter(producto => producto.nombre)
      .filter(producto => !texto || normalizarTexto(producto.nombre).includes(texto))
      .filter(producto => {
        if (filtro === 'disponibles') return producto.stock > 0;
        if (filtro === 'bajo') return producto.stock > 0 && producto.stock <= 5;
        if (filtro === 'agotados') return producto.stock <= 0;
        return true;
      });

    lista.sort((a, b) => {
      if (orden === 'stock-desc') return b.stock - a.stock || a.nombre.localeCompare(b.nombre, 'es');
      if (orden === 'stock-asc') return a.stock - b.stock || a.nombre.localeCompare(b.nombre, 'es');
      return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
    });
    return lista;
  }

  window.renderStock = function () {
    const lista = listaFiltrada();
    const tbody = document.getElementById('stockTabla');
    const empty = document.getElementById('stockEmpty');
    const tableWrap = document.querySelector('.operations-table-wrap');

    const rows = lista.map(producto => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const statusCell = document.createElement('td');
      const stock = document.createElement('td');
      const info = estadoStock(producto.stock);
      const badge = document.createElement('span');

      name.textContent = producto.nombre;
      badge.className = `stock-badge ${info.key}`;
      badge.textContent = info.label;
      statusCell.appendChild(badge);
      stock.className = 'stock-value';
      stock.textContent = producto.stock;
      row.append(name, statusCell, stock);
      return row;
    });

    tbody.replaceChildren(...rows);
    empty.classList.toggle('hidden', lista.length > 0);
    tableWrap.classList.toggle('hidden', lista.length === 0);

    const total = lista.reduce((sum, producto) => sum + producto.stock, 0);
    const bajos = lista.filter(producto => producto.stock > 0 && producto.stock <= 5).length;
    const agotados = lista.filter(producto => producto.stock <= 0).length;
    document.getElementById('totalProductos').textContent = lista.length;
    document.getElementById('totalStock').textContent = total;
    document.getElementById('totalStockBajo').textContent = bajos;
    document.getElementById('totalAgotados').textContent = agotados;
    document.getElementById('stockResultCount').textContent = `${lista.length} producto${lista.length === 1 ? '' : 's'}`;
  };

  function iniciarListener() {
    if (listenerIniciado) return;
    listenerIniciado = true;
    onValue(productosRef, snapshot => {
      productos = snapshot.val() || {};
      window.renderStock();
    }, error => {
      console.error('No se pudo cargar el stock:', error);
      setStatus('error', `No se pudo cargar el stock: ${error.message}`);
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
  window.limpiarStockFiltros = function () {
    document.getElementById('buscarStock').value = '';
    document.getElementById('filtroStock').value = 'todos';
    document.getElementById('ordenStock').value = 'nombre';
    window.renderStock();
  };
  window.imprimirStock = () => window.print();

  document.getElementById('buscarStock').addEventListener('input', window.renderStock);
  document.getElementById('filtroStock').addEventListener('change', window.renderStock);
  document.getElementById('ordenStock').addEventListener('change', window.renderStock);
  document.getElementById('userPass').addEventListener('keydown', event => {
    if (event.key === 'Enter') window.login();
  });

  onAuthStateChanged(auth, async user => {
    const role = user ? getRole(user.email) : null;
    const loginDiv = document.getElementById('loginDiv');
    const stockApp = document.getElementById('stockApp');
    document.body.classList.toggle('es-admin', role === 'admin');
    document.body.classList.toggle('es-user', role === 'user');

    if (!user || !role) {
      stockApp.classList.add('hidden');
      loginDiv.classList.remove('hidden');
      if (user && !role) {
        document.getElementById('loginStatus').textContent = 'Esta cuenta no tiene permiso para consultar el stock.';
        await signOut(auth).catch(() => {});
      }
      return;
    }

    loginDiv.classList.add('hidden');
    stockApp.classList.remove('hidden');
    setStatus(role, `${role === 'admin' ? 'Administrador' : 'Usuario'} · ${user.email} · Stock sincronizado`);
    iniciarListener();
  });
})().catch(window.INVENTARIO_BOOT.showBootError);
