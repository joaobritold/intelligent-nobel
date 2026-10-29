/**
 * Modo Operador (Mobile / Safari Optimized)
 */

const params = new URLSearchParams(location.search);
const paramRoom = params.get('room');
const savedDeviceRoom = localStorage.getItem('stagetimer_device_room');
const savedLastRoom = localStorage.getItem('stagetimer_last_room');

let roomId = (
  (paramRoom && paramRoom.toUpperCase() !== 'PALCO1') ? paramRoom :
  (savedDeviceRoom && savedDeviceRoom.toUpperCase() !== 'PALCO1') ? savedDeviceRoom :
  (savedLastRoom && savedLastRoom.toUpperCase() !== 'PALCO1') ? savedLastRoom :
  (paramRoom || savedDeviceRoom || savedLastRoom || 'PALCO1')
).toUpperCase();

try {
  localStorage.setItem('stagetimer_device_room', roomId);
  localStorage.setItem('stagetimer_last_room', roomId);
} catch (e) {}

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
const $opEventSelect = document.getElementById('op-event-select');
const $opDayTabs = document.getElementById('op-day-tabs');

function renderOpEventSelector() {
  if (!$opEventSelect || typeof client.getEventsList !== 'function') return;
  const currentCode = (state?.id || roomId || 'PALCO1').toUpperCase();
  const list = client.getEventsList();
  $opEventSelect.innerHTML = list.map(ev => {
    return `<option value="${ev.code}" ${ev.code === currentCode ? 'selected' : ''}>${ev.title || ev.code}</option>`;
  }).join('');
}

if ($opEventSelect) {
  $opEventSelect.addEventListener('change', () => {
    const val = $opEventSelect.value;
    if (val && val !== (state?.id || roomId)) {
      try {
        localStorage.setItem('stagetimer_device_room', val.toUpperCase());
        localStorage.setItem('stagetimer_last_room', val.toUpperCase());
      } catch (e) {}
      location.search = `?room=${encodeURIComponent(val)}`;
    }
  });
}

const $navHub = document.getElementById('nav-hub');
if ($navHub) {
  $navHub.href = (roomId && roomId !== 'PALCO1') ? `index.html?room=${encodeURIComponent(roomId)}` : `index.html`;
}

function renderOpDayTabs() {
  if (!$opDayTabs || !state) return;
  const currentDay = state.currentDay || 1;
  const daysMap = state.days || { '1': state.timers || [] };
  const dayKeys = Object.keys(daysMap).map(Number).sort((a, b) => a - b);
  if (dayKeys.length === 0) dayKeys.push(1);

  $opDayTabs.innerHTML = dayKeys.map(d => {
    const isAct = d === currentDay;
    const count = Array.isArray(daysMap[String(d)]) ? daysMap[String(d)].length : (isAct ? state.timers.length : 0);
    return `
      <button type="button" class="btn btn-sm ${isAct ? 'btn-primary' : ''}" data-op-day="${d}" style="padding: 3px 8px; font-size: 0.72rem; font-weight: 700;">
        Dia ${d} (${count})
      </button>
    `;
  }).join('') + `
    <button id="op-add-day-btn" type="button" class="btn btn-sm" style="padding: 3px 7px; font-size: 0.7rem; background: rgba(0, 184, 148, 0.2); border-color: rgba(0, 184, 148, 0.5); color: #55efc4;">+ Dia</button>
  `;
}

if ($opDayTabs) {
  $opDayTabs.addEventListener('click', (e) => {
    const dayBtn = e.target.closest('[data-op-day]');
    if (dayBtn) {
      client.switchDay(parseInt(dayBtn.dataset.opDay, 10));
      return;
    }
    const addBtn = e.target.closest('#op-add-day-btn');
    if (addBtn) {
      client.addDay();
    }
  });
}

client.on('events-list-update', (list) => {
  renderOpEventSelector();
  renderOpDayTabs();
  if (roomId === 'PALCO1' && (!state || !state.timers || state.timers.length === 0) && Array.isArray(list) && list.length > 0) {
    const activeEv = list.find(e => (e.timersCount > 0 || e.artistCount > 0)) || list.find(e => e.code !== 'PALCO1');
    if (activeEv && activeEv.code && activeEv.code !== 'PALCO1') {
      try {
        localStorage.setItem('stagetimer_device_room', activeEv.code);
        localStorage.setItem('stagetimer_last_room', activeEv.code);
      } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.set('room', activeEv.code);
      location.replace(u.toString());
    }
  }
});

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
const $msgInfo = document.getElementById('op-msg-info');
const $msgUrgent = document.getElementById('op-msg-urgent');
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
  const $navHub = document.getElementById('nav-hub');
  if ($navHub) $navHub.href = (roomId && roomId !== 'PALCO1') ? `index.html?room=${code}` : `index.html`;
  $navController.href = `controller.html?room=${code}`;
  $navOperator.href = `operator.html?room=${code}`;
  $navViewer.href = `viewer.html?room=${code}`;
  const $navLineup = document.getElementById('nav-lineup');
  if ($navLineup) $navLineup.href = `lineup.html?room=${code}`;
  renderOpEventSelector();
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

function updateOpClock() {
  const el = document.getElementById('op-local-clock');
  if (el) {
    el.textContent = StageTimerClient.getTrueTimeString();
  }
}
updateOpClock();
setInterval(updateOpClock, 1000);

function formatTime(ms) {
  return StageTimerClient.formatTime(ms);
}

function getTimerElapsed(timer) {
  return StageTimerClient.getTimerElapsed(timer);
}

function parseTimeInput(str) {
  str = (str || '').trim().toLowerCase();
  if (!str) return 1800000;

  // 1. Colon format: HH:MM:SS or MM:SS or H:MM (e.g. 1:30 = 1h30m, 45:00 = 45m)
  const colonMatch = str.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      // H:MM:SS
      return (parseInt(colonMatch[1], 10) * 3600 + parseInt(colonMatch[2], 10) * 60 + parseInt(colonMatch[3], 10)) * 1000;
    }
    const part1 = parseInt(colonMatch[1], 10);
    const part2 = parseInt(colonMatch[2], 10);
    if (part1 <= 12) {
      return (part1 * 3600 + part2 * 60) * 1000;
    }
    return (part1 * 60 + part2) * 1000;
  }

  // 2. Shorthand with dot or comma: "1.3" or "1,3" -> 1h30m, "1.45" -> 1h45m, "0.3" -> 30m, "2.0" -> 2h
  const dotMatch = str.match(/^(\d+)[.,](\d{1,2})$/);
  if (dotMatch) {
    const hours = parseInt(dotMatch[1], 10);
    const minRaw = dotMatch[2];
    const mins = minRaw.length === 1 ? parseInt(minRaw, 10) * 10 : parseInt(minRaw, 10);
    return (hours * 3600 + mins * 60) * 1000;
  }

  // 3. Plain integer: ALWAYS minutes in stage/festival environment (e.g. 60 = 60m, 45 = 45m, 90 = 90m, 5 = 5m)
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10) * 60000;
  }

  // 4. "1h30", "1h30m", "1h", "45m", "30s"
  const hmMatch = str.match(/^(\d+)\s*h\s*(\d{1,2})?(?:\s*m)?$/i);
  if (hmMatch) {
    const hours = parseInt(hmMatch[1], 10);
    const mins = hmMatch[2] ? parseInt(hmMatch[2], 10) : 0;
    return (hours * 3600 + mins * 60) * 1000;
  }

  let total = 0;
  const hMatch = str.match(/(\d+)\s*h/);
  const mMatch = str.match(/(\d+)\s*m/);
  const sMatch = str.match(/(\d+)\s*s/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 3600000;
  if (mMatch) total += parseInt(mMatch[1], 10) * 60000;
  if (sMatch) total += parseInt(sMatch[1], 10) * 1000;
  return total || 1800000;
}

function getTimerColor(timer) {
  if (timer.mode === 'clock') return 'safe';
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

function getEstimatedEndTime(timer) {
  if (!timer || !state) return '';
  return StageTimerClient.computeTimerEndTime(state, timer.id);
}

function getEventEndTime() {
  return StageTimerClient.computeEventEndTime(state);
}

// ─── Render ────────────────────────────────────────────────────────

let lastQueueSignature = '';
let opDraggedId = null;

function render() {
  if (!state) return;
  renderOpEventSelector();
  renderOpDayTabs();

  const $opEventEnd = document.getElementById('op-event-end');
  if ($opEventEnd) {
    $opEventEnd.textContent = getEventEndTime();
  }

  if (state.theme?.viewerBg) {
    $bgColor.value = state.theme.viewerBg;
    $hero.style.backgroundColor = state.theme.viewerBg;
  }

  const active = state.timers.find(t => t.id === state.activeTimerId);
  const $heroEndTime = document.getElementById('op-hero-endtime');

  if (!active) {
    $heroBadge.textContent = 'SEM TIMER';
    $heroName.textContent = 'Selecione um timer abaixo';
    $heroTime.textContent = '--:--';
    $heroTime.className = 'op-hero-time';
    if ($heroEndTime) $heroEndTime.textContent = '';
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

    if ($heroEndTime) {
      const endStr = getEstimatedEndTime(active);
      $heroEndTime.textContent = endStr ? `🏁 Término previsto: ${endStr}` : '';
    }

    if ($heroNotes) {
      $heroNotes.textContent = active.notes ? `📝 ${active.notes}` : '';
    }

    if ($heroNext) {
      const idx = state.timers.findIndex(t => t.id === state.activeTimerId);
      const nextT = idx >= 0 ? state.timers[idx + 1] : null;
      $heroNext.textContent = nextT ? `NEXT: ${nextT.name}` : '';
    }

    if (active.mode === 'countdown' && active.duration > 0) {
      const elapsed = getTimerElapsed(active);
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
    const label = state.message.level === 'urgent' ? '🔴 URGENTE' : '💬 INFO';
    $msgStatus.textContent = `${label}: "${state.message.text}"`;
  } else {
    $msgStatus.textContent = '';
  }

  // Render queue only when structure changes to keep touch targets stable
  const sig = state.timers.map(t => `${t.id}:${t.name}:${t.startTime || ''}:${t.notes || ''}:${t.duration}:${t.mode}:${t.id === state.activeTimerId}:${t.state}`).join('|');
  if (sig !== lastQueueSignature && !opDraggedId) {
    lastQueueSignature = sig;
    $queueList.innerHTML = state.timers.map((t, idx) => {
      const isAct = t.id === state.activeTimerId;
      const isRunning = t.state === 'running';
      const endTimeStr = getEstimatedEndTime(t);
      return `
        <div class="op-queue-item ${isAct ? 'active' : ''}" data-id="${t.id}">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
            <span class="op-queue-name" style="flex: 1; min-width: 0; overflow-wrap: break-word;"><span style="color:var(--text-muted); margin-right:6px;">⠿</span>${escapeHtml(t.name)}</span>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              <button type="button" class="op-btn-fire ${isAct ? 'is-active' : ''}" data-fire-id="${t.id}" title="Disparar direto: coloca no ar e arranca imediatamente o contador">
                ${isAct && isRunning ? '● NO AR' : (isAct ? '▶ ARRANCA' : '🚀 DISPARAR')}
              </button>
              <button type="button" class="op-move-btn" data-move-up="${t.id}" title="Subir" ${idx === 0 ? 'disabled style="opacity:0.35"' : ''}>↑</button>
              <button type="button" class="op-move-btn" data-move-down="${t.id}" title="Descer" ${idx === state.timers.length - 1 ? 'disabled style="opacity:0.35"' : ''}>↓</button>
              <button type="button" class="op-queue-del" data-del-id="${t.id}" title="Apagar">🗑️</button>
            </div>
          </div>
          <div class="op-queue-meta" style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px;">
            ${t.startTime ? `<strong style="color:var(--accent)">[${escapeHtml(t.startTime)}]</strong>` : ''}
            <span>⏱ ${formatTime(t.duration)}</span>
            ${endTimeStr ? `<span class="op-end-time" data-end-id="${t.id}" style="color:#55efc4; font-weight:700;">🏁 Fim: ${endTimeStr}</span>` : ''}
          </div>
          <div style="display: flex; gap: 6px; width: 100%;" onclick="event.stopPropagation()">
            <input class="input" data-time-id="${t.id}" value="${escapeHtml(t.startTime || '')}" placeholder="23:00 – 00:15" style="padding: 6px 8px; font-size: 16px !important; width: 132px; text-align:center; flex-shrink: 0;">
            <input class="input op-item-notes" data-note-id="${t.id}" value="${escapeHtml(t.notes || '')}" placeholder="📝 Notas deste artista..." style="padding: 6px 8px; font-size: 16px !important; flex: 1; min-width: 0;">
          </div>
        </div>
      `;
    }).join('');
  } else {
    // Update live end times in queue
    state.timers.forEach(t => {
      const el = $queueList.querySelector(`[data-end-id="${t.id}"]`);
      if (el) {
        const endStr = getEstimatedEndTime(t);
        el.textContent = endStr ? `🏁 Fim: ${endStr}` : '';
      }
    });
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

setInterval(() => {
  if (state?.timers) {
    const active = state.timers.find(t => t.id === state.activeTimerId);
    if (active && active.mode === 'clock') {
      const $heroTime = document.getElementById('op-hero-time');
      if ($heroTime) $heroTime.textContent = getTimerDisplayValue(active);
    }
  }
}, 1000);

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

document.querySelectorAll('[data-adjust-min]').forEach(btn => {
  btn.addEventListener('click', () => {
    const mins = parseInt(btn.dataset.adjustMin, 10);
    if (!isNaN(mins) && state?.activeTimerId) {
      client.adjustTime(state.activeTimerId, mins * 60000);
    }
  });
});

$bgColor.addEventListener('input', (e) => {
  client.updateTheme({ viewerBg: e.target.value });
});

if ($msgInfo) {
  $msgInfo.addEventListener('click', () => {
    const txt = $msgInput.value.trim();
    if (txt) {
      client.sendMessage(txt, true, 'info');
      $msgInput.blur();
    }
  });
}

if ($msgUrgent) {
  $msgUrgent.addEventListener('click', () => {
    const txt = $msgInput.value.trim();
    if (txt) {
      client.sendMessage(txt, true, 'urgent');
      $msgInput.blur();
    }
  });
}

$msgClear.addEventListener('click', () => {
  $msgInput.value = '';
  client.clearMessage();
});

document.querySelectorAll('.op-preset-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const msg = btn.dataset.msg;
    const level = btn.dataset.level || 'info';
    $msgInput.value = msg;
    client.sendMessage(msg, true, level);
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

const $opClearEvent = document.getElementById('op-clear-event');
if ($opClearEvent) {
  $opClearEvent.addEventListener('click', () => {
    if (confirm('🧹 Limpar todos os artistas do dia atual?')) {
      client.clearAllTimers();
    }
  });
}

const $opImportFile = document.getElementById('op-import-file');
if ($opImportFile) {
  $opImportFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      let extractedData = null;
      if (ext === 'pdf') {
        extractedData = await ScheduleImporter.extractPdfPages(file);
      } else {
        extractedData = await ScheduleImporter.extractSpreadsheetOrText(file);
      }

      const sched = ScheduleImporter.parseMultiDaySchedule(extractedData, { includeSoundchecks: true, includeChangeovers: true });
      if (sched.totalTimers === 0) {
        alert('Nenhum artista com horário válido (ex: 23h00 - 00h15 ou 23:00) foi encontrado no ficheiro.');
        return;
      }

      if (sched.isMultiDay) {
        const daySummary = Object.keys(sched.days).sort((a, b) => Number(a) - Number(b))
          .map(k => `• ${sched.dayTitles[k] || 'Dia ' + k}: ${sched.days[k].length} artista(s)`)
          .join('\n');

        const confirmAll = confirm(`O ficheiro contém ${sched.totalDays} dias (${sched.totalTimers} artistas no total):\n\n${daySummary}\n\nDeseja importar TODOS os ${sched.totalDays} dias automaticamente?`);
        if (confirmAll) {
          client.replaceAllDays(sched.days);
          alert(`✓ ${sched.totalDays} dias importados com sucesso!`);
          return;
        } else {
          const ans = prompt(`Qual dia específico deseja carregar para o dia atual? (1 a ${sched.totalDays})`, '1');
          const dKey = String(parseInt(ans, 10) || 1);
          if (sched.days[dKey]) {
            client.replaceDayTimers(state?.currentDay || 1, sched.days[dKey]);
            alert(`✓ Dia ${state?.currentDay || 1} atualizado com ${sched.days[dKey].length} artistas!`);
          }
          return;
        }
      } else {
        const singleTimers = sched.days['1'] || [];
        if (confirm(`Encontrados ${singleTimers.length} artistas (${singleTimers.map(p => p.name).join(', ')}). Carregar agora?`)) {
          client.replaceAllTimers(singleTimers);
        }
      }
    } catch (err) {
      alert('Erro ao importar ficheiro: ' + err.message);
    } finally {
      $opImportFile.value = '';
    }
  });
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
  const fireBtn = e.target.closest('[data-fire-id]');
  if (fireBtn) {
    e.stopPropagation();
    const id = fireBtn.dataset.fireId;
    // Otimização visual imediata: coloca no ar sem qualquer atraso
    if (state && Array.isArray(state.timers)) {
      state.activeTimerId = id;
      state.timers.forEach(t => {
        if (t.id === id) {
          t.state = 'running';
        } else if (t.state === 'running') {
          t.state = 'stopped';
        }
      });
      render();
    }
    // Disparo direto atómico: coloca como ativo e arranca logo o contador!
    client.timerAction(id, 'start');
    return;
  }

  const upBtn = e.target.closest('[data-move-up]');
  if (upBtn) {
    e.stopPropagation();
    const id = upBtn.dataset.moveUp;
    const order = state.timers.map(t => t.id);
    const idx = order.indexOf(id);
    if (idx > 0) {
      [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
      client.reorderTimers(order);
    }
    return;
  }
  const downBtn = e.target.closest('[data-move-down]');
  if (downBtn) {
    e.stopPropagation();
    const id = downBtn.dataset.moveDown;
    const order = state.timers.map(t => t.id);
    const idx = order.indexOf(id);
    if (idx >= 0 && idx < order.length - 1) {
      [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
      client.reorderTimers(order);
    }
    return;
  }
  const delBtn = e.target.closest('[data-del-id]');
  if (delBtn) {
    e.stopPropagation();
    const id = delBtn.dataset.delId;
    if (confirm('Remover este artista da fila?')) {
      client.deleteTimer(id);
    }
    return;
  }
  // IMPORTANTE: Tocar na caixa (.op-queue-item) NÃO LANÇA!
  // Evita disparos acidentais ao fazer scroll ou tocar no ecrã.
});

// Navegação Anterior / Próximo no Modo Operador
const $btnPrev = document.getElementById('op-btn-prev');
const $btnNext = document.getElementById('op-btn-next');

if ($btnPrev) {
  $btnPrev.addEventListener('click', () => {
    if (!state || !state.timers || state.timers.length === 0) return;
    const currentIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const targetIdx = currentIdx > 0 ? currentIdx - 1 : 0;
    const target = state.timers[targetIdx];
    if (target && target.id !== state.activeTimerId) {
      client.setActiveTimer(target.id);
    }
  });
}

if ($btnNext) {
  $btnNext.addEventListener('click', () => {
    if (!state || !state.timers || state.timers.length === 0) return;
    const currentIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const targetIdx = currentIdx >= 0 && currentIdx < state.timers.length - 1 ? currentIdx + 1 : state.timers.length - 1;
    const target = state.timers[targetIdx];
    if (target && target.id !== state.activeTimerId) {
      client.setActiveTimer(target.id);
    }
  });
}

// Drag & Drop reordering in Operator Queue
$queueList.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.op-queue-item');
  if (!item) return;
  opDraggedId = item.dataset.id;
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

$queueList.addEventListener('dragend', () => {
  $queueList.querySelectorAll('.op-queue-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
  opDraggedId = null;
});

$queueList.addEventListener('dragover', (e) => {
  e.preventDefault();
  const target = e.target.closest('.op-queue-item');
  $queueList.querySelectorAll('.op-queue-item').forEach(el => {
    el.classList.toggle('drag-over', el === target && el.dataset.id !== opDraggedId);
  });
});

$queueList.addEventListener('drop', (e) => {
  e.preventDefault();
  $queueList.querySelectorAll('.op-queue-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
  if (!opDraggedId || !state) return;
  const target = e.target.closest('.op-queue-item');
  const fromId = opDraggedId;
  opDraggedId = null;
  if (!target || target.dataset.id === fromId) return;

  const order = state.timers.map(t => t.id);
  const fromIdx = order.indexOf(fromId);
  const toIdx = order.indexOf(target.dataset.id);
  if (fromIdx === -1 || toIdx === -1) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, fromId);
  client.reorderTimers(order);
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
