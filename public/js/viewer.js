/**
 * Viewer — fullscreen timer display for the stage.
 */

// ─── Init ──────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const roomId = (params.get('room') || 'PALCO1').toUpperCase();

const client = new StageTimerClient({
  role: 'viewer',
  room: roomId,
});

let state = null;
let clockInterval = null;

// ─── DOM References ────────────────────────────────────────────────

const $timerName = document.getElementById('viewer-timer-name');
const $timer = document.getElementById('viewer-timer');
const $progress = document.getElementById('viewer-progress-bar');
const $message = document.getElementById('viewer-message');
const $connection = document.getElementById('viewer-connection');
const $flashOverlay = document.getElementById('flash-overlay');
const $emptyState = document.getElementById('viewer-empty');
const $viewerRoomInput = document.getElementById('viewer-room-input');
const $viewerRoomBtn = document.getElementById('viewer-room-btn');
const $viewerNotes = document.getElementById('viewer-notes');
const $viewerNext = document.getElementById('viewer-next');
const $viewerNextName = document.getElementById('viewer-next-name');
const $viewerClockTime = document.getElementById('viewer-clock-time');

function updateLocalClock() {
  if ($viewerClockTime) {
    $viewerClockTime.textContent = new Date().toLocaleTimeString('pt-PT', { hour12: false });
  }
}
updateLocalClock();
setInterval(updateLocalClock, 1000);

if ($viewerRoomInput) {
  $viewerRoomInput.value = roomId;
}
if ($viewerRoomBtn && $viewerRoomInput) {
  $viewerRoomBtn.addEventListener('click', () => {
    const code = $viewerRoomInput.value.trim().toUpperCase() || 'PALCO1';
    location.search = `?room=${encodeURIComponent(code)}`;
  });
  $viewerRoomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $viewerRoomBtn.click();
  });
}

// ─── Connect ───────────────────────────────────────────────────────

client.on('connected', () => {
  $connection.className = 'viewer-connection';
});

client.on('disconnected', () => {
  $connection.className = 'viewer-connection disconnected';
});

client.on('room-state', (data) => {
  state = data;
  render();
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

function getTimerColor(timer) {
  if (timer.mode === 'clock') return 'clock';
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

// ─── Render ────────────────────────────────────────────────────────

function render() {
  if (!state) return;

  // Apply custom background color if set
  if (state.theme?.viewerBg) {
    document.querySelector('.viewer').style.backgroundColor = state.theme.viewerBg;
    document.body.style.backgroundColor = state.theme.viewerBg;
  }

  const activeTimer = state.timers.find(t => t.id === state.activeTimerId);

  // Message
  if (state.message.visible && state.message.text) {
    $message.textContent = state.message.text;
    $message.classList.add('visible');
  } else {
    $message.classList.remove('visible');
  }

  // No active timer
  if (!activeTimer) {
    $timer.style.display = 'none';
    $timerName.style.display = 'none';
    if ($viewerNotes) $viewerNotes.classList.remove('visible');
    if ($viewerNext) $viewerNext.style.display = 'none';
    $emptyState.style.display = 'flex';
    $progress.style.width = '0%';
    $flashOverlay.classList.remove('active');

    // Start clock update for empty state
    if (!clockInterval) {
      clockInterval = setInterval(render, 1000);
    }
    return;
  }

  // Show timer
  $timer.style.display = '';
  $timerName.style.display = '';
  $emptyState.style.display = 'none';

  // Timer name
  $timerName.textContent = activeTimer.name;

  // Artist Notes (under the clock)
  if ($viewerNotes) {
    if (activeTimer.notes && activeTimer.notes.trim()) {
      $viewerNotes.textContent = activeTimer.notes.trim();
      $viewerNotes.classList.add('visible');
    } else {
      $viewerNotes.textContent = '';
      $viewerNotes.classList.remove('visible');
    }
  }

  // Next Artist Indicator
  if ($viewerNext && $viewerNextName) {
    const activeIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const nextTimer = activeIdx >= 0 ? state.timers[activeIdx + 1] : null;
    if (nextTimer) {
      $viewerNextName.textContent = nextTimer.name;
      $viewerNext.style.display = 'flex';
    } else {
      $viewerNext.style.display = 'none';
    }
  }

  // Timer display
  const color = getTimerColor(activeTimer);
  const display = getTimerDisplayValue(activeTimer);

  $timer.textContent = display;
  $timer.className = `viewer-timer ${color}`;

  // Progress bar (countdown only)
  if (activeTimer.mode === 'countdown' && activeTimer.duration > 0) {
    const progress = Math.min(1, activeTimer.elapsed / activeTimer.duration);
    const remaining = 1 - progress;
    $progress.style.width = `${remaining * 100}%`;
    $progress.className = `viewer-progress-bar ${color === 'finished' ? 'danger' : color}`;
  } else {
    $progress.style.width = '0%';
  }

  // Flash overlay for finished
  if (activeTimer.state === 'finished') {
    $flashOverlay.classList.add('active');
  } else {
    $flashOverlay.classList.remove('active');
  }

  // For clock mode, keep updating every second
  if (activeTimer.mode === 'clock') {
    if (!clockInterval) {
      clockInterval = setInterval(render, 1000);
    }
  } else {
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  }
}

// ─── Fullscreen on Double Click ────────────────────────────────────

document.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// ─── Keyboard Shortcuts ────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'f':
    case 'F':
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
      break;
    case 'Escape':
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      break;
  }
});
