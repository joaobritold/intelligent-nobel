/**
 * Modo Lista (Lineup & Horários Presentation Mode)
 */

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

// ─── DOM References ────────────────────────────────────────────────

const $screen = document.getElementById('lineup-screen');
const $roomBadge = document.getElementById('lineup-room-badge');
const $lineupStageBadge = document.getElementById('lineup-stage-badge');
const $lineupEventSelect = document.getElementById('lineup-event-select');
const $lineupStagePills = document.getElementById('lineup-stage-pills');
const $localClock = document.getElementById('lineup-local-clock');

const $nowBadge = document.getElementById('lineup-now-badge');
const $nowName = document.getElementById('lineup-now-name');
const $nowSlot = document.getElementById('lineup-now-slot');
const $nowTimer = document.getElementById('lineup-now-timer');
const $nowNotes = document.getElementById('lineup-now-notes');
const $list = document.getElementById('lineup-list');

if ($roomBadge) $roomBadge.textContent = roomId;

let lastLineupStagePillsSig = '';
let lastLineupSelectSig = '';

function renderLineupEventSelector(force = false) {
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

  if ($lineupStageBadge) {
    let name = currentCode;
    if (currentEvent) {
      if (Array.isArray(currentEvent.stages) && currentEvent.stages.length > 1) {
        const st = currentEvent.stages.find(s => (s.code || s.id || '').toUpperCase() === currentCode);
        name = `${currentEvent.title || currentEvent.code} • ${st?.name || currentCode}`;
      } else {
        name = currentEvent.title || currentEvent.code;
      }
    }
    if ($lineupStageBadge.textContent !== name) {
      $lineupStageBadge.textContent = name;
    }
  }

  // Quick Stage Pills for Lineup (Show all stages if multiple exist)
  if ($lineupStagePills) {
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
      $lineupStagePills.style.display = 'flex';
      const pillsSig = allStages.map(s => `${s.code}:${s.name}:${s.isCurrent}`).join('|');
      if (force || pillsSig !== lastLineupStagePillsSig) {
        lastLineupStagePillsSig = pillsSig;
        $lineupStagePills.innerHTML = allStages.map(st => {
          const label = list.length > 1 && allStages.some(o => o.name === st.name && o.code !== st.code)
            ? `${st.eventTitle} • ${st.name}`
            : st.name;
          return `
            <button type="button" class="stage-pill ${st.isCurrent ? 'active' : ''}" data-switch-stage="${escapeHtml(st.code)}">
              🎪 ${escapeHtml(label)}
            </button>
          `;
        }).join('');
      }
    } else {
      $lineupStagePills.style.display = 'none';
      if (lastLineupStagePillsSig !== '') {
        $lineupStagePills.innerHTML = '';
        lastLineupStagePillsSig = '';
      }
    }
  }

  let totalStagesCount = 0;
  list.forEach(e => {
    totalStagesCount += (Array.isArray(e.stages) && e.stages.length > 0) ? e.stages.length : 1;
  });

  if ($lineupEventSelect) {
    if (list.length > 1 || totalStagesCount > 1) {
      $lineupEventSelect.style.display = 'inline-block';
      const selectSig = list.map(ev => `${ev.code}:${ev.title}:${(ev.stages || []).map(s => `${s.code}:${s.name}`).join(';')}`).join('||') + `::${currentCode}`;
      if (force || selectSig !== lastLineupSelectSig) {
        lastLineupSelectSig = selectSig;
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

        $lineupEventSelect.innerHTML = optionsHtml;
        $lineupEventSelect.value = currentCode;
      }
    } else {
      $lineupEventSelect.style.display = 'none';
      lastLineupSelectSig = '';
    }
  }
}

// Stage badge click focuses/opens select
if ($lineupStageBadge && $lineupEventSelect) {
  $lineupStageBadge.style.cursor = 'pointer';
  $lineupStageBadge.addEventListener('click', () => {
    if ($lineupEventSelect.style.display !== 'none') {
      $lineupEventSelect.focus();
      try { $lineupEventSelect.showPicker(); } catch (_) {}
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
      window.location.replace(`lineup.html?room=${encodeURIComponent(targetRoom)}`);
    }
  }
});

if ($lineupEventSelect) {
  $lineupEventSelect.addEventListener('change', () => {
    const chosen = $lineupEventSelect.value;
    if (chosen && chosen !== (state?.id || roomId)) {
      try {
        localStorage.setItem('stagetimer_device_room', chosen.toUpperCase());
        localStorage.setItem('stagetimer_last_room', chosen.toUpperCase());
        sessionStorage.setItem('stagetimer_active_room', chosen.toUpperCase());
      } catch (e) {}
      window.location.replace(`lineup.html?room=${encodeURIComponent(chosen)}`);
    }
  });
}

function updateLineupNavLinks(code) {
  const current = (code || roomId || 'PALCO1').toUpperCase();
  const q = `?room=${encodeURIComponent(current)}`;
  const keys = [
    { id: 'ln-nav-hub', page: 'index.html' },
    { id: 'ln-nav-viewer', page: 'viewer.html' },
    { id: 'ln-nav-lineup', page: 'lineup.html' },
    { id: 'ln-nav-master', page: 'master.html' }
  ];
  keys.forEach(k => {
    const el = document.getElementById(k.id);
    if (el) el.href = k.page === 'index.html' ? 'index.html' : `${k.page}${q}`;
  });
  const $masterPill = document.getElementById('ln-nav-master');
  if ($masterPill) {
    const isMaster = typeof window.isStageTimerMaster === 'function' ? window.isStageTimerMaster() : (
      sessionStorage.getItem('stagetimer_master_active') === '1' ||
      localStorage.getItem('stagetimer_master_active') === '1'
    );
    $masterPill.style.display = isMaster ? 'inline-flex' : 'none';
  }
}
updateLineupNavLinks(roomId);

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

  if ($roomBadge) {
    $roomBadge.textContent = state.name || roomId;
  }

  const $eventEnd = document.getElementById('lineup-event-end');
  if ($eventEnd) {
    $eventEnd.textContent = getEventEndTime(state);
  }

  const activeTimer = StageTimerClient.getActiveTimer(state);
  const activeIdx = state.timers.findIndex(t => t.id === (activeTimer?.id || state.activeTimerId));
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

client.on('events-list-update', (list) => {
  renderLineupEventSelector(true);
  updateLineupNavLinks(roomId);
});

client.on('room-state', (data) => {
  state = data;
  if (state?.id && state.id !== roomId) {
    roomId = state.id;
  }
  updateLineupNavLinks(roomId);
  renderLineupEventSelector();
  render();
});

setInterval(() => {
  if (state?.timers) {
    const $eventEnd = document.getElementById('lineup-event-end');
    if ($eventEnd) {
      $eventEnd.textContent = getEventEndTime(state);
    }
    const active = StageTimerClient.getActiveTimer(state);
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
