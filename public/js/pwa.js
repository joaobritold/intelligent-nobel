/**
 * StageTimer PFP — Lightweight Native-Feel App Engine (PWA + WakeLock + iOS/Desktop Installer)
 */
(function () {
  let deferredPrompt = null;
  let wakeLock = null;

  // 1. Register Service Worker for Instant Launch & Standalone Installability
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.update().catch(() => {});
      }).catch(() => {});
    });

    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!isRefreshing) {
        isRefreshing = true;
        window.location.reload();
      }
    });
  }

  // 2. Generate 180x180 PNG Apple Touch Icon dynamically so iPhone Home Screen has a crisp icon
  function injectAppleTouchIcon() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Dark gradient background
      const bg = ctx.createLinearGradient(0, 0, 180, 180);
      bg.addColorStop(0, '#1a1a2e');
      bg.addColorStop(1, '#090912');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 180, 180);

      // Accent border ring
      ctx.strokeStyle = '#6c5ce7';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, 160, 160);

      // Top "ON AIR" dot & text
      ctx.fillStyle = '#00b894';
      ctx.beginPath();
      ctx.arc(58, 38, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e8e8e8';
      ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ON STAGE', 98, 43);

      // Digital Timer
      ctx.fillStyle = '#00b894';
      ctx.font = 'bold 50px monospace';
      ctx.fillText('05:00', 90, 106);

      // Bottom Progress Bar
      ctx.fillStyle = '#16213e';
      ctx.fillRect(24, 132, 132, 10);
      ctx.fillStyle = '#6c5ce7';
      ctx.fillRect(24, 132, 92, 10);

      // Brand
      ctx.fillStyle = '#8892a4';
      ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
      ctx.fillText('STAGETIMER PFP', 90, 160);

      const link = document.createElement('link');
      link.rel = 'apple-touch-icon';
      link.href = canvas.toDataURL('image/png');
      document.head.appendChild(link);
    } catch (e) {}
  }
  injectAppleTouchIcon();

  // 3. Screen Wake Lock — Keep phone/PC screen awake during concerts
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  }
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  // 4. Detect Standalone Mode & Platform
  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  // 5. Capture Chrome / Edge / Android native install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallButtons();
  });

  function updateInstallButtons() {
    const btns = document.querySelectorAll('.st-install-app-btn');
    btns.forEach((btn) => {
      if (isStandalone()) {
        btn.style.display = 'none';
      } else {
        btn.style.display = 'inline-flex';
      }
    });
  }

  // 6. Interactive Install Guide Modal (for iOS Safari & Desktop)
  function showInstallGuideModal() {
    let modal = document.getElementById('st-pwa-modal');
    if (modal) {
      modal.style.display = 'flex';
      return;
    }

    const ios = isIOS();
    modal = document.createElement('div');
    modal.id = 'st-pwa-modal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 100000;
      background: rgba(8, 8, 17, 0.82);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
    `;

    modal.innerHTML = `
      <div style="background: #16213e; border: 1.5px solid #6c5ce7; border-radius: 18px; max-width: 420px; width: 100%; padding: 24px 20px; color: #fff; box-shadow: 0 18px 45px rgba(0,0,0,0.6);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="icon.svg" alt="Icon" style="width: 42px; height: 42px; border-radius: 10px;">
            <div>
              <div style="font-size: 1.1rem; font-weight: 800; line-height: 1.2;">Instalar App StageTimer</div>
              <div style="font-size: 0.75rem; color: #55efc4; font-weight: 600;">⚡ App Leve • Ecrã Inteiro • Sem Barras</div>
            </div>
          </div>
          <button id="st-pwa-close" style="background: rgba(255,255,255,0.08); border: none; color: #cbd5e1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 1rem;">✕</button>
        </div>

        ${ios ? `
          <div style="background: rgba(108, 92, 231, 0.14); border: 1px solid rgba(108, 92, 231, 0.4); border-radius: 12px; padding: 14px; font-size: 0.88rem; line-height: 1.5; margin-bottom: 14px;">
            <div style="font-weight: 700; color: #a29bfe; margin-bottom: 8px;">📱 Como instalar no iPhone / iPad (Safari):</div>
            <div style="margin-bottom: 8px;">1. Toque no botão <strong>Partilhar</strong> <span style="display:inline-block; background:#0d1b2a; padding:2px 7px; border-radius:6px; border:1px solid #2d3748;">⬆️</span> na barra do Safari.</div>
            <div style="margin-bottom: 8px;">2. Deslize e escolha <strong>"Adicionar ao Ecrã Principal"</strong> <em>(Add to Home Screen)</em>.</div>
            <div>3. Toque em <strong>Adicionar</strong> no canto superior direito!</div>
          </div>
        ` : `
          <div style="background: rgba(108, 92, 231, 0.14); border: 1px solid rgba(108, 92, 231, 0.4); border-radius: 12px; padding: 14px; font-size: 0.88rem; line-height: 1.5; margin-bottom: 14px;">
            <div style="font-weight: 700; color: #a29bfe; margin-bottom: 8px;">💻 Como instalar no PC / Mac ou Android:</div>
            <div style="margin-bottom: 8px;">• <strong>No PC (Chrome / Edge):</strong> Clique no ícone de instalação <span style="display:inline-block; background:#0d1b2a; padding:1px 6px; border-radius:5px; border:1px solid #2d3748;">📲</span> no lado direito da barra de endereço (ou Menu <strong>⋮ → Guardar e partilhar → Instalar StageTimer</strong>).</div>
            <div>• <strong>No Android (Chrome):</strong> Toque no menu <strong>⋮ → Instalar aplicação</strong>.</div>
          </div>
        `}

        <div style="font-size: 0.78rem; color: #8892a4; margin-bottom: 16px;">
          ✓ Abre como aplicação independente na secretária ou telemóvel.<br>
          ✓ Mantém o ecrã sempre ligado durante o espetáculo.
        </div>

        <button id="st-pwa-ok" style="width: 100%; padding: 11px; border-radius: 10px; border: none; background: #6c5ce7; color: #fff; font-weight: 700; font-size: 0.95rem; cursor: pointer;">Entendido</button>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => { modal.style.display = 'none'; };
    document.getElementById('st-pwa-close').addEventListener('click', close);
    document.getElementById('st-pwa-ok').addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  }

  async function triggerInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
      }
      updateInstallButtons();
    } else {
      showInstallGuideModal();
    }
  }

  window.StageTimerPWA = {
    triggerInstall,
    isStandalone
  };

  document.addEventListener('DOMContentLoaded', () => {
    updateInstallButtons();
    document.querySelectorAll('.st-install-app-btn').forEach((btn) => {
      btn.addEventListener('click', triggerInstall);
    });
  });
})();
