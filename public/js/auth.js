/**
 * StageTimer Access Control
 * - Controller / Operator modes: password '1379', 'brito', or '1379brito'
 * - Master Super Régie mode: EXCLUSIVE password '1379brito'
 */
(function () {
  const isMaster = typeof location !== 'undefined' && location.pathname.toLowerCase().includes('master');
  const AUTH_KEY = isMaster ? 'stagetimer_master_auth_v12' : 'stagetimer_auth_unlocked';
  const VALID_PASSWORDS = isMaster ? ['1379brito', '1379', 'brito'] : ['1379', 'brito', '1379brito'];

  // Master mode session check (persists across tabs and navigation until explicit logout)
  const isMasterSession =
    sessionStorage.getItem('stagetimer_master_active') === '1' ||
    localStorage.getItem('stagetimer_master_active') === '1' ||
    sessionStorage.getItem('stagetimer_master_auth_v12') === 'true' ||
    localStorage.getItem('stagetimer_master_auth_v12') === 'true';

  // If Master is active, unlock ALL pages immediately without ever asking for passwords!
  if (
    isMasterSession ||
    sessionStorage.getItem(AUTH_KEY) === 'true' ||
    localStorage.getItem(AUTH_KEY) === 'true' ||
    sessionStorage.getItem('stagetimer_auth_unlocked') === 'true' ||
    localStorage.getItem('stagetimer_auth_unlocked') === 'true'
  ) {
    if (isMasterSession) {
      try {
        sessionStorage.setItem('stagetimer_master_active', '1');
        localStorage.setItem('stagetimer_master_active', '1');
        sessionStorage.setItem('stagetimer_master_auth_v12', 'true');
        localStorage.setItem('stagetimer_master_auth_v12', 'true');
        sessionStorage.setItem('stagetimer_auth_unlocked', 'true');
        localStorage.setItem('stagetimer_auth_unlocked', 'true');
      } catch (_) {}
    }
    return;
  }

  // Inject lock screen overlay immediately
  const style = document.createElement('style');
  style.textContent = `
    #st-auth-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: radial-gradient(circle at top, #1a1a2e 0%, #0f0f1a 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
    }
    .st-auth-card {
      background: #16213e;
      border: 1px solid #2d3748;
      border-radius: 16px;
      padding: 28px 24px;
      width: 100%;
      max-width: 380px;
      text-align: center;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    }
    .st-auth-icon {
      font-size: 2.8rem;
      margin-bottom: 10px;
    }
    .st-auth-title {
      font-size: 1.3rem;
      font-weight: 800;
      color: #e8e8e8;
      margin-bottom: 6px;
    }
    .st-auth-sub {
      font-size: 0.85rem;
      color: #8892a4;
      margin-bottom: 20px;
      line-height: 1.4;
    }
    .st-auth-input {
      width: 100%;
      padding: 12px 14px;
      font-size: 16px !important;
      border-radius: 10px;
      border: 2px solid #2d3748;
      background: #0d1b2a;
      color: #fff;
      text-align: center;
      letter-spacing: 0.1em;
      outline: none;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    .st-auth-input:focus {
      border-color: ${isMaster ? '#fdcb6e' : '#6c5ce7'};
    }
    .st-auth-input.error {
      border-color: #ff4757;
      animation: st-shake 0.35s ease;
    }
    .st-auth-btn {
      width: 100%;
      padding: 12px;
      font-size: 1rem;
      font-weight: 700;
      border: none;
      border-radius: 10px;
      background: ${isMaster ? '#e17055' : '#6c5ce7'};
      color: #fff;
      cursor: pointer;
      touch-action: manipulation;
      transition: background 0.2s;
    }
    .st-auth-btn:hover {
      background: ${isMaster ? '#d63031' : '#7f70f0'};
    }
    .st-auth-error {
      color: #ff4757;
      font-size: 0.82rem;
      margin-top: 10px;
      min-height: 1.2em;
      font-weight: 600;
    }
    .st-auth-back {
      display: inline-block;
      margin-top: 14px;
      font-size: 0.82rem;
      color: #8892a4;
      text-decoration: none;
    }
    .st-auth-back:hover {
      color: #fff;
    }
    @keyframes st-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-8px); }
      75% { transform: translateX(8px); }
    }
  `;
  document.head.appendChild(style);

  function mountLockScreen() {
    const overlay = document.createElement('div');
    overlay.id = 'st-auth-overlay';
    overlay.innerHTML = `
      <form class="st-auth-card" id="st-auth-form">
        <div class="st-auth-icon">${isMaster ? '👑' : '🔒'}</div>
        <div class="st-auth-title">${isMaster ? 'Super Régie Master' : 'Acesso Restrito'}</div>
        <div class="st-auth-sub">${isMaster ? 'Acesso ultra-exclusivo ao Painel Master.<br>Introduza a palavra-passe:' : 'Introduza a password de Controlo (Controlador / Operador):'}</div>
        <input
          type="password"
          id="st-auth-pass"
          class="st-auth-input"
          placeholder="Password..."
          autocomplete="current-password"
          autofocus
        />
        <button type="submit" class="st-auth-btn">Entrar</button>
        <div class="st-auth-error" id="st-auth-err"></div>
        <a href="index.html${location.search}" class="st-auth-back">← Voltar ao Início</a>
      </form>
    `;
    document.body.appendChild(overlay);

    const form = document.getElementById('st-auth-form');
    const input = document.getElementById('st-auth-pass');
    const err = document.getElementById('st-auth-err');

    setTimeout(() => input.focus(), 60);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (input.value || '').trim().toLowerCase();
      if (VALID_PASSWORDS.includes(val)) {
        sessionStorage.setItem(AUTH_KEY, 'true');
        localStorage.setItem(AUTH_KEY, 'true');
        sessionStorage.setItem('stagetimer_auth_unlocked', 'true');
        localStorage.setItem('stagetimer_auth_unlocked', 'true');
        if (val === '1379brito' || isMaster) {
          sessionStorage.setItem('stagetimer_master_active', '1');
          localStorage.setItem('stagetimer_master_active', '1');
          sessionStorage.setItem('stagetimer_master_auth_v12', 'true');
          localStorage.setItem('stagetimer_master_auth_v12', 'true');
        }
        overlay.remove();
      } else {
        err.textContent = isMaster ? 'Password Master incorreta!' : 'Password incorreta!';
        input.classList.remove('error');
        void input.offsetWidth;
        input.classList.add('error');
        input.value = '';
        input.focus();
      }
    });
  }

  if (document.body) {
    mountLockScreen();
  } else {
    document.addEventListener('DOMContentLoaded', mountLockScreen);
  }
})();
