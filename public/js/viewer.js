/**
 * Viewer — fullscreen timer display for the stage.
 */

// ─── Init ──────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const paramRoom = (params.get('room') || '').trim();
const savedDeviceRoom = (localStorage.getItem('stagetimer_device_room') || '').trim();
const savedLastRoom = (localStorage.getItem('stagetimer_last_room') || '').trim();

let roomId = (paramRoom || savedDeviceRoom || savedLastRoom || 'PALCO1').toUpperCase();

try {
  localStorage.setItem('stagetimer_device_room', roomId);
  localStorage.setItem('stagetimer_last_room', roomId);
} catch (e) {}

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
const $viewerStageBadge = document.getElementById('viewer-stage-badge');
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
  const currentCode = (state?.id || roomId).toUpperCase();
  const list = typeof client.getEventsList === 'function' ? client.getEventsList() : [];
  if ($viewerStageBadge) {
    let name = currentCode;
    for (const ev of list) {
      if (ev.code === currentCode) {
        name = ev.title || ev.code;
        break;
      }
      if (Array.isArray(ev.stages)) {
        const st = ev.stages.find(s => s.code === currentCode);
        if (st) {
          name = `${ev.title || ev.code} • ${st.name || st.code}`;
          break;
        }
      }
    }
    $viewerStageBadge.textContent = name;
  }

  const isMaster = typeof window.isStageTimerMaster === 'function' ? window.isStageTimerMaster() : (
    sessionStorage.getItem('stagetimer_master_active') === '1' ||
    localStorage.getItem('stagetimer_master_active') === '1' ||
    sessionStorage.getItem('stagetimer_master_auth_v12') === 'true' ||
    localStorage.getItem('stagetimer_master_auth_v12') === 'true'
  );

  if ($viewerEventSelect) {
    if (isMaster && list.length > 0) {
      $viewerEventSelect.style.display = 'inline-block';
      if ($viewerStageBadge) $viewerStageBadge.style.display = 'none';

      let optionsHtml = '';
      list.forEach(ev => {
        const evTitle = ev.title || ev.code;
        const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code, name: 'Palco Principal' }];
        if (stages.length > 1) {
          optionsHtml += `<optgroup label="🎪 ${escapeHtml(evTitle)} (${stages.length} Palcos)">`;
          stages.forEach(st => {
            const isSel = st.code === currentCode;
            optionsHtml += `<option value="${escapeHtml(st.code)}" ${isSel ? 'selected' : ''}>👑 ${escapeHtml(evTitle)} • ${escapeHtml(st.name || st.code)}</option>`;
          });
          optionsHtml += `</optgroup>`;
        } else {
          const stCode = stages[0].code || ev.code;
          const isSel = stCode === currentCode;
          optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>👑 ${escapeHtml(evTitle)}</option>`;
        }
      });

      $viewerEventSelect.innerHTML = optionsHtml;
    } else {
      $viewerEventSelect.style.display = 'none';
      if ($viewerStageBadge) $viewerStageBadge.style.display = 'inline-block';
    }
  }

  if ($viewerLineupBtn) {
    $viewerLineupBtn.href = `lineup.html?room=${encodeURIComponent(currentCode)}`;
  }
}

if ($viewerEventSelect) {
  $viewerEventSelect.addEventListener('change', () => {
    const chosen = $viewerEventSelect.value;
    if (chosen) {
      try {
        localStorage.setItem('stagetimer_device_room', chosen.toUpperCase());
        localStorage.setItem('stagetimer_last_room', chosen.toUpperCase());
      } catch (e) {}
      location.search = `?room=${encodeURIComponent(chosen)}`;
    }
  });
}

const $viewerMenuBtn = document.querySelector('a[href^="index.html"]');
if ($viewerMenuBtn) {
  $viewerMenuBtn.href = `index.html?room=${encodeURIComponent(roomId)}`;
}

client.on('events-list-update', (list) => {
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
    $viewerClockTime.textContent = StageTimerClient.getTrueTimeString();
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
  return StageTimerClient.formatTime(ms);
}

function getTimerElapsed(timer) {
  return StageTimerClient.getTimerElapsed(timer);
}

function getTimerColor(timer) {
  if (timer.mode === 'clock') return 'clock';
  if (timer.state === 'finished') return 'finished';
  if (timer.mode === 'countdown') {
    const elapsed = getTimerElapsed(timer);
    const remaining = timer.duration - elapsed;
    if (remaining <= 0) return 'danger';
    if (timer.duration > 0) {
      const pct = (elapsed / timer.duration) * 100;
      if (pct > 95) return 'danger';
      if (pct > 80) return 'warn';
      return 'safe';
    }
    if (remaining <= timer.dangerAt) return 'danger';
    if (remaining <= timer.warnAt) return 'warn';
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
  const isLong = (display || '').length > 5;

  $timer.textContent = display;
  $timer.className = `viewer-timer ${color}${isLong ? ' is-long' : ''}`;

  // Progress bar (countdown only - cresce da esquerda para a direita de 0% a 100%)
  if (activeTimer.mode === 'countdown' && activeTimer.duration > 0) {
    const elapsed = getTimerElapsed(activeTimer);
    const pct = Math.min(100, Math.max(0, (elapsed / activeTimer.duration) * 100));
    $progress.style.width = `${pct.toFixed(2)}%`;

    // 0 aos 80% é verde, 81% aos 95% é laranja, > 95% é vermelho
    let phase = 'safe';
    if (pct > 95 || activeTimer.state === 'finished' || elapsed >= activeTimer.duration) {
      phase = 'danger';
    } else if (pct > 80) {
      phase = 'warn';
    }
    $progress.className = `viewer-progress-bar ${phase}`;
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

// ─── Automatic Fullscreen System ───────────────────────────────────

function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function enterFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen ||
             el.webkitRequestFullscreen ||
             el.mozRequestFullScreen ||
             el.msRequestFullscreen;
  if (fn) {
    try {
      const p = fn.call(el);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }
}

function exitFullscreen() {
  const fn = document.exitFullscreen ||
             document.webkitExitFullscreen ||
             document.mozCancelFullScreen ||
             document.msExitFullscreen;
  if (fn) {
    try {
      const p = fn.call(document);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }
}

function toggleFullscreen() {
  if (isFullscreen()) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
}

// Auto-enter fullscreen attempt on load
try {
  enterFullscreen();
} catch (e) {}

// Auto-fullscreen on first user tap / interaction anywhere
let autoFsTriggered = false;
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, button, select, input, #viewer-top-bar')) return;
  if (!isFullscreen() && !autoFsTriggered) {
    autoFsTriggered = true;
    enterFullscreen();
  }
}, { capture: true });

// Click anywhere on viewer background toggles fullscreen
document.addEventListener('click', (e) => {
  if (e.target.closest('a, button, select, input, #viewer-top-bar')) return;
  toggleFullscreen();
});

// Double click as secondary shortcut
document.addEventListener('dblclick', () => {
  toggleFullscreen();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case 'Escape':
      if (isFullscreen()) {
        exitFullscreen();
      }
      break;
  }
});
