(function () {
  const supportedProtocol = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferredInstallPrompt = null;
  let installButton = null;
  let acceptedUpdate = false;
  let activeNotice = null;

  function injectStyles() {
    if (document.getElementById('pwaUiStyles')) return;
    const style = document.createElement('style');
    style.id = 'pwaUiStyles';
    style.textContent = `
      .pwa-install-button{position:fixed;z-index:20000;right:18px;bottom:max(18px,env(safe-area-inset-bottom));display:inline-flex;min-height:44px;padding:0 17px;align-items:center;gap:8px;color:#fff!important;border:0!important;border-radius:999px!important;background:#6750a4!important;box-shadow:0 8px 28px rgba(29,27,32,.24)!important;font:600 13px/1 Roboto,"Segoe UI",Arial,sans-serif!important;cursor:pointer}
      .pwa-install-button::before{content:"↓";display:grid;width:22px;height:22px;place-items:center;border-radius:50%;background:rgba(255,255,255,.16);font-size:15px}
      .pwa-notice{position:fixed;z-index:20001;left:18px;bottom:max(18px,env(safe-area-inset-bottom));display:flex;max-width:min(460px,calc(100% - 36px));min-height:48px;padding:8px 9px 8px 15px;align-items:center;gap:14px;color:#fff;border-radius:13px;background:#323036;box-shadow:0 9px 30px rgba(29,27,32,.25);font:500 12px/1.35 Roboto,"Segoe UI",Arial,sans-serif}
      .pwa-notice.offline{background:#8c1d18}.pwa-notice.online{background:#285b42}
      .pwa-notice button{min-height:34px;padding:0 12px;flex:0 0 auto;color:#fff!important;border:1px solid rgba(255,255,255,.34)!important;border-radius:999px!important;background:transparent!important;box-shadow:none!important;font:600 11px/1 Roboto,"Segoe UI",Arial,sans-serif!important;cursor:pointer}
      .pwa-ios-backdrop{position:fixed;z-index:20002;inset:0;display:grid;padding:18px;place-items:center;background:rgba(29,27,32,.54);backdrop-filter:blur(3px)}
      .pwa-ios-dialog{position:relative;width:min(430px,100%);padding:28px;color:#1d1b20;border:1px solid #d6d0da;border-radius:22px;background:#fff;box-shadow:0 24px 80px rgba(29,27,32,.3);font-family:Roboto,"Segoe UI",Arial,sans-serif}
      .pwa-ios-dialog h2{margin:0 0 8px;font-size:23px;font-weight:600}.pwa-ios-dialog p{margin:0 0 18px;color:#625f66;font-size:13px;line-height:1.5}
      .pwa-ios-dialog ol{display:grid;gap:12px;margin:0;padding-left:22px;color:#1d1b20;font-size:13px;line-height:1.45}.pwa-ios-dialog strong{color:#6750a4}
      .pwa-ios-close{width:100%;min-height:43px;margin-top:22px;color:#fff!important;border:0!important;border-radius:999px!important;background:#6750a4!important;font:600 13px/1 Roboto,"Segoe UI",Arial,sans-serif!important;cursor:pointer}
      @media(max-width:600px){.pwa-install-button{right:12px;bottom:max(12px,env(safe-area-inset-bottom))}.pwa-notice{right:12px;bottom:max(68px,calc(env(safe-area-inset-bottom) + 68px));left:12px;max-width:none}.pwa-ios-dialog{padding:24px}}
      @media(display-mode:standalone){.pwa-install-button{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function removeInstallButton() {
    if (installButton) installButton.remove();
    installButton = null;
  }

  function showNotice(message, options = {}) {
    if (activeNotice) activeNotice.remove();
    const notice = document.createElement('div');
    notice.className = `pwa-notice ${options.kind || ''}`.trim();
    notice.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = message;
    notice.appendChild(text);
    if (options.actionLabel && options.onAction) {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = options.actionLabel;
      action.addEventListener('click', options.onAction, { once: true });
      notice.appendChild(action);
    }
    document.body.appendChild(notice);
    activeNotice = notice;
    if (!options.persistent) {
      setTimeout(() => {
        if (activeNotice === notice) activeNotice = null;
        notice.remove();
      }, options.duration || 3500);
    }
  }

  function openIosInstructions() {
    const backdrop = document.createElement('div');
    backdrop.className = 'pwa-ios-backdrop';
    backdrop.innerHTML = `
      <section class="pwa-ios-dialog" role="dialog" aria-modal="true" aria-labelledby="pwaIosTitle">
        <h2 id="pwaIosTitle">Instalar Mundo Azul</h2>
        <p>En iPhone y iPad la instalación se realiza desde Safari:</p>
        <ol>
          <li>Pulsa el botón <strong>Compartir</strong> de Safari.</li>
          <li>Selecciona <strong>Añadir a pantalla de inicio</strong>.</li>
          <li>Confirma pulsando <strong>Añadir</strong>.</li>
        </ol>
        <button type="button" class="pwa-ios-close">Entendido</button>
      </section>`;
    const close = () => backdrop.remove();
    backdrop.querySelector('button').addEventListener('click', close);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    document.body.appendChild(backdrop);
    backdrop.querySelector('button').focus();
  }

  function showInstallButton() {
    if (standalone || installButton || (!deferredInstallPrompt && !ios)) return;
    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'pwa-install-button';
    installButton.textContent = 'Instalar aplicación';
    installButton.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const result = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        removeInstallButton();
        if (result.outcome === 'accepted') showNotice('Mundo Azul se está instalando.', { kind: 'online' });
      } else if (ios) {
        openIosInstructions();
      }
    });
    document.body.appendChild(installButton);
  }

  function offerUpdate(registration) {
    if (!registration.waiting) return;
    showNotice('Hay una nueva versión de Mundo Azul disponible.', {
      actionLabel: 'Actualizar',
      persistent: true,
      onAction: () => {
        acceptedUpdate = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    removeInstallButton();
    showNotice('Mundo Azul ya está instalada.', { kind: 'online' });
  });

  window.addEventListener('offline', () => showNotice('Sin conexión. Las operaciones quedan bloqueadas hasta recuperar internet.', { kind: 'offline', persistent: true }));
  window.addEventListener('online', () => showNotice('Conexión recuperada.', { kind: 'online' }));

  if (!supportedProtocol || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    injectStyles();
    if (ios && !standalone) showInstallButton();
    if (!navigator.onLine) showNotice('Sin conexión. Las operaciones quedan bloqueadas hasta recuperar internet.', { kind: 'offline', persistent: true });

    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      if (registration.waiting) offerUpdate(registration);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(registration);
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (acceptedUpdate) location.reload();
      });

      const checkForUpdates = () => registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdates(); });
      window.setInterval(checkForUpdates, 60 * 60 * 1000);
      checkForUpdates();
    } catch (error) {
      console.error('No se pudo registrar la aplicación instalable:', error);
    }
  });
})();
