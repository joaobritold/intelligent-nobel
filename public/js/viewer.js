/**
 * Viewer — fullscreen timer display for the stage.
 */

// ─── Init ──────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const paramRoom = (params.get('room') || '').trim();
const savedActiveRoom = (sessionStorage.getItem('stagetimer_active_room') || '').trim();
const savedDeviceRoom = (localStorage.getItem('stagetimer_device_room') || '').trim();
const savedLastRoom = (localStorage.getItem('stagetimer_last_room') || '').trim();

let roomId = (paramRoom || savedActiveRoom || savedDeviceRoom || savedLastRoom || 'PALCO1').toUpperCase();

// Smart resolve: if roomId is parent event code with multiple stages, resolve to Stage 1
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
const $viewerStagePills = document.getElementById('viewer-stage-pills');
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
  let currentEvent = null;

  for (const ev of list) {
    if (ev.code === currentCode) {
      currentEvent = ev;
      break;
    }
    if (Array.isArray(ev.stages)) {
      const st = ev.stages.find(s => (s.code || s.id || '').toUpperCase() === currentCode);
      if (st) {
        currentEvent = ev;
        break;
      }
    }
  }

  if ($viewerStageBadge) {
    let name = currentCode;
    if (currentEvent) {
      if (Array.isArray(currentEvent.stages) && currentEvent.stages.length > 1) {
        const st = currentEvent.stages.find(s => (s.code || s.id || '').toUpperCase() === currentCode);
        name = `${currentEvent.title || currentEvent.code} • ${st?.name || currentCode}`;
      } else {
        name = currentEvent.title || currentEvent.code;
      }
    }
    $viewerStageBadge.textContent = name;
  }

  // Quick Stage Pills for Viewer (Show all stages if multiple exist)
  if ($viewerStagePills) {
    const allStages = [];
    list.forEach(ev => {
      const evTitle = ev.title || ev.code;
      const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code, name: evTitle }];
      stages.forEach(st => {
        const stCode = (st.code || st.id || '').toUpperCase();
        allStages.push({
          code: stCode,
          name: st.name || stCode,
          eventTitle: evTitle,
          isCurrent: stCode === currentCode
        });
      });
    });

    if (allStages.length > 1) {
      $viewerStagePills.style.display = 'flex';
      $viewerStagePills.innerHTML = allStages.map(st => {
        const isAct = st.isCurrent;
        const label = list.length > 1 && allStages.some(o => o.name === st.name && o.code !== st.code)
          ? `${st.eventTitle} • ${st.name}`
          : st.name;
        return `
          <button type="button" class="stage-pill ${isAct ? 'active' : ''}" data-switch-stage="${escapeHtml(st.code)}">
            🎪 ${escapeHtml(label)}
          </button>
        `;
      }).join('');
    } else {
      $viewerStagePills.style.display = 'none';
      $viewerStagePills.innerHTML = '';
    }
  }

  let totalStagesCount = 0;
  list.forEach(e => {
    totalStagesCount += (Array.isArray(e.stages) && e.stages.length > 0) ? e.stages.length : 1;
  });

  if ($viewerEventSelect) {
    if (list.length > 1 || totalStagesCount > 1) {
      $viewerEventSelect.style.display = 'inline-block';
      let optionsHtml = '';
      list.forEach(ev => {
        const evTitle = ev.title || ev.code;
        const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code, name: 'Palco Principal' }];
        if (stages.length > 1) {
          optionsHtml += `<optgroup label="🎪 ${escapeHtml(evTitle)} (${stages.length} Palcos)">`;
          stages.forEach(st => {
            const stCode = (st.code || st.id || '').toUpperCase();
            const isSel = stCode === currentCode;
            optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>🎪 ${escapeHtml(evTitle)} • ${escapeHtml(st.name || stCode)}</option>`;
          });
          optionsHtml += `</optgroup>`;
        } else {
          const stCode = (stages[0].code || ev.code).toUpperCase();
          const isSel = stCode === currentCode;
          optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>🎪 ${escapeHtml(evTitle)}</option>`;
        }
      });

      $viewerEventSelect.innerHTML = optionsHtml;
      $viewerEventSelect.value = currentCode;
    } else {
      $viewerEventSelect.style.display = 'none';
    }
  }

  if ($viewerLineupBtn) {
    $viewerLineupBtn.href = `lineup.html?room=${encodeURIComponent(currentCode)}`;
  }
}

// Stage badge click focuses/opens select
if ($viewerStageBadge && $viewerEventSelect) {
  $viewerStageBadge.style.cursor = 'pointer';
  $viewerStageBadge.addEventListener('click', () => {
    if ($viewerEventSelect.style.display !== 'none') {
      $viewerEventSelect.focus();
      try { $viewerEventSelect.showPicker(); } catch (_) {}
    }
  });
}

// Stage pills click delegation
document.addEventListener('click', (e) => {
  const pill = e.target.closest('[data-switch-stage]');
  if (pill) {
    const targetRoom = (pill.dataset.switchStage || '').toUpperCase().trim();
    if (targetRoom && targetRoom !== (state?.id || roomId).toUpperCase()) {
      try {
        localStorage.setItem('stagetimer_device_room', targetRoom);
        localStorage.setItem('stagetimer_last_room', targetRoom);
        sessionStorage.setItem('stagetimer_active_room', targetRoom);
      } catch (_) {}
      window.location.replace(`viewer.html?room=${encodeURIComponent(targetRoom)}`);
    }
  }
});

function updateViewerNavLinks(code) {
  const current = (code || roomId || 'PALCO1').toUpperCase();
  const q = `?room=${encodeURIComponent(current)}`;
  const $hub = document.getElementById('viewer-nav-hub');
  const $op = document.getElementById('viewer-nav-operator');
  const $ln = document.getElementById('viewer-lineup-btn');
  const $master = document.getElementById('viewer-nav-master');
  if ($hub) $hub.href = 'index.html';
  if ($op) $op.href = `operator.html${q}`;
  if ($ln) $ln.href = `lineup.html${q}`;
  if ($master) {
    $master.href = `master.html${q}`;
    const isMaster = typeof window.isStageTimerMaster === 'function' ? window.isStageTimerMaster() : (
      sessionStorage.getItem('stagetimer_master_active') === '1' ||
      localStorage.getItem('stagetimer_master_active') === '1'
    );
    $master.style.display = isMaster ? 'inline-block' : 'none';
  }
}
updateViewerNavLinks(roomId);

if ($viewerEventSelect) {
  $viewerEventSelect.addEventListener('change', () => {
    const chosen = $viewerEventSelect.value;
    if (chosen && chosen !== (state?.id || roomId)) {
      try {
        localStorage.setItem('stagetimer_device_room', chosen.toUpperCase());
        localStorage.setItem('stagetimer_last_room', chosen.toUpperCase());
        sessionStorage.setItem('stagetimer_active_room', chosen.toUpperCase());
      } catch (e) {}
      window.location.replace(`viewer.html?room=${encodeURIComponent(chosen)}`);
    }
  });
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
  if (state?.id && state.id !== roomId) {
    roomId = state.id;
  }
  updateViewerNavLinks(roomId);
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

  const activeTimer = StageTimerClient.getActiveTimer(state);

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

  // Next Artist Indicator (searches in the day list containing the active timer)
  if ($viewerNext && $viewerNextName) {
    let nextTimer = null;
    if (activeTimer) {
      let containingList = state.timers;
      if (!containingList.some(t => t.id === activeTimer.id) && state.days) {
        for (const dayList of Object.values(state.days)) {
          if (Array.isArray(dayList) && dayList.some(t => t.id === activeTimer.id)) {
            containingList = dayList;
            break;
          }
        }
      }
      const activeIdx = containingList.findIndex(t => t.id === activeTimer.id);
      nextTimer = activeIdx >= 0 ? containingList[activeIdx + 1] : null;
    }
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
