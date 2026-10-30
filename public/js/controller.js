/**
 * Controller — manages timers and communicates with the server.
 */

// ─── Init ──────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const paramRoom = (params.get('room') || '').trim();
const savedActiveRoom = (sessionStorage.getItem('stagetimer_active_room') || '').trim();
const savedDeviceRoom = (localStorage.getItem('stagetimer_device_room') || '').trim();
const savedLastRoom = (localStorage.getItem('stagetimer_last_room') || '').trim();

let roomId = (paramRoom || savedActiveRoom || savedDeviceRoom || savedLastRoom || 'PALCO1').toUpperCase();

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
let draggedId = null;

// ─── DOM References ────────────────────────────────────────────────

const $connectionBadge = document.getElementById('connection-badge');
const $roomIdDisplay = document.getElementById('room-id');
const $timerList = document.getElementById('timer-list');
const $addTimerBtn = document.getElementById('add-timer-btn');
const $previewDisplay = document.getElementById('preview-display');
const $previewName = document.getElementById('preview-name');
const $previewMessage = document.getElementById('preview-message');
const $messageInput = document.getElementById('message-input');
const $sendInfoBtn = document.getElementById('send-info-btn');
const $sendUrgentBtn = document.getElementById('send-urgent-btn');
const $toggleMsgBtn = document.getElementById('toggle-msg-btn') || document.getElementById('clear-msg-btn');
const $viewerLink = document.getElementById('viewer-link');
const $controllerLink = document.getElementById('controller-link');
const $globalStart = document.getElementById('global-start');
const $globalPause = document.getElementById('global-pause');
const $globalReset = document.getElementById('global-reset');
const $toast = document.getElementById('toast');
const $viewerBgColor = document.getElementById('viewer-bg-color');
const $roomCodeInput = document.getElementById('room-code-input');
const $joinRoomBtn = document.getElementById('join-room-btn');
const $p2pStatusText = document.getElementById('p2p-status-text');
const $p2pPeerCount = document.getElementById('p2p-peer-count');
const $viewerLinkBtn = document.getElementById('viewer-link-btn');
const $ctrlStageBadge = document.getElementById('ctrl-stage-badge');
const $ctrlEventSelect = document.getElementById('ctrl-event-select');
const $ctrlNewCleanEventBtn = document.getElementById('ctrl-new-clean-event-btn');
const $newEventModal = document.getElementById('new-event-modal');
const $newEventTitleInput = document.getElementById('new-event-title-input');
const $newEventConfirm = document.getElementById('new-event-confirm');
const $newEventCancel = document.getElementById('new-event-cancel');
const $ctrlEventsManageList = document.getElementById('ctrl-events-manage-list');
const $ctrlDeleteAllEventsBtn = document.getElementById('ctrl-delete-all-events-btn');
const $ctrlStagePills = document.getElementById('ctrl-stage-pills');
const $ctrlDayTabs = document.getElementById('ctrl-day-tabs');
function updateTopNavLinks(code) {
  const current = (code || roomId || 'PALCO1').toUpperCase();
  const q = `?room=${encodeURIComponent(current)}`;
  const topHub = document.getElementById('top-nav-hub');
  const topController = document.getElementById('top-nav-controller');
  const topOperator = document.getElementById('top-nav-operator');
  const topViewer = document.getElementById('top-nav-viewer');
  const topLineup = document.getElementById('top-nav-lineup');
  const topMaster = document.getElementById('top-nav-master');
  if (topHub) topHub.href = 'index.html';
  if (topController) topController.href = `controller.html${q}`;
  if (topOperator) topOperator.href = `operator.html${q}`;
  if (topViewer) topViewer.href = `viewer.html${q}`;
  if (topLineup) topLineup.href = `lineup.html${q}`;
  if (topMaster) topMaster.href = `master.html${q}`;
}
updateTopNavLinks(roomId);

function renderDayTabs() {
  if (!$ctrlDayTabs || !state) return;
  const currentDay = state.currentDay || 1;
  const daysMap = state.days || { '1': state.timers || [] };
  const dayKeys = Object.keys(daysMap).map(Number).sort((a, b) => a - b);
  if (dayKeys.length === 0) dayKeys.push(1);

  $ctrlDayTabs.innerHTML = dayKeys.map(d => {
    const isAct = d === currentDay;
    const count = Array.isArray(daysMap[String(d)]) ? daysMap[String(d)].length : (isAct ? state.timers.length : 0);
    return `
      <div style="display: inline-flex; align-items: center; border-radius: 8px; overflow: hidden; border: 1px solid ${isAct ? 'var(--accent)' : 'var(--border)'}; background: ${isAct ? 'rgba(108, 92, 231, 0.25)' : 'rgba(255,255,255,0.03)'};">
        <button type="button" class="btn btn-sm ${isAct ? 'btn-primary' : ''}" data-switch-day="${d}" style="padding: 4px 10px; font-size: 0.76rem; font-weight: 700; border: none; border-radius: 0;">
          📅 Dia ${d} <span style="opacity: 0.75; font-size: 0.7rem;">(${count})</span>
        </button>
        ${dayKeys.length > 1 ? `<button type="button" data-del-day="${d}" title="Apagar Dia ${d}" style="background: transparent; border: none; color: #ff7675; cursor: pointer; padding: 4px 6px; font-size: 0.7rem; font-weight: 700;">✕</button>` : ''}
      </div>
    `;
  }).join('') + `
    <button id="ctrl-add-day-btn" type="button" class="btn btn-sm" style="padding: 4px 9px; font-size: 0.74rem; background: rgba(0, 184, 148, 0.18); border-color: rgba(0, 184, 148, 0.45); color: #55efc4;" title="Adicionar novo dia a este evento">+ Dia</button>
  `;
}

if ($ctrlDayTabs) {
  $ctrlDayTabs.addEventListener('click', (e) => {
    const switchBtn = e.target.closest('[data-switch-day]');
    if (switchBtn) {
      const d = parseInt(switchBtn.dataset.switchDay, 10);
      client.switchDay(d);
      return;
    }
    const delBtn = e.target.closest('[data-del-day]');
    if (delBtn) {
      const d = parseInt(delBtn.dataset.delDay, 10);
      if (confirm(`Tem a certeza que pretende apagar o Dia ${d} e os seus artistas?`)) {
        client.removeDay(d);
      }
      return;
    }
    const addBtn = e.target.closest('#ctrl-add-day-btn');
    if (addBtn) {
      client.addDay();
    }
  });
}

function renderEventSelector() {
  const currentCode = (state?.id || roomId || 'PALCO1').toUpperCase();
  const list = typeof client.getEventsList === 'function' ? client.getEventsList() : [];
  
  let name = currentCode;
  let currentEvent = null;
  for (const ev of list) {
    if (ev.code === currentCode) {
      name = ev.title || ev.code;
      currentEvent = ev;
      break;
    }
    if (Array.isArray(ev.stages)) {
      const st = ev.stages.find(s => s.code === currentCode);
      if (st) {
        name = `${ev.title || ev.code} • ${st.name || st.code}`;
        currentEvent = ev;
        break;
      }
    }
  }

  if ($ctrlStageBadge) {
    $ctrlStageBadge.textContent = name;
  }

  const isMaster = typeof window.isStageTimerMaster === 'function' ? window.isStageTimerMaster() : (
    sessionStorage.getItem('stagetimer_master_active') === '1' ||
    localStorage.getItem('stagetimer_master_active') === '1' ||
    sessionStorage.getItem('stagetimer_master_auth_v12') === 'true' ||
    localStorage.getItem('stagetimer_master_auth_v12') === 'true'
  );

  if ($ctrlEventSelect) {
    if (isMaster && list.length > 0) {
      $ctrlEventSelect.style.display = 'inline-block';
      if ($ctrlStageBadge) $ctrlStageBadge.style.display = 'none';

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

      $ctrlEventSelect.innerHTML = optionsHtml;
    } else if (currentEvent && Array.isArray(currentEvent.stages) && currentEvent.stages.length > 1) {
      // Event has multiple stages: show stages dropdown even for non-master devices of this event!
      $ctrlEventSelect.style.display = 'inline-block';
      if ($ctrlStageBadge) $ctrlStageBadge.style.display = 'none';
      let optionsHtml = `<optgroup label="🎪 ${escapeHtml(currentEvent.title || currentEvent.code)}">`;
      currentEvent.stages.forEach(st => {
        const isSel = st.code === currentCode;
        optionsHtml += `<option value="${escapeHtml(st.code)}" ${isSel ? 'selected' : ''}>🎪 ${escapeHtml(st.name || st.code)}</option>`;
      });
      optionsHtml += `</optgroup>`;
      $ctrlEventSelect.innerHTML = optionsHtml;
    } else {
      $ctrlEventSelect.style.display = 'none';
      if ($ctrlStageBadge) $ctrlStageBadge.style.display = 'inline-block';
    }
  }

  // Quick stages pills (rendered next to Day tabs when event has multiple stages)
  if ($ctrlStagePills) {
    if (currentEvent && Array.isArray(currentEvent.stages) && currentEvent.stages.length > 1) {
      $ctrlStagePills.style.display = 'inline-flex';
      $ctrlStagePills.innerHTML = currentEvent.stages.map(st => {
        const isAct = st.code === currentCode;
        return `
          <button type="button" class="btn btn-sm ${isAct ? 'btn-primary' : ''}" data-ctrl-switch-stage="${escapeHtml(st.code)}" style="padding: 3px 8px; font-size: 0.75rem; font-weight: 700; border-radius: 6px; ${isAct ? 'background: #00b894; border-color: #00b894; color: #fff;' : 'background: rgba(255,255,255,0.06); border-color: var(--border); color: #cbd5e1;'}">
            🎪 ${escapeHtml(st.name || st.code)}
          </button>
        `;
      }).join('');
    } else {
      $ctrlStagePills.style.display = 'none';
      $ctrlStagePills.innerHTML = '';
    }
  }

  if ($ctrlEventsManageList) {
    $ctrlEventsManageList.innerHTML = list.map(ev => {
      const isAct = ev.code === currentCode;
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid ${isAct ? '#00b894' : 'var(--border)'}; font-size: 0.8rem;">
          <div>
            <strong>${ev.title || ev.code}</strong>
            <span style="color: var(--text-secondary); font-family: var(--font-mono); margin-left: 6px; font-size: 0.72rem;">(${ev.code})</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-sm ${isAct ? 'btn-primary' : ''}" data-open-ev="${ev.code}" style="padding: 3px 8px; font-size: 0.72rem;">${isAct ? 'Ativo' : 'Abrir'}</button>
            ${list.length > 1 ? `<button type="button" class="btn btn-sm btn-danger" data-del-ev="${ev.code}" style="padding: 3px 8px; font-size: 0.72rem;" title="Apagar este evento">🗑️</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

function openNewEventModal() {
  renderEventSelector();
  if ($newEventModal) {
    $newEventModal.classList.add('visible');
    if ($newEventTitleInput) {
      $newEventTitleInput.value = '';
      setTimeout(() => $newEventTitleInput.focus(), 50);
    }
  }
}

if ($ctrlEventSelect) {
  $ctrlEventSelect.addEventListener('change', () => {
    const val = $ctrlEventSelect.value;
    if (val === '__NEW_CLEAN__') {
      renderEventSelector();
      openNewEventModal();
      return;
    }
    if (val && val !== (state?.id || roomId)) {
      try {
        localStorage.setItem('stagetimer_device_room', val.toUpperCase());
        localStorage.setItem('stagetimer_last_room', val.toUpperCase());
        sessionStorage.setItem('stagetimer_active_room', val.toUpperCase());
      } catch (e) {}
      window.location.replace(`controller.html?room=${encodeURIComponent(val)}`);
    }
  });
}

if ($ctrlStagePills) {
  $ctrlStagePills.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctrl-switch-stage]');
    if (btn) {
      const targetStage = btn.dataset.ctrlSwitchStage;
      if (targetStage && targetStage !== (state?.id || roomId)) {
        try {
          localStorage.setItem('stagetimer_device_room', targetStage.toUpperCase());
          localStorage.setItem('stagetimer_last_room', targetStage.toUpperCase());
          sessionStorage.setItem('stagetimer_active_room', targetStage.toUpperCase());
        } catch (_) {}
        window.location.replace(`controller.html?room=${encodeURIComponent(targetStage)}`);
      }
    }
  });
}

if ($ctrlNewCleanEventBtn) {
  $ctrlNewCleanEventBtn.addEventListener('click', () => {
    openNewEventModal();
  });
}

if ($newEventCancel && $newEventModal) {
  $newEventCancel.addEventListener('click', () => {
    $newEventModal.classList.remove('visible');
  });
  $newEventModal.addEventListener('click', (e) => {
    if (e.target === $newEventModal) $newEventModal.classList.remove('visible');
  });
}

if ($newEventConfirm) {
  $newEventConfirm.addEventListener('click', () => {
    const title = ($newEventTitleInput ? $newEventTitleInput.value : '').trim();
    if (!title) {
      alert('Por favor introduza o Nome do Palco / Evento (ex: Palco 2, RC26).');
      if ($newEventTitleInput) $newEventTitleInput.focus();
      return;
    }
    const newCode = client.createNewCleanEvent(title);
    location.search = `?room=${encodeURIComponent(newCode)}&clean=1`;
  });
}

if ($ctrlEventsManageList) {
  $ctrlEventsManageList.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-open-ev]');
    if (openBtn) {
      const code = openBtn.dataset.openEv.toUpperCase();
      try {
        localStorage.setItem('stagetimer_device_room', code);
        localStorage.setItem('stagetimer_last_room', code);
      } catch (e) {}
      location.search = `?room=${encodeURIComponent(code)}`;
      return;
    }
    const delBtn = e.target.closest('[data-del-ev]');
    if (delBtn) {
      const codeToDel = delBtn.dataset.delEv;
      if (confirm(`Apagar o palco/evento "${codeToDel}"?`)) {
        const remaining = client.deleteEventFromRegistry(codeToDel);
        if ((state?.id || roomId) === codeToDel) {
          const nextRoom = (remaining && remaining.length > 0) ? remaining[0].code : 'PALCO1';
          location.search = `?room=${encodeURIComponent(nextRoom)}&clean=1`;
        } else {
          renderEventSelector();
        }
      }
    }
  });
}

if ($ctrlDeleteAllEventsBtn) {
  $ctrlDeleteAllEventsBtn.addEventListener('click', () => {
    if (confirm('Tem a certeza que pretende reiniciar e apagar todos os palcos/eventos criados?')) {
      client.clearAllEvents();
      location.search = '?room=PALCO1&clean=1';
    }
  });
}

client.on('events-list-update', (list) => {
  renderEventSelector();
  renderDayTabs();
});

if ($roomCodeInput) {
  $roomCodeInput.value = (roomId || 'PALCO1').toUpperCase();
}

if ($joinRoomBtn && $roomCodeInput) {
  $joinRoomBtn.addEventListener('click', () => {
    const newRoom = $roomCodeInput.value.trim().toUpperCase() || 'PALCO1';
    location.search = `?room=${encodeURIComponent(newRoom)}`;
  });
  $roomCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $joinRoomBtn.click();
  });
}

if ($viewerBgColor) {
  $viewerBgColor.addEventListener('input', (e) => {
    client.updateTheme({ viewerBg: e.target.value });
  });
}

// ─── Connect ───────────────────────────────────────────────────────

client.on('connected', () => {
  $connectionBadge.className = 'connection-badge connected';
  $connectionBadge.innerHTML = '<span class="connection-dot"></span> Connected';
  renderEventSelector();
});

client.on('disconnected', () => {
  $connectionBadge.className = 'connection-badge disconnected';
  $connectionBadge.innerHTML = '<span class="connection-dot"></span> Disconnected';
});

client.on('p2p-ready', (data) => {
  if ($p2pStatusText) {
    $p2pStatusText.innerHTML = `<span style="color: var(--green);">● Online Ready</span> (Room: <strong>${(state?.id || roomId || 'PALCO1').toUpperCase()}</strong>)`;
  }
});

client.on('p2p-peers-update', (data) => {
  $connectionBadge.className = 'connection-badge connected';
  $connectionBadge.innerHTML = `<span class="connection-dot"></span> Online (${data.count} screen${data.count === 1 ? '' : 's'})`;
  if ($p2pPeerCount) {
    $p2pPeerCount.textContent = data.count;
  }
});

client.on('room-state', (data) => {
  state = data;

  if (state.theme?.viewerBg && $viewerBgColor) {
    $viewerBgColor.value = state.theme.viewerBg;
  }

  // Update room ID in URL if needed
  if (data.id && data.id !== roomId) {
    roomId = data.id;
    const url = new URL(location);
    url.searchParams.set('room', roomId);
    history.replaceState(null, '', url);
  }

  updateRoomInfo();
  renderTimers();
  renderPreview();
  renderMessageState();
  renderEventSelector();
});

renderEventSelector();
client.connect();

// ─── Helpers ───────────────────────────────────────────────────────

function updateLocalClock() {
  const el = document.getElementById('ctrl-local-clock');
  if (el) {
    el.textContent = StageTimerClient.getTrueTimeString();
  }
}
updateLocalClock();
setInterval(updateLocalClock, 1000);

function formatTime(ms) {
  return StageTimerClient.formatTime(ms);
}

function getTimerElapsed(timer) {
  return StageTimerClient.getTimerElapsed(timer);
}

function parseTimeInput(str) {
  str = (str || '').trim().toLowerCase();
  if (!str) return null;

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
      // H:MM (e.g. 1:30 = 1h30m, 2:15 = 2h15m, 0:45 = 45m)
      return (part1 * 3600 + part2 * 60) * 1000;
    }
    // MM:SS (e.g. 45:00 = 45m, 60:00 = 60m)
    return (part1 * 60 + part2) * 1000;
  }

  // 2. Shorthand with dot or comma: "1.3" or "1,3" -> 1h30m, "1.45" -> 1h45m, "0.3" -> 30m, "2.0" -> 2h
  const dotMatch = str.match(/^(\d+)[.,](\d{1,2})$/);
  if (dotMatch) {
    const hours = parseInt(dotMatch[1], 10);
    const minRaw = dotMatch[2];
    // Single digit (e.g. .3) means 30 minutes; two digits (e.g. .30, .45, .05) is literal minutes
    const mins = minRaw.length === 1 ? parseInt(minRaw, 10) * 10 : parseInt(minRaw, 10);
    return (hours * 3600 + mins * 60) * 1000;
  }

  // 3. Plain integer: ALWAYS minutes in stage/festival environment (e.g. 60 = 60m, 45 = 45m, 90 = 90m, 5 = 5m)
  if (/^\d+$/.test(str)) {
    const mins = parseInt(str, 10);
    return mins * 60000;
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
  if (total > 0) return total;

  return null;
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
  // countup
  return formatTime(elapsed);
}

function getTimerProgress(timer) {
  if (timer.mode !== 'countdown' || timer.duration === 0) return 0;
  const elapsed = getTimerElapsed(timer);
  return Math.min(1, elapsed / timer.duration);
}

function getEstimatedEndTime(timer) {
  if (!timer || !state) return '';
  return StageTimerClient.computeTimerEndTime(state, timer.id);
}

function getEventEndTime() {
  return StageTimerClient.computeEventEndTime(state);
}

let lastRenderedStructureSig = '';

function showToast(message) {
  $toast.textContent = message;
  $toast.classList.add('visible');
  setTimeout(() => $toast.classList.remove('visible'), 2000);
}

// ─── Update Room Info ──────────────────────────────────────────────

function updateRoomInfo() {
  if (!state) return;
  const code = (state.id || 'PALCO1').toUpperCase();
  $roomIdDisplay.textContent = code;
  if ($roomCodeInput && document.activeElement !== $roomCodeInput) {
    $roomCodeInput.value = code;
  }

  const basePath = location.pathname.substring(0, location.pathname.lastIndexOf('/'));
  const viewerUrl = `${basePath}/viewer.html?room=${encodeURIComponent(code)}`;
  const operatorUrl = `${basePath}/operator.html?room=${encodeURIComponent(code)}`;
  const controllerUrl = `${basePath}/controller.html?room=${encodeURIComponent(code)}`;
  $viewerLink.href = viewerUrl;
  $viewerLink.textContent = `viewer.html?room=${code}`;
  if ($viewerLinkBtn) $viewerLinkBtn.href = viewerUrl;
  $controllerLink.href = operatorUrl;
  $controllerLink.textContent = `operator.html?room=${code}`;

  updateTopNavLinks(code);
  renderEventSelector();
  renderDayTabs();
}

// ─── Render Timers ─────────────────────────────────────────────────

function renderTimers() {
  if (!state) return;

  const $ctrlEventEnd = document.getElementById('ctrl-event-end');
  if ($ctrlEventEnd) {
    $ctrlEventEnd.textContent = getEventEndTime();
  }

  if (state.timers.length === 0) {
    lastRenderedStructureSig = 'EMPTY';
    $timerList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⏱️</div>
        <div class="empty-state-text">No timers yet</div>
        <div class="empty-state-sub">Click "Add Timer" to get started</div>
      </div>
    `;
    return;
  }

  // Structural signature includes order of IDs, active timer, state, mode, and fields
  const structureSig = state.timers.map(t => `${t.id}:${t.name}:${t.notes || ''}:${t.id === state.activeTimerId}:${t.state}:${t.mode}:${t.startTime || ''}:${t.duration}`).join('|');

  // Never rebuild innerHTML on 100ms ticks if structure hasn't changed, or while editing/dragging
  const isEditing = document.activeElement && document.activeElement.matches('input, select, textarea');

  if (structureSig === lastRenderedStructureSig || isEditing || draggedId) {
    // Only update live display values in-place instead of blowing away innerHTML
    state.timers.forEach(timer => {
      const card = $timerList.querySelector(`[data-timer-id="${timer.id}"]`);
      if (card) {
        const display = card.querySelector('.timer-display');
        const color = getTimerColor(timer);
        if (display && document.activeElement !== display) {
          display.value = getTimerDisplayValue(timer);
          display.className = `timer-display timer-${color}`;
        }
        const endBadge = card.querySelector('.timer-end-badge');
        if (endBadge) {
          endBadge.textContent = `🏁 Fim previsto: ${getEstimatedEndTime(timer)}`;
        }
        const bar = card.querySelector('.timer-progress-bar');
        if (bar && timer.mode === 'countdown') {
          const progress = getTimerProgress(timer);
          bar.style.width = `${progress * 100}%`;
          bar.className = `timer-progress-bar ${color}`;
        }
      }
    });
    return;
  }

  lastRenderedStructureSig = structureSig;

  // Build HTML for each timer
  const html = state.timers.map((timer, idx) => {
    const color = getTimerColor(timer);
    const display = getTimerDisplayValue(timer);
    const progress = getTimerProgress(timer);
    const isActive = timer.id === state.activeTimerId;
    const isRunning = timer.state === 'running';
    const isFinished = timer.state === 'finished';
    const endTimeStr = getEstimatedEndTime(timer);

    const cardClasses = [
      'timer-card',
      isActive ? 'active' : '',
      isRunning ? 'running' : '',
      isFinished ? 'finished' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClasses}" data-timer-id="${timer.id}">
        <div class="timer-card-top">
          <span class="drag-handle" title="Arraste para reorganizar a ordem">⠿</span>
          <input
            class="timer-name-input"
            value="${escapeHtml(timer.name)}"
            data-timer-id="${timer.id}"
            data-field="name"
            spellcheck="false"
          />
          <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
            <button
              class="btn btn-sm btn-success timer-fire-direct-btn"
              data-action="fire-direct"
              data-timer-id="${timer.id}"
              title="Disparar direto: coloca no ar e arranca imediatamente o contador"
              style="font-weight: 800; padding: 4px 10px; box-shadow: 0 2px 6px rgba(0, 184, 148, 0.4);"
            >
              🚀 Disparar
            </button>
            <button
              class="btn btn-sm timer-active-btn ${isActive ? 'is-active' : ''}"
              data-action="set-active"
              data-timer-id="${timer.id}"
              title="Colocar como timer ativo no palco (sem arrancar)"
            >
              ${isActive ? '● NO AR' : 'SET LIVE'}
            </button>
          </div>
        </div>

        <div class="timer-card-middle">
          <input
            class="timer-display timer-${color}"
            value="${display}"
            data-timer-id="${timer.id}"
            data-field="duration"
            ${timer.mode === 'clock' ? 'readonly' : ''}
            title="${timer.mode === 'clock' ? 'Hora Atual (Modo Relógio)' : 'Duração / Contagem (ex: 60 = 60m, 1.3 = 1h30m, 45, 1:30)'}"
            spellcheck="false"
          />
          <div class="timer-meta">
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
              <select class="input timer-mode-select" data-timer-id="${timer.id}" data-field="mode">
                <option value="countdown" ${timer.mode === 'countdown' ? 'selected' : ''}>⏬ Countdown</option>
                <option value="countup" ${timer.mode === 'countup' ? 'selected' : ''}>⏫ Count Up</option>
                <option value="clock" ${timer.mode === 'clock' ? 'selected' : ''}>🕐 Clock</option>
              </select>
              ${timer.mode !== 'clock' ? `
                <span class="timer-end-badge" title="Hora prevista de término">🏁 Fim previsto: ${endTimeStr}</span>
              ` : ''}
            </div>
            ${timer.mode !== 'clock' ? `
              <div class="timer-duration-row" style="flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px;">
                <span style="font-size: 0.75rem; color: var(--text-secondary);">Duração:</span>
                <input
                  class="input input-mono timer-duration-input"
                  style="width: 78px; padding: 2px 6px; font-size: 0.8rem; text-align: center;"
                  value="${formatTime(timer.duration)}"
                  data-timer-id="${timer.id}"
                  data-field="duration"
                  title="Editar duração total (ex: 60 = 60m, 1.3 = 1h30m, 45, 1:30)"
                  spellcheck="false"
                />
                <span style="font-size: 0.75rem; color: var(--text-secondary);">Horário:</span>
                <input
                  class="input input-mono timer-duration-input"
                  style="width: 125px; padding: 2px 6px; font-size: 0.8rem; text-align: center;"
                  placeholder="23:00 – 00:15"
                  value="${escapeHtml(timer.startTime || '')}"
                  data-timer-id="${timer.id}"
                  data-field="startTime"
                  title="Horário programado (ex: 21:00 ou 21:00 – 22:30)"
                  spellcheck="false"
                />
              </div>
            ` : ''}
          </div>
        </div>

        <div class="timer-card-notes" style="margin-bottom: 10px;">
          <input
            class="input timer-notes-input"
            style="width: 100%; font-size: 0.8rem; padding: 6px 10px;"
            placeholder="📝 Notas de palco para este artista (aparece debaixo do relógio)..."
            value="${escapeHtml(timer.notes || '')}"
            data-timer-id="${timer.id}"
            data-field="notes"
          />
        </div>

        <div class="timer-card-bottom">
          <div class="timer-controls">
            <button class="btn btn-icon btn-sm ${isRunning ? 'btn-success' : ''}" data-action="toggle" data-timer-id="${timer.id}" title="${isRunning ? 'Pause' : 'Start'}">
              ${isRunning ? '⏸' : '▶'}
            </button>
            <button class="btn btn-icon btn-sm" data-action="reset" data-timer-id="${timer.id}" title="Reset">
              ⏹
            </button>
            <button class="btn btn-sm" data-action="minus1m" data-timer-id="${timer.id}" title="Retirar 1 minuto (atualiza seguintes)" style="padding: 2px 7px; font-size: 0.72rem;">-1m</button>
            <button class="btn btn-sm" data-action="plus1m" data-timer-id="${timer.id}" title="Adicionar 1 minuto (atualiza seguintes)" style="padding: 2px 7px; font-size: 0.72rem;">+1m</button>
            <button class="btn btn-sm" data-action="plus5m" data-timer-id="${timer.id}" title="Adicionar 5 minutos (atualiza seguintes)" style="padding: 2px 7px; font-size: 0.72rem;">+5m</button>
          </div>
          <div class="timer-settings">
            <button class="btn btn-icon btn-sm" data-action="move-up" data-timer-id="${timer.id}" title="Mover para cima" ${idx === 0 ? 'disabled style="opacity:0.35"' : ''}>
              ↑
            </button>
            <button class="btn btn-icon btn-sm" data-action="move-down" data-timer-id="${timer.id}" title="Mover para baixo" ${idx === state.timers.length - 1 ? 'disabled style="opacity:0.35"' : ''}>
              ↓
            </button>
            <button class="btn btn-icon btn-sm" data-action="edit" data-timer-id="${timer.id}" title="Edit warnings">
              ⚙️
            </button>
            <button class="btn btn-icon btn-sm btn-danger" data-action="delete" data-timer-id="${timer.id}" title="Delete">
              🗑️
            </button>
          </div>
        </div>

        ${timer.mode === 'countdown' ? `
          <div class="timer-progress">
            <div class="timer-progress-bar ${color}" style="width: ${progress * 100}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  $timerList.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Render Preview ────────────────────────────────────────────────

function renderPreview() {
  if (!state) return;

  const activeTimer = state.timers.find(t => t.id === state.activeTimerId);
  const previewFrame = document.querySelector('.preview-frame');
  if (previewFrame && state.theme?.viewerBg) {
    previewFrame.style.backgroundColor = state.theme.viewerBg;
  }

  if (!activeTimer) {
    $previewName.textContent = '';
    $previewDisplay.textContent = '--:--';
    $previewDisplay.className = 'preview-timer-display';
    return;
  }

  const color = getTimerColor(activeTimer);
  const display = getTimerDisplayValue(activeTimer);

  $previewName.textContent = activeTimer.name;
  $previewDisplay.textContent = display;
  $previewDisplay.className = `preview-timer-display timer-${color}`;

  const $previewEndTime = document.getElementById('preview-endtime');
  if ($previewEndTime) {
    const endStr = getEstimatedEndTime(activeTimer);
    const evEnd = getEventEndTime();
    $previewEndTime.textContent = endStr ? `🏁 Fim artista: ${endStr}  |  🏁 Fim Evento: ${evEnd}` : '';
  }

  const $previewNotes = document.getElementById('preview-notes');
  if ($previewNotes) {
    $previewNotes.textContent = activeTimer.notes || '';
  }

  const $previewNext = document.getElementById('preview-next');
  if ($previewNext) {
    const idx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const nextTimer = idx >= 0 ? state.timers[idx + 1] : null;
    $previewNext.textContent = nextTimer ? `NEXT: ${nextTimer.name}` : '';
  }

  const $ctrlPrevToggle = document.getElementById('ctrl-preview-toggle');
  if ($ctrlPrevToggle) {
    if (activeTimer.state === 'running') {
      $ctrlPrevToggle.textContent = '⏸ Pausar';
      $ctrlPrevToggle.classList.remove('btn-primary');
      $ctrlPrevToggle.classList.add('btn-warning');
    } else {
      $ctrlPrevToggle.textContent = '▶ Iniciar';
      $ctrlPrevToggle.classList.add('btn-primary');
      $ctrlPrevToggle.classList.remove('btn-warning');
    }
  }
}

// ─── Render Message State ──────────────────────────────────────────

function renderMessageState() {
  if (!state) return;

  const isVisible = !!(state.message?.visible && state.message?.text);

  if (isVisible) {
    $previewMessage.textContent = state.message.text;
    $previewMessage.style.background = state.message.level === 'urgent' ? 'rgba(145, 20, 28, 0.95)' : 'rgba(15, 23, 42, 0.9)';
    $previewMessage.classList.add('visible');
  } else {
    $previewMessage.classList.remove('visible');
  }

  if ($toggleMsgBtn) {
    if (isVisible) {
      $toggleMsgBtn.innerHTML = '🙈 Ocultar';
      $toggleMsgBtn.style.background = '#d63031';
      $toggleMsgBtn.style.borderColor = '#d63031';
      $toggleMsgBtn.style.color = '#fff';
      $toggleMsgBtn.title = 'A mensagem está visível no palco. Clique para ocultar.';
    } else {
      $toggleMsgBtn.innerHTML = '👁️ Mostrar';
      $toggleMsgBtn.style.background = 'rgba(0, 184, 148, 0.2)';
      $toggleMsgBtn.style.borderColor = '#00b894';
      $toggleMsgBtn.style.color = '#55efc4';
      $toggleMsgBtn.title = 'A mensagem está oculta. Clique para mostrar no palco.';
    }
  }

  if ($messageInput && !$messageInput.value && state.message?.text && document.activeElement !== $messageInput) {
    $messageInput.value = state.message.text;
  }
}

// ─── Event Delegation ──────────────────────────────────────────────

// Timer list clicks
$timerList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const timerId = btn.dataset.timerId;

  switch (action) {
    case 'toggle':
      client.timerAction(timerId, 'toggle');
      break;
    case 'reset':
      client.timerAction(timerId, 'reset');
      break;
    case 'minus1m':
      client.adjustTime(timerId, -60000);
      break;
    case 'plus1m':
      client.adjustTime(timerId, 60000);
      break;
    case 'plus5m':
      client.adjustTime(timerId, 300000);
      break;
    case 'fire-direct':
      client.timerAction(timerId, 'start');
      break;
    case 'set-active':
      client.setActiveTimer(timerId);
      break;
    case 'delete':
      if (confirm('Delete this timer?')) {
        client.deleteTimer(timerId);
      }
      break;
    case 'edit':
      openEditModal(timerId);
      break;
    case 'move-up': {
      const order = state.timers.map(t => t.id);
      const idx = order.indexOf(timerId);
      if (idx > 0) {
        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        client.reorderTimers(order);
      }
      break;
    }
    case 'move-down': {
      const order = state.timers.map(t => t.id);
      const idx = order.indexOf(timerId);
      if (idx >= 0 && idx < order.length - 1) {
        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
        client.reorderTimers(order);
      }
      break;
    }
  }
});

// Display editing handlers (prevents live countdown from overwriting total duration on blur)
$timerList.addEventListener('focusin', (e) => {
  const input = e.target;
  if (input.classList.contains('timer-display') && input.dataset.timerId) {
    const t = state?.timers?.find(item => item.id === input.dataset.timerId);
    if (t && t.mode !== 'clock') {
      input.dataset.editing = 'true';
      input.value = formatTime(t.duration);
      input.select();
    }
  }
});

$timerList.addEventListener('focusout', (e) => {
  const input = e.target;
  if (input.classList.contains('timer-display') && input.dataset.timerId) {
    input.dataset.editing = 'false';
    const t = state?.timers?.find(item => item.id === input.dataset.timerId);
    if (t) {
      input.value = getTimerDisplayValue(t);
    }
  }
});

// Timer field editing
$timerList.addEventListener('change', (e) => {
  const input = e.target;
  const timerId = input.dataset.timerId;
  const field = input.dataset.field;
  if (!timerId || !field) return;

  if (field === 'name') {
    client.updateTimer(timerId, { name: input.value });
  } else if (field === 'notes') {
    client.updateTimer(timerId, { notes: input.value });
  } else if (field === 'startTime') {
    client.updateTimer(timerId, { startTime: input.value });
  } else if (field === 'mode') {
    client.updateTimer(timerId, { mode: input.value });
  } else if (field === 'duration') {
    const ms = parseTimeInput(input.value);
    const t = state?.timers?.find(item => item.id === timerId);
    if (ms && ms > 0 && t && ms !== t.duration) {
      client.updateTimer(timerId, { duration: ms });
    }
  }
});

// Live update notes while typing
$timerList.addEventListener('input', (e) => {
  const input = e.target;
  if (input.dataset?.field === 'notes' && input.dataset?.timerId) {
    client.updateTimer(input.dataset.timerId, { notes: input.value });
  }
});

// Prevent Enter from unfocusing name/duration input
$timerList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.timer-name-input, .timer-duration-input, .timer-display')) {
    e.target.blur();
  }
});

// Add Timer
$addTimerBtn.addEventListener('click', () => {
  client.createTimer({
    name: 'New Timer',
    mode: 'countdown',
    duration: 300000,
  });
});

const $clearEventBtn = document.getElementById('clear-event-btn');
if ($clearEventBtn) {
  $clearEventBtn.addEventListener('click', () => {
    if (confirm('🧹 Limpar todos os artistas do dia atual?')) {
      client.clearAllTimers();
      showToast('✓ Dia limpo com sucesso.');
    }
  });
}

// Global controls (removed from UI, guarded for backwards safety)
if ($globalStart) $globalStart.addEventListener('click', () => client.globalAction('start'));
if ($globalPause) $globalPause.addEventListener('click', () => client.globalAction('pause'));
if ($globalReset) $globalReset.addEventListener('click', () => client.globalAction('reset'));

// Message controls (Info vs Urgent vs Toggle Visibility)
if ($sendInfoBtn) {
  $sendInfoBtn.addEventListener('click', () => {
    const text = $messageInput ? $messageInput.value.trim() : '';
    if (text) {
      client.sendMessage(text, true, 'info');
    } else if ($messageInput) {
      $messageInput.focus();
    }
  });
}

if ($sendUrgentBtn) {
  $sendUrgentBtn.addEventListener('click', () => {
    const text = $messageInput ? $messageInput.value.trim() : '';
    if (text) {
      client.sendMessage(text, true, 'urgent');
    } else if ($messageInput) {
      $messageInput.focus();
    }
  });
}

if ($toggleMsgBtn) {
  $toggleMsgBtn.addEventListener('click', () => {
    const isCurrentlyVisible = !!(state?.message?.visible && state?.message?.text);
    const inputTxt = $messageInput ? $messageInput.value.trim() : '';
    const currentText = inputTxt || (state?.message?.text || '').trim();

    if (isCurrentlyVisible) {
      // Ocultar mensagem do palco sem apagar o texto guardado
      client.sendMessage(currentText, false, state?.message?.level || 'info');
      showToast('Mensagem ocultada do palco');
    } else {
      // Mostrar mensagem no palco
      if (!currentText) {
        if ($messageInput) $messageInput.focus();
        showToast('Escreva uma mensagem primeiro');
        return;
      }
      client.sendMessage(currentText, true, state?.message?.level || 'info');
      showToast('Mensagem enviada para o palco');
    }
  });
}

// Send message on Ctrl+Enter (defaults to Info)
$messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    if ($sendInfoBtn) $sendInfoBtn.click();
  }
});

// Copy room ID
$roomIdDisplay.addEventListener('click', () => {
  navigator.clipboard?.writeText(roomId).then(() => {
    showToast('Room ID copied!');
  });
});

// ─── Drag & Drop ───────────────────────────────────────────────────

// Disable card draggable when pressing inside an input/select so user can select text normally
$timerList.addEventListener('mousedown', (e) => {
  const card = e.target.closest('.timer-card');
  if (!card) return;
  if (e.target.matches('input, select, textarea, button')) {
    card.setAttribute('draggable', 'false');
  } else {
    card.setAttribute('draggable', 'true');
  }
});

$timerList.addEventListener('mouseup', (e) => {
  const card = e.target.closest('.timer-card');
  if (card) card.removeAttribute('draggable');
});

$timerList.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.timer-card');
  if (!card) return;
  draggedId = card.dataset.timerId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', draggedId);
  } catch (_) {}
});

$timerList.addEventListener('dragend', () => {
  $timerList.querySelectorAll('.timer-card').forEach(c => {
    c.classList.remove('dragging', 'drag-over');
    c.removeAttribute('draggable');
  });
  draggedId = null;
});

$timerList.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.target.closest('.timer-card');
  $timerList.querySelectorAll('.timer-card').forEach(c => {
    c.classList.toggle('drag-over', c === target && c.dataset.timerId !== draggedId);
  });
});

$timerList.addEventListener('dragleave', (e) => {
  const target = e.target.closest('.timer-card');
  if (target && !target.contains(e.relatedTarget)) {
    target.classList.remove('drag-over');
  }
});

$timerList.addEventListener('drop', (e) => {
  e.preventDefault();
  $timerList.querySelectorAll('.timer-card').forEach(c => c.classList.remove('drag-over', 'dragging'));
  if (!draggedId || !state) return;

  const target = e.target.closest('.timer-card');
  const currentDraggedId = draggedId;
  draggedId = null;

  if (!target || target.dataset.timerId === currentDraggedId) return;

  const order = state.timers.map(t => t.id);
  const fromIdx = order.indexOf(currentDraggedId);
  const toIdx = order.indexOf(target.dataset.timerId);
  if (fromIdx === -1 || toIdx === -1) return;

  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, currentDraggedId);

  client.reorderTimers(order);
});

// ─── Edit Timer Modal ──────────────────────────────────────────────

const $modal = document.getElementById('edit-modal');
const $modalTimerId = document.getElementById('modal-timer-id');
const $modalWarnAt = document.getElementById('modal-warn-at');
const $modalDangerAt = document.getElementById('modal-danger-at');
const $modalSave = document.getElementById('modal-save');
const $modalCancel = document.getElementById('modal-cancel');

function openEditModal(timerId) {
  const timer = state?.timers.find(t => t.id === timerId);
  if (!timer) return;

  $modalTimerId.value = timerId;
  $modalWarnAt.value = formatTime(timer.warnAt);
  $modalDangerAt.value = formatTime(timer.dangerAt);

  $modal.classList.add('visible');
}

$modalSave.addEventListener('click', () => {
  const timerId = $modalTimerId.value;
  const warnAt = parseTimeInput($modalWarnAt.value);
  const dangerAt = parseTimeInput($modalDangerAt.value);

  if (warnAt != null && dangerAt != null) {
    client.updateTimer(timerId, { warnAt, dangerAt });
  }

  $modal.classList.remove('visible');
});

$modalCancel.addEventListener('click', () => {
  $modal.classList.remove('visible');
});

$modal.addEventListener('click', (e) => {
  if (e.target === $modal) {
    $modal.classList.remove('visible');
  }
});

// ─── Smart Schedule Importer Modal (PDF / Excel / CSV / Text) ──────

const $openImportBtn = document.getElementById('open-import-btn');
const $importModal = document.getElementById('import-modal');
const $importDropZone = document.getElementById('import-drop-zone');
const $importIncludeSoundchecks = document.getElementById('import-include-soundchecks');
const $importIncludeChangeovers = document.getElementById('import-include-changeovers');
const $importFileInput = document.getElementById('import-file-input');
const $importPageSelector = document.getElementById('import-page-selector');
const $importPageSelect = document.getElementById('import-page-select');
const $importTextArea = document.getElementById('import-text-area');
const $importPreviewBox = document.getElementById('import-preview-box');
const $importConfirm = document.getElementById('import-confirm');
const $importCancel = document.getElementById('import-cancel');

let rawExtractedData = null;
let currentSchedule = null;

function getImportOptions() {
  return {
    includeSoundchecks: $importIncludeSoundchecks ? $importIncludeSoundchecks.checked : true,
    includeChangeovers: $importIncludeChangeovers ? $importIncludeChangeovers.checked : true
  };
}

function formatTimerBadge(name) {
  if (name.includes('(Soundcheck)')) {
    return `<span style="display: inline-block; padding: 1px 5px; font-size: 0.65rem; border-radius: 4px; background: rgba(253, 203, 110, 0.2); color: #ffeaa7; margin-right: 4px; border: 1px solid rgba(253, 203, 110, 0.4);">Soundcheck</span>`;
  }
  if (name.includes('(Changeover)')) {
    return `<span style="display: inline-block; padding: 1px 5px; font-size: 0.65rem; border-radius: 4px; background: rgba(9, 132, 227, 0.2); color: #74b9ff; margin-right: 4px; border: 1px solid rgba(9, 132, 227, 0.4);">Changeover</span>`;
  }
  return `<span style="display: inline-block; padding: 1px 5px; font-size: 0.65rem; border-radius: 4px; background: rgba(0, 184, 148, 0.2); color: #55efc4; margin-right: 4px; border: 1px solid rgba(0, 184, 148, 0.4);">Atuação Palco</span>`;
}

function formatScheduleSummaryText(sched) {
  if (!sched || !sched.days) return '';
  const dayKeys = Object.keys(sched.days).sort((a, b) => Number(a) - Number(b));
  return dayKeys.map(k => {
    const title = sched.dayTitles[k] || `Dia ${k}`;
    const timers = sched.days[k] || [];
    const lines = timers.map(t => `${t.name.padEnd(28, ' ')} ${t.startTime}`);
    return `=== ${title.toUpperCase()} ===\n${lines.join('\n')}`;
  }).join('\n\n');
}

function updateImportPreview() {
  if (!$importTextArea || !$importPreviewBox) return;
  const text = $importTextArea.value.trim();
  if (!text) {
    $importPreviewBox.style.display = 'none';
    return;
  }

  const opts = getImportOptions();
  let sched = null;
  if (currentSchedule && currentSchedule.isMultiDay && $importPageSelect && $importPageSelect.value === 'all_days') {
    sched = currentSchedule;
  } else {
    sched = ScheduleImporter.parseMultiDaySchedule(text, opts);
  }

  if (sched.totalTimers === 0) {
    $importPreviewBox.style.display = 'block';
    $importPreviewBox.innerHTML = `
      <div style="color: #fab1a0; font-size: 0.78rem;">
        ⚠️ Não foram detetados artistas com horários válidos. Certifique-se de que cada linha tem um artista e horário (ex: <em>23h00 - 00h15</em> ou <em>23:00</em>).
      </div>
    `;
    return;
  }

  $importPreviewBox.style.display = 'block';
  if (sched.isMultiDay) {
    const dayKeys = Object.keys(sched.days).sort((a, b) => Number(a) - Number(b));
    $importPreviewBox.innerHTML = `
      <div style="color: var(--green); font-weight: 700; margin-bottom: 8px; font-size: 0.82rem; display: flex; align-items: center; justify-content: space-between;">
        <span>✓ Detetados ${sched.totalDays} Dias (${sched.totalTimers} entradas no total):</span>
        <span style="font-size: 0.72rem; color: #a29bfe; font-weight: 500;">Cronologia de festival</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${dayKeys.map(k => {
          const list = sched.days[k];
          const lines = list.map(t => `<div style="margin: 2px 0;">${formatTimerBadge(t.name)}<strong>${escapeHtml(t.name)}</strong> (${escapeHtml(t.startTime)}) — <span style="color: #81ecec;">${formatTime(t.duration)}</span></div>`).join('');
          return `
            <div style="background: rgba(255,255,255,0.05); padding: 7px 10px; border-radius: 6px; border-left: 3px solid var(--accent);">
              <div style="font-weight: 700; color: #fdcb6e; font-size: 0.78rem; margin-bottom: 4px;">
                📅 ${escapeHtml(sched.dayTitles[k] || 'Dia ' + k)} (${list.length} itens)
              </div>
              <div style="font-size: 0.72rem; color: #cbd5e1; line-height: 1.5;">${lines}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    const timers = sched.days['1'] || [];
    $importPreviewBox.innerHTML = `
      <div style="color: var(--green); font-weight: 700; margin-bottom: 6px; font-size: 0.82rem;">
        ✓ ${timers.length} Entrada(s) detetada(s) (ordenadas cronologicamente):
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        ${timers.map((t, i) => `
          <div style="font-size: 0.74rem; color: #e2e8f0;">
            ${formatTimerBadge(t.name)}<strong>${escapeHtml(t.name)}</strong> (${escapeHtml(t.startTime)}) — <span style="color: #81ecec;">${formatTime(t.duration)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
}

async function handleProcessImportFile(file) {
  if (!file) return;
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      rawExtractedData = await ScheduleImporter.extractPdfPages(file);
    } else {
      rawExtractedData = await ScheduleImporter.extractSpreadsheetOrText(file);
    }

    const opts = getImportOptions();
    currentSchedule = ScheduleImporter.parseMultiDaySchedule(rawExtractedData, opts);

    if (currentSchedule.isMultiDay) {
      if ($importPageSelector) $importPageSelector.style.display = 'block';
      const dayKeys = Object.keys(currentSchedule.days).sort((a, b) => Number(a) - Number(b));
      if ($importPageSelect) {
        $importPageSelect.innerHTML =
          `<option value="all_days">🌟 Todos os Dias (${currentSchedule.totalDays} dias / ${currentSchedule.totalTimers} artistas)</option>` +
          dayKeys.map(k => {
            const count = currentSchedule.days[k].length;
            const title = currentSchedule.dayTitles[k] || `Dia ${k}`;
            return `<option value="${k}">Apenas ${escapeHtml(title)} (${count} artistas)</option>`;
          }).join('');
        $importPageSelect.value = 'all_days';
      }
      $importTextArea.value = formatScheduleSummaryText(currentSchedule);
    } else {
      if ($importPageSelector) $importPageSelector.style.display = 'none';
      const singleText = Array.isArray(rawExtractedData) ? (rawExtractedData[0] || '') : (rawExtractedData.pages ? rawExtractedData.pages[0] : '');
      $importTextArea.value = singleText;
    }

    updateImportPreview();
  } catch (err) {
    alert('Erro ao processar ficheiro: ' + err.message);
  }
}

if ($importDropZone && $importFileInput) {
  $importDropZone.addEventListener('click', (e) => {
    if (e.target !== $importFileInput) {
      $importFileInput.click();
    }
  });

  $importDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $importDropZone.style.borderColor = 'var(--green)';
    $importDropZone.style.background = 'rgba(0, 184, 148, 0.16)';
  });

  $importDropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $importDropZone.style.borderColor = 'rgba(108, 92, 231, 0.6)';
    $importDropZone.style.background = 'rgba(108, 92, 231, 0.08)';
  });

  $importDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $importDropZone.style.borderColor = 'rgba(108, 92, 231, 0.6)';
    $importDropZone.style.background = 'rgba(108, 92, 231, 0.08)';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleProcessImportFile(file);
  });
}

if ($importFileInput) {
  $importFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleProcessImportFile(file);
  });
}

function handleImportOptionsChanged() {
  const opts = getImportOptions();
  if (rawExtractedData) {
    currentSchedule = ScheduleImporter.parseMultiDaySchedule(rawExtractedData, opts);
    if (currentSchedule.isMultiDay && $importPageSelect && $importPageSelect.value === 'all_days') {
      $importTextArea.value = formatScheduleSummaryText(currentSchedule);
    }
  }
  updateImportPreview();
}

if ($importIncludeSoundchecks) {
  $importIncludeSoundchecks.addEventListener('change', handleImportOptionsChanged);
}

if ($importIncludeChangeovers) {
  $importIncludeChangeovers.addEventListener('change', handleImportOptionsChanged);
}

if ($openImportBtn && $importModal) {
  $openImportBtn.addEventListener('click', () => {
    $importModal.classList.add('visible');
  });
}

if ($importCancel && $importModal) {
  $importCancel.addEventListener('click', () => {
    $importModal.classList.remove('visible');
  });
  $importModal.addEventListener('click', (e) => {
    if (e.target === $importModal) $importModal.classList.remove('visible');
  });
}

if ($importTextArea) {
  $importTextArea.addEventListener('input', updateImportPreview);
}

if ($importPageSelect) {
  $importPageSelect.addEventListener('change', () => {
    if (!currentSchedule) return;
    const val = $importPageSelect.value;
    if (val === 'all_days') {
      $importTextArea.value = formatScheduleSummaryText(currentSchedule);
    } else {
      const dKey = String(val);
      const dTimers = currentSchedule.days[dKey] || [];
      if (dTimers.length > 0) {
        $importTextArea.value = dTimers.map(t => `${t.name.padEnd(24, ' ')} ${t.startTime}`).join('\n');
      } else {
        const idx = parseInt(val, 10) - 1;
        const pageList = Array.isArray(rawExtractedData) ? rawExtractedData : (rawExtractedData?.pages || []);
        $importTextArea.value = pageList[idx] || '';
      }
    }
    updateImportPreview();
  });
}

if ($importConfirm) {
  $importConfirm.addEventListener('click', () => {
    const opts = getImportOptions();
    let sched = null;
    if (currentSchedule && currentSchedule.isMultiDay && $importPageSelect && $importPageSelect.value === 'all_days') {
      sched = currentSchedule;
    } else {
      sched = ScheduleImporter.parseMultiDaySchedule($importTextArea.value, opts);
    }

    if (sched.totalTimers === 0) {
      alert('Nenhum artista com horário (ex: 23h00 - 00h15 ou 23:00) foi encontrado no texto.');
      return;
    }

    if ($importPageSelect && $importPageSelect.value !== 'all_days' && $importPageSelect.value) {
      // Single day chosen
      const dayNum = parseInt($importPageSelect.value, 10) || 1;
      const dayTimers = (currentSchedule && currentSchedule.days[String(dayNum)]) || sched.days[String(dayNum)] || sched.days['1'] || [];
      if (dayTimers.length === 0) {
        alert('Nenhum artista encontrado para o dia selecionado.');
        return;
      }
      client.replaceDayTimers(dayNum, dayTimers);
      $importModal.classList.remove('visible');
      showToast(`✓ Dia ${dayNum} atualizado com ${dayTimers.length} artistas!`);
    } else if (sched.isMultiDay) {
      // Import all days at once
      client.replaceAllDays(sched.days);
      $importModal.classList.remove('visible');
      showToast(`✓ ${sched.totalDays} dias e ${sched.totalTimers} artistas importados com sucesso!`);
    } else {
      // Single day import
      const singleTimers = sched.days['1'] || [];
      client.replaceAllTimers(singleTimers);
      $importModal.classList.remove('visible');
      showToast(`✓ ${singleTimers.length} artistas importados com sucesso!`);
    }
  });
}

// ─── Keyboard Shortcuts ────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Don't handle when typing in inputs
  if (e.target.matches('input, textarea, select')) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      // Toggle active timer
      if (state?.activeTimerId) {
        client.timerAction(state.activeTimerId, 'toggle');
      }
      break;
    case 'n':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        $addTimerBtn.click();
      }
      break;
    case 'Escape':
      $modal.classList.remove('visible');
      break;
    case 'ArrowLeft':
    case '[':
      e.preventDefault();
      stepControllerTimer(-1);
      break;
    case 'ArrowRight':
    case ']':
      e.preventDefault();
      stepControllerTimer(1);
      break;
  }
});

// ─── Step Navigation (Passar para trás / Passar para a frente) ───────

function stepControllerTimer(delta) {
  if (!state || !state.timers || state.timers.length === 0) return;
  const currentIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
  let targetIdx = 0;
  if (currentIdx === -1) {
    targetIdx = 0;
  } else {
    targetIdx = Math.max(0, Math.min(state.timers.length - 1, currentIdx + delta));
  }
  const target = state.timers[targetIdx];
  if (target && target.id !== state.activeTimerId) {
    client.setActiveTimer(target.id);
  }
}

const $ctrlNavPrev = document.getElementById('ctrl-nav-prev');
const $ctrlNavNext = document.getElementById('ctrl-nav-next');
const $ctrlPrevPrev = document.getElementById('ctrl-preview-prev');
const $ctrlPrevNext = document.getElementById('ctrl-preview-next');

if ($ctrlNavPrev) $ctrlNavPrev.addEventListener('click', () => stepControllerTimer(-1));
if ($ctrlNavNext) $ctrlNavNext.addEventListener('click', () => stepControllerTimer(1));
if ($ctrlPrevPrev) $ctrlPrevPrev.addEventListener('click', () => stepControllerTimer(-1));
if ($ctrlPrevNext) $ctrlPrevNext.addEventListener('click', () => stepControllerTimer(1));

const $ctrlPrevToggle = document.getElementById('ctrl-preview-toggle');
if ($ctrlPrevToggle) {
  $ctrlPrevToggle.addEventListener('click', () => {
    if (state?.activeTimerId) {
      client.timerAction(state.activeTimerId, 'toggle');
    }
  });
}

const $ctrlPrevReset = document.getElementById('ctrl-preview-reset');
if ($ctrlPrevReset) {
  $ctrlPrevReset.addEventListener('click', () => {
    if (state?.activeTimerId) {
      client.timerAction(state.activeTimerId, 'reset');
    }
  });
}
