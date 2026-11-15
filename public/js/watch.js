/**
 * ⌚ StageTimer PFP — Apple Watch Single Screen Controller
 * One unified, automatic display: Giant Stage Timer when running, Official Clock when idle,
 * Artist name, Projected event end & instant presence in Master panel.
 */

(function() {
  'use strict';

  // ─── Room & Device Resolution ─────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const rawParamRoom = (params.get('room') || '').trim();
  // Normalize spaces to hyphens so "rc viana" automatically matches "RC-VIANA"
  const normalizedParam = rawParamRoom.replace(/\s+/g, '-').toUpperCase();
  const savedActiveRoom = (sessionStorage.getItem('stagetimer_active_room') || '').trim();
  const savedDeviceRoom = (localStorage.getItem('stagetimer_device_room') || '').trim();
  const savedLastRoom = (localStorage.getItem('stagetimer_last_room') || '').trim();

  let roomId = (normalizedParam || savedActiveRoom || savedDeviceRoom || savedLastRoom || 'PALCO1').toUpperCase();

  // Smart resolve from cached registry if available
  try {
    const localEvents = JSON.parse(localStorage.getItem('stagetimer_v63_registry') || localStorage.getItem('stagetimer_v10_events_list') || '[]');
    const cleanLookup = roomId.replace(/[^A-Z0-9]/g, '');
    const matchedEv = localEvents.find(e => {
      const c = (e.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const t = (e.title || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      return c === cleanLookup || t === cleanLookup;
    });
    if (matchedEv && Array.isArray(matchedEv.stages) && matchedEv.stages.length > 0) {
      const hasCurrent = matchedEv.stages.some(s => (s.code || s.id || '').toUpperCase() === roomId);
      if (!hasCurrent && matchedEv.stages[0]?.code) {
        roomId = matchedEv.stages[0].code.toUpperCase();
      }
    }
  } catch (_) {}

  try {
    localStorage.setItem('stagetimer_device_room', roomId);
    localStorage.setItem('stagetimer_last_room', roomId);
    sessionStorage.setItem('stagetimer_active_room', roomId);
  } catch (_) {}

  // ─── DOM References ──────────────────────────────────────────────────
  const $statusDot = document.getElementById('watch-status-dot');
  const $stageBadge = document.getElementById('watch-stage-badge');
  const $miniClock = document.getElementById('watch-mini-clock');
  const $digits = document.getElementById('watch-digits');
  const $info = document.getElementById('watch-info');
  const $eventEndVal = document.getElementById('watch-event-end-val');
  const $msgOverlay = document.getElementById('watch-message-overlay');
  const $msgBadge = document.getElementById('watch-msg-badge');
  const $msgText = document.getElementById('watch-msg-text');

  // ─── Client Sync (Role 'watch' announces Apple Watch to Master) ─────────
  const client = new StageTimerClient({
    role: 'watch',
    room: roomId,
  });

  let state = null;
  let lastMessageId = '';

  client.on('connected', () => {
    if ($statusDot) $statusDot.classList.remove('disconnected');
    updateStageBadge();
  });

  client.on('disconnected', () => {
    if ($statusDot) $statusDot.classList.add('disconnected');
  });

  client.on('room-state', (data) => {
    state = data;
    if (state?.id && state.id !== roomId) {
      roomId = state.id;
    }
    updateStageBadge();
    handleMessageAlert();
    updateEventEnd();
    render();
  });

  // Dynamic Room Resolution when Cloud Registry arrives
  client.on('events-list-update', (eventsList) => {
    if (!Array.isArray(eventsList) || eventsList.length === 0) return;
    const cleanLookup = roomId.replace(/[^A-Z0-9]/g, '');
    const matchedEv = eventsList.find(e => {
      const c = (e.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const t = (e.title || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      return c === cleanLookup || t === cleanLookup;
    });

    if (matchedEv) {
      const stages = Array.isArray(matchedEv.stages) && matchedEv.stages.length > 0
        ? matchedEv.stages
        : [{ code: matchedEv.code, name: matchedEv.title }];
      const hasCurrent = stages.some(s => (s.code || s.id || '').toUpperCase() === roomId);
      if (!hasCurrent && stages[0]?.code) {
        const targetCode = stages[0].code.toUpperCase();
        if (targetCode !== roomId) {
          try {
            localStorage.setItem('stagetimer_device_room', targetCode);
            localStorage.setItem('stagetimer_last_room', targetCode);
            sessionStorage.setItem('stagetimer_active_room', targetCode);
          } catch (_) {}
          window.location.replace(`watch.html?room=${encodeURIComponent(targetCode)}`);
        }
      }
    }
  });

  client.connect();

  // ─── Stage Badge Display ─────────────────────────────────────────────
  function updateStageBadge() {
    if (!$stageBadge) return;
    const currentCode = (state?.id || roomId).toUpperCase();
    $stageBadge.textContent = state?.name || currentCode;
  }
  updateStageBadge();

  // ─── Projected Event End Time (Fim Previsto do Evento) ───────────────
  function updateEventEnd() {
    if (!$eventEndVal) return;
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) {
      $eventEndVal.textContent = '🏁 Fim: --:--';
      return;
    }

    const cascade = typeof StageTimerClient.computeCascadeSchedule === 'function'
      ? StageTimerClient.computeCascadeSchedule(state)
      : null;

    const endStr = cascade?.eventEndStr || (typeof StageTimerClient.computeEventEndTime === 'function' ? StageTimerClient.computeEventEndTime(state) : '--:--');

    if (cascade && cascade.isDelayed && cascade.globalDelayStr && cascade.globalDelayStr !== '0m') {
      $eventEndVal.innerHTML = `🏁 Fim: ${endStr} <span class="watch-delay">(${cascade.globalDelayStr})</span>`;
    } else {
      $eventEndVal.textContent = `🏁 Fim: ${endStr}`;
    }
  }

  // ─── Message Overlay & Vibration ─────────────────────────────────────
  function handleMessageAlert() {
    if (!state) return;
    const msg = state.message;
    if (msg && msg.visible && msg.text) {
      if ($msgText) $msgText.textContent = msg.text;
      if ($msgBadge) $msgBadge.textContent = msg.level === 'urgent' ? '⚠️ URGENTE' : '💬 AVISO';
      if ($msgOverlay) {
        $msgOverlay.className = `watch-message-overlay visible ${msg.level === 'urgent' ? 'urgent' : ''}`;
      }
      if (msg.id !== lastMessageId) {
        lastMessageId = msg.id;
        if (navigator.vibrate) {
          try { navigator.vibrate([200, 100, 200, 100, 300]); } catch (_) {}
        }
      }
    } else {
      if ($msgOverlay) $msgOverlay.className = '';
      lastMessageId = '';
    }
  }

  if ($msgOverlay) {
    $msgOverlay.addEventListener('click', () => {
      $msgOverlay.classList.remove('visible');
    });
  }

  // ─── Format & Calculation Helpers ────────────────────────────────────
  function formatTime(ms) {
    return StageTimerClient.formatTime(ms);
  }

  function getTimerElapsed(timer) {
    return StageTimerClient.getTimerElapsed(timer);
  }

  function getTrueTimeString() {
    return StageTimerClient.getTrueTimeString();
  }

  function getTimerColorClass(timer) {
    if (timer.mode === 'clock') return 'clock';
    if (timer.state === 'paused') return 'paused';
    if (timer.state === 'finished') return 'finished';
    if (timer.mode === 'countdown') {
      const elapsed = getTimerElapsed(timer);
      const remaining = timer.duration - elapsed;
      if (remaining <= 0) return 'overtime';
      if (timer.duration > 0) {
        const pct = (elapsed / timer.duration) * 100;
        if (pct > 95) return 'danger';
        if (pct > 80) return 'warn';
        return 'safe';
      }
      return 'safe';
    }
    return 'safe';
  }

  function getTimerDisplayValue(timer) {
    if (timer.mode === 'clock') {
      return getTrueTimeString();
    }
    const elapsed = getTimerElapsed(timer);
    if (timer.mode === 'countdown') {
      const remaining = timer.duration - elapsed;
      if (remaining <= 0) {
        const overdue = Math.abs(remaining);
        return `-${formatTime(overdue)}`;
      }
      return formatTime(remaining);
    }
    return formatTime(elapsed);
  }

  // ─── Edge-to-Edge Dynamic Scaling ────────────────────────────────────
  function fitDigits() {
    if (!$digits) return;
    const isHours = $digits.textContent.length > 5;
    $digits.style.fontSize = isHours ? '19.5vw' : '31vw';
  }

  // ─── Render Loop (Single Unified Screen) ─────────────────────────────
  let lastColorState = '';

  function render() {
    const trueClockStr = getTrueTimeString();
    if ($miniClock) {
      $miniClock.textContent = trueClockStr.substring(0, 5); // HH:MM no topo
    }

    const activeTimer = state ? StageTimerClient.getActiveTimer(state) : null;

    if (!activeTimer) {
      // ── Nenhum timer ativo: Mostra o Relógio Oficial em Gigante ──
      if ($digits) {
        $digits.textContent = trueClockStr;
        $digits.className = 'watch-digits clock has-hours';
      }
      if ($info) {
        $info.textContent = 'Palco Livre • Sem Timer';
      }
      fitDigits();
      return;
    }

    // ── Timer Ativo em Palco (Countdown / Countup / Overtime) ──
    const displayVal = getTimerDisplayValue(activeTimer);
    const colorClass = getTimerColorClass(activeTimer);

    // Vibração tátil ao entrar em tempo excedido (overtime)
    if (colorClass === 'overtime' && lastColorState !== 'overtime') {
      if (navigator.vibrate) {
        try { navigator.vibrate([150, 80, 150]); } catch (_) {}
      }
    }
    lastColorState = colorClass;

    if ($digits) {
      $digits.textContent = displayVal;
      const isLong = displayVal.length > 5;
      $digits.className = `watch-digits ${colorClass} ${isLong ? 'has-hours' : ''}`;
    }

    if ($info) {
      const prefix = activeTimer.state === 'paused' ? '⏸️ ' : '';
      $info.textContent = prefix + (activeTimer.name || 'Timer de Palco');
    }

    fitDigits();
  }

  // Atualização suave a cada 200ms
  setInterval(render, 200);
  setInterval(updateEventEnd, 2000);

  // ─── Screen Wake Lock (Manter Ecrã Ligado) ────────────────────────────
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (_) {}
  }
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
  document.addEventListener('touchstart', requestWakeLock, { passive: true, once: true });

  // ─── Auto-Collapse watchOS Navigation Header (Tela Cheia) ────────────
  function tryCollapseWatchHeader() {
    try {
      window.scrollTo({ top: 30, behavior: 'smooth' });
    } catch (_) {
      window.scrollTo(0, 30);
    }
  }
  window.addEventListener('load', () => setTimeout(tryCollapseWatchHeader, 350));
  document.addEventListener('touchstart', () => setTimeout(tryCollapseWatchHeader, 80), { passive: true, once: true });
})();
