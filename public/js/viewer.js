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
const $viewerTopBar = document.getElementById('viewer-top-bar');
const $viewerEventSelect = document.getElementById('viewer-event-select');
const $viewerLineupBtn = document.getElementById('viewer-lineup-btn');
const $viewerNotes = document.getElementById('viewer-notes');
const $viewerNext = document.getElementById('viewer-next');
const $viewerNextName = document.getElementById('viewer-next-name');
const $viewerClockTime = document.getElementById('viewer-clock-time');

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function renderViewerEventSelector() {
  if (!$viewerEventSelect) return;
  const list = client.getEventsList();
  const currentCode = (state?.id || roomId).toUpperCase();
  $viewerEventSelect.innerHTML = list.map(ev => `
    <option value="${escapeHtml(ev.code)}" ${ev.code === currentCode ? 'selected' : ''}>
      ${escapeHtml(ev.title || ev.code)} (${escapeHtml(ev.code)})
    </option>
  `).join('');
  if ($viewerLineupBtn) {
    $viewerLineupBtn.href = `lineup.html?room=${encodeURIComponent(currentCode)}`;
  }
}

if ($viewerEventSelect) {
  $viewerEventSelect.addEventListener('change', () => {
    const chosen = $viewerEventSelect.value;
    if (chosen) {
      location.search = `?room=${encodeURIComponent(chosen)}`;
    }
  });
}

client.on('events-list-update', () => {
  renderViewerEventSelector();
});

// Auto-dim top bar after 5s of mouse idle when a timer is running
let mouseIdleTimer = null;
function showTopBar() {
  if ($viewerTopBar) $viewerTopBar.style.opacity = '1';
  clearTimeout(mouseIdleTimer);
  mouseIdleTimer = setTimeout(() => {
    if ($viewerTopBar && state?.timers?.some(t => t.state === 'running')) {
      $viewerTopBar.style.opacity = '0.2';
    }
  }, 5000);
}
document.addEventListener('mousemove', showTopBar);
document.addEventListener('touchstart', showTopBar, { passive: true });

function updateLocalClock() {
  if ($viewerClockTime) {
    $viewerClockTime.textContent = new Date().toLocaleTimeString('pt-PT', { hour12: false });
  }
}
updateLocalClock();
setInterval(updateLocalClock, 1000);

// ─── Connect ───────────────────────────────────────────────────────

client.on('connected', () => {
  $connection.className = 'viewer-connection';
  renderViewerEventSelector();
});

client.on('disconnected', () => {
  $connection.className = 'viewer-connection disconnected';
});

client.on('room-state', (data) => {
  state = data;
  renderViewerEventSelector();
  render();
});

renderViewerEventSelector();
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

function getTimerElapsed(timer) {
  let elapsed = timer.elapsed || 0;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  return elapsed;
}

function getTimerColor(timer) {
  if (timer.mode === 'clock') return 'clock';
  if (timer.state === 'finished') return 'finished';
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - getTimerElapsed(timer);
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
  const elapsed = getTimerElapsed(timer);
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
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

  // Message (Full-screen Info or Urgent while keeping clock visible at top)
  const $viewerRoot = document.querySelector('.viewer');
  if (state.message.visible && state.message.text) {
    const level = state.message.level === 'urgent' ? 'urgent' : 'info';
    $message.textContent = state.message.text;
    $message.className = `viewer-message level-${level} visible`;
    if ($viewerRoot) $viewerRoot.classList.add('has-message');
  } else {
    $message.className = 'viewer-message';
    if ($viewerRoot) $viewerRoot.classList.remove('has-message');
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

  // Progress bar (countdown only - smooth linear animation)
  if (activeTimer.mode === 'countdown' && activeTimer.duration > 0) {
    const elapsed = getTimerElapsed(activeTimer);
    const progress = Math.min(1, Math.max(0, elapsed / activeTimer.duration));
    const remaining = 1 - progress;
    $progress.style.width = `${(remaining * 100).toFixed(2)}%`;
    $progress.className = `viewer-progress-bar ${color === 'finished' ? 'danger' : color}`;
  } else {
    $progress.style.width = '0%';
  }

  // Flash overlay for overtime / finished
  const isOvertime = activeTimer.mode === 'countdown' && getTimerElapsed(activeTimer) >= activeTimer.duration;
  if (activeTimer.state === 'finished' || isOvertime) {
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
