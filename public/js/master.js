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
  const $cmdAllRegies = document.getElementById('cmd-all-regies');
  const $cmdAllReload = document.getElementById('cmd-all-reload');
  const $cmdClearOffline = document.getElementById('cmd-clear-offline');

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

    // 0. Modo Régies (FOH & Palco) - Match before generic viewer / palco
    if (viewKey === 'regies' || path.includes('regies') || label.includes('régies') || label.includes('regies')) {
      const isStage = label.includes('palco') || path.includes('station=stage');
      return {
        key: 'regies',
        name: isStage ? '📟 Modo Régies (Palco)' : '📟 Modo Régies (FOH)',
        shortName: 'Régies',
        badgeClass: 'view-regies'
      };
    }

    // 1. Lineup / Modo Lista
    if (viewKey === 'lineup' || path.includes('lineup') || label.includes('lista') || label.includes('backstage')) {
      return {
        key: 'lineup',
        name: '📋 Modo Lista (Backstage)',
        shortName: 'Lista',
        badgeClass: 'view-lineup'
      };
    }

    // 2. Operador Mobile
    if (viewKey === 'operator' || path.includes('operator') || role === 'operator' || label.includes('operador')) {
      return {
        key: 'operator',
        name: '📱 Operador Mobile',
        shortName: 'Operador',
        badgeClass: 'view-operator'
      };
    }

    // 3. Modo Palco (Viewer)
    if (viewKey === 'viewer' || path.includes('viewer') || label.includes('palco') || label.includes('telao') || label.includes('telão')) {
      return {
        key: 'viewer',
        name: '📺 Modo Palco',
        shortName: 'Palco',
        badgeClass: 'view-viewer'
      };
    }

    // 4. Configurador
    if (viewKey === 'controller' || path.includes('controller') || label.includes('configurador') || label.includes('controlador')) {
      return {
        key: 'controller',
        name: '🎛️ Configurador',
        shortName: 'Configurador',
        badgeClass: 'view-controller'
      };
    }

    // 5. Painel Master
    if (viewKey === 'master' || path.includes('master') || role === 'master' || label.includes('master')) {
      return {
        key: 'master',
        name: '👑 Painel Master',
        shortName: 'Master',
        badgeClass: 'view-master'
      };
    }

    // 6. Generic role fallbacks
    if (role === 'regies') {
      return {
        key: 'regies',
        name: '📟 Modo Régies',
        shortName: 'Régies',
        badgeClass: 'view-regies'
      };
    }
    if (role === 'viewer') {
      return {
        key: 'viewer',
        name: '📺 Modo Palco',
        shortName: 'Palco',
        badgeClass: 'view-viewer'
      };
    }
    if (role === 'controller') {
      return {
        key: 'controller',
        name: '🎛️ Configurador',
        shortName: 'Configurador',
        badgeClass: 'view-controller'
      };
    }

    return {
      key: 'index',
      name: '🏠 Início',
      shortName: 'Início',
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

  function buildDeviceRoomOptions(eventsList, currentRoom) {
    const cleanCurrent = String(currentRoom || '').toUpperCase().trim();
    let optionsHtml = '';
    eventsList.forEach(e => {
      const evTitle = e.title || e.code;
      const stages = Array.isArray(e.stages) && e.stages.length > 0 ? e.stages : [{ code: e.code, name: 'Palco Principal' }];
      if (stages.length > 1) {
        optionsHtml += `<optgroup label="🎪 ${escapeHtml(evTitle)} (${stages.length} Palcos)">`;
        stages.forEach(st => {
          const stCode = (st.code || st.id || '').toUpperCase();
          const isSel = stCode === cleanCurrent;
          optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>${escapeHtml(evTitle)} • ${escapeHtml(st.name || stCode)} (${escapeHtml(stCode)})</option>`;
        });
        optionsHtml += `</optgroup>`;
      } else {
        const stCode = (stages[0].code || e.code).toUpperCase();
        const isSel = stCode === cleanCurrent;
        optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>${escapeHtml(evTitle)} (${escapeHtml(stCode)})</option>`;
      }
    });
    return optionsHtml;
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
            Abre o StageTimer em qualquer telemóvel, computador ou ecrã de palco para que apareça aqui instantaneamente.
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

        const roomOptions = buildDeviceRoomOptions(eventsList, dev.room);

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
              <button type="button" class="device-btn ${viewInfo.key === 'viewer' ? 'is-current-view' : ''}" data-cmd="viewer" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Modo Palco">
                📺 Palco ${viewInfo.key === 'viewer' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn ${viewInfo.key === 'lineup' ? 'is-current-view' : ''}" data-cmd="lineup" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Modo Lista Backstage">
                📋 Lista ${viewInfo.key === 'lineup' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn ${viewInfo.key === 'regies' ? 'is-current-view' : ''}" data-cmd="regies" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Modo Régies (FOH & Palco)">
                📟 Régies ${viewInfo.key === 'regies' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn ${viewInfo.key === 'operator' ? 'is-current-view' : ''}" data-cmd="operator" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Modo Operador Mobile">
                📱 Operador ${viewInfo.key === 'operator' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
              </button>
              <button type="button" class="device-btn ${viewInfo.key === 'controller' ? 'is-current-view' : ''}" data-cmd="controller" data-target-uuid="${escapeHtml(dev.deviceUuid)}" data-target-room="${escapeHtml(dev.room || 'PALCO1')}" title="Mudar este ecrã para Configurador">
                🎛️ Configurador ${viewInfo.key === 'controller' ? '<span class="btn-active-check">✓ Ativo</span>' : ''}
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

            <div class="device-danger-zone">
              <button type="button" class="device-btn btn-delete-device" data-cmd="delete_device" data-target-uuid="${escapeHtml(dev.deviceUuid)}" title="Eliminar este dispositivo e fechar a sua sessão (logout se for controlador/operador)">
                🗑️ Eliminar Dispositivo
              </button>
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

        card.dataset.deviceRoom = dev.room || 'PALCO1';

        const select = card.querySelector('.device-room-select');
        if (select && document.activeElement !== select) {
          const freshOptions = buildDeviceRoomOptions(eventsList, dev.room);
          if (select.innerHTML.length !== freshOptions.length) {
            select.innerHTML = freshOptions;
          }
          if (select.value !== dev.room) {
            select.value = dev.room;
          }
        }
      }
    });
  }

  const $masterEventSelect = document.getElementById('master-event-select');

  function renderMasterEventSelector() {
    if (!$masterEventSelect) return;
    const events = masterClient.getEventsList();
    if (events.length === 0) {
      $masterEventSelect.innerHTML = '<option value="">(Nenhum palco criado)</option>';
      return;
    }
    const activeCode = (sessionStorage.getItem('stagetimer_active_room') || localStorage.getItem('stagetimer_device_room') || localStorage.getItem('stagetimer_last_room') || events[0]?.code || '').toUpperCase();

    let optionsHtml = '';
    events.forEach(ev => {
      const evTitle = ev.title || ev.code;
      const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code, name: 'Palco Principal' }];
      if (stages.length > 1) {
        optionsHtml += `<optgroup label="🎪 ${escapeHtml(evTitle)} (${stages.length} Palcos)">`;
        stages.forEach(st => {
          const isSel = st.code === activeCode;
          optionsHtml += `<option value="${escapeHtml(st.code)}" ${isSel ? 'selected' : ''}>👑 ${escapeHtml(evTitle)} • ${escapeHtml(st.name || st.code)}</option>`;
        });
        optionsHtml += `</optgroup>`;
      } else {
        const stCode = stages[0].code || ev.code;
        const isSel = stCode === activeCode;
        optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>👑 ${escapeHtml(evTitle)}</option>`;
      }
    });

    $masterEventSelect.innerHTML = optionsHtml;
    if (activeCode && $masterEventSelect.value !== activeCode) {
      $masterEventSelect.value = activeCode;
    }
  }

  if ($masterEventSelect) {
    $masterEventSelect.addEventListener('change', () => {
      const chosen = ($masterEventSelect.value || '').trim().toUpperCase();
      if (chosen) {
        try {
          localStorage.setItem('stagetimer_device_room', chosen);
          localStorage.setItem('stagetimer_last_room', chosen);
          sessionStorage.setItem('stagetimer_active_room', chosen);
        } catch (e) {}
        updateMasterNavLinks();
      }
    });
  }

  function updateMasterNavLinks() {
    const events = masterClient.getEventsList();
    const defaultFirstStage = (events[0] && Array.isArray(events[0].stages) && events[0].stages.length > 0 && events[0].stages[0].code) ? events[0].stages[0].code : (events[0]?.code || 'PALCO1');
    const activeCode = (sessionStorage.getItem('stagetimer_active_room') || localStorage.getItem('stagetimer_device_room') || localStorage.getItem('stagetimer_last_room') || defaultFirstStage).toUpperCase();
    const q = `?room=${encodeURIComponent(activeCode)}`;
    document.querySelectorAll('.master-nav-btn').forEach(btn => {
      const href = btn.getAttribute('href');
      if (href && !href.startsWith('index.html')) {
        const page = href.split('?')[0];
        btn.href = `${page}${q}`;
      }
    });
    renderMasterEventSelector();
  }
  updateMasterNavLinks();

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href*="?room="]');
    if (link) {
      try {
        const u = new URL(link.href, location.href);
        const r = u.searchParams.get('room');
        if (r) {
          localStorage.setItem('stagetimer_device_room', r.toUpperCase());
          localStorage.setItem('stagetimer_last_room', r.toUpperCase());
          sessionStorage.setItem('stagetimer_active_room', r.toUpperCase());
        }
      } catch (_) {}
    }
  });

  masterClient.on('events-list-update', () => {
    updateMasterNavLinks();
  });

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
      const select = card?.querySelector('.device-room-select');
      const devObj = masterClient.globalDevicesMap.get(uuid);
      const room = select?.value || devObj?.room || btn.dataset.targetRoom || card?.dataset.deviceRoom || 'PALCO1';
      const cmd = btn.dataset.cmd;

      if (!uuid) return;

      if (navigator.vibrate) {
        try { navigator.vibrate(35); } catch (e) {}
      }

      if (cmd === 'reload') {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '🔄 A recarregar...';
        btn.style.filter = 'brightness(1.5)';
        btn.style.borderColor = '#55efc4';
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.style.filter = '';
          btn.style.borderColor = '';
        }, 1200);
        masterClient.sendDeviceCommand(uuid, { action: 'reload' });
        return;
      }

      if (cmd === 'delete_device') {
        const isCurrentSelf = uuid === masterClient.deviceUuid;
        const confirmMsg = isCurrentSelf
          ? 'Tem a certeza que deseja eliminar o seu próprio ecrã? A sua sessão do Painel Master será terminada e perderá todas as credenciais de acesso.'
          : 'Eliminar este dispositivo da rede?\nO dispositivo perderá todas as credenciais de acesso (tokens, eventos e palcos) e terá de preencher tudo de novo na página inicial.';

        if (confirm(confirmMsg)) {
          if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) {} }
          masterClient.deleteDevice(uuid);
          card?.remove();
          renderDevicesList();
        }
        return;
      }

      // Optimistic instant UI update for view modes:
      // Update global devices map so the active button and banner update immediately!
      const existingDev = masterClient.globalDevicesMap.get(uuid);
      if (existingDev) {
        existingDev.viewKey = cmd;
        existingDev.path = `${cmd}.html`;
        existingDev.room = room;
        masterClient.globalDevicesMap.set(uuid, existingDev);
      }

      // Re-render device cards in-place immediately
      renderDevicesList();

      // Brief glowing effect on the card
      if (card) {
        card.dataset.deviceRoom = room;
        card.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
        card.style.borderColor = '#00b894';
        card.style.boxShadow = '0 0 16px rgba(0, 184, 148, 0.4)';
        setTimeout(() => {
          card.style.borderColor = '';
          card.style.boxShadow = '';
        }, 800);
      }

      if (cmd === 'viewer' || cmd === 'lineup' || cmd === 'regies' || cmd === 'operator' || cmd === 'controller') {
        masterClient.sendDeviceCommand(uuid, {
          action: 'navigate',
          url: `${cmd}.html?room=${encodeURIComponent(room)}`,
          room: room
        });
      }
    });

    $devicesList.addEventListener('change', (e) => {
      const select = e.target.closest('[data-room-for-device]');
      if (!select) return;
      const uuid = select.dataset.roomForDevice;
      const targetRoom = (select.value || 'PALCO1').toUpperCase();
      if (uuid && targetRoom) {
        const card = select.closest('[data-device-uuid]');
        if (card) card.dataset.deviceRoom = targetRoom;
        const existingDev = masterClient.globalDevicesMap.get(uuid);
        if (existingDev) {
          existingDev.room = targetRoom;
          masterClient.globalDevicesMap.set(uuid, existingDev);
        }
        renderDevicesList();
        masterClient.sendDeviceCommand(uuid, { action: 'switch_room', room: targetRoom });
        select.style.borderColor = '#55efc4';
        setTimeout(() => { select.style.borderColor = ''; }, 1000);
      }
    });
  }

  // Global Broadcast Buttons
  if ($cmdAllViewer) {
    $cmdAllViewer.addEventListener('click', () => {
      if (confirm('Mudar TODOS os dispositivos online para o Modo Palco?')) {
        if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
        masterClient.globalDevicesMap.forEach(dev => {
          dev.viewKey = 'viewer';
          dev.path = 'viewer.html';
        });
        renderDevicesList();
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
        masterClient.globalDevicesMap.forEach(dev => {
          dev.viewKey = 'lineup';
          dev.path = 'lineup.html';
        });
        renderDevicesList();
        masterClient.sendDeviceCommand('ALL', { action: 'navigate', url: 'lineup.html' });
        $cmdAllLineup.textContent = '⚡ Enviado a Todos!';
        setTimeout(() => { $cmdAllLineup.textContent = '📋 Todos Lista'; }, 1500);
      }
    });
  }

  if ($cmdAllRegies) {
    $cmdAllRegies.addEventListener('click', () => {
      if (confirm('Mudar TODOS os dispositivos online para o Modo Régies?')) {
        if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
        masterClient.globalDevicesMap.forEach(dev => {
          dev.viewKey = 'regies';
          dev.path = 'regies.html';
        });
        renderDevicesList();
        masterClient.sendDeviceCommand('ALL', { action: 'navigate', url: 'regies.html' });
        $cmdAllRegies.textContent = '⚡ Enviado a Todos!';
        setTimeout(() => { $cmdAllRegies.textContent = '📟 Todos Régies'; }, 1500);
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

  if ($cmdClearOffline) {
    $cmdClearOffline.addEventListener('click', () => {
      if (confirm('Eliminar todos os dispositivos inativos (sem sinal há mais de 10 segundos)?')) {
        if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) {} }
        masterClient.clearInactiveDevices(10000);
        renderDevicesList();
        $cmdClearOffline.textContent = '⚡ Inativos Limpos!';
        setTimeout(() => { $cmdClearOffline.textContent = '🗑️ Limpar Inativos'; }, 1500);
      }
    });
  }

  // ─── Section 2: Gestão Central de Palcos & Eventos ──────────────────

  let lastEventsManagerSig = '';
  function renderEventsManager() {
    if (!$eventsList) return;
    const events = masterClient.getEventsList();
    if ($kpiEvents) $kpiEvents.textContent = events.length;
    const tabEvBadge = document.getElementById('tab-events-badge');
    if (tabEvBadge) tabEvBadge.textContent = events.length;

    const sig = events.map(ev => {
      const stagesStr = (ev.stages || []).map(s => `${s.code || ''}-${s.name || ''}`).join(',');
      return `${ev.code}:${ev.title}:${ev.timersCount}:${ev.currentDay}:${ev.pin}:${ev.stagesCount}:${stagesStr}`;
    }).join('||');
    if (sig === lastEventsManagerSig && events.length > 0) return;
    lastEventsManagerSig = sig;

    if (events.length === 0) {
      $eventsList.innerHTML = `
        <div class="empty-state-box" style="grid-column: 1 / -1; padding: 32px 16px; text-align: center;">
          <div style="font-size: 2.2rem; margin-bottom: 6px;">🎪</div>
          <div style="font-weight: 700; color: #fff; font-size: 1rem;">Nenhum evento ativo no momento.</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            Utilize a barra acima para criar o seu primeiro evento com os palcos desejados.
          </div>
        </div>
      `;
      return;
    }

    $eventsList.innerHTML = events.map(ev => {
      const count = typeof ev.timersCount === 'number' ? ev.timersCount : 0;
      const day = ev.currentDay || 1;
      const primaryTargetRoom = (Array.isArray(ev.stages) && ev.stages.length > 0 && ev.stages[0].code) ? ev.stages[0].code : ev.code;

      return `
        <div class="event-manage-card" data-stage-code="${escapeHtml(ev.code)}">
          <div class="event-manage-top">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <div class="event-manage-title" style="margin-bottom: 0;">${escapeHtml(ev.title || ev.code)}</div>
                <button type="button" class="btn btn-sm" data-rename-event="${escapeHtml(ev.code)}" data-current-name="${escapeHtml(ev.title || ev.code)}" style="padding: 2px 8px; font-size: 0.72rem; background: rgba(108, 92, 231, 0.2); border-color: var(--accent); color: #a29bfe; font-weight: 600;" title="Renomear este Evento">
                  ✏️ Renomear Evento
                </button>
              </div>
              <div class="event-manage-stats" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
                <span>${ev.stagesCount || 1} palco(s)</span>
                <span>•</span>
                <span class="badge" style="background: rgba(253, 203, 110, 0.2); color: #fdcb6e; font-weight: 800; font-family: var(--font-mono); padding: 2px 8px; border-radius: 6px; border: 1px solid #fdcb6e; font-size: 0.78rem;">🔑 PIN: ${escapeHtml(ev.pin || '----')}</span>
                <span>•</span>
                <span>${count} artista(s) programado(s) • Dia ${day}</span>
              </div>
            </div>
            <span class="event-manage-code">${escapeHtml(ev.code)}</span>
          </div>

          <div class="event-manage-btns">
            <a href="controller.html?room=${encodeURIComponent(primaryTargetRoom)}" class="btn btn-sm btn-primary" title="Abrir configurador para este palco">
              🎛️ Configurador
            </a>
            <a href="operator.html?room=${encodeURIComponent(primaryTargetRoom)}" class="btn btn-sm" title="Abrir operador mobile para este palco">
              📱 Operador
            </a>
            <a href="viewer.html?room=${encodeURIComponent(primaryTargetRoom)}" class="btn btn-sm" title="Abrir ecrã de palco">
              📺 Palco
            </a>
            <a href="lineup.html?room=${encodeURIComponent(primaryTargetRoom)}" class="btn btn-sm" title="Abrir lista de horários">
              📋 Lista
            </a>
            <button type="button" class="btn btn-sm" data-add-substage="${escapeHtml(ev.code)}" style="background: rgba(0, 184, 148, 0.18); border-color: #00b894; color: #55efc4; font-weight: 700;" title="Adicionar um novo palco a este evento">
              ➕ + Palco
            </button>
            <button type="button" class="btn btn-sm" data-rename-event="${escapeHtml(ev.code)}" data-current-name="${escapeHtml(ev.title || ev.code)}" title="Renomear este evento">
              ✏️ Renomear
            </button>
            <button type="button" class="btn btn-sm btn-danger" data-delete-stage="${escapeHtml(ev.code)}" title="Apagar definitivamente este evento">
              🗑️ Apagar
            </button>
          </div>
          ${Array.isArray(ev.stages) && ev.stages.length > 0 ? `
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); align-items: center;">
              <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Palcos deste evento:</span>
              ${ev.stages.map(st => `
                <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 8px; padding: 4px 8px; flex-wrap: wrap;">
                  <strong style="font-size: 0.78rem; color: #55efc4;">🎪 ${escapeHtml(st.name || st.code)}</strong>
                  <span style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono);">(${escapeHtml(st.code)})</span>
                  <button type="button" class="btn btn-sm" data-rename-stage="${escapeHtml(st.code)}" data-parent-event="${escapeHtml(ev.code)}" data-current-name="${escapeHtml(st.name || st.code)}" style="padding: 2px 7px; font-size: 0.68rem; background: rgba(108, 92, 231, 0.2); border-color: var(--accent); color: #a29bfe; font-weight: 600;" title="Renomear este palco">
                    ✏️ Renomear Palco
                  </button>
                  <a href="controller.html?room=${encodeURIComponent(st.code)}" class="btn btn-sm" style="padding: 2px 6px; font-size: 0.68rem;" title="Abrir Configurador">🎛️</a>
                  <a href="operator.html?room=${encodeURIComponent(st.code)}" class="btn btn-sm" style="padding: 2px 6px; font-size: 0.68rem;" title="Abrir Operador">📱</a>
                  <a href="viewer.html?room=${encodeURIComponent(st.code)}" class="btn btn-sm" style="padding: 2px 6px; font-size: 0.68rem;" title="Abrir Palco">📺</a>
                  <a href="lineup.html?room=${encodeURIComponent(st.code)}" class="btn btn-sm" style="padding: 2px 6px; font-size: 0.68rem;" title="Abrir Lista">📋</a>
                  ${ev.stages.length > 1 ? `
                    <button type="button" class="btn btn-sm btn-danger" data-delete-substage="${escapeHtml(st.code)}" data-parent-event="${escapeHtml(ev.code)}" data-stage-name="${escapeHtml(st.name || st.code)}" style="padding: 2px 7px; font-size: 0.68rem; margin-left: 2px;" title="Eliminar este palco do evento">
                      ✕
                    </button>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  masterClient.on('events-list-update', () => {
    renderEventsManager();
    renderDevicesList();
    renderMultiview();
    renderMasterEventSelector();
    updateMasterNavLinks();
  });

  // ─── Modal de Renomeação / Adição de Palco ───────────────────────────
  let currentModalAction = null; // { type: 'event'|'stage'|'add-stage', eventCode, stageCode, currentName }

  function openRenameModal({ type, eventCode, stageCode, currentName }) {
    currentModalAction = { type, eventCode, stageCode, currentName };
    const modal = document.getElementById('master-rename-modal');
    const titleEl = document.getElementById('master-rename-title');
    const subtitleEl = document.getElementById('master-rename-subtitle');
    const input = document.getElementById('master-rename-input');
    const saveBtn = document.getElementById('master-rename-save-btn');
    if (!modal || !input) return;

    if (type === 'event') {
      if (titleEl) titleEl.innerHTML = '✏️ Renomear Evento';
      if (subtitleEl) subtitleEl.textContent = `Indique o novo nome para o evento (${eventCode}):`;
      if (saveBtn) saveBtn.textContent = '💾 Guardar Nome';
      input.placeholder = 'Ex: Festival Rock 2026';
    } else if (type === 'stage') {
      if (titleEl) titleEl.innerHTML = '🎪 Renomear Palco';
      if (subtitleEl) subtitleEl.textContent = `Indique o novo nome para o palco (${stageCode}):`;
      if (saveBtn) saveBtn.textContent = '💾 Guardar Nome';
      input.placeholder = 'Ex: Palco Sunset, Palco Club...';
    } else if (type === 'add-stage') {
      if (titleEl) titleEl.innerHTML = '➕ Adicionar Novo Palco';
      if (subtitleEl) subtitleEl.textContent = `Indique o nome do novo palco a adicionar ao evento (${eventCode}):`;
      if (saveBtn) saveBtn.textContent = '✨ Criar Palco';
      input.placeholder = 'Ex: Palco 2, VIP Lounge, Sunset...';
    }

    input.value = currentName || '';
    modal.style.display = 'flex';
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  function closeRenameModal() {
    const modal = document.getElementById('master-rename-modal');
    if (modal) modal.style.display = 'none';
    currentModalAction = null;
  }

  function handleSaveModal() {
    if (!currentModalAction) return;
    const input = document.getElementById('master-rename-input');
    const val = (input ? input.value : '').trim();
    if (!val) {
      alert('Por favor introduza um nome válido.');
      if (input) input.focus();
      return;
    }

    const { type, eventCode, stageCode } = currentModalAction;
    try {
      if (type === 'event') {
        masterClient.renameEvent(eventCode, val);
      } else if (type === 'stage') {
        masterClient.renameStage(eventCode, stageCode, val);
      } else if (type === 'add-stage') {
        masterClient.addStageToEvent(eventCode, val);
      }
      closeRenameModal();
      lastEventsManagerSig = ''; // Force re-render
      renderEventsManager();
      renderMultiview();
      renderMasterEventSelector();
      updateMasterNavLinks();
    } catch (err) {
      alert(err.message || 'Erro ao processar alteração.');
    }
  }

  const $renameModal = document.getElementById('master-rename-modal');
  const $renameCancelBtn = document.getElementById('master-rename-cancel-btn');
  const $renameSaveBtn = document.getElementById('master-rename-save-btn');
  const $renameInput = document.getElementById('master-rename-input');

  if ($renameCancelBtn) {
    $renameCancelBtn.addEventListener('click', closeRenameModal);
  }
  if ($renameSaveBtn) {
    $renameSaveBtn.addEventListener('click', handleSaveModal);
  }
  if ($renameInput) {
    $renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveModal();
      } else if (e.key === 'Escape') {
        closeRenameModal();
      }
    });
  }
  if ($renameModal) {
    $renameModal.addEventListener('click', (e) => {
      if (e.target === $renameModal) {
        closeRenameModal();
      }
    });
  }

  if ($eventsList) {
    $eventsList.addEventListener('click', (e) => {
      // 1. Delete whole event
      const delBtn = e.target.closest('[data-delete-stage]');
      if (delBtn) {
        const code = delBtn.dataset.deleteStage;
        if (confirm(`Tem a certeza que pretende APAGAR o evento "${code}"?\nEsta ação elimina todos os palcos e timers deste evento.`)) {
          masterClient.deleteEventFromRegistry(code);
          stagesStateMap.delete(code);
          lastEventsManagerSig = '';
          renderEventsManager();
          renderMultiview();
          renderMasterEventSelector();
          updateMasterNavLinks();
        }
        return;
      }

      // 2. Rename event
      const renameEvBtn = e.target.closest('[data-rename-event]');
      if (renameEvBtn) {
        const code = renameEvBtn.dataset.renameEvent;
        const currentName = renameEvBtn.dataset.currentName || code;
        openRenameModal({ type: 'event', eventCode: code, currentName });
        return;
      }

      // 3. Rename individual stage
      const renameStBtn = e.target.closest('[data-rename-stage]');
      if (renameStBtn) {
        const stageCode = renameStBtn.dataset.renameStage;
        const parentEvent = renameStBtn.dataset.parentEvent || stageCode;
        const currentName = renameStBtn.dataset.currentName || stageCode;
        openRenameModal({ type: 'stage', eventCode: parentEvent, stageCode, currentName });
        return;
      }

      // 4. Delete sub-stage
      const delSubBtn = e.target.closest('[data-delete-substage]');
      if (delSubBtn) {
        const parentEvent = delSubBtn.dataset.parentEvent;
        const stageCode = delSubBtn.dataset.deleteSubstage;
        const stageName = delSubBtn.dataset.stageName || stageCode;
        if (confirm(`Eliminar o palco "${stageName}" deste evento?\nEsta ação apagará as programações deste palco.`)) {
          try {
            masterClient.removeStageFromEvent(parentEvent, stageCode);
            stagesStateMap.delete(stageCode);
            lastEventsManagerSig = '';
            renderEventsManager();
            renderMultiview();
            renderMasterEventSelector();
            updateMasterNavLinks();
          } catch (err) {
            alert(err.message || 'Erro ao apagar palco.');
          }
        }
        return;
      }

      // 5. Add stage to event
      const addStageBtn = e.target.closest('[data-add-substage]');
      if (addStageBtn) {
        const code = addStageBtn.dataset.addSubstage;
        const currentEv = masterClient.getEventsList().find(item => item.code === code);
        const nextIdx = (currentEv?.stages?.length || 1) + 1;
        openRenameModal({
          type: 'add-stage',
          eventCode: code,
          currentName: `Palco ${nextIdx}`
        });
        return;
      }
    });
  }

  if ($createStageBtn) {
    $createStageBtn.addEventListener('click', () => {
      const name = ($newStageInput ? $newStageInput.value : '').trim();
      if (!name) {
        alert('Por favor introduza o nome do evento (ex: Festival Rock, Gala IPCA...).');
        if ($newStageInput) $newStageInput.focus();
        return;
      }
      const stagesSelect = document.getElementById('master-new-stages-count');
      const stagesCount = Math.max(1, Math.min(20, parseInt(stagesSelect ? stagesSelect.value : '1', 10) || 1));
      try {
        const created = masterClient.createEventWithStages({
          title: name,
          stagesCount,
          masterPass: '1379brito'
        });
        if ($newStageInput) $newStageInput.value = '';
        renderEventsManager();
        renderMultiview();
        renderMasterEventSelector();
        updateMasterNavLinks();
        alert(`✅ Evento "${created.title}" criado com sucesso!\n🎪 Palcos: ${created.stagesCount}\n🔑 PIN atribuído à equipa: ${created.pin}`);
      } catch (err) {
        alert(err.message || 'Erro ao criar evento.');
      }
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

  // Pre-load states from localStorage for all registered stages and events
  function preloadLocalStagesState() {
    const events = masterClient.getEventsList();
    events.forEach(ev => {
      const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code }];
      stages.forEach(st => {
        try {
          const saved = localStorage.getItem(`stagetimer_v10_state_${st.code}`) || localStorage.getItem(`stagetimer_live_state_${st.code}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed.timers)) {
              stagesStateMap.set(st.code, parsed);
            }
          }
        } catch (e) {}
      });
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

    // Collect all individual stages across all events
    const allStages = [];
    events.forEach(ev => {
      const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code, name: ev.title || ev.code }];
      stages.forEach(st => {
        allStages.push({
          parentEvent: ev,
          code: (st.code || st.id || ev.code).toUpperCase(),
          name: stages.length > 1 ? `${ev.title || ev.code} • ${st.name || st.code}` : (ev.title || st.name || ev.code)
        });
      });
    });

    if ($kpiEvents) $kpiEvents.textContent = allStages.length;

    if (allStages.length === 0) {
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

    const currentCodes = new Set(allStages.map(s => s.code));

    // Remove any card whose stage was deleted
    const currentCards = Array.from($multiviewGrid.querySelectorAll('[data-mv-room]'));
    currentCards.forEach(card => {
      const code = card.dataset.mvRoom;
      if (!currentCodes.has(code)) {
        card.remove();
      }
    });

    allStages.forEach(stageItem => {
      const stageCode = stageItem.code;
      const stageName = stageItem.name;
      const stageState = stagesStateMap.get(stageCode) || {
        id: stageCode,
        name: stageName,
        timers: [],
        activeTimerId: null
      };

      const activeTimer = StageTimerClient.getActiveTimer(stageState);
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

      let card = $multiviewGrid.querySelector(`[data-mv-room="${CSS.escape(stageCode)}"]`);

      if (!card) {
        // Create new card
        card = document.createElement('div');
        card.dataset.mvRoom = stageCode;
        card.className = `multiview-card status-${statusClass}`;
        card.innerHTML = `
          <div class="multiview-header">
            <div>
              <div class="multiview-stage-name">${escapeHtml(stageName)}</div>
              <span class="event-code-pill">${escapeHtml(stageCode)}</span>
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
            <a href="controller.html?room=${encodeURIComponent(stageCode)}" class="btn btn-sm btn-primary" style="padding: 4px 10px; font-size: 0.75rem;">
              🎛️ Abrir Configurador
            </a>
          </div>
        `;
        $multiviewGrid.appendChild(card);
      } else {
        // In-place update: zero DOM destruction, zero reflow trembling
        card.className = `multiview-card status-${statusClass}`;

        const stageNameEl = card.querySelector('.multiview-stage-name');
        if (stageNameEl && stageNameEl.textContent !== stageName) {
          stageNameEl.textContent = stageName;
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

    // Ensure multiview cards are ordered identically to the deterministic stages array without DOM thrashing
    const currentDomChildren = Array.from($multiviewGrid.children);
    const targetOrder = allStages
      .map(s => $multiviewGrid.querySelector(`[data-mv-room="${CSS.escape(s.code)}"]`))
      .filter(Boolean);

    let needsReorder = false;
    for (let i = 0; i < targetOrder.length; i++) {
      if (currentDomChildren[i] !== targetOrder[i]) {
        needsReorder = true;
        break;
      }
    }
    if (needsReorder) {
      targetOrder.forEach(node => $multiviewGrid.appendChild(node));
    }

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

  function switchMobileTab(targetId, shouldScroll = false) {
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

      if (shouldScroll) {
        const tabBar = document.getElementById('master-tab-bar');
        if (tabBar) {
          const rect = tabBar.getBoundingClientRect();
          if (rect.top < 0) {
            tabBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    } else {
      Object.values(masterSections).forEach(el => {
        if (el) el.style.display = '';
      });
      if (shouldScroll) {
        const targetEl = masterSections[targetId];
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  }

  $tabItems.forEach(btn => {
    btn.addEventListener('click', () => {
      if (navigator.vibrate) {
        try { navigator.vibrate(25); } catch (e) {}
      }
      switchMobileTab(btn.dataset.target, true);
    });
  });

  let lastScreenWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    // CRITICAL: On mobile phones, scrolling down collapses the address bar,
    // which fires a window resize event (height change only).
    // NEVER switch tabs or scroll if width has not changed!
    if (window.innerWidth === lastScreenWidth) return;
    lastScreenWidth = window.innerWidth;

    if (window.innerWidth > 768) {
      Object.values(masterSections).forEach(el => {
        if (el) el.style.display = '';
      });
    } else {
      const activeBtn = document.querySelector('.master-tab-item.active') || $tabItems[0];
      if (activeBtn) switchMobileTab(activeBtn.dataset.target, false);
    }
  });

  if (window.innerWidth <= 768) {
    switchMobileTab('section-devices', false);
  }

  // Initial Boot
  preloadLocalStagesState();
  masterClient.connect();
  renderEventsManager();
  renderDevicesList();
  renderMultiview();
})();
