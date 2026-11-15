/**
 * ⌚ StageTimer PFP — Apple Watch Fullscreen Micro-Viewer Controller
 * Ultra-responsive touch navigation, edge-to-edge digits, projected event end & OLED dark mode.
 */

(function() {
  'use strict';

  // ─── Room & Device Resolution ─────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const paramRoom = (params.get('room') || '').trim();
  const savedActiveRoom = (sessionStorage.getItem('stagetimer_active_room') || '').trim();
  const savedDeviceRoom = (localStorage.getItem('stagetimer_device_room') || '').trim();
  const savedLastRoom = (localStorage.getItem('stagetimer_last_room') || '').trim();

  let roomId = (paramRoom || savedActiveRoom || savedDeviceRoom || savedLastRoom || 'PALCO1').toUpperCase();

  // Smart resolve: if parent event code has multiple stages, resolve to Stage 1
  try {
    const localEvents = JSON.parse(localStorage.getItem('stagetimer_v63_registry') || localStorage.getItem('stagetimer_v10_events_list') || '[]');
    const matchedEv = localEvents.find(e => (e.code || '').toUpperCase() === roomId);
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
  const $container = document.getElementById('watch-container');
  const $statusDot = document.getElementById('watch-status-dot');
  const $stageBadge = document.getElementById('watch-stage-badge');
  const $miniClock = document.getElementById('watch-mini-clock');
  const $center = document.getElementById('watch-center');
  const $digits = document.getElementById('watch-digits');
  const $info = document.getElementById('watch-info');
  const $secondary = document.getElementById('watch-secondary');
  const $eventEndVal = document.getElementById('watch-event-end-val');
  const $modePill = document.getElementById('watch-mode-pill');
  const $modeToast = document.getElementById('watch-mode-toast');
  const $msgOverlay = document.getElementById('watch-message-overlay');
  const $msgBadge = document.getElementById('watch-msg-badge');
  const $msgText = document.getElementById('watch-msg-text');

  // ─── View Modes: 'timer', 'clock', 'dual' ───────────────────────────
  const MODES = ['timer', 'clock', 'dual'];
  const MODE_LABELS = {
    'timer': '⏱️ Modo Timer',
    'clock': '🕒 Relógio Oficial',
    'dual': '⚡ Modo Duplo'
  };

  let currentModeIndex = 0;
  try {
    const savedMode = localStorage.getItem('stagetimer_watch_mode');
    const idx = MODES.indexOf(savedMode);
    if (idx >= 0) currentModeIndex = idx;
  } catch (_) {}

  let toastTimer = null;
  function showModeToast(text) {
    if (!$modeToast) return;
    $modeToast.textContent = text;
    $modeToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $modeToast.classList.remove('show');
    }, 1100);
  }

  function applyMode(showToast = false) {
    const mode = MODES[currentModeIndex];
    if ($container) {
      $container.className = `watch-container mode-${mode}`;
    }
    if ($modePill) {
      if (mode === 'timer') $modePill.textContent = 'Timer';
      else if (mode === 'clock') $modePill.textContent = 'Relógio';
      else if (mode === 'dual') $modePill.textContent = 'Duplo';
    }
    if (showToast) {
      showModeToast(MODE_LABELS[mode] || mode);
    }
    try {
      localStorage.setItem('stagetimer_watch_mode', mode);
    } catch (_) {}
  }
  applyMode(false);

  function cycleMode() {
    currentModeIndex = (currentModeIndex + 1) % MODES.length;
    applyMode(true);

    // Haptic vibration feedback
    if (navigator.vibrate) {
      try { navigator.vibrate(60); } catch (_) {}
    }

    // Visual tap flash on the screen
    if ($container) {
      $container.classList.add('tap-flash');
      setTimeout(() => {
        $container.classList.remove('tap-flash');
      }, 150);
    }

    render();
  }

  // ─── Global Touch / Tap Listener (Resolves Apple Watch Tap) ───────────
  let lastTapTime = 0;
  function handleScreenTap(e) {
    const now = Date.now();
    if (now - lastTapTime < 280) return; // Debounce rapid multiple events
    lastTapTime = now;

    // If tap was specifically on the stage badge, let cycleStage handle it
    if (e && e.target && e.target.closest('#watch-stage-badge')) {
      return;
    }

    // If message overlay is open, dismiss it
    if ($msgOverlay && $msgOverlay.classList.contains('visible')) {
      $msgOverlay.classList.remove('visible');
      return;
    }

    cycleMode();
  }

  window.addEventListener('touchend', handleScreenTap, { passive: true });
  window.addEventListener('click', handleScreenTap);

  // ─── Client Sync ─────────────────────────────────────────────────────
  const client = new StageTimerClient({
    role: 'viewer',
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

  client.connect();

  // ─── Stage Switching on Watch Tap ────────────────────────────────────
  function getAvailableStages() {
    try {
      const rawList = typeof client.getEventsList === 'function' ? client.getEventsList() : [];
      const currentCode = (state?.id || roomId).toUpperCase();
      for (const ev of rawList) {
        if (ev.code === currentCode || (Array.isArray(ev.stages) && ev.stages.some(s => (s.code || s.id || '').toUpperCase() === currentCode))) {
          if (Array.isArray(ev.stages) && ev.stages.length > 1) {
            return ev.stages.map(s => (s.code || s.id || '').toUpperCase());
          }
        }
      }
    } catch (_) {}
    return [roomId];
  }

  function cycleStage(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const stages = getAvailableStages();
    if (stages.length <= 1) return;

    const currIdx = stages.indexOf(roomId);
    const nextIdx = (currIdx + 1) % stages.length;
    const nextRoom = stages[nextIdx];

    try {
      localStorage.setItem('stagetimer_device_room', nextRoom);
      localStorage.setItem('stagetimer_last_room', nextRoom);
      sessionStorage.setItem('stagetimer_active_room', nextRoom);
    } catch (_) {}

    window.location.replace(`watch.html?room=${encodeURIComponent(nextRoom)}`);
  }

  if ($stageBadge) {
    $stageBadge.addEventListener('touchend', cycleStage, { passive: false });
    $stageBadge.addEventListener('click', cycleStage);
  }

  function updateStageBadge() {
    if (!$stageBadge) return;
    const currentCode = (state?.id || roomId).toUpperCase();
    $stageBadge.textContent = currentCode;
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
      // Vibrate if it's a new incoming message
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
    const mode = MODES[currentModeIndex];
    const textLen = $digits.textContent.length;
    const isHours = textLen > 5;

    let targetVw = 32;
    if (mode === 'dual') {
      targetVw = isHours ? 19 : 24;
    } else if (isHours) {
      targetVw = 19.5;
    }

    $digits.style.fontSize = `${targetVw}vw`;
  }

  // ─── Render Loop ─────────────────────────────────────────────────────
  let lastColorState = '';

  function render() {
    const trueClockStr = getTrueTimeString();
    if ($miniClock) {
      $miniClock.textContent = trueClockStr.substring(0, 5); // HH:MM
    }

    const mode = MODES[currentModeIndex];
    const activeTimer = state ? StageTimerClient.getActiveTimer(state) : null;

    if (mode === 'clock') {
      // ── Pure Clock Mode ──
      if ($digits) {
        $digits.textContent = trueClockStr;
        $digits.className = 'watch-digits clock has-hours';
      }
      if ($info) {
        $info.textContent = activeTimer ? `⏱️ ${activeTimer.name}` : (state?.name || roomId);
      }
      if ($secondary) $secondary.textContent = '';
      fitDigits();
      return;
    }

    // ── Timer or Dual Mode ──
    if (!activeTimer) {
      if ($digits) {
        $digits.textContent = trueClockStr;
        $digits.className = 'watch-digits clock has-hours';
      }
      if ($info) {
        $info.textContent = 'Sem Timer Ativo';
      }
      if ($secondary) $secondary.textContent = '';
      fitDigits();
      return;
    }

    const displayVal = getTimerDisplayValue(activeTimer);
    const colorClass = getTimerColorClass(activeTimer);

    // Haptic vibration on entering overtime
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
      $info.textContent = prefix + (activeTimer.name || 'Timer');
    }

    if ($secondary) {
      if (mode === 'dual') {
        $secondary.textContent = trueClockStr;
      } else {
        $secondary.textContent = '';
      }
    }

    fitDigits();
  }

  // Fast animation ticker for smooth countdown and true clock
  setInterval(render, 200);

  // Periodically refresh event end calculation
  setInterval(updateEventEnd, 2000);

  // ─── Screen Wake Lock (Keep Watch Screen Awake) ──────────────────────
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

  // ─── Auto-Collapse watchOS Navigation Header (True Fullscreen) ───────
  function tryCollapseWatchHeader() {
    try {
      window.scrollTo({ top: 32, behavior: 'smooth' });
    } catch (_) {
      window.scrollTo(0, 32);
    }
  }
  window.addEventListener('load', () => setTimeout(tryCollapseWatchHeader, 350));
  document.addEventListener('touchstart', () => setTimeout(tryCollapseWatchHeader, 80), { passive: true, once: true });
})();
