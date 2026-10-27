/**
 * Modo Lista (Lineup & Horários Presentation Mode)
 */

const params = new URLSearchParams(location.search);
const roomId = (params.get('room') || 'PALCO1').toUpperCase();

const client = new StageTimerClient({
  role: 'viewer',
  room: roomId,
});

let state = null;

// ─── DOM References ────────────────────────────────────────────────

const $screen = document.getElementById('lineup-screen');
const $roomBadge = document.getElementById('lineup-room-badge');
const $localClock = document.getElementById('lineup-local-clock');

const $nowBadge = document.getElementById('lineup-now-badge');
const $nowName = document.getElementById('lineup-now-name');
const $nowSlot = document.getElementById('lineup-now-slot');
const $nowTimer = document.getElementById('lineup-now-timer');
const $nowNotes = document.getElementById('lineup-now-notes');
const $list = document.getElementById('lineup-list');

if ($roomBadge) $roomBadge.textContent = roomId;

function updateClock() {
  if ($localClock) {
    $localClock.textContent = new Date().toLocaleTimeString('pt-PT', { hour12: false });
  }
}
updateClock();
setInterval(updateClock, 1000);

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
  if (!timer) return 'safe';
  if (timer.state === 'finished') return 'finished';
  let elapsed = timer.elapsed;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    if (remaining <= timer.dangerAt) return 'danger';
    if (remaining <= timer.warnAt) return 'warn';
    return 'safe';
  }
  return 'safe';
}

function getTimerDisplayValue(timer) {
  if (!timer) return '--:--';
  if (timer.mode === 'clock') {
    return new Date().toLocaleTimeString('pt-PT', { hour12: false });
  }
  let elapsed = timer.elapsed;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  if (timer.mode === 'countdown') {
    const remaining = Math.max(0, timer.duration - elapsed);
    return formatTime(remaining);
  }
  return formatTime(elapsed);
}

// Compute automatic estimated times if startTime isn't explicitly set
function computeScheduleSlots(timers, activeIdx) {
  let rollingDate = new Date();
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
        let el = prev.elapsed + (prev.state === 'running' && prev.startedAt ? Date.now() - prev.startedAt : 0);
        rem = Math.max(0, prev.duration - el);
      }
      offsetMs += rem;
    }
    const est = new Date(rollingDate.getTime() + offsetMs);
    return est.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ─── Render ────────────────────────────────────────────────────────

function render() {
  if (!state) return;

  if (state.theme?.viewerBg && state.theme.viewerBg !== '#000000') {
    $screen.style.backgroundColor = state.theme.viewerBg;
    document.body.style.backgroundColor = state.theme.viewerBg;
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
    $nowBadge.textContent = activeTimer.state === 'running' ? '● EM PALCO AGORA' : '● PREPARADO EM PALCO';
    $nowName.textContent = activeTimer.name;
    $nowSlot.textContent = activeTimer.startTime ? `Horário: ${activeTimer.startTime}` : `Duração: ${formatTime(activeTimer.duration)}`;
    $nowTimer.textContent = getTimerDisplayValue(activeTimer);
    $nowTimer.className = `lineup-now-timer ${color}`;

    if (activeTimer.notes && activeTimer.notes.trim()) {
      $nowNotes.textContent = activeTimer.notes.trim();
      $nowNotes.style.display = 'block';
    } else {
      $nowNotes.style.display = 'none';
    }
  }

  // Right table: All Artists
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

    return `
      <div class="${rowClass}">
        <div class="lineup-col-time">🕒 ${escapeHtml(timeDisplay)}</div>
        <div class="lineup-col-artist">
          <span class="lineup-artist-name">${escapeHtml(t.name)}</span>
          ${t.notes ? `<span class="lineup-artist-notes">📝 ${escapeHtml(t.notes)}</span>` : ''}
        </div>
        <div class="lineup-col-duration">⏱ ${formatTime(t.duration)}</div>
        <div class="lineup-col-status">
          <span class="lineup-status-pill ${statusClass}">${statusText}</span>
        </div>
      </div>
    `;
  }).join('');
}

client.on('room-state', (data) => {
  state = data;
  render();
});

client.connect();

document.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
});
