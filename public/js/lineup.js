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
  const rawList = typeof client.getEventsList === 'function' ? client.getEventsList() : [];
  const list = rawList.filter(e => e.eventType !== 'theatre');
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

  // Quick Stage Pills for Lineup (Show stages of current event)
  if ($lineupStagePills) {
    const allStages = [];
    const pillEvents = currentEvent ? [currentEvent] : list;
    pillEvents.forEach(ev => {
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
          const label = pillEvents.length > 1 && allStages.some(o => o.name === st.name && o.code !== st.code)
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
    { id: 'ln-nav-controller', page: 'controller.html' },
    { id: 'ln-nav-operator', page: 'operator.html' },
    { id: 'ln-nav-viewer', page: 'viewer.html' },
    { id: 'ln-nav-lineup', page: 'lineup.html' },
    { id: 'ln-nav-regies', page: 'regies.html' },
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
    $masterPill.style.display = isMaster ? 'flex' : 'none';
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

// Compute automatic cascaded estimated times
function computeScheduleSlots(timers, activeIdx) {
  if (!state) return [];
  if (typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.computeCascadeSchedule === 'function') {
    const cascade = StageTimerClient.computeCascadeSchedule(state);
    if (cascade && Array.isArray(cascade.slots) && cascade.slots.length > 0) {
      return timers.map(t => {
        const slot = cascade.slots.find(s => s.id === t.id);
        if (slot) return slot.slotRange;
        return t.startTime ? t.startTime.trim() : '--:--';
      });
    }
  }

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
    const activeCascade = typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.computeCascadeSchedule === 'function' ? StageTimerClient.computeCascadeSchedule(state) : null;
    const activeSlot = activeCascade?.slots?.find(s => s.id === activeTimer.id);
    $nowSlot.textContent = activeSlot ? `Horário Previsto: ${activeSlot.slotRange}` : (activeTimer.startTime ? `Horário: ${activeTimer.startTime}` : `Duração: ${formatTime(activeTimer.duration)}`);
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
  if (typeof syncLineupVideo === 'function') {
    syncLineupVideo();
  }
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

// ─── Stage Video System (Passive Receiver controlled by Master) ───

let currentMediaStream = null;
let currentHls = null;
let currentWebRtcPeer = null;
let isVideoMuted = true;
let isVideoCollapsed = false;
let lastVideoSig = '';

const $videoContainer = document.getElementById('lineup-video-container');
const $videoExpandBtn = document.getElementById('lineup-video-expand-btn');
const $videoElement = document.getElementById('lineup-video-element');
const $videoIframe = document.getElementById('lineup-video-iframe');
const $videoPlaceholder = document.getElementById('lineup-video-placeholder');
const $videoStatusText = document.getElementById('lineup-video-status-text');
const $videoBadge = document.getElementById('lineup-video-badge');
const $videoLabel = document.getElementById('lineup-video-label');
const $videoMuteBtn = document.getElementById('lineup-video-mute-btn');
const $videoPipBtn = document.getElementById('lineup-video-pip-btn');
const $videoFsBtn = document.getElementById('lineup-video-fs-btn');
const $videoCollapseBtn = document.getElementById('lineup-video-collapse-btn');

function showVideoPlaceholder(text = 'Aguardando sinal...') {
  if ($videoPlaceholder) {
    if ($videoStatusText) $videoStatusText.textContent = text;
    $videoPlaceholder.style.display = 'flex';
  }
  if ($videoBadge) {
    $videoBadge.className = 'video-badge offline';
    $videoBadge.textContent = '● SEM SINAL';
  }
}

function showVideoActive(label = 'Câmara Palco') {
  if ($videoPlaceholder) $videoPlaceholder.style.display = 'none';
  if ($videoBadge) {
    $videoBadge.className = 'video-badge live';
    $videoBadge.textContent = '● AO VIVO';
  }
  if ($videoLabel) {
    $videoLabel.textContent = label || 'Câmara Palco';
  }
}

function stopCurrentVideoStream() {
  if (currentMediaStream) {
    try { currentMediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    currentMediaStream = null;
  }
  if (currentHls) {
    try { currentHls.destroy(); } catch (_) {}
    currentHls = null;
  }
  if (currentWebRtcPeer) {
    try { currentWebRtcPeer.close(); } catch (_) {}
    currentWebRtcPeer = null;
  }
  if ($videoElement) {
    $videoElement.removeAttribute('src');
    $videoElement.srcObject = null;
  }
  if ($videoIframe) {
    $videoIframe.src = 'about:blank';
  }
}

function formatEmbedUrl(rawUrl) {
  if (!rawUrl) return '';
  const url = rawUrl.trim();
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1&playsinline=1`;
  }
  if (url.includes('vdo.ninja')) {
    let clean = url;
    if (!clean.includes('autoplay')) clean += (clean.includes('?') ? '&' : '?') + 'autoplay=1';
    if (!clean.includes('cleanoutput')) clean += '&cleanoutput=1';
    return clean;
  }
  return url;
}

// Connect to Master WebRTC Broadcaster
function connectWebRtcToMaster(cleanRoom) {
  if (!cleanRoom) return;
  if (currentWebRtcPeer) {
    try { currentWebRtcPeer.close(); } catch (_) {}
    currentWebRtcPeer = null;
  }

  showVideoPlaceholder('A ligar à emissão do Master...');

  const myUuid = client.deviceUuid || ('viewer_' + Math.random().toString(36).substr(2, 6));
  const signalTopic = `stagetimer_v10/${cleanRoom}/webrtc_signal`;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  currentWebRtcPeer = pc;

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      currentMediaStream = event.streams[0];
      if ($videoElement) {
        $videoElement.srcObject = event.streams[0];
        $videoElement.muted = isVideoMuted;
        $videoElement.play().catch(() => {});
      }
      showVideoActive('OBS Virtual Cam');
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && client.mqttClient && client.mqttClient.connected) {
      client.mqttClient.publish(signalTopic, JSON.stringify({
        type: 'candidate',
        candidate: event.candidate,
        viewerId: myUuid,
        from: myUuid
      }));
    }
  };

  setTimeout(() => {
    if (client.mqttClient && client.mqttClient.connected) {
      client.mqttClient.subscribe(signalTopic);
      client.mqttClient.publish(signalTopic, JSON.stringify({
        type: 'viewer-join',
        viewerId: myUuid,
        roomCode: cleanRoom
      }));
    }
  }, 200);

  setTimeout(async () => {
    if ((!$videoElement || !$videoElement.srcObject) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const obsDev = devs.find(d => d.kind === 'videoinput' && ((d.label || '').toLowerCase().includes('obs') || (d.label || '').toLowerCase().includes('virtual')));
        if (obsDev) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: obsDev.deviceId } }, audio: false });
          currentMediaStream = stream;
          if ($videoElement) {
            $videoElement.srcObject = stream;
            $videoElement.muted = isVideoMuted;
            await $videoElement.play();
          }
          showVideoActive('OBS Virtual Cam (Local)');
        }
      } catch (_) {}
    }
  }, 4000);
}

// Listen for WebRTC signals from Master
client.on('webrtc-signal', ({ topic, msg }) => {
  if (!currentWebRtcPeer || !msg) return;
  const myUuid = client.deviceUuid;
  if (msg.viewerId !== myUuid) return;

  if (msg.type === 'offer' && msg.offer) {
    currentWebRtcPeer.setRemoteDescription(new RTCSessionDescription(msg.offer))
      .then(() => currentWebRtcPeer.createAnswer())
      .then(answer => currentWebRtcPeer.setLocalDescription(answer))
      .then(() => {
        if (client.mqttClient && client.mqttClient.connected) {
          client.mqttClient.publish(topic, JSON.stringify({
            type: 'answer',
            answer: currentWebRtcPeer.localDescription,
            viewerId: myUuid,
            from: myUuid
          }));
        }
      })
      .catch(err => console.warn('Erro ao processar offer WebRTC no Lineup:', err));
  } else if (msg.type === 'candidate' && msg.candidate) {
    if (currentWebRtcPeer.remoteDescription) {
      currentWebRtcPeer.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
    }
  }
});

async function syncLineupVideo(force = false) {
  if (!$videoContainer) return;

  const cfg = state?.video || (typeof client.getVideoConfig === 'function' ? client.getVideoConfig() : null);
  const isEnabled = !!(cfg && cfg.enabled);
  const sourceType = cfg?.sourceType || 'virtual_cam';
  const url = (cfg?.url || '').trim();
  const label = (cfg?.label || 'Câmara Palco').trim();

  const sig = `${isEnabled}:${sourceType}:${url}:${label}`;
  if (!force && sig === lastVideoSig) return;
  lastVideoSig = sig;

  if (!isEnabled) {
    stopCurrentVideoStream();
    $videoContainer.style.display = 'none';
    if ($videoExpandBtn) $videoExpandBtn.style.display = 'none';
    return;
  }

  // Video is enabled by Master
  if (isVideoCollapsed) {
    $videoContainer.style.display = 'none';
    if ($videoExpandBtn) $videoExpandBtn.style.display = 'block';
  } else {
    $videoContainer.style.display = 'flex';
    if ($videoExpandBtn) $videoExpandBtn.style.display = 'none';
  }

  showVideoActive(label);

  if (sourceType === 'virtual_cam') {
    // ── Mode: OBS Virtual Camera via WebRTC or Local ──
    stopCurrentVideoStream();
    if ($videoIframe) $videoIframe.style.display = 'none';
    if ($videoElement) $videoElement.style.display = 'block';

    connectWebRtcToMaster(roomId || state?.id || 'PALCO1');
  } else {
    // ── Mode: Network Stream URL (YouTube / VDO.Ninja / HLS / MP4) ──
    stopCurrentVideoStream();

    if (!url) {
      showVideoPlaceholder('Aguardando sinal do Master...');
      return;
    }

    const isEmbed = url.includes('vdo.ninja') || url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com') || url.includes('/embed/');
    if (isEmbed) {
      if ($videoElement) $videoElement.style.display = 'none';
      if ($videoIframe) {
        $videoIframe.style.display = 'block';
        $videoIframe.src = formatEmbedUrl(url);
      }
      showVideoActive(label);
    } else {
      if ($videoIframe) $videoIframe.style.display = 'none';
      if ($videoElement) $videoElement.style.display = 'block';

      if (url.includes('.m3u8')) {
        if (window.Hls && Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          currentHls = hls;
          hls.loadSource(url);
          hls.attachMedia($videoElement);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            $videoElement.play().catch(() => {});
            showVideoActive(label);
          });
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              showVideoPlaceholder('A reconectar stream HLS...');
            }
          });
        } else if ($videoElement.canPlayType && $videoElement.canPlayType('application/vnd.apple.mpegurl')) {
          $videoElement.src = url;
          $videoElement.play().catch(() => {});
          showVideoActive(label);
        } else {
          $videoElement.src = url;
          $videoElement.play().catch(() => {});
          showVideoActive(label);
        }
      } else {
        $videoElement.src = url;
        $videoElement.play().catch(() => {});
        showVideoActive(label);
      }
    }
  }
}

// ── In-Player Controls (Viewer side) ──

if ($videoMuteBtn) {
  $videoMuteBtn.addEventListener('click', () => {
    isVideoMuted = !isVideoMuted;
    if ($videoElement) {
      $videoElement.muted = isVideoMuted;
    }
    $videoMuteBtn.textContent = isVideoMuted ? '🔇' : '🔊';
    $videoMuteBtn.title = isVideoMuted ? 'Ligar Áudio' : 'Desligar Áudio';
  });
}

if ($videoPipBtn) {
  if (!document.pictureInPictureEnabled) {
    $videoPipBtn.style.display = 'none';
  } else {
    $videoPipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if ($videoElement && $videoElement.requestPictureInPicture) {
          await $videoElement.requestPictureInPicture();
        }
      } catch (err) {
        console.warn('PiP error:', err);
      }
    });
  }
}

if ($videoFsBtn) {
  $videoFsBtn.addEventListener('click', () => {
    if ($videoElement) {
      const fn = $videoElement.requestFullscreen ||
                 $videoElement.webkitRequestFullscreen ||
                 $videoElement.mozRequestFullScreen ||
                 $videoElement.msRequestFullscreen;
      if (fn) {
        try { fn.call($videoElement); } catch (_) {}
      }
    }
  });
}

if ($videoCollapseBtn) {
  $videoCollapseBtn.addEventListener('click', () => {
    isVideoCollapsed = true;
    if ($videoContainer) $videoContainer.style.display = 'none';
    if ($videoExpandBtn) $videoExpandBtn.style.display = 'block';
  });
}

if ($videoExpandBtn) {
  $videoExpandBtn.addEventListener('click', () => {
    isVideoCollapsed = false;
    if ($videoContainer) $videoContainer.style.display = 'flex';
    if ($videoExpandBtn) $videoExpandBtn.style.display = 'none';
  });
}

// Initial video sync on startup
setTimeout(() => {
  syncLineupVideo();
}, 200);
