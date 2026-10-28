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
    return StageTimerClient.formatTime(ms);
  }

  // ─── Live Master Clock ─────────────────────────────────────────────

  function updateMasterClock() {
    if (!$liveClock) return;
    $liveClock.textContent = StageTimerClient.getTrueTimeString();
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

  function getViewDetails(dev) {
    const path = String(dev.path || '').toLowerCase();
    const role = String(dev.role || '').toLowerCase();
    const viewKey = String(dev.viewKey || '').toLowerCase();
    const label = String(dev.label || '').toLowerCase();

    if (viewKey === 'viewer' || path.includes('viewer') || role === 'viewer' || label.includes('palco') || label.includes('telao') || label.includes('telão')) {
      return {
        key: 'viewer',
        name: '📺 Modo Palco (Telão)',
        shortName: 'Palco',
        badgeClass: 'view-viewer'
      };
    }
    if (viewKey === 'controller' || path.includes('controller') || role === 'controller' || label.includes('régie') || label.includes('regie') || label.includes('controlador')) {
      return {
        key: 'controller',
        name: '🎛️ Régie (Controlador)',
        shortName: 'Régie',
        badgeClass: 'view-controller'
      };
    }
    if (viewKey === 'operator' || path.includes('operator') || role === 'operator' || label.includes('operador')) {
      return {
        key: 'operator',
        name: '📱 Operador Mobile',
        shortName: 'Operador',
        badgeClass: 'view-operator'
      };
    }
    if (viewKey === 'lineup' || path.includes('lineup') || label.includes('lista') || label.includes('backstage')) {
      return {
        key: 'lineup',
        name: '📋 Modo Lista (Backstage)',
        shortName: 'Lista',
        badgeClass: 'view-lineup'
      };
    }
    if (viewKey === 'master' || path.includes('master') || role === 'master' || label.includes('master')) {
      return {
        key: 'master',
        name: '👑 Painel Master',
        shortName: 'Master',
        badgeClass: 'view-master'
      };
    }
    return {
      key: 'index',
      name: '🏠 Menu Inicial',
      shortName: 'Menu',
      badgeClass: 'view-index'
    };
  }

  function getDeviceCleanOS(dev) {
    if (dev.os) return dev.os;
    const raw = String(dev.label || '');
    const m = raw.match(/\(([^)]+)\)/);
    if (m && m[1]) return m[1];
    return 'Dispositivo';
  }

  function renderDevicesList(devices = masterClient.getOnlineDevices()) {
    if (!$devicesList) return;
    if ($kpiDevices) $kpiDevices.textContent = devices.length;
    const tabDevBadge = document.getElementById('tab-devices-badge');
    if (tabDevBadge) tabDevBadge.textContent = devices.length;

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

      const viewInfo = getViewDetails(dev);
      const deviceOs = getDeviceCleanOS(dev);

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
                  ${escapeHtml(deviceOs)}
                  ${isSelf ? '<span class="device-self-tag">(Este ecrã)</span>' : ''}
                </div>
                <div class="device-uuid-tag">${escapeHtml(dev.deviceUuid)}</div>
              </div>
            </div>
            <div class="device-seen-badge">
              <span class="device-seen-text">${seenLabel}</span>
            </div>
          </div>

          <!-- Highlighted High-Visibility View Badge -->
          <div class="device-view-status-banner ${viewInfo.badgeClass}">
            <div class="device-view-label-col">
              <span class="device-view-tag-label">VISTA ATUAL DO ECRÃ:</span>
              <strong class="device-view-tag-name">${viewInfo.name}</strong>
            </div>
            <span class="device-view-live-pill">● ONLINE</span>
          </div>

          <div class="device-meta-row">
            <span class="device-room-pill">🎪 Palco: <strong>${escapeHtml(dev.roomTitle || dev.room || 'PALCO1')}</strong></span>
            <span class="device-os-pill">📱 ${escapeHtml(deviceOs)}</span>
          </div>

          <div class="device-actions-toolbar">
            <div class="device-actions-title">
              <span>Mudar Modo do Ecrã:</span>
            </div>
            <div class="device-btn-group">
              <button type="button" class="device-btn ${viewInfo.key === 'viewer' ? 'is-current-view' : ''}" data-cmd="viewer" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Telão de Palco">
                📺 Palco ${viewInfo.key === 'viewer' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn ${viewInfo.key === 'lineup' ? 'is-current-view' : ''}" data-cmd="lineup" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Modo Lista Backstage">
                📋 Lista ${viewInfo.key === 'lineup' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn ${viewInfo.key === 'operator' ? 'is-current-view' : ''}" data-cmd="operator" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Modo Operador Mobile">
                📱 Operador ${viewInfo.key === 'operator' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn ${viewInfo.key === 'controller' ? 'is-current-view' : ''}" data-cmd="controller" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Controlador Régie">
                🎛️ Régie ${viewInfo.key === 'controller' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn btn-warning-action" data-cmd="reload" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Recarregar página no dispositivo">
                🔄 Recarregar Ecrã Remoto
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

        // Update banner
        const bannerEl = card.querySelector('.device-view-status-banner');
        if (bannerEl) {
          bannerEl.className = `device-view-status-banner ${viewInfo.badgeClass}`;
          const nameEl = bannerEl.querySelector('.device-view-tag-name');
          if (nameEl && nameEl.textContent !== viewInfo.name) {
            nameEl.textContent = viewInfo.name;
          }
        }

        // Update button targets & active state
        card.querySelectorAll('[data-cmd]').forEach(b => {
          b.dataset.targetUuid = dev.deviceUuid;
          b.dataset.targetRoom = dev.room || 'PALCO1';
          const cmd = b.dataset.cmd;
          const isCurrent = cmd === viewInfo.key;
          b.classList.toggle('is-current-view', isCurrent);
          const checkEl = b.querySelector('.btn-active-check');
          if (isCurrent && !checkEl && cmd !== 'reload') {
            const check = document.createElement('span');
            check.className = 'btn-active-check';
            check.textContent = '✓ Ativo';
            b.appendChild(check);
          } else if (!isCurrent && checkEl) {
            checkEl.remove();
          }
        });

        const seenEl = card.querySelector('.device-seen-text');
        if (seenEl && seenEl.textContent.trim() !== seenLabel) seenEl.textContent = seenLabel;

        const roomPill = card.querySelector('.device-room-pill');
        const expectedRoomText = `🎪 Palco: ${dev.roomTitle || dev.room || 'PALCO1'}`;
        if (roomPill && roomPill.textContent !== expectedRoomText) {
          roomPill.innerHTML = `🎪 Palco: <strong>${escapeHtml(dev.roomTitle || dev.room || 'PALCO1')}</strong>`;
        }

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
      const uuid = btn.dataset.targetUuid || card?.dataset.deviceUuid;
      const room = btn.dataset.targetRoom || card?.dataset.deviceRoom || 'PALCO1';
      const cmd = btn.dataset.cmd;

      if (!uuid) return;

      if (navigator.vibrate) {
        try { navigator.vibrate(35); } catch (e) {}
      }

      // Instant visual click feedback
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '⚡ Enviado!';
      btn.style.filter = 'brightness(1.5)';
      btn.style.borderColor = '#55efc4';
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.style.filter = '';
        btn.style.borderColor = '';
      }, 1000);

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
        select.style.borderColor = '#55efc4';
        setTimeout(() => { select.style.borderColor = ''; }, 1000);
      }
    });
  }

  // Global Broadcast Buttons
  if ($cmdAllViewer) {
    $cmdAllViewer.addEventListener('click', () => {
      if (confirm('Mudar TODOS os dispositivos online para o Modo Palco (Telão)?')) {
        if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
        masterClient.sendDeviceCommand('ALL', { action: 'navigate', url: 'viewer.html' });
        $cmdAllViewer.textContent = '⚡ Enviado a Todos!';
        setTimeout(() => { $cmdAllViewer.textContent = '📺 Todos Palco'; }, 1500);
      }
    });
  }

  if ($cmdAllLineup) {
    $cmdAllLineup.addEventListener('click', () => {
      if (confirm('Mudar TODOS os dispositivos online para o Modo Lista?')) {
        if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
        masterClient.sendDeviceCommand('ALL', { action: 'navigate', url: 'lineup.html' });
        $cmdAllLineup.textContent = '⚡ Enviado a Todos!';
        setTimeout(() => { $cmdAllLineup.textContent = '📋 Todos Lista'; }, 1500);
      }
    });
  }

  if ($cmdAllReload) {
    $cmdAllReload.addEventListener('click', () => {
      if (confirm('Recarregar TODOS os ecrãs e dispositivos remotos agora?')) {
        if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) {} }
        masterClient.sendDeviceCommand('ALL', { action: 'reload' });
        $cmdAllReload.textContent = '⚡ Recarregar Enviado!';
        setTimeout(() => { $cmdAllReload.textContent = '🔄 Recarregar Todos'; }, 1500);
      }
    });
  }

  // ─── Section 2: Gestão Central de Palcos & Eventos ──────────────────

  function renderEventsManager() {
    if (!$eventsList) return;
    const events = masterClient.getEventsList();
    if ($kpiEvents) $kpiEvents.textContent = events.length;
    const tabEvBadge = document.getElementById('tab-events-badge');
    if (tabEvBadge) tabEvBadge.textContent = events.length;

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

  const $cleanGhostsBtn = document.getElementById('master-clean-ghosts-btn');
  if ($cleanGhostsBtn) {
    $cleanGhostsBtn.addEventListener('click', () => {
      if (confirm('Purgar todos os palcos fantasmas e forçar sincronização limpa com a nuvem?')) {
        masterClient.forceCloudRegistrySync();
        renderEventsManager();
        renderMultiview();
        $cleanGhostsBtn.textContent = '✅ Nuvem Limpa!';
        setTimeout(() => { $cleanGhostsBtn.textContent = '👻 Purgar Fantasmas da Nuvem'; }, 2000);
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
        const elapsed = StageTimerClient.getTimerElapsed(activeTimer);
        if (activeTimer.state === 'running') {
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
    const tabRunBadge = document.getElementById('tab-running-badge');
    if (tabRunBadge) tabRunBadge.textContent = runningCount;
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

  // ─── Mobile Segmented Tab Navigation ──────────────────────────────
  const $tabItems = document.querySelectorAll('.master-tab-item');
  const masterSections = {
    'section-devices': document.getElementById('section-devices'),
    'section-events': document.getElementById('section-events'),
    'section-multiview': document.getElementById('section-multiview')
  };

  function switchMobileTab(targetId) {
    if (!targetId) return;

    $tabItems.forEach(item => {
      const isTarget = item.dataset.target === targetId;
      item.classList.toggle('active', isTarget);
    });

    if (window.innerWidth <= 768) {
      Object.entries(masterSections).forEach(([id, el]) => {
        if (!el) return;
        if (id === targetId) {
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      Object.values(masterSections).forEach(el => {
        if (el) el.style.display = '';
      });
      const targetEl = masterSections[targetId];
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  $tabItems.forEach(btn => {
    btn.addEventListener('click', () => {
      if (navigator.vibrate) {
        try { navigator.vibrate(25); } catch (e) {}
      }
      switchMobileTab(btn.dataset.target);
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      Object.values(masterSections).forEach(el => {
        if (el) el.style.display = '';
      });
    } else {
      const activeBtn = document.querySelector('.master-tab-item.active') || $tabItems[0];
      if (activeBtn) switchMobileTab(activeBtn.dataset.target);
    }
  });

  if (window.innerWidth <= 768) {
    switchMobileTab('section-devices');
  }

  // Initial Boot
  preloadLocalStagesState();
  masterClient.connect();
  renderEventsManager();
  renderDevicesList();
  renderMultiview();
})();
