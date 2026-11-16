/**
 * ⌚ StageTimer PFP — Apple Watch HUD Operacional de Pulso
 * Sincronização Híbrida:
 * 1. SSE nativo em HTTPS (Porta 443, zero rate-limit, <100ms push)
 * 2. MQTT WebSocket over WSS (quando em Wi-Fi direto)
 * 3. Re-Sync Instantâneo ao Levantar o Pulso (visibilitychange / touch)
 * 4. Fim do Evento em tempo real (Cascade Schedule)
 * 5. Dígitos Gigantes com Overtime Negativo e Alerta Tátil
 */

(function() {
  'use strict';

  // ─── Safe Storage Helpers (100% imune a WebKit SecurityError) ─────
  function safeGet(storageName, key) {
    try {
      if (typeof window !== 'undefined' && window[storageName] && typeof window[storageName].getItem === 'function') {
        return window[storageName].getItem(key) || '';
      }
    } catch (_) {}
    return '';
  }
  function safeSet(storageName, key, val) {
    try {
      if (typeof window !== 'undefined' && window[storageName] && typeof window[storageName].setItem === 'function') {
        window[storageName].setItem(key, val);
      }
    } catch (_) {}
  }

  // ─── Resolução da Sala e Dispositivo ───────────────────────────────────
  const params = new URLSearchParams(location.search);
  const rawParamRoom = (params.get('room') || '').trim();
  const normalizedParam = rawParamRoom.replace(/\s+/g, '-').toUpperCase();
  const savedActiveRoom = safeGet('sessionStorage', 'stagetimer_active_room').trim();
  const savedDeviceRoom = safeGet('localStorage', 'stagetimer_device_room').trim();
  const savedLastRoom = safeGet('localStorage', 'stagetimer_last_room').trim();

  let roomId = (normalizedParam || savedActiveRoom || savedDeviceRoom || savedLastRoom || 'PALCO1').toUpperCase();

  // Resolução inteligente a partir do registo de eventos se disponível
  try {
    const rawReg = safeGet('localStorage', 'stagetimer_v63_registry') || safeGet('localStorage', 'stagetimer_v10_events_list') || '[]';
    const localEvents = JSON.parse(rawReg);
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

  safeSet('localStorage', 'stagetimer_device_room', roomId);
  safeSet('localStorage', 'stagetimer_last_room', roomId);
  safeSet('sessionStorage', 'stagetimer_active_room', roomId);

  // ─── Elementos do DOM (com suporte duplo a classes novas e antigas) ───
  const $dot = document.getElementById('watch-status-dot') || document.getElementById('viewer-connection');
  const $artistName = document.getElementById('watch-artist-name') || document.getElementById('viewer-timer-name');
  const $stateBadge = document.getElementById('watch-state-badge');
  const $timer = document.getElementById('watch-timer') || document.getElementById('viewer-timer');
  const $eventEnd = document.getElementById('watch-event-end');
  const $clockTime = document.getElementById('watch-clock-time') || document.getElementById('viewer-clock-time');
  const $next = document.getElementById('watch-next') || document.getElementById('viewer-next');
  const $nextName = document.getElementById('watch-next-name') || document.getElementById('viewer-next-name');
  const $progressBar = document.getElementById('watch-progress-bar') || document.getElementById('viewer-progress-bar');
  const $msgOverlay = document.getElementById('watch-message-overlay') || document.getElementById('viewer-message');
  const $msgBadge = document.getElementById('watch-msg-badge');
  const $msgText = document.getElementById('watch-msg-text');

  // Primeiro quadro instantâneo (sem ecrã preto)
  if ($artistName) $artistName.textContent = roomId;
  if ($timer) {
    $timer.textContent = '00:00';
    $timer.className = 'watch-digits safe';
  }
  if ($clockTime && typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.getTrueTimeString === 'function') {
    $clockTime.textContent = StageTimerClient.getTrueTimeString();
  }

  let state = null;
  let lastMessageId = '';
  let lastStateUpdate = 0;
  let sseSource = null;

  // ─── Atualização e Adoção do Estado ────────────────────────────────────
  function adoptRoomAndState(targetRoom, incomingData) {
    const cleanTarget = String(targetRoom || '').toUpperCase().trim();
    if (!cleanTarget) return;

    if ($dot) $dot.classList.remove('disconnected');
    lastStateUpdate = Date.now();

    if (incomingData && (Array.isArray(incomingData.timers) || incomingData.timers)) {
      state = incomingData;
    }

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

      // Re-conecta SSE para o novo canal se o palco mudou
      setupSseRelay();

      if (client.mqttClient && client.mqttClient.connected) {
        try {
          client.mqttClient.subscribe([client.mqttTopicState, client.mqttTopicPresence], { qos: 0 });
          client.announcePresenceNow();
        } catch (_) {}
      }
    }

    if (incomingData && Array.isArray(incomingData.timers)) {
      try { client._applyIncomingState(incomingData, true); } catch (_) {}
    }

    handleMessageAlert();
    render();
  }

  // ─── 1. Motor Server-Sent Events (SSE) nativo sobre HTTPS ─────────────
  // O SSE usa porta 443 padrão, sem bloqueios de WebSockets no Bluetooth watchOS
  function setupSseRelay() {
    if (typeof EventSource === 'undefined') return;
    try {
      if (sseSource) {
        sseSource.close();
        sseSource = null;
      }
      const cleanRoom = roomId.replace(/[^A-Z0-9_-]/g, '');
      const sseUrl = `https://ntfy.sh/showflow_v10_${cleanRoom}/sse`;
      sseSource = new EventSource(sseUrl);

      sseSource.onopen = function() {
        if ($dot) $dot.classList.remove('disconnected');
      };

      sseSource.onmessage = function(event) {
        if (!event || !event.data) return;
        try {
          const item = JSON.parse(event.data);
          if (item.event === 'message' && item.message) {
            const incoming = JSON.parse(item.message);
            if (incoming && Array.isArray(incoming.timers)) {
              adoptRoomAndState(incoming.id || roomId, incoming);
            }
          }
        } catch (_) {}
      };

      sseSource.onerror = function() {
        // Se cair (ex.: braço baixado), o navegador reconecta automaticamente ao voltar
        if (Date.now() - lastStateUpdate > 12000 && (!client.mqttClient || !client.mqttClient.connected)) {
          if ($dot) $dot.classList.add('disconnected');
        }
      };
    } catch (_) {}
  }

  // ─── 2. Fetch de Resgate Pontual (Zero Spam, Sem 429) ───────────────────
  let isFetchingRescue = false;
  async function fetchRescueState() {
    if (isFetchingRescue) return;
    isFetchingRescue = true;
    try {
      const cleanRoom = roomId.replace(/[^A-Z0-9_-]/g, '');
      const url = `https://ntfy.sh/showflow_v10_${cleanRoom}/json?poll=1`;
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const tid = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
      const opts = { cache: 'no-store' };
      if (ctrl) opts.signal = ctrl.signal;

      const res = await fetch(url, opts);
      if (tid) clearTimeout(tid);

      if (res.ok) {
        const text = await res.text();
        if (text && text.trim()) {
          const lines = text.trim().split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const item = JSON.parse(lines[i]);
              if (item.event === 'message' && item.message) {
                const incoming = JSON.parse(item.message);
                if (incoming && Array.isArray(incoming.timers)) {
                  adoptRoomAndState(incoming.id || roomId, incoming);
                  break;
                }
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {
    } finally {
      isFetchingRescue = false;
    }
  }

  // ─── 3. Cliente MQTT / LocalSync Padrão (Wi-Fi Direto) ─────────────────
  const client = new StageTimerClient({
    role: 'watch',
    room: roomId,
  });

  client.on('connected', () => {
    if ($dot) $dot.classList.remove('disconnected');
    try {
      client.sendDeviceCommand('ALL', { action: 'request_room_state', room: roomId });
      client.sendDeviceCommand('ALL', { action: 'request_registry' });
    } catch (_) {}
    render();
  });

  client.on('room-state', (data) => {
    state = data;
    if (state?.id && state.id !== roomId) roomId = state.id;
    if ($dot) $dot.classList.remove('disconnected');
    lastStateUpdate = Date.now();
    handleMessageAlert();
    render();
  });

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

    const currentRunning = Boolean(state && StageTimerClient.getActiveTimer(state)?.state === 'running');
    const incomingRunning = Boolean(StageTimerClient.getActiveTimer(data)?.state === 'running');

    if (isSubStage && (incomingRunning || !currentRunning)) {
      adoptRoomAndState(incomingRoom, data);
    }
  });

  client.connect();
  setupSseRelay();

  // Se o estado inicial inline já tiver sido lido no head, aplica agora
  if (typeof window !== 'undefined' && window.__INITIAL_WATCH_STATE__) {
    try {
      const initS = window.__INITIAL_WATCH_STATE__;
      if (initS && Array.isArray(initS.timers)) {
        adoptRoomAndState(initS.id || roomId, initS);
      }
    } catch (_) {}
  }

  // ─── Re-Sync Imediato ao Levantar o Pulso / Acordar ─────────────────────
  function onWakeUp() {
    render();
    fetchRescueState();
    if (!sseSource || sseSource.readyState === EventSource.CLOSED) {
      setupSseRelay();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onWakeUp();
  });
  window.addEventListener('focus', onWakeUp);

  // Toque rápido no ecrã: feedback tátil suave e re-sincronização forçada
  document.addEventListener('touchstart', () => {
    if (navigator.vibrate) {
      try { navigator.vibrate(30); } catch (_) {}
    }
    onWakeUp();
  }, { passive: true });

  // Heartbeat de segurança a cada 8s caso o SSE esteja em silêncio
  setInterval(() => {
    if (Date.now() - lastStateUpdate > 8000) {
      fetchRescueState();
    }
  }, 8000);

  // ─── Helpers de Horários e Formatação ─────────────────────────────────
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
      if (remaining <= 0) return 'danger'; // Overtime / negativo a vermelho vivo
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

  function getNextTimer(currentState, currentActive) {
    if (!currentState || !Array.isArray(currentState.timers) || currentState.timers.length === 0) return null;
    let list = currentState.timers;
    if (currentActive) {
      if (!list.some(t => t.id === currentActive.id) && currentState.days) {
        for (const dayList of Object.values(currentState.days)) {
          if (Array.isArray(dayList) && dayList.some(t => t.id === currentActive.id)) {
            list = dayList;
            break;
          }
        }
      }
      const activeIdx = list.findIndex(t => t.id === currentActive.id);
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

  // ─── Resolução do Fim do Evento / Show ────────────────────────────────
  function resolveEventEndTime(currentState) {
    if (!currentState) return '--:--';
    if (currentState.eventEndTime && currentState.eventEndTime !== '--:--') {
      return currentState.eventEndTime;
    }
    if (typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.computeEventEndTime === 'function') {
      try {
        return StageTimerClient.computeEventEndTime(currentState);
      } catch (_) {}
    }
    return '--:--';
  }

  // ─── Ajuste Dinâmico da Tipografia dos Dígitos ────────────────────────
  function fitDigits() {
    if (!$timer) return;
    const txt = $timer.textContent || '';
    const len = txt.length;
    if (len > 8) {
      $timer.style.fontSize = 'clamp(1.9rem, 16vw, 2.7rem)';
      $timer.classList.add('is-long');
    } else if (len > 5) {
      $timer.style.fontSize = 'clamp(2.4rem, 21vw, 3.8rem)';
      $timer.classList.add('is-long');
    } else {
      $timer.style.fontSize = 'clamp(3.8rem, 35vw, 6.4rem)';
      $timer.classList.remove('is-long');
    }
  }

  // ─── Alertas da Régie ────────────────────────────────────────────────
  function handleMessageAlert() {
    if (!state) return;
    const msg = state.message;
    if (msg && msg.visible && msg.text) {
      if ($msgText) $msgText.textContent = msg.text;
      if ($msgBadge) $msgBadge.textContent = msg.level === 'urgent' ? 'URGENTE DA RÉGIE' : 'AVISO DA RÉGIE';
      if ($msgOverlay) $msgOverlay.className = 'watch-alert-overlay visible';
      if (msg.id !== lastMessageId) {
        lastMessageId = msg.id;
        if (navigator.vibrate) {
          try { navigator.vibrate([200, 100, 200, 100, 300]); } catch (_) {}
        }
      }
    } else {
      if ($msgOverlay) $msgOverlay.className = 'watch-alert-overlay';
      lastMessageId = '';
    }
  }

  if ($msgOverlay) {
    $msgOverlay.addEventListener('click', () => {
      $msgOverlay.classList.remove('visible');
    });
  }

  // ─── Render Loop Principal (200ms) ───────────────────────────────────
  let lastColorState = '';

  function render() {
    // 1. HORA LOCAL REAL (Base Esquerda)
    if ($clockTime) {
      $clockTime.textContent = StageTimerClient.getTrueTimeString();
    }

    // 2. FIM DO EVENTO / SHOW (Linha de Destaque)
    const endStr = resolveEventEndTime(state);
    if ($eventEnd) {
      $eventEnd.textContent = endStr || '--:--';
    }

    const activeTimer = state ? StageTimerClient.getActiveTimer(state) : null;

    if (!activeTimer) {
      // Sem timer ativo
      const timersList = Array.isArray(state?.timers) ? state.timers : [];
      const pendingTimer = timersList.find(t => t.state !== 'finished');

      if (pendingTimer) {
        if ($artistName) $artistName.textContent = pendingTimer.name || 'Próximo';
        if ($stateBadge) {
          $stateBadge.textContent = 'STANDBY';
          $stateBadge.className = 'watch-badge standby';
        }
        if ($timer) {
          $timer.textContent = formatTime(pendingTimer.duration || 0);
          $timer.className = 'watch-digits paused';
        }
      } else if (timersList.length > 0 && timersList.every(t => t.state === 'finished')) {
        if ($artistName) $artistName.textContent = 'Fim do Show';
        if ($stateBadge) {
          $stateBadge.textContent = 'FIM';
          $stateBadge.className = 'watch-badge danger';
        }
        if ($timer) {
          $timer.textContent = '00:00';
          $timer.className = 'watch-digits danger';
        }
      } else {
        if ($artistName) $artistName.textContent = state?.name || roomId;
        if ($stateBadge) {
          $stateBadge.textContent = 'READY';
          $stateBadge.className = 'watch-badge standby';
        }
        if ($timer) {
          $timer.textContent = '00:00';
          $timer.className = 'watch-digits clock';
        }
      }

      if ($next) $next.style.display = 'none';
      if ($progressBar) $progressBar.style.width = '0%';
      fitDigits();
      return;
    }

    // 3. NOME DO ARTISTA E BADGE DE ESTADO
    if ($artistName) {
      $artistName.textContent = activeTimer.name || 'Artista em Palco';
    }

    const isRunning = activeTimer.state === 'running';
    const isPaused = activeTimer.state === 'paused';
    const displayVal = getTimerDisplayValue(activeTimer);
    const color = getTimerColor(activeTimer);
    const isOvertime = color === 'danger' && activeTimer.mode === 'countdown';

    if ($stateBadge) {
      if (isOvertime) {
        $stateBadge.textContent = 'OVERTIME';
        $stateBadge.className = 'watch-badge overtime';
      } else if (isRunning) {
        $stateBadge.textContent = 'NO AR';
        $stateBadge.className = 'watch-badge running';
      } else if (isPaused) {
        $stateBadge.textContent = 'PAUSA';
        $stateBadge.className = 'watch-badge paused';
      } else {
        $stateBadge.textContent = 'PRONTO';
        $stateBadge.className = 'watch-badge standby';
      }
    }

    // Alerta háptico ao entrar em tempo negativo
    if (isOvertime && lastColorState !== 'danger') {
      if (navigator.vibrate) {
        try { navigator.vibrate([160, 80, 160]); } catch (_) {}
      }
    }
    lastColorState = color;

    // 4. DÍGITOS GIGANTES
    if ($timer) {
      $timer.textContent = displayVal;
      $timer.className = `watch-digits ${color}`;
    }

    // 5. PRÓXIMO ARTISTA (Base Direita)
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

    // 6. BARRA DE PROGRESSO
    if ($progressBar) {
      if (activeTimer.duration > 0 && activeTimer.mode === 'countdown') {
        const elapsed = getTimerElapsed(activeTimer);
        const pct = Math.min(100, (elapsed / activeTimer.duration) * 100);
        $progressBar.style.width = `${pct}%`;
        if (pct >= 100) {
          $progressBar.className = 'watch-progress-fill overtime';
        } else if (pct > 80) {
          $progressBar.className = 'watch-progress-fill warn';
        } else {
          $progressBar.className = 'watch-progress-fill';
        }
      } else {
        $progressBar.style.width = '0%';
      }
    }

    fitDigits();
  }

  setInterval(render, 200);

  // ─── Wake Lock (Manter Ecrã Ligado) ──────────────────────────────────
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        await navigator.wakeLock.request('screen');
      }
    } catch (_) {}
  }
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  // Recolhimento automático do cabeçalho watchOS para Fullscreen
  function tryCollapseWatchHeader() {
    try { window.scrollTo({ top: 30, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 30); }
  }
  window.addEventListener('load', () => setTimeout(tryCollapseWatchHeader, 350));
  document.addEventListener('touchstart', () => setTimeout(tryCollapseWatchHeader, 80), { passive: true, once: true });
})();
