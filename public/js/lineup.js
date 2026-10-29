/**
 * Modo Lista (Lineup & Horários Presentation Mode)
 */

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

// ─── DOM References ────────────────────────────────────────────────

const $screen = document.getElementById('lineup-screen');
const $roomBadge = document.getElementById('lineup-room-badge');
const $lineupStageBadge = document.getElementById('lineup-stage-badge');
const $lineupEventSelect = document.getElementById('lineup-event-select');
const $localClock = document.getElementById('lineup-local-clock');

const $nowBadge = document.getElementById('lineup-now-badge');
const $nowName = document.getElementById('lineup-now-name');
const $nowSlot = document.getElementById('lineup-now-slot');
const $nowTimer = document.getElementById('lineup-now-timer');
const $nowNotes = document.getElementById('lineup-now-notes');
const $list = document.getElementById('lineup-list');

if ($roomBadge) $roomBadge.textContent = roomId;

function renderLineupEventSelector() {
  const currentCode = (state?.id || roomId).toUpperCase();
  const list = typeof client.getEventsList === 'function' ? client.getEventsList() : [];
  if ($lineupStageBadge) {
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
    $lineupStageBadge.textContent = name;
  }

  const isMaster = typeof window.isStageTimerMaster === 'function' ? window.isStageTimerMaster() : (
    sessionStorage.getItem('stagetimer_master_active') === '1' ||
    localStorage.getItem('stagetimer_master_active') === '1' ||
    sessionStorage.getItem('stagetimer_master_auth_v12') === 'true' ||
    localStorage.getItem('stagetimer_master_auth_v12') === 'true'
  );

  if ($lineupEventSelect) {
    if (isMaster && list.length > 0) {
      $lineupEventSelect.style.display = 'inline-block';
      if ($lineupStageBadge) $lineupStageBadge.style.display = 'none';

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

      $lineupEventSelect.innerHTML = optionsHtml;
    } else {
      $lineupEventSelect.style.display = 'none';
      if ($lineupStageBadge) $lineupStageBadge.style.display = 'inline-block';
    }
  }
}

if ($lineupEventSelect) {
  $lineupEventSelect.addEventListener('change', () => {
    const chosen = $lineupEventSelect.value;
    if (chosen) {
      try {
        localStorage.setItem('stagetimer_device_room', chosen.toUpperCase());
        localStorage.setItem('stagetimer_last_room', chosen.toUpperCase());
      } catch (e) {}
      location.search = `?room=${encodeURIComponent(chosen)}`;
    }
  });
}

client.on('events-list-update', (list) => {
  renderLineupEventSelector();
});

// Update navigation links with current room
const q = `?room=${encodeURIComponent(roomId)}`;
['hub', 'viewer', 'lineup'].forEach(key => {
  const el = document.getElementById(`ln-nav-${key}`);
  if (el) {
    el.href = `${key === 'hub' ? 'index' : key}.html${q}`;
  }
});

function updateClock() {
  if ($localClock) {
    $localClock.textContent = StageTimerClient.getTrueTimeString();
  }
}
updateClock();
setInterval(updateClock, 1000);

// ─── Helpers ───────────────────────────────────────────────────────

function formatTime(ms) {
  return StageTimerClient.formatTime(ms);
}

function getTimerElapsed(timer) {
  return StageTimerClient.getTimerElapsed(timer);
}

function getTimerColor(timer) {
  if (!timer) return 'safe';
  if (timer.state === 'finished') return 'finished';
  const elapsed = getTimerElapsed(timer);
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    if (remaining <= 0) return 'finished';
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
  if (!timer) return '--:--';
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

// Compute automatic estimated times if startTime isn't explicitly set
function computeScheduleSlots(timers, activeIdx) {
  const rollingMs = StageTimerClient.globalTrueTime();
  return timers.map((t, i) => {
    if (t.startTime && t.startTime.trim()) {
      return t.startTime.trim();
    }
    if (i < activeIdx) {
      return 'Concluído';
    }
    if (i === activeIdx) {
      return 'Agora';
    }
    // Accumulate previous durations from active timer
    let offsetMs = 0;
    for (let j = activeIdx >= 0 ? activeIdx : 0; j < i; j++) {
      const prev = timers[j];
      if (!prev) continue;
      let rem = prev.duration;
      if (j === activeIdx && prev.mode === 'countdown') {
        const el = getTimerElapsed(prev);
        rem = Math.max(0, prev.duration - el);
      }
      offsetMs += rem;
    }
    const est = new Date(rollingMs + offsetMs);
    return est.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
  });
}

function getEventEndTime(st) {
  return StageTimerClient.computeEventEndTime(st);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ─── Auto-Scroll Centering ─────────────────────────────────────────

let lastLineupSig = '';
let lastCenteredActiveId = null;
let lastUserScrollAt = 0;

const $mainScroll = document.querySelector('.lineup-main-scroll');
if ($mainScroll) {
  $mainScroll.addEventListener('wheel', () => { lastUserScrollAt = Date.now(); }, { passive: true });
  $mainScroll.addEventListener('touchmove', () => { lastUserScrollAt = Date.now(); }, { passive: true });
}
window.addEventListener('wheel', () => { lastUserScrollAt = Date.now(); }, { passive: true });
window.addEventListener('touchmove', () => { lastUserScrollAt = Date.now(); }, { passive: true });

function centerActiveArtist(smooth = true) {
  const activeRow = $list?.querySelector('.lineup-row.is-active');
  if (!activeRow) return;

  const container = document.querySelector('.lineup-main-scroll');
  if (container && window.innerWidth > 860 && container.scrollHeight > container.clientHeight) {
    const targetTop = activeRow.offsetTop - (container.clientHeight / 2) + (activeRow.clientHeight / 2);
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: smooth ? 'smooth' : 'auto'
    });
  } else {
    activeRow.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'center'
    });
  }
}

// Re-center every 7 seconds if idle so stage/backstage screens stay centered
setInterval(() => {
  if (Date.now() - lastUserScrollAt > 6000) {
    centerActiveArtist(true);
  }
}, 7000);

// ─── Render ────────────────────────────────────────────────────────

function render() {
  if (!state) return;

  if (state.theme?.viewerBg && state.theme.viewerBg !== '#000000') {
    $screen.style.backgroundColor = state.theme.viewerBg;
    document.body.style.backgroundColor = state.theme.viewerBg;
  }

  const $dayTabs = document.getElementById('lineup-day-tabs');
  if ($dayTabs && state.days) {
    const dayKeys = Object.keys(state.days).map(Number).sort((a, b) => a - b);
    if (dayKeys.length > 1) {
      $dayTabs.innerHTML = dayKeys.map(d => {
        const isAct = d === (state.currentDay || 1);
        return `<button type="button" class="btn btn-sm ${isAct ? 'btn-primary' : ''}" data-lineup-day="${d}" style="padding: 2px 7px; font-size: 0.7rem; font-weight: 700; border-radius: 6px;">Dia ${d}</button>`;
      }).join('');
    } else {
      $dayTabs.innerHTML = '';
    }
  }

  if ($roomBadge) {
    const daySuffix = (state.currentDay && state.days && Object.keys(state.days).length > 1) ? ` • Dia ${state.currentDay}` : '';
    $roomBadge.textContent = `${state.name || roomId}${daySuffix}`;
  }

  const $eventEnd = document.getElementById('lineup-event-end');
  if ($eventEnd) {
    $eventEnd.textContent = getEventEndTime(state);
  }

  const activeIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
  const activeTimer = activeIdx >= 0 ? state.timers[activeIdx] : null;
  const slots = computeScheduleSlots(state.timers, activeIdx);

  // Left card: Active Artist
  if (!activeTimer) {
    $nowBadge.textContent = 'AGUARDANDO INÍCIO';
    $nowName.textContent = 'Sem artista ativo';
    $nowSlot.textContent = '';
    $nowTimer.textContent = '--:--';
    $nowTimer.className = 'lineup-now-timer';
    $nowNotes.style.display = 'none';
  } else {
    const color = getTimerColor(activeTimer);
    const displayVal = getTimerDisplayValue(activeTimer);
    const isLong = displayVal.length > 5;
    $nowBadge.textContent = activeTimer.state === 'running' ? '● EM PALCO AGORA' : '● PREPARADO EM PALCO';
    $nowName.textContent = activeTimer.name;
    $nowSlot.textContent = activeTimer.startTime ? `Horário: ${activeTimer.startTime}` : `Duração: ${formatTime(activeTimer.duration)}`;
    $nowTimer.textContent = displayVal;
    $nowTimer.className = `lineup-now-timer ${color}${isLong ? ' is-long' : ''}`;

    if (activeTimer.notes && activeTimer.notes.trim()) {
      $nowNotes.textContent = activeTimer.notes.trim();
      $nowNotes.style.display = 'block';
    } else {
      $nowNotes.style.display = 'none';
    }
  }

  // Right table: All Artists (only rebuild DOM when lineup/slots/state changes)
  const sig = state.timers.map((t, idx) => `${t.id}:${t.name}:${slots[idx]}:${t.duration}:${t.notes || ''}:${t.state}:${idx === activeIdx}`).join('|');
  if (sig !== lastLineupSig) {
    const isFirstRender = !lastLineupSig;
    lastLineupSig = sig;

    $list.innerHTML = state.timers.map((t, idx) => {
      const isActive = idx === activeIdx;
      const isNext = activeIdx >= 0 && idx === activeIdx + 1;
      const isDone = (activeIdx >= 0 && idx < activeIdx) || t.state === 'finished';

      let rowClass = 'lineup-row';
      let statusClass = 'status-upcoming';
      let statusText = 'AGUARDA';

      if (isActive) {
        rowClass += ' is-active';
        statusClass = 'status-live';
        statusText = t.state === 'running' ? '● EM PALCO' : '● NO AR';
      } else if (isNext) {
        rowClass += ' is-next';
        statusClass = 'status-next';
        statusText = '⏭ NEXT';
      } else if (isDone) {
        rowClass += ' is-done';
        statusClass = 'status-done';
        statusText = '✓ FIM';
      }

      const timeDisplay = slots[idx] || '--:--';
      let timeIn = timeDisplay;
      let timeOut = '';

      const rangeMatch = String(timeDisplay).match(/(\d{1,2}\s*[:hH]\s*\d{2})\s*[-–—a]\s*(\d{1,2}\s*[:hH]\s*\d{2})/);
      if (rangeMatch) {
        timeIn = rangeMatch[1].replace(/[hH]/, ':').replace(/\s+/g, '');
        timeOut = rangeMatch[2].replace(/[hH]/, ':').replace(/\s+/g, '');
      } else {
        const singleMatch = String(timeDisplay).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
        if (singleMatch) {
          const sMins = parseInt(singleMatch[1], 10) * 60 + parseInt(singleMatch[2], 10);
          const eMins = (sMins + Math.round((t.duration || 0) / 60000)) % 1440;
          timeIn = `${String(Math.floor(sMins / 60)).padStart(2, '0')}:${String(sMins % 60).padStart(2, '0')}`;
          timeOut = `${String(Math.floor(eMins / 60)).padStart(2, '0')}:${String(eMins % 60).padStart(2, '0')}`;
        }
      }

      return `
        <div class="${rowClass}" data-timer-id="${t.id}">
          <div class="lineup-col-time">
            <span class="lineup-time-in">${escapeHtml(timeIn)}</span>
            ${timeOut ? `<span class="lineup-time-out">${escapeHtml(timeOut)}</span>` : ''}
          </div>
          <div class="lineup-col-artist">
            <span class="lineup-artist-name">${escapeHtml(t.name)}</span>
            ${t.notes ? `<span class="lineup-artist-notes">${escapeHtml(t.notes)}</span>` : ''}
          </div>
          <div class="lineup-col-duration">${formatTime(t.duration)}</div>
          <div class="lineup-col-status">
            <span class="lineup-status-pill ${statusClass}">${statusText}</span>
          </div>
        </div>
      `;
    }).join('');

    if (state.activeTimerId !== lastCenteredActiveId || isFirstRender) {
      lastCenteredActiveId = state.activeTimerId;
      setTimeout(() => centerActiveArtist(!isFirstRender), 60);
    }
  }
}

client.on('room-state', (data) => {
  state = data;
  renderLineupEventSelector();
  render();
});

setInterval(() => {
  if (state?.timers) {
    const active = state.timers.find(t => t.id === state.activeTimerId);
    if (active && active.mode === 'clock') {
      const $nowTimer = document.getElementById('lineup-now-timer');
      if ($nowTimer) {
        $nowTimer.textContent = getTimerDisplayValue(active);
      }
    }
  }
}, 1000);

client.on('connected', () => {
  renderLineupEventSelector();
});

renderLineupEventSelector();
client.connect();

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
  if (e.target.closest('a, button, select, input, .lineup-day-tab')) return;
  if (!isFullscreen() && !autoFsTriggered) {
    autoFsTriggered = true;
    enterFullscreen();
  }
}, { capture: true });

// Double click shortcut
document.addEventListener('dblclick', (e) => {
  if (e.target.closest('a, button, select, input')) return;
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
