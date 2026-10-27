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
const $sendMsgBtn = document.getElementById('send-msg-btn');
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
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - timer.elapsed;
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
    const remaining = Math.max(0, timer.duration - elapsed);
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

  const topController = document.getElementById('top-nav-controller');
  const topOperator = document.getElementById('top-nav-operator');
  const topViewer = document.getElementById('top-nav-viewer');
  const topLineup = document.getElementById('top-nav-lineup');
  if (topController) topController.href = controllerUrl;
  if (topOperator) topOperator.href = operatorUrl;
  if (topViewer) topViewer.href = viewerUrl;
  if (topLineup) topLineup.href = `${basePath}/lineup.html?room=${encodeURIComponent(code)}`;
}

// ─── Render Timers ─────────────────────────────────────────────────

function renderTimers() {
  if (!state) return;

  if (state.timers.length === 0) {
    $timerList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⏱️</div>
        <div class="empty-state-text">No timers yet</div>
        <div class="empty-state-sub">Click "Add Timer" to get started</div>
      </div>
    `;
    return;
  }

  // Prevent re-rendering while user is editing or hovering
  const isEditing = document.activeElement && document.activeElement.matches('input, select, textarea');
  const isHovering = $timerList.matches(':hover');

  if (isEditing || isHovering) {
    // Only update live display values instead of blowing away innerHTML
    state.timers.forEach(timer => {
      const card = $timerList.querySelector(`[data-timer-id="${timer.id}"]`);
      if (card) {
        const display = card.querySelector('.timer-display');
        const color = getTimerColor(timer);
        if (display) {
          display.textContent = getTimerDisplayValue(timer);
          display.className = `timer-display timer-${color}`;
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

  // Build HTML for each timer
  const html = state.timers.map(timer => {
    const color = getTimerColor(timer);
    const display = getTimerDisplayValue(timer);
    const progress = getTimerProgress(timer);
    const isActive = timer.id === state.activeTimerId;
    const isRunning = timer.state === 'running';
    const isFinished = timer.state === 'finished';

    const cardClasses = [
      'timer-card',
      isActive ? 'active' : '',
      isRunning ? 'running' : '',
      isFinished ? 'finished' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClasses}" data-timer-id="${timer.id}" draggable="true">
        <div class="timer-card-top">
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
          <div class="timer-display timer-${color}">
            ${display}
          </div>
          <div class="timer-meta">
            <select class="input timer-mode-select" data-timer-id="${timer.id}" data-field="mode">
              <option value="countdown" ${timer.mode === 'countdown' ? 'selected' : ''}>⏬ Countdown</option>
              <option value="countup" ${timer.mode === 'countup' ? 'selected' : ''}>⏫ Count Up</option>
              <option value="clock" ${timer.mode === 'clock' ? 'selected' : ''}>🕐 Clock</option>
            </select>
            ${timer.mode !== 'clock' ? `
              <div class="timer-duration-row">
                <span>Duration:</span>
                <input
                  class="input input-mono timer-duration-input"
                  value="${formatTime(timer.duration)}"
                  data-timer-id="${timer.id}"
                  data-field="duration"
                  spellcheck="false"
                />
                <span style="margin-left: 6px;">Horário:</span>
                <input
                  class="input input-mono timer-duration-input"
                  placeholder="21:00"
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
          </div>
          <div class="timer-settings">
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
    $previewMessage.classList.add('visible');
    $sendMsgBtn.textContent = '📝 Update';
  } else {
    $previewMessage.classList.remove('visible');
    $sendMsgBtn.textContent = '📤 Send';
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

// Prevent Enter from unfocusing name input
$timerList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.timer-name-input, .timer-duration-input')) {
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

// Global controls
$globalStart.addEventListener('click', () => client.globalAction('start'));
$globalPause.addEventListener('click', () => client.globalAction('pause'));
$globalReset.addEventListener('click', () => client.globalAction('reset'));

// Message controls
$sendMsgBtn.addEventListener('click', () => {
  const text = $messageInput.value.trim();
  if (text) {
    client.sendMessage(text, true);
  }
});

$clearMsgBtn.addEventListener('click', () => {
  $messageInput.value = '';
  client.clearMessage();
});

// Send message on Ctrl+Enter
$messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    $sendMsgBtn.click();
  }
});

// Copy room ID
$roomIdDisplay.addEventListener('click', () => {
  navigator.clipboard?.writeText(roomId).then(() => {
    showToast('Room ID copied!');
  });
});

// ─── Drag & Drop ───────────────────────────────────────────────────

$timerList.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.timer-card');
  if (!card) return;
  draggedId = card.dataset.timerId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

$timerList.addEventListener('dragend', (e) => {
  const card = e.target.closest('.timer-card');
  if (card) card.classList.remove('dragging');
  draggedId = null;
});

$timerList.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});

$timerList.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!draggedId || !state) return;

  const target = e.target.closest('.timer-card');
  if (!target || target.dataset.timerId === draggedId) return;

  const order = state.timers.map(t => t.id);
  const fromIdx = order.indexOf(draggedId);
  const toIdx = order.indexOf(target.dataset.timerId);

  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, draggedId);

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
