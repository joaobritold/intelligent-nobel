/**
 * StageTimer Super Régie — Master Control Panel Logic (v12)
 * Dispositivos Remotos, Gestão Central de Palcos & Multiview
 * Rock-solid in-place DOM rendering (zero reflow trembling, stable device ordering)
 */

(function () {
  const masterClient = new StageTimerClient({
    role: 'master',
    room: 'PALCO1'
  });

  const $liveClock = document.getElementById('master-live-clock');
  const $kpiDevices = document.getElementById('kpi-devices-count');
  const $kpiEvents = document.getElementById('kpi-events-count');
  const $kpiRunning = document.getElementById('kpi-running-count');
  const $kpiCloud = document.getElementById('kpi-cloud-status');

  const $devicesList = document.getElementById('master-devices-list');
  const $eventsList = document.getElementById('master-events-list');
  const $multiviewGrid = document.getElementById('master-multiview-grid');

  const $newStageInput = document.getElementById('master-new-stage-input');
  const $createStageBtn = document.getElementById('master-create-stage-btn');
  const $wipeAllBtn = document.getElementById('master-wipe-all-btn');

  const $cmdAllViewer = document.getElementById('cmd-all-viewer');
  const $cmdAllLineup = document.getElementById('cmd-all-lineup');
  const $cmdAllReload = document.getElementById('cmd-all-reload');

  // Multi-room state store
  const stagesStateMap = new Map();

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function formatTime(ms) {
    const isNegative = ms < 0;
    const absMs = Math.abs(ms);
    const totalSecs = Math.floor(absMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const sign = isNegative ? '-' : '';

    if (hours > 0) {
      return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${sign}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // ─── Live Master Clock ─────────────────────────────────────────────

  function updateMasterClock() {
    if (!$liveClock) return;
    const now = new Date();
    $liveClock.textContent = now.toLocaleTimeString('pt-PT', { hour12: false });
  }
  setInterval(updateMasterClock, 1000);
  updateMasterClock();

  // ─── Cloud & Peer Status ───────────────────────────────────────────

  masterClient.on('connected', () => {
    if ($kpiCloud) {
      $kpiCloud.textContent = '🟢 Online (WSS)';
      $kpiCloud.style.color = '#55efc4';
    }
  });

  masterClient.on('disconnected', () => {
    if ($kpiCloud) {
      $kpiCloud.textContent = '🔴 Offline';
      $kpiCloud.style.color = '#ff7675';
    }
  });

  // ─── Section 1: Dispositivos Online & Controlo Remoto ──────────────

  function renderDevicesList(devices = masterClient.getOnlineDevices()) {
    if (!$devicesList) return;
    if ($kpiDevices) $kpiDevices.textContent = devices.length;

    if (devices.length === 0) {
      $devicesList.innerHTML = `
        <div class="empty-state-box" style="grid-column: 1 / -1;">
          Nenhum dispositivo detetado neste momento.<br>
          <span style="font-size: 0.8rem; color: var(--text-muted);">
            Abra o StageTimer em qualquer telemóvel, computador ou telão para que apareça aqui instantaneamente.
          </span>
        </div>
      `;
      return;
    }

    const emptyBox = $devicesList.querySelector('.empty-state-box');
    if (emptyBox) emptyBox.remove();

    const eventsList = masterClient.getEventsList();
    const now = Date.now();
    const activeUuids = new Set(devices.map(d => d.deviceUuid));

    // Remove any card whose device has disconnected
    const currentCards = Array.from($devicesList.querySelectorAll('[data-device-uuid]'));
    currentCards.forEach(card => {
      const id = card.dataset.deviceUuid;
      if (!activeUuids.has(id)) {
        card.remove();
      }
    });

    // In-place update or append without altering container innerHTML
    devices.forEach((dev) => {
      const isSelf = dev.deviceUuid === masterClient.deviceUuid;
      const secondsAgo = Math.max(0, Math.round((now - (dev.lastSeen || dev.ts || now)) / 1000));
      const seenLabel = secondsAgo <= 2 ? 'Agora mesmo' : `há ${secondsAgo}s`;

      let card = $devicesList.querySelector(`[data-device-uuid="${CSS.escape(dev.deviceUuid)}"]`);

      if (!card) {
        // Create new device card
        card = document.createElement('div');
        card.className = `device-card ${isSelf ? 'self-device' : ''}`;
        card.dataset.deviceUuid = dev.deviceUuid;
        card.dataset.deviceRoom = dev.room || 'PALCO1';

        const roomOptions = eventsList.map(e => `
          <option value="${escapeHtml(e.code)}" ${e.code === dev.room ? 'selected' : ''}>
            ${escapeHtml(e.title || e.code)} (${escapeHtml(e.code)})
          </option>
        `).join('');

        card.innerHTML = `
          <div class="device-header">
            <div class="device-main-info">
              <div class="device-beacon"></div>
              <div>
                <div class="device-name">
                  ${escapeHtml(dev.label || 'Dispositivo')}
                  ${isSelf ? '<span style="font-size: 0.7rem; color: #a29bfe; font-weight: normal;">(Este ecrã)</span>' : ''}
                </div>
                <div class="device-uuid-tag">${escapeHtml(dev.deviceUuid)}</div>
              </div>
            </div>
            <div class="device-seen-text" style="font-size: 0.72rem; color: var(--text-secondary); text-align: right;">
              ${seenLabel}
            </div>
          </div>

          <div class="device-meta-row">
            <span class="device-room-pill">Palco: ${escapeHtml(dev.roomTitle || dev.room || 'PALCO1')}</span>
            <span class="device-view-pill">Vista: ${escapeHtml(dev.path || 'index.html')}</span>
          </div>

          <div class="device-actions-toolbar">
            <div class="device-actions-title">
              <span>Mudar Modo do Ecrã Remoto:</span>
            </div>
            <div class="device-btn-group">
              <button type="button" class="device-btn" data-cmd="viewer" title="Mudar este ecrã para Telão de Palco">
                📺 Palco
              </button>
              <button type="button" class="device-btn" data-cmd="lineup" title="Mudar este ecrã para Modo Lista Backstage">
                📋 Lista
              </button>
              <button type="button" class="device-btn" data-cmd="operator" title="Mudar este ecrã para Modo Operador Mobile">
                📱 Operador
              </button>
              <button type="button" class="device-btn" data-cmd="controller" title="Mudar este ecrã para Controlador Régie">
                🎛️ Régie
              </button>
              <button type="button" class="device-btn btn-warning-action" data-cmd="reload" title="Recarregar página no dispositivo">
                🔄 Recarregar
              </button>
            </div>

            <div class="device-room-switcher" style="margin-top: 4px;">
              <span style="font-size: 0.72rem; color: var(--text-secondary); white-space: nowrap;">Palco:</span>
              <select class="device-room-select" data-room-for-device="${escapeHtml(dev.deviceUuid)}">
                ${roomOptions}
              </select>
            </div>
          </div>
        `;

        $devicesList.appendChild(card);
      } else {
        // In-place update of dynamic values only
        card.dataset.deviceRoom = dev.room || 'PALCO1';

        const seenEl = card.querySelector('.device-seen-text');
        if (seenEl && seenEl.textContent.trim() !== seenLabel) seenEl.textContent = seenLabel;

        const roomPill = card.querySelector('.device-room-pill');
        const expectedRoomText = `Palco: ${dev.roomTitle || dev.room || 'PALCO1'}`;
        if (roomPill && roomPill.textContent !== expectedRoomText) roomPill.textContent = expectedRoomText;

        const viewPill = card.querySelector('.device-view-pill');
        const expectedViewText = `Vista: ${dev.path || 'index.html'}`;
        if (viewPill && viewPill.textContent !== expectedViewText) viewPill.textContent = expectedViewText;

        const select = card.querySelector('.device-room-select');
        if (select && document.activeElement !== select && select.value !== dev.room) {
          select.value = dev.room;
        }
      }
    });
  }

  masterClient.on('devices-update', (devices) => {
    renderDevicesList(devices);
  });

  // Device card actions delegation
  if ($devicesList) {
    $devicesList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      const card = btn.closest('[data-device-uuid]');
      if (!card) return;

      const uuid = card.dataset.deviceUuid;
      const room = card.dataset.deviceRoom || 'PALCO1';
      const cmd = btn.dataset.cmd;

      if (cmd === 'reload') {
        masterClient.sendDeviceCommand(uuid, { action: 'reload' });
      } else if (cmd === 'viewer') {
        masterClient.sendDeviceCommand(uuid, { action: 'navigate', url: `viewer.html?room=${encodeURIComponent(room)}` });
      } else if (cmd === 'lineup') {
        masterClient.sendDeviceCommand(uuid, { action: 'navigate', url: `lineup.html?room=${encodeURIComponent(room)}` });
      } else if (cmd === 'operator') {
        masterClient.sendDeviceCommand(uuid, { action: 'navigate', url: `operator.html?room=${encodeURIComponent(room)}` });
      } else if (cmd === 'controller') {
        masterClient.sendDeviceCommand(uuid, { action: 'navigate', url: `controller.html?room=${encodeURIComponent(room)}` });
      }
    });

    $devicesList.addEventListener('change', (e) => {
      const select = e.target.closest('[data-room-for-device]');
      if (!select) return;
      const uuid = select.dataset.roomForDevice;
      const targetRoom = select.value;
      if (uuid && targetRoom) {
        masterClient.sendDeviceCommand(uuid, { action: 'switch_room', room: targetRoom });
      }
    });
  }

  // Global Broadcast Buttons
  if ($cmdAllViewer) {
    $cmdAllViewer.addEventListener('click', () => {
      if (confirm('Mudar TODOS os dispositivos online para o Modo Palco (Telão)?')) {
        masterClient.sendDeviceCommand('ALL', { action: 'navigate', url: 'viewer.html' });
      }
    });
  }

  if ($cmdAllLineup) {
    $cmdAllLineup.addEventListener('click', () => {
      if (confirm('Mudar TODOS os dispositivos online para o Modo Lista?')) {
        masterClient.sendDeviceCommand('ALL', { action: 'navigate', url: 'lineup.html' });
      }
    });
  }

  if ($cmdAllReload) {
    $cmdAllReload.addEventListener('click', () => {
      if (confirm('Recarregar TODOS os ecrãs e dispositivos remotos agora?')) {
        masterClient.sendDeviceCommand('ALL', { action: 'reload' });
      }
    });
  }

  // ─── Section 2: Gestão Central de Palcos & Eventos ──────────────────

  function renderEventsManager() {
    if (!$eventsList) return;
    const events = masterClient.getEventsList();
    if ($kpiEvents) $kpiEvents.textContent = events.length;

    $eventsList.innerHTML = events.map(ev => {
      const count = typeof ev.timersCount === 'number' ? ev.timersCount : 0;
      const day = ev.currentDay || 1;

      return `
        <div class="event-manage-card" data-stage-code="${escapeHtml(ev.code)}">
          <div class="event-manage-top">
            <div>
              <div class="event-manage-title">${escapeHtml(ev.title || ev.code)}</div>
              <div class="event-manage-stats">
                ${count} artista(s) programado(s) • Dia ${day}
              </div>
            </div>
            <span class="event-manage-code">${escapeHtml(ev.code)}</span>
          </div>

          <div class="event-manage-btns">
            <a href="controller.html?room=${encodeURIComponent(ev.code)}" class="btn btn-sm btn-primary" title="Abrir controlador para este palco">
              🎛️ Régie
            </a>
            <a href="viewer.html?room=${encodeURIComponent(ev.code)}" target="_blank" class="btn btn-sm" title="Abrir telão noutro separador">
              📺 Telão
            </a>
            <a href="lineup.html?room=${encodeURIComponent(ev.code)}" target="_blank" class="btn btn-sm" title="Abrir lista noutro separador">
              📋 Lista
            </a>
            <button type="button" class="btn btn-sm" data-rename-stage="${escapeHtml(ev.code)}" title="Renomear este palco">
              ✏️
            </button>
            <button type="button" class="btn btn-sm btn-danger" data-delete-stage="${escapeHtml(ev.code)}" title="Apagar definitivamente este palco">
              🗑️ Apagar
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  masterClient.on('events-list-update', () => {
    renderEventsManager();
    renderDevicesList();
    renderMultiview();
  });

  if ($eventsList) {
    $eventsList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-delete-stage]');
      if (delBtn) {
        const code = delBtn.dataset.deleteStage;
        if (confirm(`Tem a certeza que pretende APAGAR o palco/evento "${code}"?\nEsta ação elimina todos os timers deste palco.`)) {
          masterClient.deleteEventFromRegistry(code);
          stagesStateMap.delete(code);
          renderEventsManager();
          renderMultiview();
        }
        return;
      }

      const renameBtn = e.target.closest('[data-rename-stage]');
      if (renameBtn) {
        const code = renameBtn.dataset.renameStage;
        const currentItem = masterClient.getEventsList().find(item => item.code === code);
        const newTitle = prompt('Novo nome para o palco/evento:', currentItem?.title || code);
        if (newTitle && newTitle.trim()) {
          masterClient.renameEvent(code, newTitle.trim());
          renderEventsManager();
          renderMultiview();
        }
      }
    });
  }

  if ($createStageBtn) {
    $createStageBtn.addEventListener('click', () => {
      let name = $newStageInput ? $newStageInput.value.trim() : '';
      if (!name) {
        const prompted = prompt('Nome do novo palco / evento (ex: Palco Sunset, Tenda Eletrónica):', '');
        if (prompted === null) return;
        name = prompted.trim() || `Palco ${masterClient.getEventsList().length + 1}`;
      }
      masterClient.createNewCleanEvent(name);
      if ($newStageInput) $newStageInput.value = '';
      renderEventsManager();
      renderMultiview();
    });
  }

  if ($newStageInput) {
    $newStageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && $createStageBtn) {
        e.preventDefault();
        $createStageBtn.click();
      }
    });
  }

  if ($wipeAllBtn) {
    $wipeAllBtn.addEventListener('click', () => {
      if (confirm('ATENÇÃO: Deseja apagar TODOS os eventos e repor a aplicação a zero?')) {
        if (confirm('Confirmação final: todos os dados de palcos existentes serão eliminados permanentemente.')) {
          masterClient.clearAllEvents();
          stagesStateMap.clear();
          renderEventsManager();
          renderMultiview();
          alert('Todos os palcos foram apagados. O sistema está agora 100% limpo com um Palco Principal vazio.');
        }
      }
    });
  }

  // ─── Section 3: Multiview Simultâneo dos Palcos ────────────────────

  // Pre-load states from localStorage for all registered events
  function preloadLocalStagesState() {
    const events = masterClient.getEventsList();
    events.forEach(ev => {
      try {
        const saved = localStorage.getItem(`stagetimer_live_state_${ev.code}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed.timers)) {
            stagesStateMap.set(ev.code, parsed);
          }
        }
      } catch (e) {}
    });
  }

  masterClient.on('multi-room-state', ({ room, data }) => {
    if (room && data) {
      stagesStateMap.set(room, data);
      renderMultiview();
    }
  });

  masterClient.on('multi-room-deleted', ({ room }) => {
    if (room) {
      stagesStateMap.delete(room);
      renderMultiview();
    }
  });

  function renderMultiview() {
    if (!$multiviewGrid) return;
    const events = masterClient.getEventsList();
    let runningCount = 0;

    if (events.length === 0) {
      $multiviewGrid.innerHTML = `
        <div class="empty-state-box" style="grid-column: 1 / -1;">
          Nenhum palco registado. Crie um novo palco acima.
        </div>
      `;
      if ($kpiRunning) $kpiRunning.textContent = '0';
      return;
    }

    const emptyBox = $multiviewGrid.querySelector('.empty-state-box');
    if (emptyBox) emptyBox.remove();

    const currentCodes = new Set(events.map(e => e.code));

    // Remove any card whose event was deleted
    const currentCards = Array.from($multiviewGrid.querySelectorAll('[data-mv-room]'));
    currentCards.forEach(card => {
      const code = card.dataset.mvRoom;
      if (!currentCodes.has(code)) {
        card.remove();
      }
    });

    events.forEach(ev => {
      const stageState = stagesStateMap.get(ev.code) || {
        id: ev.code,
        name: ev.title || ev.code,
        timers: [],
        activeTimerId: null
      };

      const activeTimer = stageState.timers?.find(t => t.id === stageState.activeTimerId) || stageState.timers?.[0] || null;
      let displayTime = '--:--';
      let isRunning = false;
      let isOvertime = false;
      let statusClass = 'stopped';
      let statusLabel = '⏹️ Parado';

      if (activeTimer) {
        let elapsed = activeTimer.elapsed || 0;
        if (activeTimer.state === 'running' && activeTimer.startedAt) {
          elapsed += Date.now() - activeTimer.startedAt;
          isRunning = true;
          runningCount++;
        }

        const remaining = (activeTimer.duration || 0) - elapsed;
        isOvertime = remaining < 0;

        if (isRunning) {
          statusClass = isOvertime ? 'danger' : 'running';
          statusLabel = isOvertime ? '⚠️ OVERTIME' : '🟢 A DECORRER';
        } else if (elapsed > 0) {
          statusClass = 'stopped';
          statusLabel = '⏸️ EM PAUSA';
        }

        displayTime = formatTime(remaining);
      }

      const eventEndTime = StageTimerClient.computeEventEndTime(stageState);

      let card = $multiviewGrid.querySelector(`[data-mv-room="${CSS.escape(ev.code)}"]`);

      if (!card) {
        // Create new card
        card = document.createElement('div');
        card.dataset.mvRoom = ev.code;
        card.className = `multiview-card status-${statusClass}`;
        card.innerHTML = `
          <div class="multiview-header">
            <div>
              <div class="multiview-stage-name">${escapeHtml(ev.title || stageState.name || ev.code)}</div>
              <span class="event-code-pill">${escapeHtml(ev.code)}</span>
            </div>
            <span class="multiview-status-badge ${statusClass}">${statusLabel}</span>
          </div>

          <div class="multiview-timer-display ${statusClass} ${isOvertime ? 'overtime' : ''}">
            ${displayTime}
          </div>

          <div class="multiview-artist-box">
            <div class="multiview-artist-title">
              ${activeTimer ? escapeHtml(activeTimer.name || 'Artista') : 'Sem artistas programados'}
            </div>
            <div class="multiview-artist-notes">
              ${activeTimer?.notes ? escapeHtml(activeTimer.notes) : (activeTimer?.startTime ? `Horário: ${escapeHtml(activeTimer.startTime)}` : '')}
            </div>
          </div>

          <div class="multiview-footer">
            <div>
              🏁 Fim: <span class="multiview-end-badge">${eventEndTime}</span>
            </div>
            <a href="controller.html?room=${encodeURIComponent(ev.code)}" class="btn btn-sm btn-primary" style="padding: 4px 10px; font-size: 0.75rem;">
              🎛️ Abrir Régie
            </a>
          </div>
        `;
        $multiviewGrid.appendChild(card);
      } else {
        // In-place update: zero DOM destruction, zero reflow trembling
        card.className = `multiview-card status-${statusClass}`;

        const stageNameEl = card.querySelector('.multiview-stage-name');
        const expectedStageName = ev.title || stageState.name || ev.code;
        if (stageNameEl && stageNameEl.textContent !== expectedStageName) {
          stageNameEl.textContent = expectedStageName;
        }

        const badgeEl = card.querySelector('.multiview-status-badge');
        if (badgeEl) {
          badgeEl.className = `multiview-status-badge ${statusClass}`;
          if (badgeEl.textContent !== statusLabel) badgeEl.textContent = statusLabel;
        }

        const timeDisplayEl = card.querySelector('.multiview-timer-display');
        if (timeDisplayEl) {
          timeDisplayEl.className = `multiview-timer-display ${statusClass} ${isOvertime ? 'overtime' : ''}`;
          if (timeDisplayEl.textContent.trim() !== displayTime) timeDisplayEl.textContent = displayTime;
        }

        const artistTitleEl = card.querySelector('.multiview-artist-title');
        const expectedArtist = activeTimer ? (activeTimer.name || 'Artista') : 'Sem artistas programados';
        if (artistTitleEl && artistTitleEl.textContent !== expectedArtist) {
          artistTitleEl.textContent = expectedArtist;
        }

        const artistNotesEl = card.querySelector('.multiview-artist-notes');
        const expectedNotes = activeTimer?.notes ? activeTimer.notes : (activeTimer?.startTime ? `Horário: ${activeTimer.startTime}` : '');
        if (artistNotesEl && artistNotesEl.textContent !== expectedNotes) {
          artistNotesEl.textContent = expectedNotes;
        }

        const endBadgeEl = card.querySelector('.multiview-end-badge');
        if (endBadgeEl && endBadgeEl.textContent !== eventEndTime) {
          endBadgeEl.textContent = eventEndTime;
        }
      }
    });

    if ($kpiRunning) $kpiRunning.textContent = runningCount;
  }

  // Live smooth tick for multiview timers when stages are running (in-place updates)
  setInterval(() => {
    let hasAnyRunning = false;
    stagesStateMap.forEach(st => {
      if (st?.timers?.some(t => t.state === 'running')) {
        hasAnyRunning = true;
      }
    });
    if (hasAnyRunning) {
      renderMultiview();
    }
  }, 250);

  // Initial Boot
  preloadLocalStagesState();
  masterClient.connect();
  renderEventsManager();
  renderDevicesList();
  renderMultiview();
})();
