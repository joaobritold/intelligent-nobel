/**
 * Controller — manages timers and communicates with the server.
 */

// ─── Init ──────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
let roomId = (params.get('room') || 'PALCO1').toUpperCase();

const client = new StageTimerClient({
  role: 'controller',
  room: roomId,
});

let state = null;
let draggedId = null;

// ─── DOM References ────────────────────────────────────────────────

const $connectionBadge = document.getElementById('connection-badge');
const $roomIdDisplay = document.getElementById('room-id');
const $timerList = document.getElementById('timer-list');
const $addTimerBtn = document.getElementById('add-timer-btn');
const $previewDisplay = document.getElementById('preview-display');
const $previewName = document.getElementById('preview-name');
const $previewMessage = document.getElementById('preview-message');
const $messageInput = document.getElementById('message-input');
const $sendInfoBtn = document.getElementById('send-info-btn');
const $sendUrgentBtn = document.getElementById('send-urgent-btn');
const $clearMsgBtn = document.getElementById('clear-msg-btn');
const $viewerLink = document.getElementById('viewer-link');
const $controllerLink = document.getElementById('controller-link');
const $globalStart = document.getElementById('global-start');
const $globalPause = document.getElementById('global-pause');
const $globalReset = document.getElementById('global-reset');
const $toast = document.getElementById('toast');
const $viewerBgColor = document.getElementById('viewer-bg-color');
const $roomCodeInput = document.getElementById('room-code-input');
const $joinRoomBtn = document.getElementById('join-room-btn');
const $p2pStatusText = document.getElementById('p2p-status-text');
const $p2pPeerCount = document.getElementById('p2p-peer-count');
const $viewerLinkBtn = document.getElementById('viewer-link-btn');

if ($roomCodeInput) {
  $roomCodeInput.value = (roomId || 'PALCO1').toUpperCase();
}

if ($joinRoomBtn && $roomCodeInput) {
  $joinRoomBtn.addEventListener('click', () => {
    const newRoom = $roomCodeInput.value.trim().toUpperCase() || 'PALCO1';
    location.search = `?room=${encodeURIComponent(newRoom)}`;
  });
  $roomCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $joinRoomBtn.click();
  });
}

if ($viewerBgColor) {
  $viewerBgColor.addEventListener('input', (e) => {
    client.updateTheme({ viewerBg: e.target.value });
  });
}

// ─── Connect ───────────────────────────────────────────────────────

client.on('connected', () => {
  $connectionBadge.className = 'connection-badge connected';
  $connectionBadge.innerHTML = '<span class="connection-dot"></span> Connected';
});

client.on('disconnected', () => {
  $connectionBadge.className = 'connection-badge disconnected';
  $connectionBadge.innerHTML = '<span class="connection-dot"></span> Disconnected';
});

client.on('p2p-ready', (data) => {
  if ($p2pStatusText) {
    $p2pStatusText.innerHTML = `<span style="color: var(--green);">● Online Ready</span> (Room: <strong>${(state?.id || roomId || 'PALCO1').toUpperCase()}</strong>)`;
  }
});

client.on('p2p-peers-update', (data) => {
  $connectionBadge.className = 'connection-badge connected';
  $connectionBadge.innerHTML = `<span class="connection-dot"></span> Online (${data.count} screen${data.count === 1 ? '' : 's'})`;
  if ($p2pPeerCount) {
    $p2pPeerCount.textContent = data.count;
  }
});

client.on('room-state', (data) => {
  state = data;

  if (state.theme?.viewerBg && $viewerBgColor) {
    $viewerBgColor.value = state.theme.viewerBg;
  }

  // Update room ID in URL if needed
  if (data.id && data.id !== roomId) {
    roomId = data.id;
    const url = new URL(location);
    url.searchParams.set('room', roomId);
    history.replaceState(null, '', url);
  }

  updateRoomInfo();
  renderTimers();
  renderPreview();
  renderMessageState();
});

client.connect();

// ─── Helpers ───────────────────────────────────────────────────────

function formatTime(ms) {
  const isNegative = ms < 0;
  const absMs = Math.abs(ms);
  const totalSeconds = Math.floor(absMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const prefix = isNegative ? '-' : '';
  if (hours > 0) {
    return `${prefix}${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseTimeInput(str) {
  // Accept formats: "5:00", "05:00", "1:30:00", "90" (seconds), "5m", "1h30m"
  str = str.trim();

  // HH:MM:SS or MM:SS
  const colonMatch = str.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      // H:MM:SS
      return (parseInt(colonMatch[1]) * 3600 + parseInt(colonMatch[2]) * 60 + parseInt(colonMatch[3])) * 1000;
    }
    // MM:SS
    return (parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])) * 1000;
  }

  // Just a number = seconds
  if (/^\d+$/.test(str)) {
    return parseInt(str) * 1000;
  }

  // Xh Ym Zs format
  let total = 0;
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (hMatch) total += parseInt(hMatch[1]) * 3600000;
  if (mMatch) total += parseInt(mMatch[1]) * 60000;
  if (sMatch) total += parseInt(sMatch[1]) * 1000;
  return total || null;
}

function getTimerColor(timer) {
  if (timer.mode === 'clock') return 'safe';
  if (timer.state === 'finished') return 'finished';
  let elapsed = timer.elapsed || 0;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    if (remaining <= 0) return 'finished';
    if (remaining <= timer.dangerAt) return 'danger';
    if (remaining <= timer.warnAt) return 'warn';
    return 'safe';
  }
  return 'safe';
}

function getTimerDisplayValue(timer) {
  if (timer.mode === 'clock') {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false });
  }
  let elapsed = timer.elapsed;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    return formatTime(remaining);
  }
  // countup
  return formatTime(elapsed);
}

function getTimerProgress(timer) {
  if (timer.mode !== 'countdown' || timer.duration === 0) return 0;
  let elapsed = timer.elapsed;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  return Math.min(1, elapsed / timer.duration);
}

function getEstimatedEndTime(timer) {
  if (!timer || timer.mode === 'clock') return '';
  let elapsed = timer.elapsed || 0;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  const remaining = Math.max(0, (timer.duration || 0) - elapsed);

  // If currently running (or active & already started), calculate real-time clock finish
  if (timer.state === 'running' || (timer.id === state?.activeTimerId && elapsed > 0)) {
    const end = new Date(Date.now() + remaining);
    return end.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // If scheduled startTime exists (e.g. "23:00"), calculate startTime + remaining duration
  if (timer.startTime) {
    const m = String(timer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
    if (m) {
      const startMins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const endMins = (startMins + Math.round(remaining / 60000)) % 1440;
      const hh = String(Math.floor(endMins / 60)).padStart(2, '0');
      const mm = String(endMins % 60).padStart(2, '0');
      return `${hh}:${mm}`;
    }
  }

  // Fallback: if started right now
  const end = new Date(Date.now() + remaining);
  return end.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getEventEndTime() {
  if (!state || !Array.isArray(state.timers) || state.timers.length === 0) return '--:--';
  const lastTimer = [...state.timers].reverse().find(t => t.mode !== 'clock') || state.timers[state.timers.length - 1];
  const activeTimer = state.timers.find(t => t.id === state.activeTimerId);

  let overtimeMins = 0;
  if (activeTimer && activeTimer.mode === 'countdown') {
    let el = activeTimer.elapsed || 0;
    if (activeTimer.state === 'running' && activeTimer.startedAt) el += Date.now() - activeTimer.startedAt;
    if (el > activeTimer.duration) {
      overtimeMins = Math.floor((el - activeTimer.duration) / 60000);
    }
  }

  if (lastTimer && lastTimer.startTime) {
    const rangeMatch = String(lastTimer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})\s*[-–—a]\s*(\d{1,2})\s*[:hH]\s*(\d{2})/);
    if (rangeMatch) {
      const endMins = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10) + overtimeMins;
      const norm = ((endMins % 1440) + 1440) % 1440;
      const str = `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
      return overtimeMins > 0 ? `${str} (+${overtimeMins}m)` : str;
    }
    const singleMatch = String(lastTimer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
    if (singleMatch) {
      const startMins = parseInt(singleMatch[1], 10) * 60 + parseInt(singleMatch[2], 10);
      const endMins = startMins + Math.round((lastTimer.duration || 0) / 60000) + overtimeMins;
      const norm = ((endMins % 1440) + 1440) % 1440;
      const str = `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
      return overtimeMins > 0 ? `${str} (+${overtimeMins}m)` : str;
    }
  }

  return getEstimatedEndTime(lastTimer) || '--:--';
}

let lastRenderedStructureSig = '';

function showToast(message) {
  $toast.textContent = message;
  $toast.classList.add('visible');
  setTimeout(() => $toast.classList.remove('visible'), 2000);
}

// ─── Update Room Info ──────────────────────────────────────────────

function updateRoomInfo() {
  if (!state) return;
  const code = (state.id || 'PALCO1').toUpperCase();
  $roomIdDisplay.textContent = code;
  if ($roomCodeInput && document.activeElement !== $roomCodeInput) {
    $roomCodeInput.value = code;
  }

  const basePath = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
  const viewerUrl = `${basePath}/viewer.html?room=${encodeURIComponent(code)}`;
  const operatorUrl = `${basePath}/operator.html?room=${encodeURIComponent(code)}`;
  const controllerUrl = `${basePath}/controller.html?room=${encodeURIComponent(code)}`;
  $viewerLink.href = viewerUrl;
  $viewerLink.textContent = `viewer.html?room=${code}`;
  if ($viewerLinkBtn) $viewerLinkBtn.href = viewerUrl;
  $controllerLink.href = operatorUrl;
  $controllerLink.textContent = `operator.html?room=${code}`;

  const topHub = document.getElementById('top-nav-hub');
  const topController = document.getElementById('top-nav-controller');
  const topOperator = document.getElementById('top-nav-operator');
  const topViewer = document.getElementById('top-nav-viewer');
  const topLineup = document.getElementById('top-nav-lineup');
  if (topHub) topHub.href = `${basePath}/index.html?room=${encodeURIComponent(code)}`;
  if (topController) topController.href = controllerUrl;
  if (topOperator) topOperator.href = operatorUrl;
  if (topViewer) topViewer.href = viewerUrl;
  if (topLineup) topLineup.href = `${basePath}/lineup.html?room=${encodeURIComponent(code)}`;
}

// ─── Render Timers ─────────────────────────────────────────────────

function renderTimers() {
  if (!state) return;

  const $ctrlEventEnd = document.getElementById('ctrl-event-end');
  if ($ctrlEventEnd) {
    $ctrlEventEnd.textContent = getEventEndTime();
  }

  if (state.timers.length === 0) {
    lastRenderedStructureSig = 'EMPTY';
    $timerList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⏱️</div>
        <div class="empty-state-text">No timers yet</div>
        <div class="empty-state-sub">Click "Add Timer" to get started</div>
      </div>
    `;
    return;
  }

  // Structural signature includes order of IDs, active timer, state, mode, and fields
  const structureSig = state.timers.map(t => `${t.id}:${t.name}:${t.notes || ''}:${t.id === state.activeTimerId}:${t.state}:${t.mode}:${t.startTime || ''}:${t.duration}`).join('|');

  // Never rebuild innerHTML on 100ms ticks if structure hasn't changed, or while editing/dragging
  const isEditing = document.activeElement && document.activeElement.matches('input, select, textarea');

  if (structureSig === lastRenderedStructureSig || isEditing || draggedId) {
    // Only update live display values in-place instead of blowing away innerHTML
    state.timers.forEach(timer => {
      const card = $timerList.querySelector(`[data-timer-id="${timer.id}"]`);
      if (card) {
        const display = card.querySelector('.timer-display');
        const color = getTimerColor(timer);
        if (display && document.activeElement !== display) {
          display.value = getTimerDisplayValue(timer);
          display.className = `timer-display timer-${color}`;
        }
        const endBadge = card.querySelector('.timer-end-badge');
        if (endBadge) {
          endBadge.textContent = `🏁 Fim previsto: ${getEstimatedEndTime(timer)}`;
        }
        const bar = card.querySelector('.timer-progress-bar');
        if (bar && timer.mode === 'countdown') {
          const progress = getTimerProgress(timer);
          bar.style.width = `${progress * 100}%`;
          bar.className = `timer-progress-bar ${color}`;
        }
      }
    });
    return;
  }

  lastRenderedStructureSig = structureSig;

  // Build HTML for each timer
  const html = state.timers.map((timer, idx) => {
    const color = getTimerColor(timer);
    const display = getTimerDisplayValue(timer);
    const progress = getTimerProgress(timer);
    const isActive = timer.id === state.activeTimerId;
    const isRunning = timer.state === 'running';
    const isFinished = timer.state === 'finished';
    const endTimeStr = getEstimatedEndTime(timer);

    const cardClasses = [
      'timer-card',
      isActive ? 'active' : '',
      isRunning ? 'running' : '',
      isFinished ? 'finished' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClasses}" data-timer-id="${timer.id}">
        <div class="timer-card-top">
          <span class="drag-handle" title="Arraste para reorganizar a ordem">⠿</span>
          <input
            class="timer-name-input"
            value="${escapeHtml(timer.name)}"
            data-timer-id="${timer.id}"
            data-field="name"
            spellcheck="false"
          />
          <button
            class="btn btn-sm timer-active-btn ${isActive ? 'is-active' : ''}"
            data-action="set-active"
            data-timer-id="${timer.id}"
          >
            ${isActive ? '● ON AIR' : 'SET LIVE'}
          </button>
        </div>

        <div class="timer-card-middle">
          <input
            class="timer-display timer-${color}"
            value="${display}"
            data-timer-id="${timer.id}"
            data-field="duration"
            title="Clique para editar a duração total"
            spellcheck="false"
          />
          <div class="timer-meta">
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
              <select class="input timer-mode-select" data-timer-id="${timer.id}" data-field="mode">
                <option value="countdown" ${timer.mode === 'countdown' ? 'selected' : ''}>⏬ Countdown</option>
                <option value="countup" ${timer.mode === 'countup' ? 'selected' : ''}>⏫ Count Up</option>
                <option value="clock" ${timer.mode === 'clock' ? 'selected' : ''}>🕐 Clock</option>
              </select>
              ${timer.mode !== 'clock' ? `
                <span class="timer-end-badge" title="Hora prevista de término">🏁 Fim previsto: ${endTimeStr}</span>
              ` : ''}
            </div>
            ${timer.mode !== 'clock' ? `
              <div class="timer-duration-row" style="flex-wrap: wrap;">
                <span>Horário:</span>
                <input
                  class="input input-mono timer-duration-input"
                  style="width: 138px;"
                  placeholder="23:00 – 00:15"
                  value="${escapeHtml(timer.startTime || '')}"
                  data-timer-id="${timer.id}"
                  data-field="startTime"
                  spellcheck="false"
                />
              </div>
            ` : ''}
          </div>
        </div>

        <div class="timer-card-notes" style="margin-bottom: 10px;">
          <input
            class="input timer-notes-input"
            style="width: 100%; font-size: 0.8rem; padding: 6px 10px;"
            placeholder="📝 Notas de palco para este artista (aparece debaixo do relógio)..."
            value="${escapeHtml(timer.notes || '')}"
            data-timer-id="${timer.id}"
            data-field="notes"
          />
        </div>

        <div class="timer-card-bottom">
          <div class="timer-controls">
            <button class="btn btn-icon btn-sm ${isRunning ? 'btn-success' : ''}" data-action="toggle" data-timer-id="${timer.id}" title="${isRunning ? 'Pause' : 'Start'}">
              ${isRunning ? '⏸' : '▶'}
            </button>
            <button class="btn btn-icon btn-sm" data-action="reset" data-timer-id="${timer.id}" title="Reset">
              ⏹
            </button>
            <button class="btn btn-sm" data-action="minus1m" data-timer-id="${timer.id}" title="Retirar 1 minuto (atualiza seguintes)" style="padding: 2px 7px; font-size: 0.72rem;">-1m</button>
            <button class="btn btn-sm" data-action="plus1m" data-timer-id="${timer.id}" title="Adicionar 1 minuto (atualiza seguintes)" style="padding: 2px 7px; font-size: 0.72rem;">+1m</button>
            <button class="btn btn-sm" data-action="plus5m" data-timer-id="${timer.id}" title="Adicionar 5 minutos (atualiza seguintes)" style="padding: 2px 7px; font-size: 0.72rem;">+5m</button>
          </div>
          <div class="timer-settings">
            <button class="btn btn-icon btn-sm" data-action="move-up" data-timer-id="${timer.id}" title="Mover para cima" ${idx === 0 ? 'disabled style="opacity:0.35"' : ''}>
              ↑
            </button>
            <button class="btn btn-icon btn-sm" data-action="move-down" data-timer-id="${timer.id}" title="Mover para baixo" ${idx === state.timers.length - 1 ? 'disabled style="opacity:0.35"' : ''}>
              ↓
            </button>
            <button class="btn btn-icon btn-sm" data-action="edit" data-timer-id="${timer.id}" title="Edit warnings">
              ⚙️
            </button>
            <button class="btn btn-icon btn-sm btn-danger" data-action="delete" data-timer-id="${timer.id}" title="Delete">
              🗑️
            </button>
          </div>
        </div>

        ${timer.mode === 'countdown' ? `
          <div class="timer-progress">
            <div class="timer-progress-bar ${color}" style="width: ${progress * 100}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  $timerList.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Render Preview ────────────────────────────────────────────────

function renderPreview() {
  if (!state) return;

  const activeTimer = state.timers.find(t => t.id === state.activeTimerId);
  const previewFrame = document.querySelector('.preview-frame');
  if (previewFrame && state.theme?.viewerBg) {
    previewFrame.style.backgroundColor = state.theme.viewerBg;
  }

  if (!activeTimer) {
    $previewName.textContent = '';
    $previewDisplay.textContent = '--:--';
    $previewDisplay.className = 'preview-timer-display';
    return;
  }

  const color = getTimerColor(activeTimer);
  const display = getTimerDisplayValue(activeTimer);

  $previewName.textContent = activeTimer.name;
  $previewDisplay.textContent = display;
  $previewDisplay.className = `preview-timer-display timer-${color}`;

  const $previewEndTime = document.getElementById('preview-endtime');
  if ($previewEndTime) {
    const endStr = getEstimatedEndTime(activeTimer);
    const evEnd = getEventEndTime();
    $previewEndTime.textContent = endStr ? `🏁 Fim artista: ${endStr}  |  🏁 Fim Evento: ${evEnd}` : '';
  }

  const $previewNotes = document.getElementById('preview-notes');
  if ($previewNotes) {
    $previewNotes.textContent = activeTimer.notes || '';
  }

  const $previewNext = document.getElementById('preview-next');
  if ($previewNext) {
    const idx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const nextTimer = idx >= 0 ? state.timers[idx + 1] : null;
    $previewNext.textContent = nextTimer ? `NEXT: ${nextTimer.name}` : '';
  }
}

// ─── Render Message State ──────────────────────────────────────────

function renderMessageState() {
  if (!state) return;

  if (state.message.visible && state.message.text) {
    $previewMessage.textContent = state.message.text;
    $previewMessage.style.background = state.message.level === 'urgent' ? 'rgba(145, 20, 28, 0.95)' : 'rgba(15, 23, 42, 0.9)';
    $previewMessage.classList.add('visible');
  } else {
    $previewMessage.classList.remove('visible');
  }
}

// ─── Event Delegation ──────────────────────────────────────────────

// Timer list clicks
$timerList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const timerId = btn.dataset.timerId;

  switch (action) {
    case 'toggle':
      client.timerAction(timerId, 'toggle');
      break;
    case 'reset':
      client.timerAction(timerId, 'reset');
      break;
    case 'minus1m':
      client.adjustTime(timerId, -60000);
      break;
    case 'plus1m':
      client.adjustTime(timerId, 60000);
      break;
    case 'plus5m':
      client.adjustTime(timerId, 300000);
      break;
    case 'set-active':
      client.setActiveTimer(timerId);
      break;
    case 'delete':
      if (confirm('Delete this timer?')) {
        client.deleteTimer(timerId);
      }
      break;
    case 'edit':
      openEditModal(timerId);
      break;
    case 'move-up': {
      const order = state.timers.map(t => t.id);
      const idx = order.indexOf(timerId);
      if (idx > 0) {
        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        client.reorderTimers(order);
      }
      break;
    }
    case 'move-down': {
      const order = state.timers.map(t => t.id);
      const idx = order.indexOf(timerId);
      if (idx >= 0 && idx < order.length - 1) {
        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
        client.reorderTimers(order);
      }
      break;
    }
  }
});

// Timer name editing
$timerList.addEventListener('change', (e) => {
  const input = e.target;
  const timerId = input.dataset.timerId;
  const field = input.dataset.field;
  if (!timerId || !field) return;

  if (field === 'name') {
    client.updateTimer(timerId, { name: input.value });
  } else if (field === 'notes') {
    client.updateTimer(timerId, { notes: input.value });
  } else if (field === 'startTime') {
    client.updateTimer(timerId, { startTime: input.value });
  } else if (field === 'mode') {
    client.updateTimer(timerId, { mode: input.value });
  } else if (field === 'duration') {
    const ms = parseTimeInput(input.value);
    if (ms && ms > 0) {
      client.updateTimer(timerId, { duration: ms });
    }
  }
});

// Live update notes while typing
$timerList.addEventListener('input', (e) => {
  const input = e.target;
  if (input.dataset?.field === 'notes' && input.dataset?.timerId) {
    client.updateTimer(input.dataset.timerId, { notes: input.value });
  }
});

// Prevent Enter from unfocusing name/duration input
$timerList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.timer-name-input, .timer-duration-input, .timer-display')) {
    e.target.blur();
  }
});

// Add Timer
$addTimerBtn.addEventListener('click', () => {
  client.createTimer({
    name: 'New Timer',
    mode: 'countdown',
    duration: 300000,
  });
});

// Preset Days (Dia 1, Dia 2, Dia 3, Dia 4)
document.querySelectorAll('.preset-day-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const day = parseInt(btn.dataset.day, 10) || 1;
    if (confirm(`Carregar alinhamento da Receção ao Caloiro 2026 — DIA ${day} (com Soundchecks e On Stage)?`)) {
      client.loadPresetDay(day);
      showToast(`✓ Dia ${day} carregado com sucesso!`);
    }
  });
});

const $clearEventBtn = document.getElementById('clear-event-btn');
if ($clearEventBtn) {
  $clearEventBtn.addEventListener('click', () => {
    if (confirm('🧹 Começar um Novo Evento do zero?\n\nIsto vai limpar todos os artistas atuais e mensagens de palco para poderes criar ou importar um novo evento.')) {
      client.clearAllTimers();
      showToast('✓ Lista limpa! Pronto para novo evento.');
    }
  });
}

// Global controls
$globalStart.addEventListener('click', () => client.globalAction('start'));
$globalPause.addEventListener('click', () => client.globalAction('pause'));
$globalReset.addEventListener('click', () => client.globalAction('reset'));

// Message controls (Info vs Urgent)
if ($sendInfoBtn) {
  $sendInfoBtn.addEventListener('click', () => {
    const text = $messageInput.value.trim();
    if (text) client.sendMessage(text, true, 'info');
  });
}

if ($sendUrgentBtn) {
  $sendUrgentBtn.addEventListener('click', () => {
    const text = $messageInput.value.trim();
    if (text) client.sendMessage(text, true, 'urgent');
  });
}

$clearMsgBtn.addEventListener('click', () => {
  $messageInput.value = '';
  client.clearMessage();
});

// Send message on Ctrl+Enter (defaults to Info)
$messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    if ($sendInfoBtn) $sendInfoBtn.click();
  }
});

// Copy room ID
$roomIdDisplay.addEventListener('click', () => {
  navigator.clipboard?.writeText(roomId).then(() => {
    showToast('Room ID copied!');
  });
});

// ─── Drag & Drop ───────────────────────────────────────────────────

// Disable card draggable when pressing inside an input/select so user can select text normally
$timerList.addEventListener('mousedown', (e) => {
  const card = e.target.closest('.timer-card');
  if (!card) return;
  if (e.target.matches('input, select, textarea, button')) {
    card.setAttribute('draggable', 'false');
  } else {
    card.setAttribute('draggable', 'true');
  }
});

$timerList.addEventListener('mouseup', (e) => {
  const card = e.target.closest('.timer-card');
  if (card) card.removeAttribute('draggable');
});

$timerList.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.timer-card');
  if (!card) return;
  draggedId = card.dataset.timerId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', draggedId);
  } catch (_) {}
});

$timerList.addEventListener('dragend', () => {
  $timerList.querySelectorAll('.timer-card').forEach(c => {
    c.classList.remove('dragging', 'drag-over');
    c.removeAttribute('draggable');
  });
  draggedId = null;
});

$timerList.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.target.closest('.timer-card');
  $timerList.querySelectorAll('.timer-card').forEach(c => {
    c.classList.toggle('drag-over', c === target && c.dataset.timerId !== draggedId);
  });
});

$timerList.addEventListener('dragleave', (e) => {
  const target = e.target.closest('.timer-card');
  if (target && !target.contains(e.relatedTarget)) {
    target.classList.remove('drag-over');
  }
});

$timerList.addEventListener('drop', (e) => {
  e.preventDefault();
  $timerList.querySelectorAll('.timer-card').forEach(c => c.classList.remove('drag-over', 'dragging'));
  if (!draggedId || !state) return;

  const target = e.target.closest('.timer-card');
  const currentDraggedId = draggedId;
  draggedId = null;

  if (!target || target.dataset.timerId === currentDraggedId) return;

  const order = state.timers.map(t => t.id);
  const fromIdx = order.indexOf(currentDraggedId);
  const toIdx = order.indexOf(target.dataset.timerId);
  if (fromIdx === -1 || toIdx === -1) return;

  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, currentDraggedId);

  client.reorderTimers(order);
});

// ─── Edit Timer Modal ──────────────────────────────────────────────

const $modal = document.getElementById('edit-modal');
const $modalTimerId = document.getElementById('modal-timer-id');
const $modalWarnAt = document.getElementById('modal-warn-at');
const $modalDangerAt = document.getElementById('modal-danger-at');
const $modalSave = document.getElementById('modal-save');
const $modalCancel = document.getElementById('modal-cancel');

function openEditModal(timerId) {
  const timer = state?.timers.find(t => t.id === timerId);
  if (!timer) return;

  $modalTimerId.value = timerId;
  $modalWarnAt.value = formatTime(timer.warnAt);
  $modalDangerAt.value = formatTime(timer.dangerAt);

  $modal.classList.add('visible');
}

$modalSave.addEventListener('click', () => {
  const timerId = $modalTimerId.value;
  const warnAt = parseTimeInput($modalWarnAt.value);
  const dangerAt = parseTimeInput($modalDangerAt.value);

  if (warnAt != null && dangerAt != null) {
    client.updateTimer(timerId, { warnAt, dangerAt });
  }

  $modal.classList.remove('visible');
});

$modalCancel.addEventListener('click', () => {
  $modal.classList.remove('visible');
});

$modal.addEventListener('click', (e) => {
  if (e.target === $modal) {
    $modal.classList.remove('visible');
  }
});

// ─── Smart Schedule Importer Modal (PDF / Excel / CSV / Text) ──────

const $openImportBtn = document.getElementById('open-import-btn');
const $importModal = document.getElementById('import-modal');
const $importFileInput = document.getElementById('import-file-input');
const $importPageSelector = document.getElementById('import-page-selector');
const $importPageSelect = document.getElementById('import-page-select');
const $importTextArea = document.getElementById('import-text-area');
const $importPreviewBox = document.getElementById('import-preview-box');
const $importConfirm = document.getElementById('import-confirm');
const $importCancel = document.getElementById('import-cancel');

let extractedPagesText = [];

function updateImportPreview() {
  if (!$importTextArea || !$importPreviewBox) return;
  const parsed = ScheduleImporter.parseTextToTimers($importTextArea.value);
  if (parsed.length === 0) {
    $importPreviewBox.style.display = 'none';
    return;
  }
  $importPreviewBox.style.display = 'block';
  $importPreviewBox.innerHTML = `<div style="color: var(--green); font-weight: 700; margin-bottom: 4px;">✓ ${parsed.length} Artista(s) detetado(s):</div>` +
    parsed.map((t, i) => `<div>${i + 1}. <strong>${escapeHtml(t.name)}</strong> (${escapeHtml(t.startTime)}) — ${formatTime(t.duration)}</div>`).join('');
}

if ($openImportBtn && $importModal) {
  $openImportBtn.addEventListener('click', () => {
    $importModal.classList.add('visible');
  });
}

if ($importCancel && $importModal) {
  $importCancel.addEventListener('click', () => {
    $importModal.classList.remove('visible');
  });
  $importModal.addEventListener('click', (e) => {
    if (e.target === $importModal) $importModal.classList.remove('visible');
  });
}

if ($importTextArea) {
  $importTextArea.addEventListener('input', updateImportPreview);
}

if ($importPageSelect) {
  $importPageSelect.addEventListener('change', () => {
    if ($importPageSelect.value === 'all') {
      $importTextArea.value = extractedPagesText.join('\n\n');
      updateImportPreview();
      return;
    }
    const idx = parseInt($importPageSelect.value, 10) || 0;
    if (extractedPagesText[idx] !== undefined) {
      $importTextArea.value = extractedPagesText[idx];
      updateImportPreview();
    }
  });
}

if ($importFileInput) {
  $importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'pdf') {
        extractedPagesText = await ScheduleImporter.extractPdfPages(file);
      } else {
        extractedPagesText = await ScheduleImporter.extractSpreadsheetOrText(file);
      }

      if (extractedPagesText.length > 1) {
        $importPageSelector.style.display = 'block';
        $importPageSelect.innerHTML =
          extractedPagesText.map((_, i) => `<option value="${i}">Página / Dia ${i + 1}</option>`).join('') +
          `<option value="all">Todos os Dias (${extractedPagesText.length} páginas)</option>`;
      } else {
        $importPageSelector.style.display = 'none';
      }

      $importTextArea.value = extractedPagesText[0] || '';
      updateImportPreview();
    } catch (err) {
      alert('Erro ao ler ficheiro: ' + err.message);
    }
  });
}

if ($importConfirm) {
  $importConfirm.addEventListener('click', () => {
    const parsed = ScheduleImporter.parseTextToTimers($importTextArea.value);
    if (parsed.length === 0) {
      alert('Nenhum artista com horário (ex: 23h00 - 00h15) foi encontrado no texto.');
      return;
    }
    client.replaceAllTimers(parsed);
    $importModal.classList.remove('visible');
    showToast(`✓ ${parsed.length} artistas importados com sucesso!`);
  });
}

// ─── Keyboard Shortcuts ────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Don't handle when typing in inputs
  if (e.target.matches('input, textarea, select')) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      // Toggle active timer
      if (state?.activeTimerId) {
        client.timerAction(state.activeTimerId, 'toggle');
      }
      break;
    case 'n':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        $addTimerBtn.click();
      }
      break;
    case 'Escape':
      $modal.classList.remove('visible');
      break;
  }
});
