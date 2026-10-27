/**
 * Modo Operador (Mobile / Safari Optimized)
 */

const params = new URLSearchParams(location.search);
let roomId = (params.get('room') || 'PALCO1').toUpperCase();

const client = new StageTimerClient({
  role: 'controller',
  room: roomId,
});

let state = null;

// ─── DOM References ────────────────────────────────────────────────

const $roomInput = document.getElementById('op-room-input');
const $joinBtn = document.getElementById('op-join-btn');
const $connBadge = document.getElementById('op-conn-badge');
const $bgColor = document.getElementById('op-bg-color');

const $navController = document.getElementById('nav-controller');
const $navOperator = document.getElementById('nav-operator');
const $navViewer = document.getElementById('nav-viewer');

const $hero = document.getElementById('op-hero');
const $heroBadge = document.getElementById('op-hero-badge');
const $heroName = document.getElementById('op-hero-name');
const $heroTime = document.getElementById('op-hero-time');
const $heroBar = document.getElementById('op-hero-bar');

const $btnToggle = document.getElementById('op-btn-toggle');
const $btnReset = document.getElementById('op-btn-reset');
const $btnMinus1m = document.getElementById('op-btn-minus1m');
const $btnPlus1m = document.getElementById('op-btn-plus1m');
const $btnPlus5m = document.getElementById('op-btn-plus5m');

const $msgInput = document.getElementById('op-msg-input');
const $msgSend = document.getElementById('op-msg-send');
const $msgClear = document.getElementById('op-msg-clear');
const $msgStatus = document.getElementById('op-msg-status');
const $queueList = document.getElementById('op-queue-list');

const $artistName = document.getElementById('op-artist-name');
const $artistStartTime = document.getElementById('op-artist-starttime');
const $artistDuration = document.getElementById('op-artist-duration');
const $artistNotes = document.getElementById('op-artist-notes');
const $addArtistBtn = document.getElementById('op-add-artist-btn');
const $liveArtistBtn = document.getElementById('op-live-artist-btn');
const $heroNotes = document.getElementById('op-hero-notes');
const $heroNext = document.getElementById('op-hero-next');

// ─── Room & Links Setup ────────────────────────────────────────────

$roomInput.value = roomId;
updateNavLinks();

function updateNavLinks() {
  const code = encodeURIComponent(roomId);
  $navController.href = `controller.html?room=${code}`;
  $navOperator.href = `operator.html?room=${code}`;
  $navViewer.href = `viewer.html?room=${code}`;
  const $navLineup = document.getElementById('nav-lineup');
  if ($navLineup) $navLineup.href = `lineup.html?room=${code}`;
}

$joinBtn.addEventListener('click', () => {
  const code = $roomInput.value.trim().toUpperCase() || 'PALCO1';
  location.search = `?room=${encodeURIComponent(code)}`;
});

$roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    $roomInput.blur();
    $joinBtn.click();
  }
});

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
  str = (str || '').trim();
  const colonMatch = str.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      return (parseInt(colonMatch[1]) * 3600 + parseInt(colonMatch[2]) * 60 + parseInt(colonMatch[3])) * 1000;
    }
    return (parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])) * 1000;
  }
  if (/^\d+$/.test(str)) {
    return parseInt(str) * 60000; // Plain number in mobile operator = minutes
  }
  let total = 0;
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (hMatch) total += parseInt(hMatch[1]) * 3600000;
  if (mMatch) total += parseInt(mMatch[1]) * 60000;
  if (sMatch) total += parseInt(sMatch[1]) * 1000;
  return total || 1800000;
}

function getTimerColor(timer) {
  if (timer.mode === 'clock') return 'safe';
  if (timer.state === 'finished') return 'finished';
  let elapsed = timer.elapsed;
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
    return new Date().toLocaleTimeString('pt-PT', { hour12: false });
  }
  let elapsed = timer.elapsed;
  if (timer.state === 'running' && timer.startedAt) {
    elapsed += Date.now() - timer.startedAt;
  }
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    return formatTime(remaining);
  }
  return formatTime(elapsed);
}

// ─── Render ────────────────────────────────────────────────────────

let lastQueueSignature = '';

function render() {
  if (!state) return;

  if (state.theme?.viewerBg) {
    $bgColor.value = state.theme.viewerBg;
    $hero.style.backgroundColor = state.theme.viewerBg;
  }

  const active = state.timers.find(t => t.id === state.activeTimerId);

  if (!active) {
    $heroBadge.textContent = 'SEM TIMER';
    $heroName.textContent = 'Selecione um timer abaixo';
    $heroTime.textContent = '--:--';
    $heroTime.className = 'op-hero-time';
    $heroBar.style.width = '0%';
  } else {
    const isRunning = active.state === 'running';
    const isFinished = active.state === 'finished';
    const color = getTimerColor(active);

    $hero.className = `op-hero ${isRunning ? 'running' : ''}`;
    $heroBadge.textContent = isRunning ? '● NO AR (A CORRER)' : (isFinished ? '⚠️ TEMPO ESGOTADO' : 'EM ESPERA');
    $heroName.textContent = active.name;
    $heroTime.textContent = getTimerDisplayValue(active);
    $heroTime.className = `op-hero-time ${color}`;

    if ($heroNotes) {
      $heroNotes.textContent = active.notes ? `📝 ${active.notes}` : '';
    }

    if ($heroNext) {
      const idx = state.timers.findIndex(t => t.id === state.activeTimerId);
      const nextT = idx >= 0 ? state.timers[idx + 1] : null;
      $heroNext.textContent = nextT ? `NEXT: ${nextT.name}` : '';
    }

    if (active.mode === 'countdown' && active.duration > 0) {
      let elapsed = active.elapsed;
      if (isRunning && active.startedAt) elapsed += Date.now() - active.startedAt;
      const pct = Math.min(100, (elapsed / active.duration) * 100);
      $heroBar.style.width = `${pct}%`;
      $heroBar.className = `op-hero-progress-bar ${color}`;
    } else {
      $heroBar.style.width = '0%';
    }

    // Update giant Play/Pause button
    if (isRunning) {
      $btnToggle.innerHTML = '⏸ PAUSAR';
      $btnToggle.classList.add('is-running');
    } else {
      $btnToggle.innerHTML = '▶ INICIAR';
      $btnToggle.classList.remove('is-running');
    }
  }

  // Message status
  if (state.message?.visible && state.message?.text) {
    $msgStatus.textContent = `● Visível: "${state.message.text}"`;
  } else {
    $msgStatus.textContent = '';
  }

  // Render queue only when structure changes to keep touch targets stable
  const sig = state.timers.map(t => `${t.id}:${t.name}:${t.startTime || ''}:${t.notes || ''}:${t.duration}:${t.mode}:${t.id === state.activeTimerId}`).join('|');
  if (sig !== lastQueueSignature) {
    lastQueueSignature = sig;
    $queueList.innerHTML = state.timers.map(t => {
      const isAct = t.id === state.activeTimerId;
      return `
        <div class="op-queue-item ${isAct ? 'active' : ''}" data-id="${t.id}">
          <div class="op-queue-info" style="flex:1; margin-right: 8px;">
            <span class="op-queue-name">${t.startTime ? `<strong style="color:var(--accent)">[${escapeHtml(t.startTime)}]</strong> ` : ''}${escapeHtml(t.name)}</span>
            <span class="op-queue-meta">${t.mode.toUpperCase()} • ${formatTime(t.duration)}</span>
            <div style="display:flex; gap:6px; margin-top: 6px;" onclick="event.stopPropagation()">
              <input class="input" data-time-id="${t.id}" value="${escapeHtml(t.startTime || '')}" placeholder="🕒 21:00" style="padding: 4px 8px; font-size: 16px !important; width: 85px; text-align:center;">
              <input class="input op-item-notes" data-note-id="${t.id}" value="${escapeHtml(t.notes || '')}" placeholder="📝 Notas deste artista..." style="padding: 4px 8px; font-size: 16px !important; flex: 1;">
            </div>
          </div>
          <div class="op-queue-actions">
            <span class="op-queue-badge">${isAct ? '● NO AR' : 'ATIVAR'}</span>
            <button type="button" class="op-queue-del" data-del-id="${t.id}" title="Apagar">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Events ────────────────────────────────────────────────────────

client.on('room-state', (data) => {
  state = data;
  render();
});

client.on('p2p-peers-update', (data) => {
  $connBadge.innerHTML = `<span class="connection-dot"></span> Online (${data.count})`;
});

client.connect();

$btnToggle.addEventListener('click', () => {
  if (state?.activeTimerId) {
    client.timerAction(state.activeTimerId, 'toggle');
  }
});

$btnReset.addEventListener('click', () => {
  if (state?.activeTimerId) {
    client.timerAction(state.activeTimerId, 'reset');
  }
});

$btnMinus1m.addEventListener('click', () => {
  if (state?.activeTimerId) client.adjustTime(state.activeTimerId, -60000);
});

$btnPlus1m.addEventListener('click', () => {
  if (state?.activeTimerId) client.adjustTime(state.activeTimerId, 60000);
});

$btnPlus5m.addEventListener('click', () => {
  if (state?.activeTimerId) client.adjustTime(state.activeTimerId, 300000);
});

$bgColor.addEventListener('input', (e) => {
  client.updateTheme({ viewerBg: e.target.value });
});

$msgSend.addEventListener('click', () => {
  const txt = $msgInput.value.trim();
  if (txt) {
    client.sendMessage(txt, true);
    $msgInput.blur();
  }
});

$msgClear.addEventListener('click', () => {
  $msgInput.value = '';
  client.clearMessage();
});

document.querySelectorAll('.op-preset-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const msg = btn.dataset.msg;
    $msgInput.value = msg;
    client.sendMessage(msg, true);
  });
});

document.querySelectorAll('.op-dur-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.op-dur-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mins = parseInt(btn.dataset.min) || 30;
    $artistDuration.value = `${mins}:00`;
  });
});

function handleCreateArtist(goLive = false) {
  const name = ($artistName.value || '').trim() || `Artista ${(state?.timers?.length || 0) + 1}`;
  const startTime = ($artistStartTime?.value || '').trim();
  const notes = ($artistNotes?.value || '').trim();
  const duration = parseTimeInput($artistDuration.value);
  const created = client.createTimer({
    name,
    startTime,
    notes,
    mode: 'countdown',
    duration,
    warnAt: Math.min(300000, Math.floor(duration * 0.2)),
    dangerAt: Math.min(60000, Math.floor(duration * 0.05)),
    setActive: goLive
  });
  if (goLive && created) {
    client.timerAction(created.id, 'start');
  }
  $artistName.value = '';
  if ($artistStartTime) $artistStartTime.value = '';
  if ($artistNotes) $artistNotes.value = '';
  $artistName.blur();
}

if ($addArtistBtn) {
  $addArtistBtn.addEventListener('click', () => handleCreateArtist(false));
}
if ($liveArtistBtn) {
  $liveArtistBtn.addEventListener('click', () => handleCreateArtist(true));
}
if ($artistName) {
  $artistName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateArtist(false);
  });
}

$queueList.addEventListener('click', (e) => {
  const delBtn = e.target.closest('[data-del-id]');
  if (delBtn) {
    e.stopPropagation();
    const id = delBtn.dataset.delId;
    if (confirm('Remover este artista da fila?')) {
      client.deleteTimer(id);
    }
    return;
  }
  const item = e.target.closest('.op-queue-item');
  if (item && item.dataset.id) {
    client.setActiveTimer(item.dataset.id);
  }
});

$queueList.addEventListener('change', (e) => {
  const noteInput = e.target.closest('[data-note-id]');
  if (noteInput) {
    client.updateTimer(noteInput.dataset.noteId, { notes: noteInput.value });
  }
  const timeInput = e.target.closest('[data-time-id]');
  if (timeInput) {
    client.updateTimer(timeInput.dataset.timeId, { startTime: timeInput.value });
  }
});
