/**
 * StageTimer PFP — Secure Access Control Module
 * Validates Master and Operator credentials via Backend/Serverless Auth API
 * with Web Crypto SHA-256 salted hash verification for offline/PWA resilience.
 * Never stores or exposes plaintext credentials in client code.
 */
(function () {
  const AUTH_SALT = 'st_pfp_v1_salt_9f8e7d6c';

  // Salted SHA-256 digests (no plaintext secrets in client bundle)
  const MASTER_DIGESTS = Object.freeze([
    'fb2e5f099f5a42d505f0e1114d2f0e28c667852ebcecb6f7202d3fe9d955f346'
  ]);

  const OPERATOR_DIGESTS = Object.freeze([
    'fb2e5f099f5a42d505f0e1114d2f0e28c667852ebcecb6f7202d3fe9d955f346',
    'f62cd1e7b7ab0ba4e545477674d5e8788c8119d17be4e2e1367cd27b29f55972',
    'c823786caa78b9c35b7719b058021956a1cf8406a7ac466d9b91e1cf62683a65'
  ]);

  const pathname = typeof location !== 'undefined' ? location.pathname.toLowerCase() : '';
  const isMasterPage = pathname.includes('master');
  const isProtectedPage =
    isMasterPage ||
    pathname.includes('controller') ||
    pathname.includes('operator');

  const AUTH_KEY = isMasterPage ? 'stagetimer_master_auth_v12' : 'stagetimer_auth_unlocked';

  async function sha256SaltedHex(input) {
    const clean = String(input || '').trim().toLowerCase();
    const data = new TextEncoder().encode(`${AUTH_SALT}:${clean}`);
    if (window.crypto && window.crypto.subtle) {
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return '';
  }

  function constantTimeEqual(a, b) {
    const strA = String(a || '');
    const strB = String(b || '');
    if (!strA || strA.length !== strB.length) return false;
    let diff = 0;
    for (let i = 0; i < strA.length; i++) {
      diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
    }
    return diff === 0;
  }

  function isMasterSessionActive() {
    try {
      return (
        sessionStorage.getItem('stagetimer_master_active') === '1' ||
        localStorage.getItem('stagetimer_master_active') === '1' ||
        sessionStorage.getItem('stagetimer_master_auth_v12') === 'true' ||
        localStorage.getItem('stagetimer_master_auth_v12') === 'true'
      );
    } catch (_) {
      return false;
    }
  }

  function isOperatorSessionActive() {
    try {
      return (
        isMasterSessionActive() ||
        sessionStorage.getItem('stagetimer_auth_unlocked') === 'true' ||
        localStorage.getItem('stagetimer_auth_unlocked') === 'true'
      );
    } catch (_) {
      return false;
    }
  }

  function activateMasterSession(token) {
    try {
      sessionStorage.setItem('stagetimer_master_active', '1');
      localStorage.setItem('stagetimer_master_active', '1');
      sessionStorage.setItem('stagetimer_master_auth_v12', 'true');
      localStorage.setItem('stagetimer_master_auth_v12', 'true');
      sessionStorage.setItem('stagetimer_auth_unlocked', 'true');
      localStorage.setItem('stagetimer_auth_unlocked', 'true');
      if (token) {
        sessionStorage.setItem('stagetimer_auth_token', token);
      }
    } catch (_) {}
  }

  function activateOperatorSession(token) {
    try {
      sessionStorage.setItem('stagetimer_auth_unlocked', 'true');
      localStorage.setItem('stagetimer_auth_unlocked', 'true');
      if (token) {
        sessionStorage.setItem('stagetimer_auth_token', token);
      }
    } catch (_) {}
  }

  function clearSessions() {
    try {
      sessionStorage.removeItem('stagetimer_master_active');
      localStorage.removeItem('stagetimer_master_active');
      sessionStorage.removeItem('stagetimer_master_auth_v12');
      localStorage.removeItem('stagetimer_master_auth_v12');
      sessionStorage.removeItem('stagetimer_auth_unlocked');
      localStorage.removeItem('stagetimer_auth_unlocked');
      sessionStorage.removeItem('stagetimer_auth_token');
    } catch (_) {}
  }

  async function verifyPassword(rawPassword, requiredRole = 'operator') {
    const clean = String(rawPassword || '').trim();
    if (!clean) {
      return { ok: false, isMaster: false, role: null };
    }

    // 1. Primary verification via Backend / Serverless Authentication Endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: clean, role: requiredRole }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (res.ok && data && data.ok) {
          if (data.isMaster) {
            activateMasterSession(data.token);
          } else {
            activateOperatorSession(data.token);
          }
          return {
            ok: true,
            isMaster: !!data.isMaster,
            role: data.role || (data.isMaster ? 'master' : 'operator'),
            token: data.token
          };
        }
        if (res.status === 401 || res.status === 400) {
          return { ok: false, isMaster: false, role: null, error: data?.error };
        }
      }
    } catch (_) {
      // Offline or static hosting without backend endpoint: fall through to cryptographic digest check
    }

    // 2. Cryptographic SHA-256 salted digest verification (Offline / Static PWA fallback)
    const digest = await sha256SaltedHex(clean);
    if (!digest) {
      return { ok: false, isMaster: false, role: null };
    }

    const isMasterMatch = MASTER_DIGESTS.some(h => constantTimeEqual(digest, h));
    const isOperatorMatch = OPERATOR_DIGESTS.some(h => constantTimeEqual(digest, h));

    if (requiredRole === 'master') {
      if (isMasterMatch) {
        activateMasterSession();
        return { ok: true, isMaster: true, role: 'master' };
      }
      return { ok: false, isMaster: false, role: null };
    }

    if (isMasterMatch || isOperatorMatch) {
      if (isMasterMatch) {
        activateMasterSession();
      } else {
        activateOperatorSession();
      }
      return {
        ok: true,
        isMaster: isMasterMatch,
        role: isMasterMatch ? 'master' : 'operator'
      };
    }

    return { ok: false, isMaster: false, role: null };
  }

  window.isStageTimerMaster = isMasterSessionActive;
  window.StageTimerAuth = {
    verifyPassword,
    isMaster: isMasterSessionActive,
    isUnlocked: isOperatorSessionActive,
    activateMasterSession,
    activateOperatorSession,
    logout: clearSessions
  };

  // Only enforce lock screen overlay on protected pages (Controller, Operator, Master)
  if (!isProtectedPage) {
    return;
  }

  const masterActive = isMasterSessionActive();
  const pageUnlocked =
    masterActive ||
    (!isMasterPage && isOperatorSessionActive()) ||
    sessionStorage.getItem(AUTH_KEY) === 'true' ||
    localStorage.getItem(AUTH_KEY) === 'true';

  if (pageUnlocked) {
    if (masterActive) {
      activateMasterSession();
    }
    return;
  }

  // Inject lock screen overlay styles
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
      border-color: ${isMasterPage ? '#fdcb6e' : '#6c5ce7'};
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
      background: ${isMasterPage ? '#e17055' : '#6c5ce7'};
      color: #fff;
      cursor: pointer;
      touch-action: manipulation;
      transition: background 0.2s;
    }
    .st-auth-btn:hover {
      background: ${isMasterPage ? '#d63031' : '#7f70f0'};
    }
    .st-auth-btn:disabled {
      opacity: 0.65;
      cursor: wait;
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
        <div class="st-auth-icon">${isMasterPage ? '👑' : '🔒'}</div>
        <div class="st-auth-title">${isMasterPage ? 'Super Régie Master' : 'Acesso Restrito'}</div>
        <div class="st-auth-sub">${isMasterPage ? 'Acesso exclusivo ao Painel Master.<br>Introduza a credencial de administração:' : 'Introduza a credencial de Controlo (Controlador / Operador):'}</div>
        <input
          type="password"
          id="st-auth-pass"
          class="st-auth-input"
          placeholder="Palavra-passe..."
          autocomplete="current-password"
          autofocus
        />
        <button type="submit" class="st-auth-btn" id="st-auth-submit">Entrar</button>
        <div class="st-auth-error" id="st-auth-err"></div>
        <a href="index.html${location.search}" class="st-auth-back">← Voltar ao Início</a>
      </form>
    `;
    document.body.appendChild(overlay);

    const form = document.getElementById('st-auth-form');
    const input = document.getElementById('st-auth-pass');
    const err = document.getElementById('st-auth-err');
    const submitBtn = document.getElementById('st-auth-submit');

    setTimeout(() => input.focus(), 60);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (input.value || '').trim();
      if (!val) return;

      if (submitBtn) submitBtn.disabled = true;
      const result = await verifyPassword(val, isMasterPage ? 'master' : 'operator');
      if (submitBtn) submitBtn.disabled = false;

      if (result.ok) {
        try {
          sessionStorage.setItem(AUTH_KEY, 'true');
          localStorage.setItem(AUTH_KEY, 'true');
        } catch (_) {}
        overlay.remove();
      } else {
        err.textContent = isMasterPage ? 'Credencial Master incorreta!' : 'Credencial incorreta!';
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
