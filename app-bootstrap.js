(function () {
  let firebasePromise = null;

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

  window.INVENTARIO_BOOT = Object.freeze({ loadFirebase, showBootError });
})();
