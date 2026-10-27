/**
 * StageTimer Access Control — Protects Controller & Operator modes.
 * Accepted passwords: '1379' or 'brito' (case-insensitive).
 */
(function () {
  const AUTH_KEY = 'stagetimer_auth_unlocked';
  const VALID_PASSWORDS = ['1379', 'brito'];

  if (sessionStorage.getItem(AUTH_KEY) === 'true' || localStorage.getItem(AUTH_KEY) === 'true') {
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
      max-width: 360px;
      text-align: center;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    }
    .st-auth-icon {
      font-size: 2.6rem;
      margin-bottom: 10px;
    }
    .st-auth-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #e8e8e8;
      margin-bottom: 6px;
    }
    .st-auth-sub {
      font-size: 0.85rem;
      color: #8892a4;
      margin-bottom: 20px;
    }
    .st-auth-input {
      width: 100%;
      padding: 12px 14px;
      font-size: 16px !important; /* Prevents iOS Safari zoom */
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
      border-color: #6c5ce7;
    }
    .st-auth-input.error {
      border-color: #ff4757;
      animation: st-shake 0.35s ease;
    }
    .st-auth-btn {
      width: 100%;
      padding: 12px;
      font-size: 1rem;
      font-weight: 600;
      border: none;
      border-radius: 10px;
      background: #6c5ce7;
      color: #fff;
      cursor: pointer;
      touch-action: manipulation;
    }
    .st-auth-btn:hover {
      background: #7f70f0;
    }
    .st-auth-error {
      color: #ff4757;
      font-size: 0.8rem;
      margin-top: 10px;
      min-height: 1.2em;
    }
    .st-auth-back {
      display: inline-block;
      margin-top: 14px;
      font-size: 0.8rem;
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
        <div class="st-auth-icon">🔒</div>
        <div class="st-auth-title">Acesso Restrito</div>
        <div class="st-auth-sub">Introduza a password de Operador / Controlador</div>
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
        <a href="index.html${location.search}" class="st-auth-back">← Voltar ao Menu / Modo Palco</a>
      </form>
    `;
    document.body.appendChild(overlay);

    const form = document.getElementById('st-auth-form');
    const input = document.getElementById('st-auth-pass');
    const err = document.getElementById('st-auth-err');

    setTimeout(() => input.focus(), 50);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (input.value || '').trim().toLowerCase();
      if (VALID_PASSWORDS.includes(val)) {
        sessionStorage.setItem(AUTH_KEY, 'true');
        localStorage.setItem(AUTH_KEY, 'true');
        overlay.remove();
      } else {
        err.textContent = 'Password incorreta!';
        input.classList.remove('error');
        void input.offsetWidth; // trigger reflow
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
