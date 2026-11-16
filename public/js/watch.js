/**
 * ⌚ StageTimer PFP — Apple Watch Single Screen Controller
 * Espelho fiel do Modo Palco (Viewer):
 * - Nome do Artista no topo
 * - Dígitos gigantes com contagem decrescente E contagem negativa no tempo excedido (-00:01, -00:02...)
 * - Cores do palco: Verde -> Laranja -> Vermelho Vivo Pulsante no overtime
 * - Hora Local e Próximo Artista na base
 */

(function() {
  'use strict';

  // ─── Room & Device Resolution ─────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const rawParamRoom = (params.get('room') || '').trim();
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
  const $artistName = document.getElementById('watch-artist-name');
  const $timer = document.getElementById('watch-timer');
  const $clockTime = document.getElementById('watch-clock-time');
  const $next = document.getElementById('watch-next');
  const $nextName = document.getElementById('watch-next-name');
  const $progressBar = document.getElementById('watch-progress-bar');
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

  function adoptRoomAndState(targetRoom, incomingData) {
    const cleanTarget = String(targetRoom || '').toUpperCase().trim();
    if (!cleanTarget) return;
    if (cleanTarget !== roomId) {
      roomId = cleanTarget;
      client.room = cleanTarget;
      client.cleanRoom = cleanTarget;
      client.storageKey = `stagetimer_v10_state_${cleanTarget}`;
      client.mqttTopicState = `stagetimer_v10/${cleanTarget}/state`;
      client.mqttTopicPresence = `stagetimer_v10/${cleanTarget}/presence`;
      try {
        localStorage.setItem('stagetimer_device_room', cleanTarget);
        localStorage.setItem('stagetimer_last_room', cleanTarget);
        sessionStorage.setItem('stagetimer_active_room', cleanTarget);
        const u = new URL(window.location.href);
        if (u.searchParams.get('room') !== cleanTarget) {
          u.searchParams.set('room', cleanTarget);
          history.replaceState(null, '', u.toString());
        }
      } catch (_) {}
      if (client.mqttClient && client.mqttClient.connected) {
        try {
          client.mqttClient.subscribe([client.mqttTopicState, client.mqttTopicPresence], { qos: 0 });
          client.announcePresenceNow();
        } catch (_) {}
      }
    }
    if (incomingData && Array.isArray(incomingData.timers)) {
      client._applyIncomingState(incomingData, true);
    }
  }

  client.on('connected', () => {
    if ($statusDot && client.mqttClient && client.mqttClient.connected) {
      $statusDot.classList.remove('disconnected');
    }
    render();
  });

  client.on('p2p-ready', () => {
    if ($statusDot) $statusDot.classList.remove('disconnected');
    render();
  });

  client.on('disconnected', () => {
    if ($statusDot) $statusDot.classList.add('disconnected');
  });

  client.on('room-state', (data) => {
    state = data;
    if (state?.id && state.id !== roomId) {
      roomId = state.id;
    }
    if ($statusDot && client.mqttClient && client.mqttClient.connected) {
      $statusDot.classList.remove('disconnected');
    }
    handleMessageAlert();
    render();
  });

  // Multi-room state listening: if sub-stage (e.g. RC-VIANA-26-P1) has a running timer, adopt it automatically
  client.on('multi-room-state', ({ room, data }) => {
    if (!room || !data || !Array.isArray(data.timers)) return;
    const incomingRoom = String(room).toUpperCase().trim();
    const cleanCurrent = roomId.replace(/[^A-Z0-9]/g, '');
    const cleanIncoming = incomingRoom.replace(/[^A-Z0-9]/g, '');

    if (incomingRoom === roomId || cleanIncoming === cleanCurrent) {
      adoptRoomAndState(incomingRoom, data);
      return;
    }

    const isSubStage = incomingRoom.startsWith(roomId + '-') ||
      roomId.startsWith(incomingRoom + '-') ||
      (cleanCurrent.length >= 4 && cleanIncoming.startsWith(cleanCurrent));

    const currentHasTimers = Boolean(state && Array.isArray(state.timers) && state.timers.length > 0);
    const currentIsRunning = Boolean(state && StageTimerClient.getActiveTimer(state)?.state === 'running');
    const incomingHasTimers = data.timers.length > 0;
    const incomingIsRunning = Boolean(
      StageTimerClient.getActiveTimer(data)?.state === 'running' ||
      data.timers.some(t => t.state === 'running')
    );

    if (isSubStage) {
      if ((!currentIsRunning && incomingIsRunning) || (!currentHasTimers && incomingHasTimers)) {
        adoptRoomAndState(incomingRoom, data);
      }
      return;
    }

    if (!currentHasTimers && incomingIsRunning) {
      adoptRoomAndState(incomingRoom, data);
    }
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
          adoptRoomAndState(targetCode, null);
          client.sendDeviceCommand('ALL', { action: 'request_room_state', room: targetCode });
        }
      }
    }
  });

  client.connect();

  // ─── Format & Timing Helpers (Idênticos ao Modo Palco) ───────────────
  function formatTime(ms) {
    return StageTimerClient.formatTime(ms);
  }

  function getTimerElapsed(timer) {
    return StageTimerClient.getTimerElapsed(timer);
  }

  function getTimerColor(timer) {
    if (timer.mode === 'clock') return 'clock';
    if (timer.state === 'paused') return 'paused';
    if (timer.state === 'finished') return 'danger';
    if (timer.mode === 'countdown') {
      const elapsed = getTimerElapsed(timer);
      const remaining = timer.duration - elapsed;
      if (remaining <= 0) return 'danger'; // Overtime / negativo em vermelho vivo
      if (timer.duration > 0) {
        const pct = (elapsed / timer.duration) * 100;
        if (pct > 95) return 'danger';
        if (pct > 80) return 'warn';
        return 'safe';
      }
      if (remaining <= (timer.dangerAt || 60000)) return 'danger';
      if (remaining <= (timer.warnAt || 180000)) return 'warn';
      return 'safe';
    }
    return 'safe';
  }

  // Contagem fiel do tempo: no countdown, conta decrescente e continua em negativo (-00:01, -00:02...)
  function getTimerDisplayValue(timer) {
    if (timer.mode === 'clock') {
      return StageTimerClient.getTrueTimeString();
    }
    const elapsed = getTimerElapsed(timer);
    if (timer.mode === 'countdown') {
      const remaining = timer.duration - elapsed;
      return formatTime(remaining);
    }
    return formatTime(elapsed);
  }

  // ─── Next Artist Resolution ──────────────────────────────────────────
  function getNextTimer(state, activeTimer) {
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) return null;
    let list = state.timers;
    if (activeTimer) {
      if (!list.some(t => t.id === activeTimer.id) && state.days) {
        for (const dayList of Object.values(state.days)) {
          if (Array.isArray(dayList) && dayList.some(t => t.id === activeTimer.id)) {
            list = dayList;
            break;
          }
        }
      }
      const activeIdx = list.findIndex(t => t.id === activeTimer.id);
      if (activeIdx >= 0 && activeIdx + 1 < list.length) {
        return list[activeIdx + 1];
      }
      return null;
    }

    const pending = list.filter(t => t.state !== 'finished');
    if (pending.length > 1) return pending[1];
    if (pending.length === 1) return pending[0];
    return null;
  }

  // ─── Message Overlay & Vibration (Idêntico ao Modo Palco) ─────────────
  function handleMessageAlert() {
    if (!state) return;
    const msg = state.message;
    if (msg && msg.visible && msg.text) {
      if ($msgText) $msgText.textContent = msg.text;
      if ($msgBadge) $msgBadge.textContent = msg.level === 'urgent' ? 'URGENTE' : 'AVISO';
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
      if ($msgOverlay) $msgOverlay.className = 'watch-message-overlay';
      lastMessageId = '';
    }
  }

  if ($msgOverlay) {
    $msgOverlay.addEventListener('click', () => {
      $msgOverlay.classList.remove('visible');
    });
  }

  // ─── Edge-to-Edge Dynamic Scaling ────────────────────────────────────
  function fitDigits() {
    if (!$timer) return;
    const txt = $timer.textContent || '';
    const len = txt.length;
    if (len > 8) {
      $timer.style.fontSize = 'clamp(1.8rem, 15vw, 2.7rem)';
    } else if (len > 5) {
      $timer.style.fontSize = 'clamp(2.3rem, 20vw, 3.8rem)';
    } else {
      $timer.style.fontSize = 'clamp(3.8rem, 34vw, 6.4rem)';
    }
  }

  // ─── Render Loop (Idêntico ao Modo Palco) ────────────────────────────
  let lastColorState = '';

  function render() {
    // 1. HORA LOCAL (Canto Inferior Esquerdo)
    if ($clockTime) {
      $clockTime.textContent = StageTimerClient.getTrueTimeString();
    }

    const activeTimer = state ? StageTimerClient.getActiveTimer(state) : null;

    if (!activeTimer) {
      // Nenhum timer ativo no momento
      const timersList = Array.isArray(state?.timers) ? state.timers : [];
      const pendingTimer = timersList.find(t => t.state !== 'finished');

      if (pendingTimer) {
        if ($artistName) $artistName.textContent = pendingTimer.name || 'Próximo';
        if ($timer) {
          $timer.textContent = formatTime(pendingTimer.duration || 0);
          $timer.className = 'watch-timer paused';
        }
      } else if (timersList.length > 0 && timersList.every(t => t.state === 'finished')) {
        if ($artistName) $artistName.textContent = 'Fim do Espetáculo';
        if ($timer) {
          $timer.textContent = '00:00';
          $timer.className = 'watch-timer danger';
        }
      } else {
        if ($artistName) $artistName.textContent = state?.name || roomId;
        if ($timer) {
          $timer.textContent = '00:00';
          $timer.className = 'watch-timer clock';
        }
      }

      if ($next) $next.style.display = 'none';
      if ($progressBar) $progressBar.style.width = '0%';
      fitDigits();
      return;
    }

    // 2. NOME DO ARTISTA EM PALCO (Topo)
    if ($artistName) {
      $artistName.textContent = activeTimer.name || 'Artista em Palco';
    }

    // 3. DÍGITOS GIGANTES COM CONTAGEM DECIDIDA & CONTAGEM NEGATIVA (-00:01, -00:02...)
    const displayVal = getTimerDisplayValue(activeTimer);
    const color = getTimerColor(activeTimer);
    const isLong = (displayVal || '').length > 5;

    // Vibração tátil ao entrar em tempo negativo
    if (color === 'danger' && lastColorState !== 'danger' && activeTimer.mode === 'countdown') {
      if (navigator.vibrate) {
        try { navigator.vibrate([150, 80, 150]); } catch (_) {}
      }
    }
    lastColorState = color;

    if ($timer) {
      $timer.textContent = displayVal;
      $timer.className = `watch-timer ${color}${isLong ? ' has-hours' : ''}`;
    }

    // 4. PRÓXIMO ARTISTA (Canto Inferior Direito)
    const nextTimer = getNextTimer(state, activeTimer);
    if ($next && $nextName) {
      if (nextTimer) {
        $nextName.textContent = nextTimer.name || 'A seguir';
        $next.style.display = 'flex';
      } else {
        $nextName.textContent = 'Último';
        $next.style.display = 'flex';
      }
    }

    // 5. BARRA DE PROGRESSO NA BASE (Verde -> Laranja -> Vermelho Vivo)
    if ($progressBar) {
      if (activeTimer.duration > 0 && activeTimer.mode === 'countdown') {
        const elapsed = getTimerElapsed(activeTimer);
        const pct = Math.min(100, (elapsed / activeTimer.duration) * 100);
        $progressBar.style.width = `${pct}%`;
        if (pct >= 100) {
          $progressBar.className = 'watch-progress-bar overtime';
        } else if (pct > 80) {
          $progressBar.className = 'watch-progress-bar warn';
        } else {
          $progressBar.className = 'watch-progress-bar';
        }
      } else {
        $progressBar.style.width = '0%';
      }
    }

    fitDigits();
  }

  // Atualização em alta frequência a cada 200ms
  setInterval(render, 200);

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