/**
 * Modo Operador (Mobile / Safari Optimized)
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
  role: 'controller',
  room: roomId,
});

let state = null;

// ─── DOM References ────────────────────────────────────────────────

const $roomInput = document.getElementById('op-room-input');
const $joinBtn = document.getElementById('op-join-btn');
const $connBadge = document.getElementById('op-conn-badge');
const $bgColor = document.getElementById('op-bg-color');
const $opStageBadge = document.getElementById('op-stage-badge');
const $opEventSelect = document.getElementById('op-event-select');
const $opDayTabs = document.getElementById('op-day-tabs');
const $opStagePills = document.getElementById('op-stage-pills');

let lastOpStagePillsSig = '';
let lastOpSelectSig = '';

function renderOpStageBadge(force = false) {
  const currentCode = (state?.id || roomId || 'PALCO1').toUpperCase();
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

  if ($opStageBadge) {
    let name = currentCode;
    if (currentEvent) {
      if (Array.isArray(currentEvent.stages) && currentEvent.stages.length > 1) {
        const st = currentEvent.stages.find(s => (s.code || s.id || '').toUpperCase() === currentCode);
        name = `${currentEvent.title || currentEvent.code} • ${st?.name || currentCode}`;
      } else {
        name = currentEvent.title || currentEvent.code;
      }
    }
    if ($opStageBadge.textContent !== name) {
      $opStageBadge.textContent = name;
    }
  }

  // Quick Stage Pills for Operator (Show all stages if multiple exist)
  if ($opStagePills) {
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
      $opStagePills.style.display = 'flex';
      const pillsSig = allStages.map(s => `${s.code}:${s.name}:${s.isCurrent}`).join('|');
      if (force || pillsSig !== lastOpStagePillsSig) {
        lastOpStagePillsSig = pillsSig;
        $opStagePills.innerHTML = allStages.map(st => {
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
      }
    } else {
      $opStagePills.style.display = 'none';
      if (lastOpStagePillsSig !== '') {
        $opStagePills.innerHTML = '';
        lastOpStagePillsSig = '';
      }
    }
  }

  let totalStagesCount = 0;
  list.forEach(e => {
    totalStagesCount += (Array.isArray(e.stages) && e.stages.length > 0) ? e.stages.length : 1;
  });

  if ($opEventSelect) {
    if (list.length > 1 || totalStagesCount > 1) {
      $opEventSelect.style.display = 'inline-block';
      const selectSig = list.map(ev => `${ev.code}:${ev.title}:${(ev.stages || []).map(s => `${s.code}:${s.name}`).join(';')}`).join('||') + `::${currentCode}`;
      if (force || selectSig !== lastOpSelectSig) {
        lastOpSelectSig = selectSig;
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

        $opEventSelect.innerHTML = optionsHtml;
        $opEventSelect.value = currentCode;
      }
    } else {
      $opEventSelect.style.display = 'none';
      lastOpSelectSig = '';
    }
  }
}

// Stage badge click focuses/opens select
if ($opStageBadge && $opEventSelect) {
  $opStageBadge.style.cursor = 'pointer';
  $opStageBadge.addEventListener('click', () => {
    if ($opEventSelect.style.display !== 'none') {
      $opEventSelect.focus();
      try { $opEventSelect.showPicker(); } catch (_) {}
    }
  });
}

// Stage pills click delegation
document.addEventListener('click', (e) => {
  const pill = e.target.closest('[data-switch-stage], [data-ctrl-switch-stage]');
  if (pill) {
    const targetRoom = (pill.dataset.switchStage || pill.dataset.ctrlSwitchStage || '').toUpperCase().trim();
    if (targetRoom && targetRoom !== (state?.id || roomId).toUpperCase()) {
      try {
        localStorage.setItem('stagetimer_device_room', targetRoom);
        localStorage.setItem('stagetimer_last_room', targetRoom);
        sessionStorage.setItem('stagetimer_active_room', targetRoom);
      } catch (_) {}
      window.location.replace(`operator.html?room=${encodeURIComponent(targetRoom)}`);
    }
  }
});

if ($opEventSelect) {
  $opEventSelect.addEventListener('change', () => {
    const val = $opEventSelect.value;
    if (val && val !== (state?.id || roomId)) {
      try {
        localStorage.setItem('stagetimer_device_room', val.toUpperCase());
        localStorage.setItem('stagetimer_last_room', val.toUpperCase());
        sessionStorage.setItem('stagetimer_active_room', val.toUpperCase());
      } catch (e) {}
      window.location.replace(`operator.html?room=${encodeURIComponent(val)}`);
    }
  });
}

const $navHub = document.getElementById('nav-hub');
if ($navHub) {
  $navHub.href = 'index.html';
}

let lastOpDayTabsSig = '';

function renderOpDayTabs(force = false) {
  if (!$opDayTabs || !state) return;
  const currentDay = state.currentDay || 1;
  const daysMap = state.days || { '1': state.timers || [] };
  const dayKeys = Object.keys(daysMap).map(Number).sort((a, b) => a - b);
  if (dayKeys.length === 0) dayKeys.push(1);

  const sig = `${currentDay}:${dayKeys.map(d => `${d}:${Array.isArray(daysMap[String(d)]) ? daysMap[String(d)].length : (d === currentDay ? (state.timers?.length || 0) : 0)}`).join(',')}`;
  if (!force && sig === lastOpDayTabsSig) return;
  lastOpDayTabsSig = sig;

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
      const d = parseInt(dayBtn.dataset.opDay, 10);
      if (!isNaN(d)) {
        client.switchDay(d);
        if (state) {
          state.currentDay = d;
          if (state.days && state.days[String(d)]) {
            state.timers = [...state.days[String(d)]];
          }
          renderOpDayTabs();
          if (typeof renderQueue === 'function') renderQueue();
          render();
        }
      }
      return;
    }
    const addBtn = e.target.closest('#op-add-day-btn');
    if (addBtn) {
      client.addDay();
      if (state) {
        renderOpDayTabs();
        if (typeof renderQueue === 'function') renderQueue();
        render();
      }
    }
  });
}

client.on('events-list-update', (list) => {
  renderOpStageBadge(true);
  renderOpDayTabs(true);
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
const $msgToggle = document.getElementById('op-msg-toggle') || document.getElementById('op-msg-clear');
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
  const currentCode = (state?.id || roomId || 'PALCO1').toUpperCase();
  const code = encodeURIComponent(currentCode);
  const $navHub = document.getElementById('nav-hub');
  if ($navHub) $navHub.href = 'index.html';
  if ($navController) $navController.href = `controller.html?room=${code}`;
  if ($navOperator) $navOperator.href = `operator.html?room=${code}`;
  if ($navViewer) $navViewer.href = `viewer.html?room=${code}`;
  const $navLineup = document.getElementById('nav-lineup');
  if ($navLineup) $navLineup.href = `lineup.html?room=${code}`;
  const $navMaster = document.getElementById('nav-master');
  if ($navMaster) $navMaster.href = `master.html?room=${code}`;
  renderOpStageBadge();
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
  const $opEventEnd = document.getElementById('op-event-end');
  if ($opEventEnd) {
    $opEventEnd.textContent = getEventEndTime();
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
  if (state.id && state.id !== roomId) {
    roomId = state.id;
    updateNavLinks();
  }
  renderOpStageBadge();
  renderOpDayTabs();

  const $opEventEnd = document.getElementById('op-event-end');
  if ($opEventEnd) {
    $opEventEnd.textContent = getEventEndTime();
  }

  if (state.theme?.viewerBg) {
    $bgColor.value = state.theme.viewerBg;
    $hero.style.backgroundColor = state.theme.viewerBg;
  }

  const active = StageTimerClient.getActiveTimer(state);
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
      let nextT = null;
      let containingList = state.timers;
      if (!containingList.some(t => t.id === active.id) && state.days) {
        for (const dayList of Object.values(state.days)) {
          if (Array.isArray(dayList) && dayList.some(t => t.id === active.id)) {
            containingList = dayList;
            break;
          }
        }
      }
      const idx = containingList.findIndex(t => t.id === active.id);
      nextT = idx >= 0 ? containingList[idx + 1] : null;
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

  // Message status & toggle visibility
  const isMsgVisible = !!(state.message?.visible && state.message?.text);
  if (isMsgVisible) {
    const label = state.message.level === 'urgent' ? '🔴 URGENTE' : '💬 INFO';
    $msgStatus.textContent = `${label}: "${state.message.text}"`;
    if ($msgToggle) {
      $msgToggle.innerHTML = '🙈 Ocultar';
      $msgToggle.style.background = '#d63031';
      $msgToggle.style.borderColor = '#d63031';
      $msgToggle.style.color = '#fff';
      $msgToggle.title = 'A mensagem está visível no palco. Toque para ocultar.';
    }
  } else {
    $msgStatus.textContent = '';
    if ($msgToggle) {
      $msgToggle.innerHTML = '👁️ Mostrar';
      $msgToggle.style.background = 'rgba(0, 184, 148, 0.2)';
      $msgToggle.style.borderColor = '#00b894';
      $msgToggle.style.color = '#55efc4';
      $msgToggle.title = 'A mensagem está oculta. Toque para mostrar no palco.';
    }
  }

  if ($msgInput && !$msgInput.value && state.message?.text && document.activeElement !== $msgInput) {
    $msgInput.value = state.message.text;
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
    const active = StageTimerClient.getActiveTimer(state);
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
      $msgInput.dataset.level = 'info';
      $msgInput.blur();
    }
  });
}

if ($msgUrgent) {
  $msgUrgent.addEventListener('click', () => {
    const txt = $msgInput.value.trim();
    if (txt) {
      client.sendMessage(txt, true, 'urgent');
      $msgInput.dataset.level = 'urgent';
      $msgInput.blur();
    }
  });
}

if ($msgToggle) {
  $msgToggle.addEventListener('click', () => {
    const isCurrentlyVisible = !!(state?.message?.visible && state?.message?.text);
    const inputTxt = $msgInput ? $msgInput.value.trim() : '';
    const currentText = inputTxt || (state?.message?.text || '').trim();

    if (isCurrentlyVisible) {
      // Ocultar mensagem do palco mantendo o texto guardado
      client.sendMessage(currentText, false, state?.message?.level || 'info');
    } else {
      // Mostrar mensagem no palco
      if (!currentText) {
        if ($msgInput) $msgInput.focus();
        return;
      }
      const level = ($msgInput && $msgInput.dataset.level) || state?.message?.level || 'info';
      client.sendMessage(currentText, true, level);
    }
  });
}

// Quick Stage Message Presets: select & pre-fill without broadcasting
document.querySelectorAll('.op-preset-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const wasActive = btn.classList.contains('active');
    document.querySelectorAll('.op-preset-chip').forEach(b => b.classList.remove('active'));
    if (wasActive) {
      if ($msgInput) $msgInput.dataset.level = 'info';
      return;
    }
    btn.classList.add('active');
    const msg = btn.dataset.msg;
    const level = btn.dataset.level || 'info';
    if ($msgInput) {
      $msgInput.value = msg;
      $msgInput.dataset.level = level;
    }
    // Note: Do NOT broadcast to stage yet! The user must click "Mostrar" or "Informativo" / "Urgente"
    if (navigator.vibrate) { try { navigator.vibrate(25); } catch (_) {} }
  });
});

if ($msgInput) {
  $msgInput.addEventListener('input', () => {
    document.querySelectorAll('.op-preset-chip').forEach(b => b.classList.remove('active'));
  });
}

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
    if (target) {
      // Optimistic instant visual update
      if (state && Array.isArray(state.timers)) {
        state.activeTimerId = target.id;
        state.timers.forEach(t => {
          if (t.id === target.id) {
            t.state = 'running';
          } else if (t.state === 'running') {
            t.state = 'stopped';
          }
        });
        render();
      }
      // Direct atomic start: activates and starts countdown immediately!
      client.timerAction(target.id, 'start');
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
