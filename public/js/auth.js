/**
 * StageTimer Access Control:
 * - Modo Controlador (controller.html): Requires ONLY the 2 master passwords ('1379' or 'brito').
 *   Only the Controller can create or delete events and define each event's password.
 * - Modo Operador (operator.html): Accepts either the event's password (ex: 'palco 1')
 *   defined when the event was created, OR the 2 master passwords ('1379' or 'brito').
 */
(function () {
  const MASTER_AUTH_KEY = 'stagetimer_master_auth_unlocked';
  const MASTER_PASSWORDS = ['1379', 'brito'];

  const isControllerPage = location.pathname.toLowerCase().includes('controller');
  const params = new URLSearchParams(location.search);
  const currentRoom = (params.get('room') || localStorage.getItem('stagetimer_last_room') || 'PALCO1').trim().toUpperCase();
  const EVENT_AUTH_KEY = `stagetimer_event_unlocked_${currentRoom}`;

  function getEventInfo(roomCode) {
    try {
      const raw = localStorage.getItem('stagetimer_events_registry');
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        const found = list.find(e => (e.code || e.id || '').toUpperCase() === roomCode);
        if (found) return found;
      }
    } catch (e) {}
    return { code: 'PALCO1', title: 'RC26', pass: 'palco 1' };
  }

  // Check if already unlocked for this role
  if (isControllerPage) {
    if (sessionStorage.getItem(MASTER_AUTH_KEY) === 'true') {
      return;
    }
  } else {
    if (
      sessionStorage.getItem(MASTER_AUTH_KEY) === 'true' ||
      sessionStorage.getItem(EVENT_AUTH_KEY) === 'true' ||
      localStorage.getItem(EVENT_AUTH_KEY) === 'true'
    ) {
      return;
    }
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
    const evInfo = getEventInfo(currentRoom);
    const subtitle = isControllerPage
      ? 'Modo Controlador — Introduza uma das 2 passes mestras para gerir ou criar eventos'
      : `Evento: ${evInfo.title || currentRoom} — Introduza a pass deste evento`;

    const overlay = document.createElement('div');
    overlay.id = 'st-auth-overlay';
    overlay.innerHTML = `
      <form class="st-auth-card" id="st-auth-form">
        <div class="st-auth-icon">🔒</div>
        <div class="st-auth-title">${isControllerPage ? 'Acesso Controlador' : 'Acesso ao Evento'}</div>
        <div class="st-auth-sub">${subtitle}</div>
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
        <a href="index.html${location.search}" class="st-auth-back">← Voltar ao Menu Inicial</a>
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
      const latestEvInfo = getEventInfo(currentRoom);
      const eventPass = String(latestEvInfo.pass || 'palco 1').trim().toLowerCase();

      if (MASTER_PASSWORDS.includes(val)) {
        sessionStorage.setItem(MASTER_AUTH_KEY, 'true');
        sessionStorage.setItem(EVENT_AUTH_KEY, 'true');
        localStorage.setItem(EVENT_AUTH_KEY, 'true');
        overlay.remove();
      } else if (!isControllerPage && val && val === eventPass) {
        sessionStorage.setItem(EVENT_AUTH_KEY, 'true');
        localStorage.setItem(EVENT_AUTH_KEY, 'true');
        overlay.remove();
      } else {
        err.textContent = isControllerPage
          ? 'Pass mestra incorreta! Apenas as 2 passes do Controlador são aceites.'
          : 'Pass do evento incorreta!';
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
