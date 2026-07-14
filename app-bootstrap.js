(function () {
  let firebasePromise = null;
  const PRIVATE_PAGES = new Set([
    'stock.html',
    'novedades.html',
    'ventas-propias.html',
    'estadisticas.html',
    'logs.html',
    'gastos.html'
  ]);
  const USER_PAGES = new Set(['stock.html', 'novedades.html']);

  function loadFirebase() {
    if (!firebasePromise) {
      firebasePromise = Promise.all([
        import('https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js'),
        import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js')
      ]);
    }
    return firebasePromise;
  }

  function showBootError(error) {
    console.error('No se pudo iniciar la aplicación:', error);
    document.documentElement.dataset.appBoot = 'error';

    let aviso = document.getElementById('appBootError');
    if (!aviso) {
      aviso = document.createElement('div');
      aviso.id = 'appBootError';
      aviso.className = 'app-boot-error';
      aviso.setAttribute('role', 'alert');
      aviso.textContent = 'No se pudo cargar la aplicación. Comprueba tu conexión y vuelve a abrir la página.';
      document.body.prepend(aviso);
    }
  }

  function currentPrivatePage() {
    const page = location.pathname.split('/').pop() || 'index.html';
    if (!PRIVATE_PAGES.has(page)) return '';
    return `${page}${location.search}${location.hash}`;
  }

  function redirectToLogin() {
    const next = currentPrivatePage();
    const target = next ? `index.html?next=${encodeURIComponent(next)}` : 'index.html';
    location.replace(target);
  }

  function requestedPrivatePage(role) {
    const requested = new URLSearchParams(location.search).get('next');
    if (!requested) return '';
    try {
      const target = new URL(requested, location.href);
      const page = target.pathname.split('/').pop();
      if (target.origin !== location.origin || !PRIVATE_PAGES.has(page)) return '';
      if (role !== 'admin' && !USER_PAGES.has(page)) return '';
      return `${page}${target.search}${target.hash}`;
    } catch (error) {
      return '';
    }
  }

  window.INVENTARIO_BOOT = Object.freeze({
    loadFirebase,
    showBootError,
    redirectToLogin,
    requestedPrivatePage
  });
})();
