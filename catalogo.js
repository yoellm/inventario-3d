(async function () {
  const config = window.INVENTARIO_CONFIG || {};
  const catalogDatabaseURL = config.publicCatalogDatabaseURL || config.firebaseConfig?.databaseURL;
  if (!catalogDatabaseURL) throw new Error('Falta la configuración del catálogo público');
  const catalogUrl = `${catalogDatabaseURL.replace(/\/$/, '')}/productos_publicos.json`;

  const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const state = { productos: [], filtro: 'todos', texto: '', orden: 'nombre-asc' };

  const grid = document.getElementById('catalogGrid');
  const status = document.getElementById('catalogStatus');
  const empty = document.getElementById('catalogEmpty');
  const resultCount = document.getElementById('catalogResultCount');
  const totalProductos = document.getElementById('totalProductos');
  const dialog = document.getElementById('catalogProductDialog');
  const liveIndicator = document.getElementById('catalogLiveIndicator');
  let primeraCarga = true;

  function normalizarTexto(value = '') {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function disponibilidad(producto) {
    const stock = Number(producto.stock || 0);
    if (stock > 0 && stock <= 3) return { key: 'low', text: 'Últimas unidades' };
    if (stock > 3) return { key: 'available', text: 'En stock' };
    if (producto.porEncargo) return { key: 'order', text: 'Por encargo' };
    return { key: 'out', text: 'Agotado' };
  }

  function productosFiltrados() {
    const texto = normalizarTexto(state.texto);
    const items = state.productos.filter(producto => {
      if (texto && !normalizarTexto(producto.nombre).includes(texto)) return false;
      const stock = Number(producto.stock || 0);
      if (state.filtro === 'disponibles' && stock <= 0) return false;
      if (state.filtro === 'encargo' && !producto.porEncargo) return false;
      if (state.filtro === 'agotados' && (stock > 0 || producto.porEncargo)) return false;
      return true;
    });

    return items.sort((a, b) => {
      if (state.orden === 'precio-asc') return Number(a.laura) - Number(b.laura);
      if (state.orden === 'precio-desc') return Number(b.laura) - Number(a.laura);
      return String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });
    });
  }

  function crearPlaceholder() {
    const placeholder = document.createElement('div');
    placeholder.className = 'card-placeholder';
    const logo = document.createElement('img');
    logo.src = 'logo.png';
    logo.alt = '';
    placeholder.appendChild(logo);
    return placeholder;
  }

  function crearImagen(producto, className = '') {
    if (!producto.imagen) return crearPlaceholder();
    const img = document.createElement('img');
    img.src = producto.imagen;
    img.alt = producto.nombre;
    img.loading = 'lazy';
    if (className) img.className = className;
    img.addEventListener('error', () => img.replaceWith(crearPlaceholder()));
    return img;
  }

  function crearBadge(producto) {
    const info = disponibilidad(producto);
    const badge = document.createElement('span');
    badge.className = `availability-badge ${info.key}`;
    badge.textContent = info.text;
    return badge;
  }

  function abrirProducto(producto) {
    const media = document.getElementById('dialogMedia');
    media.replaceChildren(crearImagen(producto));
    document.getElementById('dialogName').textContent = producto.nombre;
    document.getElementById('dialogPrice').textContent = money.format(Number(producto.laura || 0));

    const info = disponibilidad(producto);
    const badge = document.getElementById('dialogAvailability');
    badge.className = `availability-badge ${info.key}`;
    badge.textContent = info.text;
    const message = document.getElementById('dialogAvailabilityMessage');
    message.textContent = info.key === 'order'
      ? 'Este producto se fabrica por encargo. Consulta el plazo de realización antes de hacer tu pedido.'
      : info.key === 'out'
        ? 'Este producto no está disponible actualmente.'
        : 'Producto disponible. Consulta para realizar tu pedido.';
    dialog.showModal();
  }

  function crearTarjeta(producto) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'catalog-card';
    card.setAttribute('aria-label', `Ver ${producto.nombre}`);

    const media = document.createElement('div');
    media.className = 'card-media';
    media.append(crearImagen(producto), crearBadge(producto));

    const content = document.createElement('div');
    content.className = 'card-content';
    const name = document.createElement('h2');
    name.className = 'card-name';
    name.textContent = producto.nombre;

    const bottom = document.createElement('div');
    bottom.className = 'card-bottom';
    const price = document.createElement('strong');
    price.className = 'card-price';
    price.textContent = money.format(Number(producto.laura || 0));
    const detail = document.createElement('span');
    detail.className = 'card-detail';
    detail.textContent = 'Ver detalle';
    bottom.append(price, detail);
    content.append(name, bottom);
    card.append(media, content);
    card.addEventListener('click', () => abrirProducto(producto));
    return card;
  }

  function render() {
    const items = productosFiltrados();
    grid.replaceChildren(...items.map(crearTarjeta));
    status.hidden = true;
    empty.hidden = items.length > 0;
    grid.hidden = items.length === 0;
    totalProductos.textContent = state.productos.length;
    resultCount.textContent = `Mostrando ${items.length} de ${state.productos.length} productos`;
  }

  function transformarProductos(data) {
    return Object.entries(data || {})
      .map(([id, producto]) => ({
        id,
        nombre: String(producto?.nombre || '').trim(),
        laura: Math.max(0, Number(producto?.laura || 0)),
        stock: Math.max(0, Number(producto?.stock || 0)),
        imagen: String(producto?.imagen || ''),
        porEncargo: producto?.porEncargo === true
      }))
      .filter(producto => producto.nombre && producto.laura > 0);
  }

  function mostrarError(error) {
    console.error('No se pudo cargar el catálogo público:', error);
    liveIndicator.classList.add('error');
    liveIndicator.lastChild.textContent = ' Sin conexión con el catálogo';
    if (!primeraCarga) return;

    status.classList.add('error');
    status.replaceChildren();
    const message = document.createElement('span');
    message.textContent = 'No se pudo cargar el catálogo. Comprueba tu conexión e inténtalo de nuevo.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'catalog-retry';
    retry.textContent = 'Reintentar';
    retry.addEventListener('click', () => {
      status.classList.remove('error');
      status.replaceChildren();
      const spinner = document.createElement('div');
      spinner.className = 'catalog-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      const loading = document.createElement('span');
      loading.textContent = 'Cargando productos…';
      status.append(spinner, loading);
      cargarProductos();
    }, { once: true });
    status.append(message, retry);
    resultCount.textContent = 'Catálogo no disponible';
    totalProductos.textContent = '—';
  }

  async function cargarProductos() {
    try {
      const response = await fetch(catalogUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Firebase respondió ${response.status}`);
      state.productos = transformarProductos(await response.json());
      liveIndicator.classList.remove('error');
      liveIndicator.lastChild.textContent = ' Disponibilidad actualizada';
      status.classList.remove('error');
      render();
      primeraCarga = false;
    } catch (error) {
      mostrarError(error);
    }
  }

  document.getElementById('catalogSearch').addEventListener('input', event => {
    state.texto = event.target.value;
    render();
  });

  document.getElementById('catalogSort').addEventListener('change', event => {
    state.orden = event.target.value;
    render();
  });

  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.filtro = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
      render();
    });
  });

  document.getElementById('clearCatalogFilters').addEventListener('click', () => {
    state.texto = '';
    state.filtro = 'todos';
    state.orden = 'nombre-asc';
    document.getElementById('catalogSearch').value = '';
    document.getElementById('catalogSort').value = 'nombre-asc';
    document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item.dataset.filter === 'todos'));
    render();
  });

  document.getElementById('closeCatalogDialog').addEventListener('click', () => dialog.close());
  document.getElementById('dialogDone').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) dialog.close();
    }
  });

  await cargarProductos();
  window.setInterval(cargarProductos, 30000);
})().catch(error => console.error('No se pudo iniciar el catálogo:', error));
