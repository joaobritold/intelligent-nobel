/**
 * StageTimer Universal Cloud + Local Synchronizer (v4)
 * - Multi-Stage / Multi-Event sessions (isolated rooms)
 * - Multi-Day lineups per stage (Dia 1, Dia 2, + Dia)
 * - Cloud MQTT over WSS + Local BroadcastChannel
 * - Zero hardcoded demo bands: new events start 100% clean (0 artists)
 * - Real-time device presence & remote screen control with dual-channel dispatch
 * - Reliable event deletion & unified cumulative end time calculation
 */

class UniversalSyncClient {
  constructor({ role = 'viewer', room } = {}) {
    this.role = role;
    let initialRoom = (room || '').trim().toUpperCase();

    // Check saved device room in localStorage if no room was explicitly provided
    if (!initialRoom) {
      let savedActiveRoom = '';
      let savedDeviceRoom = '';
      let savedLastRoom = '';
      try {
        savedActiveRoom = (sessionStorage.getItem('stagetimer_active_room') || '').trim().toUpperCase();
        savedDeviceRoom = (localStorage.getItem('stagetimer_device_room') || '').trim().toUpperCase();
        savedLastRoom = (localStorage.getItem('stagetimer_last_room') || '').trim().toUpperCase();
      } catch (e) {}
      initialRoom = savedActiveRoom || savedDeviceRoom || savedLastRoom || 'PALCO1';
    }

    this.room = initialRoom;
    this.cleanRoom = this.room.replace(/[^A-Z0-9_-]/g, '') || 'PALCO1';
    try {
      localStorage.setItem('stagetimer_device_room', this.cleanRoom);
      localStorage.setItem('stagetimer_last_room', this.cleanRoom);
      sessionStorage.setItem('stagetimer_active_room', this.cleanRoom);
    } catch (e) {}

    this.channelName = `stagetimer_v10_${this.cleanRoom}`;
    this.cmdChannelName = 'stagetimer_v10_cmds';
    this.storageKey = `stagetimer_v10_state_${this.cleanRoom}`;
    this.mqttTopicState = `stagetimer_v10/${this.cleanRoom}/state`;
    this.mqttTopicPresence = `stagetimer_v10/${this.cleanRoom}/presence`;
    this.mqttTopicRegistry = 'stagetimer_v63_events_registry';
    this.mqttTopicGlobalPresence = 'stagetimer_v10/_global_presence';
    this.mqttTopicCommands = 'stagetimer_v10/_commands';
    this.mqttTopicAllCmd = 'stagetimer_v10/_cmd_all';
    this.registryStorageKey = 'stagetimer_v63_registry';
    this.deletedStorageKey = 'stagetimer_v63_deleted';

    // ── Clean Slate Epoch v63 Reset (Permanent Zero Wipe) ──
    const CLEAN_SLATE_EPOCH = 'stagetimer_clean_slate_epoch_v63';
    if (localStorage.getItem(CLEAN_SLATE_EPOCH) !== 'true') {
      try {
        const preserveAuthMaster = localStorage.getItem('stagetimer_master_active');
        const preserveAuthV12 = localStorage.getItem('stagetimer_master_auth_v12');
        const preserveAuthUnlocked = localStorage.getItem('stagetimer_auth_unlocked');
        const devUuid = localStorage.getItem('stagetimer_device_uuid');

        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (
            k && (
              k.startsWith('stagetimer_events_registry_') ||
              k.startsWith('stagetimer_deleted_events_') ||
              k.startsWith('stagetimer_live_state_') ||
              k.startsWith('stagetimer_v8_') ||
              k.startsWith('stagetimer_v10_') ||
              k.startsWith('stagetimer_v63_') ||
              k.startsWith('stagetimer_device_room') ||
              k.startsWith('stagetimer_last_room') ||
              k.startsWith('stagetimer_unlocked_event') ||
              k.startsWith('stagetimer_clean_slate_epoch_')
            )
          ) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => {
          try { localStorage.removeItem(k); } catch (_) {}
        });

        try { sessionStorage.removeItem('stagetimer_active_room'); } catch (_) {}
        try { sessionStorage.removeItem('stagetimer_unlocked_event'); } catch (_) {}

        if (devUuid) localStorage.setItem('stagetimer_device_uuid', devUuid);
        if (preserveAuthMaster) localStorage.setItem('stagetimer_master_active', preserveAuthMaster);
        if (preserveAuthV12) localStorage.setItem('stagetimer_master_auth_v12', preserveAuthV12);
        if (preserveAuthUnlocked) localStorage.setItem('stagetimer_auth_unlocked', preserveAuthUnlocked);

        localStorage.setItem(CLEAN_SLATE_EPOCH, 'true');
      } catch (e) {}
    }

    // Prune obsolete registry versions to eliminate ghost events
    ['stagetimer_events_registry_v1', 'stagetimer_events_registry_v2', 'stagetimer_events_registry_v3', 'stagetimer_events_registry_v4', 'stagetimer_events_registry_v5', 'stagetimer_events_registry_v6', 'stagetimer_events_registry_v7', 'stagetimer_events_registry_v8'].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });

    this.firstSeen = Date.now();

    // Give each distinct device/browser a persistent UUID (persists across navigation/reloads)
    try {
      this.deviceUuid = localStorage.getItem('stagetimer_device_uuid') || sessionStorage.getItem('stagetimer_screen_uuid');
      if (!this.deviceUuid) {
        this.deviceUuid = 'dev_' + Math.random().toString(36).substring(2, 7) + '_' + Math.random().toString(36).substring(2, 6);
      }
      localStorage.setItem('stagetimer_device_uuid', this.deviceUuid);
      sessionStorage.setItem('stagetimer_screen_uuid', this.deviceUuid);
    } catch (e) {
      this.deviceUuid = 'dev_' + Math.random().toString(36).substring(2, 9);
    }

    this.mqttTopicDeviceCmd = `stagetimer_v10/_cmd/${this.deviceUuid}`;
    this.mqttTopicRoomCmd = `stagetimer_v10/_cmd_room/${this.cleanRoom}`;
    this.mqttTopicAllCmd = 'stagetimer_v10/_cmd_all';

    this.clientId = 'st_' + Math.random().toString(36).substring(2, 10);
    this.listeners = new Map();
    this.channel = null;
    this.cmdChannel = null;
    this._state = null;
    this.tickInterval = null;
    this.mqttClient = null;
    this.peersMap = new Map();
    this.globalDevicesMap = new Map();
    this.purgedDevicesSet = new Set();
    this.connectedPeersCount = 1;
    this._needsInitialPublish = false;
    this.timeOffset = window._stagetimer_time_offset || 0;
  }

  // ─── Deleted Events Tombstones ──────────────────────────────────────

  _getDeletedEvents() {
    try {
      const raw = localStorage.getItem(this.deletedStorageKey);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(c => String(c).toUpperCase()) : []);
    } catch (e) {
      return new Set();
    }
  }

  _recordDeletedEvent(code) {
    if (!code) return;
    const set = this._getDeletedEvents();
    set.add(code.toUpperCase());
    try {
      localStorage.setItem(this.deletedStorageKey, JSON.stringify(Array.from(set)));
    } catch (e) {}
  }

  _unmarkDeletedEvent(code) {
    if (!code) return;
    const set = this._getDeletedEvents();
    set.delete(code.toUpperCase());
    try {
      localStorage.setItem(this.deletedStorageKey, JSON.stringify(Array.from(set)));
    } catch (e) {}
  }

  // ─── Device Info & Remote Control ───────────────────────────────────

  _getDeviceOS() {
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    if (/Mac/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'PC Windows';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Dispositivo';
  }

  _getCurrentViewKey() {
    const path = typeof location !== 'undefined' ? location.pathname.toLowerCase() : '';
    if (path.includes('master')) return 'master';
    if (path.includes('lineup')) return 'lineup';
    if (path.includes('regies')) return 'regies';
    if (path.includes('operator')) return 'operator';
    if (path.includes('viewer')) return 'viewer';
    if (path.includes('controller')) return 'controller';
    if (path.includes('cue-station') || path.includes('cuestation')) return 'cue-station';
    if (path.includes('dc')) return 'dc';
    if (path.includes('index') || path === '' || path === '/') return 'index';

    if (this.role === 'master') return 'master';
    if (this.role === 'operator') return 'operator';
    if (this.role === 'regies') return 'regies';
    if (this.role === 'dc') return 'dc';
    if (this.role === 'cue-station') return 'cue-station';
    if (this.role === 'viewer') return 'viewer';
    if (this.role === 'controller') return 'controller';
    return this.role || 'index';
  }

  _getDeviceLabel() {
    const os = this._getDeviceOS();
    const viewKey = this._getCurrentViewKey();
    let roleLabel = 'Ecrã';
    if (viewKey === 'master') roleLabel = 'Painel Master';
    else if (viewKey === 'controller') roleLabel = 'Configurador';
    else if (viewKey === 'operator') roleLabel = 'Operador Mobile';
    else if (viewKey === 'lineup') roleLabel = 'Modo Lista';
    else if (viewKey === 'regies') {
      const st = typeof localStorage !== 'undefined' ? (localStorage.getItem('stagetimer_regie_station') || 'foh') : 'foh';
      roleLabel = st === 'stage' ? 'Modo Régies (Palco)' : 'Modo Régies (FOH)';
    }
    else if (viewKey === 'dc') roleLabel = 'Mesa Diretora de Cena';
    else if (viewKey === 'cue-station') {
      const dept = typeof localStorage !== 'undefined' ? (localStorage.getItem('stagetimer_cue_dept') || 'Geral') : 'Geral';
      roleLabel = `Posto Técnico (${dept})`;
    }
    else if (viewKey === 'viewer') roleLabel = 'Ecrã de Palco';
    else if (viewKey === 'index') roleLabel = 'Início';

    return `${roleLabel} (${os})`;
  }

  get state() {
    return this._state;
  }

  async syncServerTime() {
    try {
      const t0 = performance.now();
      const res = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
      const t1 = performance.now();
      const dateHdr = res.headers.get('date');
      if (dateHdr) {
        const serverMs = new Date(dateHdr).getTime();
        if (Number.isFinite(serverMs)) {
          const roundTrip = (t1 - t0) / 2;
          const estServerNow = serverMs + roundTrip;
          const offset = Math.round(estServerNow - Date.now());
          if (Number.isFinite(offset) && Math.abs(offset) < 86400000) {
            this.timeOffset = offset;
            window._stagetimer_time_offset = offset;
          }
        }
      }
    } catch (e) {}
  }

  getTrueTime() {
    const off = Number(this.timeOffset || window._stagetimer_time_offset || 0);
    return Date.now() + (Number.isFinite(off) ? off : 0);
  }

  static globalTrueTime() {
    const off = Number(window._stagetimer_time_offset || 0);
    return Date.now() + (Number.isFinite(off) ? off : 0);
  }

  static getTrueLocalDate() {
    const t = UniversalSyncClient.globalTrueTime();
    const d = new Date(Number.isFinite(t) ? t : Date.now());
    return isNaN(d.getTime()) ? new Date() : d;
  }

  static getTrueTimeString(includeSeconds = true) {
    const d = UniversalSyncClient.getTrueLocalDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (!includeSeconds) return `${hh}:${mm}`;
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  static getTimerElapsed(timer) {
    if (!timer) return 0;
    let elapsed = timer.elapsed || 0;
    if (timer.state === 'running') {
      const anchor = timer.serverStartedAt || timer.startedAt;
      if (anchor) {
        elapsed += Math.max(0, UniversalSyncClient.globalTrueTime() - anchor);
      }
    }
    return elapsed;
  }

  static formatTime(ms) {
    const isNegative = ms < 0;
    const absMs = Math.abs(ms);
    const totalSeconds = Math.floor(absMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const prefix = isNegative ? '-' : '';
    if (hours > 0) {
      return `${prefix}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  connect() {
    this.syncServerTime();
    setInterval(() => this.syncServerTime(), 60000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.syncServerTime();
      });
    }

    // 1. Local Tab-to-Tab State Sync (BroadcastChannel)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(this.channelName);
        this.channel.onmessage = (event) => {
          const msg = event.data;
          if (msg && msg.type === 'room-state' && msg.sender !== this.clientId) {
            this._applyIncomingState(msg.data, false);
          }
        };
      } catch (e) {}

      // Dual-channel instant local remote commands
      try {
        this.cmdChannel = new BroadcastChannel(this.cmdChannelName);
        this.cmdChannel.onmessage = (event) => {
          const msg = event.data;
          if (msg && msg.sender !== this.clientId) {
            this._handleRemoteCommand(msg);
          }
        };
      } catch (e) {}
    }

    // 2. LocalStorage Fallback
    window.addEventListener('storage', (e) => {
      if (e.key === this.storageKey && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          this._applyIncomingState(data, false);
        } catch (err) {}
      } else if (e.key === this.registryStorageKey && e.newValue) {
        try {
          this._emit('events-list-update', this.getEventsList());
        } catch (err) {}
      }
    });

    // 3. Load Saved State or Create Clean Empty Room
    const urlParams = new URLSearchParams(location.search);
    const isClean = urlParams.get('clean') === '1';

    if (isClean) {
      let regItem = null;
      const allEvs = this.getEventsList();
      for (const ev of allEvs) {
        if (ev.code === this.cleanRoom) { regItem = ev; break; }
        if (Array.isArray(ev.stages)) {
          const st = ev.stages.find(s => (s.code || s.id || '').toUpperCase() === this.cleanRoom);
          if (st) {
            regItem = { ...st, title: st.name || st.code };
            break;
          }
        }
      }
      this._state = this._createDefaultRoom(this.cleanRoom);
      if (regItem && regItem.title) {
        this._state.name = regItem.title;
      }
      this._saveLocal();
      this._needsInitialPublish = true;
      try {
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('clean');
        history.replaceState(null, '', cleanUrl);
      } catch (e) {}
    } else {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed.timers)) {
            this._state = parsed;
          }
        } catch (e) {}
      }
      if (!this._state) {
        let regItem = null;
        const allEvs = this.getEventsList();
        for (const ev of allEvs) {
          if (ev.code === this.cleanRoom) { regItem = ev; break; }
          if (Array.isArray(ev.stages)) {
            const st = ev.stages.find(s => (s.code || s.id || '').toUpperCase() === this.cleanRoom);
            if (st) {
              regItem = { ...st, title: st.name || st.code };
              break;
            }
          }
        }
        this._state = this._createDefaultRoom(this.cleanRoom);
        if (regItem && regItem.title) {
          this._state.name = regItem.title;
        }
        this._saveLocal();
      }
    }
    if (this._state && this._state.id !== this.cleanRoom) {
      this._state.id = this.cleanRoom;
    }

    // Ensure days structure is initialized
    this._ensureDaysStructure();
    this._ensureTheatreStructure();
    this._syncEventInRegistry();

    // 4. Local High-FPS UI Render Loop
    this._startRenderLoop();

    setTimeout(() => {
      this._emit('connected');
      this._emit('room-state', this._state);
    }, 30);

    // 5. Connect to Cloud MQTT over Secure WebSocket (WSS)
    this._initCloudSync();
  }

  _handleRemoteCommand(msg) {
    if (!msg || typeof msg !== 'object') return;
    const target = String(msg.targetUuid || 'ALL').trim().toLowerCase();
    const myUuid = String(this.deviceUuid || '').trim().toLowerCase();
    const isTarget = target === 'all' || target === myUuid;
    if (!isTarget) return;

    if (msg.action === 'reload') {
      try {
        const u = new URL(location.href);
        u.searchParams.set('_ts', Date.now());
        window.location.replace(u.toString());
      } catch (err) {
        window.location.reload();
      }
      return;
    }

    if (msg.action === 'delete_device') {
      try {
        // Revoke all credentials completely: forced logout, clear tokens, events, rooms
        try {
          sessionStorage.clear();
          localStorage.removeItem('stagetimer_master_active');
          localStorage.removeItem('stagetimer_master_auth_v12');
          localStorage.removeItem('stagetimer_auth_unlocked');
          localStorage.removeItem('stagetimer_unlocked_event');
          localStorage.removeItem('stagetimer_device_room');
          localStorage.removeItem('stagetimer_last_room');
          localStorage.removeItem('stagetimer_auth_admin');
          localStorage.removeItem('stagetimer_auth_operator');
          const allKeys = Object.keys(localStorage);
          for (let i = 0; i < allKeys.length; i++) {
            const k = allKeys[i];
            if (
              k.startsWith('stagetimer_auth') ||
              k.startsWith('stagetimer_master') ||
              k.startsWith('stagetimer_unlocked')
            ) {
              localStorage.removeItem(k);
            }
          }
        } catch (e) {}

        // Broadcast removal notice to peers
        if (this.mqttClient && this.mqttClient.connected) {
          try {
            this.mqttClient.publish(
              'stagetimer_v10/_device_removed',
              JSON.stringify({ deviceUuid: this.deviceUuid, removed: true, ts: Date.now() }),
              { qos: 0, retain: false }
            );
          } catch (e) {}
        }

        // Navigate immediately to initial portal menu (all credentials completely revoked)
        window.location.replace(`index.html?revoked=1&_ts=${Date.now()}`);
      } catch (e) {
        window.location.replace('index.html?revoked=1');
      }
      return;
    }

    if (msg.action === 'navigate' && msg.url) {
      try {
        let targetUrl = msg.url;
        const uTarget = new URL(targetUrl, location.href);
        const urlRoom = uTarget.searchParams.get('room');
        const effectiveRoom = (msg.room || urlRoom || localStorage.getItem('stagetimer_device_room') || this.cleanRoom || 'PALCO1').toUpperCase();

        try {
          localStorage.setItem('stagetimer_device_room', effectiveRoom);
          localStorage.setItem('stagetimer_last_room', effectiveRoom);
        } catch (e) {}

        uTarget.searchParams.set('room', effectiveRoom);
        uTarget.searchParams.set('_ts', Date.now());
        targetUrl = uTarget.toString();

        // Broadcast departing presence with anticipated target view before leaving
        try {
          const targetPath = targetUrl.split('?')[0].split('/').pop() || 'viewer.html';
          let anticipatedView = 'viewer';
          if (targetPath.includes('lineup')) anticipatedView = 'lineup';
          else if (targetPath.includes('operator')) anticipatedView = 'operator';
          else if (targetPath.includes('controller')) anticipatedView = 'controller';
          else if (targetPath.includes('master')) anticipatedView = 'master';
          else if (targetPath.includes('index')) anticipatedView = 'index';

          const devPayload = {
            clientId: this.clientId,
            deviceUuid: this.deviceUuid,
            label: this._getDeviceLabel(),
            os: this._getDeviceOS(),
            viewKey: anticipatedView,
            role: this.role,
            room: effectiveRoom,
            roomTitle: effectiveRoom,
            path: targetPath,
            firstSeen: this.firstSeen,
            ts: Date.now()
          };
          if (this.mqttClient && this.mqttClient.connected) {
            this.mqttClient.publish(this.mqttTopicGlobalPresence, JSON.stringify(devPayload), { qos: 0, retain: false });
          }
        } catch (errDepart) {}

        window.location.replace(targetUrl);
      } catch (e) {
        window.location.href = msg.url;
      }
      return;
    }

    if (msg.action === 'switch_room' && msg.room) {
      try {
        const cleanTargetRoom = String(msg.room).toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'PALCO1';
        try {
          localStorage.setItem('stagetimer_device_room', cleanTargetRoom);
          localStorage.setItem('stagetimer_last_room', cleanTargetRoom);
        } catch (e) {}
        const u = new URL(location.href);
        u.searchParams.set('room', cleanTargetRoom);
        u.searchParams.set('_ts', Date.now());
        window.location.replace(u.toString());
      } catch (e) {
        window.location.reload();
      }
      return;
    }

    if (msg.action === 'purge_event' && msg.code) {
      const purgeCode = String(msg.code).toUpperCase().trim();
      this._recordDeletedEvent(purgeCode);
      try { 
        localStorage.removeItem(`stagetimer_v10_state_${purgeCode}`);
        localStorage.removeItem(`stagetimer_v8_state_${purgeCode}`);
        localStorage.removeItem(`stagetimer_live_state_${purgeCode}`);
      } catch (e) {}
      const updatedList = this.getEventsList().filter(e => e.code !== purgeCode);
      this._saveEventsList(updatedList, false);
      if (this.cleanRoom === purgeCode) {
        const u = new URL(location.href);
        u.searchParams.set('room', 'PALCO1');
        window.location.replace(u.toString());
        return;
      }
      this._emit('events-list-update', updatedList);
      return;
    }

    if (msg.action === 'purge_all_ghosts' && Array.isArray(msg.activeCodes)) {
      const activeSet = new Set(msg.activeCodes.map(c => String(c).toUpperCase()));
      try {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('stagetimer_v10_state_') || key.startsWith('stagetimer_v8_state_') || key.startsWith('stagetimer_live_state_')) {
            const c = key.replace('stagetimer_v10_state_', '').replace('stagetimer_v8_state_', '').replace('stagetimer_live_state_', '').toUpperCase();
            if (c && !activeSet.has(c) && c !== 'PALCO1') {
              localStorage.removeItem(key);
              this._recordDeletedEvent(c);
            }
          }
        });
      } catch (e) {}
      if (!activeSet.has(this.cleanRoom)) {
        const u = new URL(location.href);
        u.searchParams.set('room', 'PALCO1');
        window.location.replace(u.toString());
        return;
      }
      const filtered = this.getEventsList().filter(e => activeSet.has(e.code));
      this._saveEventsList(filtered, false);
      this._emit('events-list-update', filtered);
      return;
    }

    if (msg.action === 'purge_clean_slate_v63' || msg.action === 'purge_clean_slate_v10' || msg.action === 'purge_clean_slate_v8' || msg.action === 'purge_clean_slate_v7') {
      try {
        const preserveAuthMaster = localStorage.getItem('stagetimer_master_active');
        const preserveAuthV12 = localStorage.getItem('stagetimer_master_auth_v12');
        const preserveAuthUnlocked = localStorage.getItem('stagetimer_auth_unlocked');
        const devUuid = localStorage.getItem('stagetimer_device_uuid');

        localStorage.clear();
        sessionStorage.clear();

        if (devUuid) localStorage.setItem('stagetimer_device_uuid', devUuid);
        if (preserveAuthMaster) localStorage.setItem('stagetimer_master_active', preserveAuthMaster);
        if (preserveAuthV12) localStorage.setItem('stagetimer_master_auth_v12', preserveAuthV12);
        if (preserveAuthUnlocked) localStorage.setItem('stagetimer_auth_unlocked', preserveAuthUnlocked);
        localStorage.setItem('stagetimer_clean_slate_epoch_v63', 'true');
      } catch (_) {}
      window.location.replace(`index.html?clean_slate=v63&_ts=${Date.now()}`);
      return;
    }

    if (msg.action === 'request_registry') {
      const isMasterUser = this.role === 'master' || (typeof localStorage !== 'undefined' && localStorage.getItem('stagetimer_master_active') === '1');
      if (!isMasterUser) return;

      const list = this.getEventsList();
      if (list && list.length > 0 && this.mqttClient && this.mqttClient.connected) {
        try {
          const payload = JSON.stringify({ sender: this.clientId, forceReplace: false, events: list });
          this.mqttClient.publish(this.mqttTopicRegistry, payload, { qos: 0, retain: true });
        } catch (e) {}
      }
      return;
    }

    if (msg.action === 'request_room_state' && msg.room === this.cleanRoom) {
      const isControllerRole = this.role === 'controller' || this.role === 'operator' || this.role === 'master';
      if (isControllerRole && this._state && Array.isArray(this._state.timers) && this._state.timers.length > 0) {
        this._commitStateChange(true);
      }
      return;
    }
  }

  _initCloudSync() {
    if (typeof mqtt === 'undefined') {
      console.warn('MQTT library not loaded; using local sync only.');
      return;
    }

    const brokers = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];

    this.mqttClient = mqtt.connect(brokers[0], {
      clientId: this.clientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 2000
    });

    this.mqttClient.on('connect', () => {
      this._emit('connected');

      if (this._needsInitialPublish && this._state) {
        this._needsInitialPublish = false;
        this._commitStateChange(true);
      }

      // Erase legacy retained registry topics on MQTT broker
      ['stagetimer_live/_events_list', 'stagetimer_live/_events_list_v6', 'stagetimer_live/_events_list_v7', 'stagetimer_live/_events_list_v8', 'stagetimer_v8/_events_list'].forEach(top => {
        try {
          this.mqttClient.publish(top, JSON.stringify({ sender: this.clientId, forceReplace: true, events: [] }), { qos: 0, retain: true });
        } catch (_) {}
      });

      const topicsToSubscribe = [
        this.mqttTopicState,
        this.mqttTopicPresence,
        this.mqttTopicRegistry,
        this.mqttTopicGlobalPresence,
        this.mqttTopicCommands,
        this.mqttTopicAllCmd,
        this.mqttTopicDeviceCmd,
        this.mqttTopicRoomCmd,
        'stagetimer_v10/_cmd/+',
        'stagetimer_v10/_cmd_room/+',
        'stagetimer_v10/_device_removed'
      ];

      // If in Master mode, also subscribe to all room state broadcasts
      if (this.role === 'master') {
        topicsToSubscribe.push('stagetimer_v10/+/state');
      }

      this.mqttClient.subscribe(topicsToSubscribe, { qos: 0 }, (err) => {
        if (!err) {
          this._emit('p2p-ready', { id: this.cleanRoom, count: this.connectedPeersCount });
          this._announcePresence();
          setTimeout(() => {
            try {
              this.sendDeviceCommand('ALL', { action: 'request_registry' });
              this.sendDeviceCommand('ALL', { action: 'request_room_state', room: this.cleanRoom });
            } catch (_) {}
          }, 350);
        }
      });
    });

    this.mqttClient.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());

        // Remote device commands (switch view, change room, reload, purge)
        if (topic === this.mqttTopicCommands ||
            topic === this.mqttTopicAllCmd ||
            topic === this.mqttTopicDeviceCmd ||
            topic === this.mqttTopicRoomCmd ||
            topic.startsWith('stagetimer_v10/_cmd/') ||
            topic.startsWith('stagetimer_v10/_cmd_room/')) {
          if (msg.sender === this.clientId) return;
          this._handleRemoteCommand(msg);
          return;
        }

        // Room state update
        if (topic === this.mqttTopicState) {
          if (msg.sender === this.clientId) return;
          if (msg.deleted) {
            this._recordDeletedEvent(this.cleanRoom);
            return;
          }
          if (msg.data) {
            this._applyIncomingState(msg.data, true);
          }
        } else if (topic.startsWith('stagetimer_v10/') && topic.endsWith('/state')) {
          // Multi-room state for Master Régie
          const parts = topic.split('/');
          const roomCode = parts[1];
          if (roomCode && roomCode !== '_events_list') {
            if (msg.deleted) {
              this._recordDeletedEvent(roomCode);
              this._emit('multi-room-deleted', { room: roomCode });
            } else if (msg.data) {
              this._emit('multi-room-state', { room: roomCode, data: msg.data });
            }
          }
        } else if (topic === this.mqttTopicRegistry) {
          if (msg && msg.sender === this.clientId) return; // Prevent echo feedback loops
          if (msg && Array.isArray(msg.events)) {
            this._mergeIncomingRegistry(msg.events, Boolean(msg.forceReplace));
          }
        } else if (topic === this.mqttTopicPresence) {
          if (msg.clientId) {
            this.peersMap.set(msg.clientId, Date.now());
            this._cleanupPeers();
          }
        } else if (topic === 'stagetimer_v10/_device_removed') {
          if (msg && msg.deviceUuid) {
            this.purgedDevicesSet.add(msg.deviceUuid);
            this.globalDevicesMap.delete(msg.deviceUuid);
            this._emit('devices-update', this.getOnlineDevices());
          }
        } else if (topic === this.mqttTopicGlobalPresence) {
          if (msg.deviceUuid && msg.ts) {
            if (this.purgedDevicesSet.has(msg.deviceUuid)) {
              return;
            }
            const existing = this.globalDevicesMap.get(msg.deviceUuid);
            this.globalDevicesMap.set(msg.deviceUuid, {
              ...msg,
              firstSeen: existing?.firstSeen || msg.firstSeen || Date.now(),
              lastSeen: Date.now()
            });
            this._cleanupGlobalDevices();
            this._emit('devices-update', this.getOnlineDevices());
          }
        }
      } catch (e) {}
    });

    this.mqttClient.on('offline', () => {
      this._emit('disconnected');
    });

    setInterval(() => this._announcePresence(), 5000);
    setInterval(() => this._cleanupGlobalDevices(), 4000);
    setInterval(() => {
      const isControllerRole = this.role === 'controller' || this.role === 'operator' || this.role === 'master';
      if (isControllerRole && this._state?.timers?.some(t => t.state === 'running')) {
        this._commitStateChange(true);
      }
    }, 1500);
  }

  _cleanupGlobalDevices() {
    const now = Date.now();
    for (const [uuid, dev] of this.globalDevicesMap.entries()) {
      if (now - (dev.lastSeen || 0) > 20000) {
        this.globalDevicesMap.delete(uuid);
      }
    }
  }

  getOnlineDevices() {
    this._cleanupGlobalDevices();
    // ALWAYS stable order: firstSeen ascending, then deviceUuid so order never swaps
    return Array.from(this.globalDevicesMap.values()).sort((a, b) => {
      const diff = (a.firstSeen || 0) - (b.firstSeen || 0);
      if (diff !== 0) return diff;
      return String(a.deviceUuid).localeCompare(String(b.deviceUuid));
    });
  }

  deleteDevice(deviceUuid) {
    if (!deviceUuid) return;
    this.purgedDevicesSet.add(deviceUuid);
    this.globalDevicesMap.delete(deviceUuid);

    // If deleting this own device screen locally
    if (deviceUuid === this.deviceUuid) {
      try {
        sessionStorage.clear();
        localStorage.removeItem('stagetimer_master_active');
        localStorage.removeItem('stagetimer_master_auth_v12');
        localStorage.removeItem('stagetimer_auth_unlocked');
        localStorage.removeItem('stagetimer_unlocked_event');
        localStorage.removeItem('stagetimer_device_room');
        localStorage.removeItem('stagetimer_last_room');
        localStorage.removeItem('stagetimer_auth_admin');
        localStorage.removeItem('stagetimer_auth_operator');
        const allKeys = Object.keys(localStorage);
        for (let i = 0; i < allKeys.length; i++) {
          const k = allKeys[i];
          if (
            k.startsWith('stagetimer_auth') ||
            k.startsWith('stagetimer_master') ||
            k.startsWith('stagetimer_unlocked')
          ) {
            localStorage.removeItem(k);
          }
        }
      } catch (e) {}
      window.location.replace(`index.html?revoked=1&_ts=${Date.now()}`);
      return;
    }

    // Send remote command to tell device to revoke all credentials and return to portal
    this.sendDeviceCommand(deviceUuid, { action: 'delete_device', logout: true, revoke: true });

    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          'stagetimer_v10/_device_removed',
          JSON.stringify({ deviceUuid, removed: true, ts: Date.now() }),
          { qos: 0, retain: false }
        );
      } catch (e) {}
    }

    this._emit('devices-update', this.getOnlineDevices());
  }

  clearInactiveDevices(maxIdleMs = 10000) {
    const now = Date.now();
    for (const [uuid, dev] of this.globalDevicesMap.entries()) {
      if (uuid !== this.deviceUuid && (now - (dev.lastSeen || 0) > maxIdleMs)) {
        this.purgedDevicesSet.add(uuid);
        this.globalDevicesMap.delete(uuid);
      }
    }
    this._emit('devices-update', this.getOnlineDevices());
  }

  sendDeviceCommand(targetDeviceUuid, command) {
    const target = String(targetDeviceUuid || 'ALL').trim();
    const payload = {
      sender: this.clientId,
      sentAt: Date.now(),
      targetUuid: target,
      ...command
    };

    // 1. Instant local BroadcastChannel (cross-tab / same machine)
    if (this.cmdChannel) {
      try {
        this.cmdChannel.postMessage(payload);
      } catch (e) {}
    }

    // 2. Cloud MQTT (cross-device over network)
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        const json = JSON.stringify(payload);
        // Universal command channel so every device receives the command without topic loss
        this.mqttClient.publish(this.mqttTopicCommands, json, { qos: 0, retain: false });

        if (target === 'ALL') {
          this.mqttClient.publish(this.mqttTopicAllCmd, json, { qos: 0, retain: false });
        } else {
          this.mqttClient.publish(`stagetimer_v10/_cmd/${target}`, json, { qos: 0, retain: false });
        }
      } catch (e) {}
    }
  }

  sendRoomCommand(roomCode, command) {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    try {
      const clean = (roomCode || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      const topic = `stagetimer_v10/_cmd_room/${clean}`;
      this.mqttClient.publish(
        topic,
        JSON.stringify({ sender: this.clientId, sentAt: Date.now(), ...command }),
        { qos: 0, retain: false }
      );
    } catch (e) {}
  }

  _announcePresence() {
    if (this.mqttClient && this.mqttClient.connected) {
      this.peersMap.set(this.clientId, Date.now());
      const pathFile = typeof location !== 'undefined' ? (location.pathname.split('/').pop() || 'index.html') : 'index.html';
      const devPayload = {
        clientId: this.clientId,
        deviceUuid: this.deviceUuid,
        label: this._getDeviceLabel(),
        os: this._getDeviceOS(),
        viewKey: this._getCurrentViewKey(),
        role: this.role,
        room: this.cleanRoom,
        roomTitle: this._state?.name || this.cleanRoom,
        path: pathFile,
        firstSeen: this.firstSeen,
        ts: Date.now()
      };
      const jsonStr = JSON.stringify(devPayload);
      this.mqttClient.publish(this.mqttTopicPresence, jsonStr, { qos: 0, retain: false });
      this.mqttClient.publish(this.mqttTopicGlobalPresence, jsonStr, { qos: 0, retain: false });

      // Record self in global devices
      const existing = this.globalDevicesMap.get(this.deviceUuid);
      this.globalDevicesMap.set(this.deviceUuid, {
        ...devPayload,
        firstSeen: existing?.firstSeen || this.firstSeen,
        lastSeen: Date.now()
      });
      this._cleanupPeers();
    }
  }

  _cleanupPeers() {
    const now = Date.now();
    for (const [id, lastSeen] of this.peersMap.entries()) {
      if (now - lastSeen > 24000) {
        this.peersMap.delete(id);
      }
    }
    this.connectedPeersCount = Math.max(1, this.peersMap.size);
    this._emit('p2p-peers-update', { count: this.connectedPeersCount });
  }

  _createDefaultRoom(id) {
    const defaultTitle = id === 'PALCO1' ? 'Palco Principal' : id;
    return {
      id: id,
      name: defaultTitle,
      currentDay: 1,
      days: {
        '1': []
      },
      timers: [],
      activeTimerId: null,
      message: { text: '', visible: false, level: 'info' },
      regieCall: { fohCallingStage: false, stageCallingFoh: false, triggeredAt: 0, triggeredBy: '' },
      regieMessage: { id: '', text: '', visible: false, sentAt: 0, sentTimeStr: '', ackFoh: null, ackStage: null },
      regieHistory: [],
      theatre: this._createDefaultTheatreState(),
      theatre: this._createDefaultTheatreState(),
      theme: { viewerBg: '#000000', controllerBg: '#0f0f1a' },
      updatedAt: 0,
      isEmptyDefault: true
    };
  }

  _ensureDaysStructure() {
    if (!this._state) return;
    if (!this._state.days || typeof this._state.days !== 'object') {
      this._state.days = { '1': Array.isArray(this._state.timers) ? [...this._state.timers] : [] };
    }
    if (!this._state.currentDay) {
      this._state.currentDay = 1;
    }
    const curDayKey = String(this._state.currentDay);
    if (!Array.isArray(this._state.days[curDayKey])) {
      this._state.days[curDayKey] = Array.isArray(this._state.timers) ? [...this._state.timers] : [];
    }
    this._ensureRegieStructure();
    this._ensureTheatreStructure();
  }

  _ensureRegieStructure() {
    if (!this._state) return;
    if (!this._state.regieCall || typeof this._state.regieCall !== 'object') {
      this._state.regieCall = { fohCallingStage: false, stageCallingFoh: false, triggeredAt: 0, triggeredBy: '' };
    }
    if (!this._state.regieMessage || typeof this._state.regieMessage !== 'object') {
      this._state.regieMessage = { id: '', text: '', visible: false, sentAt: 0, sentTimeStr: '', ackFoh: null, ackStage: null };
    }
    if (!Array.isArray(this._state.regieHistory)) {
      this._state.regieHistory = [];
    }
    // Auto-expire calls older than 5.5 seconds across any client/device
    if (this._state.regieCall && (this._state.regieCall.fohCallingStage || this._state.regieCall.stageCallingFoh)) {
      if (this._state.regieCall.triggeredAt && (Date.now() - this._state.regieCall.triggeredAt > 5500)) {
        this._state.regieCall.fohCallingStage = false;
        this._state.regieCall.stageCallingFoh = false;
      }
    }
  }

  _ensureTheatreStructure() {
    if (!this._state) return;
    if (!this._state.theatre || typeof this._state.theatre !== 'object') {
      this._state.theatre = this._createDefaultTheatreState();
    } else {
      if (!Array.isArray(this._state.theatre.cues)) this._state.theatre.cues = this._createDefaultCues();
      if (!Array.isArray(this._state.theatre.script)) this._state.theatre.script = this._createDefaultScript();
      const defaultDepts = ['Luz', 'Som', 'Maquinaria', 'Vídeo', 'Coxias'];
      if (!this._state.theatre.checklists || typeof this._state.theatre.checklists !== 'object') {
        this._state.theatre.checklists = this._createDefaultChecklists();
      } else {
        const defaults = this._createDefaultChecklists();
        defaultDepts.forEach(d => {
          if (!Array.isArray(this._state.theatre.checklists[d])) {
            this._state.theatre.checklists[d] = defaults[d] || [];
          }
        });
      }
      if (!Array.isArray(this._state.theatre.telemetry)) this._state.theatre.telemetry = [];
      if (!this._state.theatre.urgentNotice || typeof this._state.theatre.urgentNotice !== 'object') {
        this._state.theatre.urgentNotice = { text: '', level: 'warn', visible: false, sentAt: 0 };
      }
      if (typeof this._state.theatre.showState !== 'string') this._state.theatre.showState = 'pre';
    }
  }

  _createDefaultTheatreState() {
    return {
      showState: 'pre',
      showStartTime: 0,
      showPausedAt: 0,
      showElapsedMs: 0,
      activeCueId: null,
      standbyCueId: null,
      urgentNotice: { text: '', level: 'warn', visible: false, sentAt: 0 },
      cues: this._createDefaultCues(),
      script: this._createDefaultScript(),
      checklists: this._createDefaultChecklists(),
      telemetry: []
    };
  }

  _createDefaultCues() {
    return [
      {
        id: 'cue_1',
        num: 'Q1',
        name: 'Abertura de Sala',
        targetText: 'Público a entrar / 3º Sinal',
        departments: ['Luz', 'Som'],
        notes: 'Luz de sala a 80%, Som ambiente suave.',
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      },
      {
        id: 'cue_2',
        num: 'Q2',
        name: 'Blackout & Fecho de Sala',
        targetText: 'Aviso de início / Silêncio no teatro',
        departments: ['Luz', 'Som', 'Coxias'],
        notes: 'Desvanecimento suave da sala para 0%. Fade-out do som.',
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      },
      {
        id: 'cue_3',
        num: 'Q3',
        name: 'Abertura de Cortina & Trilha',
        targetText: 'Primeira respiração do ator / Luz de fundo',
        departments: ['Luz', 'Som', 'Maquinaria'],
        notes: 'Cortina principal abre a velocidade 3. Foco pontual sobre cadeira.',
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      },
      {
        id: 'cue_4',
        num: 'Q4',
        name: 'Entrada do Protagonista & Projeção',
        targetText: '“As pedras do chão não mentem...”',
        departments: ['Luz', 'Vídeo'],
        notes: 'Projeção mapeada no ciclorama (nuvens). Luz quente zenital.',
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      },
      {
        id: 'cue_5',
        num: 'Q5',
        name: 'Trovão & Relâmpago',
        targetText: '“...quando a tempestade se ergue sobre o vale.”',
        departments: ['Luz', 'Som'],
        notes: 'Flash estroboscópico de 0.5s sincronizado com estrondo sub-grave.',
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      },
      {
        id: 'cue_6',
        num: 'Q6',
        name: 'Mudança de Cenário / Coxias',
        targetText: 'Saída do ator pela esquerda alta',
        departments: ['Maquinaria', 'Coxias'],
        notes: 'Descida da vara 4 (janela de madeira). Verificação de adereços.',
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      },
      {
        id: 'cue_7',
        num: 'Q7',
        name: 'Agradecimentos & Fecho Final',
        targetText: 'Atores alinham na boca de cena',
        departments: ['Luz', 'Som', 'Maquinaria'],
        notes: 'Luz geral de agradecimentos, aplausos, subida de cortina.',
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      }
    ];
  }

  _createDefaultScript() {
    return [
      { id: 'sc_1', type: 'direction', text: 'CENA I — O ALVORECER NO VELHO TEATRO', cueAnchor: 'cue_1' },
      { id: 'sc_2', type: 'dialogue', speaker: 'DIRETOR', text: 'Tudo pronto nas coxias? O público já tomou os seus lugares.' },
      { id: 'sc_3', type: 'dialogue', speaker: 'ATOR 1', text: 'Estamos a postos. Apenas aguardo o sinal luminoso.' },
      { id: 'sc_4', type: 'direction', text: '[Ouve-se o 3º sinal. O murmúrio da plateia acalma-se progressivamente.]', cueAnchor: 'cue_2' },
      { id: 'sc_5', type: 'direction', text: '[Blackout total. A cortina abre-se em silêncio solene.]', cueAnchor: 'cue_3' },
      { id: 'sc_6', type: 'dialogue', speaker: 'ATOR 1', text: 'As pedras do chão não mentem...' },
      { id: 'sc_7', type: 'direction', text: '[Surge no ciclorama a imagem difusa de nuvens em movimento rápido.]', cueAnchor: 'cue_4' },
      { id: 'sc_8', type: 'dialogue', speaker: 'ATOR 1', text: '...quando a tempestade se ergue sobre o vale.' },
      { id: 'sc_9', type: 'direction', text: '[Relâmpago estroboscópico seguido de estrondo violento de trovão.]', cueAnchor: 'cue_5' },
      { id: 'sc_10', type: 'dialogue', speaker: 'ATOR 2 (em off)', text: 'Não há refúgio onde a verdade não nos alcance!' },
      { id: 'sc_11', type: 'direction', text: '[Saída do Ator 1. A vara de madeira desce suavemente no plano médio.]', cueAnchor: 'cue_6' },
      { id: 'sc_12', type: 'dialogue', speaker: 'ATOR 2', text: 'E agora resta apenas o silêncio e as memórias da noite.' },
      { id: 'sc_13', type: 'direction', text: '[Blackout final. O elenco regressa para os agradecimentos.]', cueAnchor: 'cue_7' }
    ];
  }

  _createDefaultChecklists() {
    return {
      'Luz': [
        { id: 'chk_l_1', label: 'Verificar canais de DMX e splitters', done: true, isOneOff: false },
        { id: 'chk_l_2', label: 'Afinar varas frontais e contra-luz', done: true, isOneOff: false },
        { id: 'chk_l_3', label: 'Testar dimmers e lâmpadas de reserva', done: false, isOneOff: false },
        { id: 'chk_l_4', label: 'Preset de sala a 80%', done: false, isOneOff: false }
      ],
      'Som': [
        { id: 'chk_s_1', label: 'Baterias novas nos microfones emissores (Atores 1 e 2)', done: true, isOneOff: false },
        { id: 'chk_s_2', label: 'Teste de ganho e equalização nas caixas de boca de cena', done: true, isOneOff: false },
        { id: 'chk_s_3', label: 'Carregar e testar trilhas no software de playback', done: false, isOneOff: false },
        { id: 'chk_s_4', label: 'Comunicação Intercom verificada com Mesa DC', done: false, isOneOff: false }
      ],
      'Maquinaria': [
        { id: 'chk_m_1', label: 'Inspecionar cabos de aço e contrapesos das varas', done: true, isOneOff: false },
        { id: 'chk_m_2', label: 'Teste de abertura/fecho da cortina de boca', done: true, isOneOff: false },
        { id: 'chk_m_3', label: 'Carris lubrificados e livres de obstrução', done: false, isOneOff: false }
      ],
      'Vídeo': [
        { id: 'chk_v_1', label: 'Calibração de foco e keystone do projetor principal', done: true, isOneOff: false },
        { id: 'chk_v_2', label: 'Teste de envio HDMI / fibra para o ciclorama', done: false, isOneOff: false },
        { id: 'chk_v_3', label: 'Verificar obturador (shutter) de proteção', done: false, isOneOff: false }
      ],
      'Coxias': [
        { id: 'chk_c_1', label: 'Passagens laterais limpas e sinalizadas com luz azul', done: true, isOneOff: false },
        { id: 'chk_c_2', label: 'Mesa de adereços conferida (cadeira, relógio de bolso, capa)', done: false, isOneOff: false },
        { id: 'chk_c_3', label: 'Água e toalhas prontas nos postos de entrada', done: false, isOneOff: false }
      ]
    };
  }

  // ─── Multi-Day Management ──────────────────────────────────────────

  switchDay(dayNumber) {
    if (!this._state) return;
    this._ensureDaysStructure();
    const targetDay = Number(dayNumber) || 1;
    const curDayKey = String(this._state.currentDay || 1);
    const targetKey = String(targetDay);

    this._lastDaySwitchAt = this.getTrueTime();

    if (this._state.currentDay === targetDay) return;

    // 1. Save current active day lineup in days map
    this._state.days[curDayKey] = [...(this._state.timers || [])];

    // 2. Initialize target day if needed
    if (!Array.isArray(this._state.days[targetKey])) {
      this._state.days[targetKey] = [];
    }

    // 3. Switch viewed day
    this._state.currentDay = targetDay;
    this._state.timers = [...this._state.days[targetKey]];

    // 4. CRITICAL FIX: NEVER hijack, stop, or change the active clock on stage!
    // The active / running timer stays untouched!
    // Only if there is NO activeTimerId at all anywhere, set it to the first timer of this day
    const currentActive = UniversalSyncClient.getActiveTimer(this._state);
    if (!currentActive && this._state.timers.length > 0) {
      this._state.activeTimerId = this._state.timers[0].id;
    }

    this._commitStateChange(true);
  }

  addDay() {
    if (!this._state) return;
    this._ensureDaysStructure();
    const existing = Object.keys(this._state.days).map(Number).filter(n => !isNaN(n));
    const nextDay = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
    this._state.days[String(nextDay)] = [];
    this.switchDay(nextDay);
  }

  removeDay(dayNumber) {
    if (!this._state) return;
    this._ensureDaysStructure();
    const dayKey = String(dayNumber);
    const keys = Object.keys(this._state.days);
    if (keys.length <= 1) {
      // Only 1 day left: clear its timers instead of deleting the day
      this._state.days[dayKey] = [];
      this._state.timers = [];
      this._state.activeTimerId = null;
      this._commitStateChange(true);
      return;
    }

    delete this._state.days[dayKey];
    if (String(this._state.currentDay) === dayKey) {
      const remaining = Object.keys(this._state.days).map(Number).sort((a, b) => a - b);
      this.switchDay(remaining[0] || 1);
    } else {
      this._commitStateChange(true);
    }
  }

  // ─── Multi-Event / Stage Registry ──────────────────────────────────

  _getPersistentCreatedAt(code, candidateTime = 0) {
    const cleanCode = (code || '').toUpperCase().trim();
    if (!cleanCode) return Date.now();
    if (cleanCode === 'PALCO1') return 1000000000000; // Fixed historic timestamp so PALCO1 is always oldest/last
    try {
      const stored = localStorage.getItem(`stagetimer_created_${cleanCode}`);
      const storedNum = Number(stored);
      if (!isNaN(storedNum) && storedNum > 0) {
        return storedNum;
      }
      const candidateNum = Number(candidateTime);
      if (!isNaN(candidateNum) && candidateNum > 1000000000000) {
        localStorage.setItem(`stagetimer_created_${cleanCode}`, String(candidateNum));
        return candidateNum;
      }
      const now = Date.now();
      localStorage.setItem(`stagetimer_created_${cleanCode}`, String(now));
      return now;
    } catch (_) {
      return candidateTime || Date.now();
    }
  }

  _normalizeRegistryItem(item) {
    if (!item) return null;
    const code = (item?.code || item?.id || 'PALCO1').toUpperCase().trim();
    if (!code) return null;

    const isDefault = code === 'PALCO1';
    let title = (item?.title || '').trim();
    if (!title) {
      title = isDefault ? 'Palco Principal' : code;
    }

    let eventType = item?.eventType || '';
    if (eventType !== 'theatre' && eventType !== 'concert') {
      const lowerTitle = (title || '').toLowerCase();
      if (lowerTitle.includes('teatro') || lowerTitle.includes('peça') || lowerTitle.includes('peca') || lowerTitle.includes('cena') || lowerTitle.includes('espetaculo') || lowerTitle.includes('espetáculo') || lowerTitle.includes('recita') || lowerTitle.includes('récita')) {
        eventType = 'theatre';
      } else {
        eventType = 'concert';
      }
    }

    const count = typeof item?.timersCount === 'number'
      ? item.timersCount
      : (typeof item?.artistCount === 'number' ? item.artistCount : 0);

    let pin = String(item?.pin || '').trim();
    if (!/^\d{4}$/.test(pin)) {
      // Deterministic 4-digit fallback PIN for existing/legacy events
      const hash = Math.abs(code.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0));
      pin = code === 'PALCO1' ? '1001' : String(1000 + (hash % 9000));
    }

    const targetStagesCount = Math.max(
      1,
      typeof item?.stagesCount === 'number'
        ? item.stagesCount
        : (Array.isArray(item?.stages) && item.stages.length > 0 ? item.stages.length : 1)
    );

    let stages = [];
    if (Array.isArray(item?.stages) && item.stages.length >= targetStagesCount && item.stages.length > 0) {
      stages = item.stages.map((st, idx) => ({
        id: (st?.id || st?.code || (targetStagesCount > 1 ? `${code}-P${idx + 1}` : code)).toUpperCase(),
        code: (st?.code || st?.id || (targetStagesCount > 1 ? `${code}-P${idx + 1}` : code)).toUpperCase(),
        name: (st?.name || st?.title || (targetStagesCount > 1 ? `Palco ${idx + 1}` : (isDefault ? 'Palco Principal' : title))).trim(),
        timersCount: typeof st?.timersCount === 'number' ? st.timersCount : (idx === 0 ? count : 0)
      }));
    } else {
      // Always guarantee full generation of all stages up to targetStagesCount
      for (let i = 1; i <= targetStagesCount; i++) {
        const sCode = targetStagesCount === 1 ? code : `${code}-P${i}`;
        const sName = targetStagesCount === 1 ? (isDefault ? 'Palco Principal' : title) : `Palco ${i}`;
        const existingSt = Array.isArray(item?.stages) ? item.stages.find(s => s && ((s.code || s.id || '').toUpperCase() === sCode)) : null;
        stages.push({
          id: sCode,
          code: sCode,
          name: (existingSt?.name || existingSt?.title || sName).trim(),
          timersCount: typeof existingSt?.timersCount === 'number' ? existingSt.timersCount : (i === 1 ? count : 0)
        });
      }
    }

    const stagesCount = Math.max(1, targetStagesCount);

    // Guaranteed permanent, immutable creation timestamp
    const createdTime = this._getPersistentCreatedAt(code, item?.createdAt);
    const updatedTime = Number(item?.updatedAt) || createdTime;

    return {
      id: code,
      code,
      title,
      pin,
      stagesCount,
      stages,
      timersCount: count,
      artistCount: count,
      currentDay: item?.currentDay || 1,
      eventType,
      createdAt: createdTime,
      updatedAt: updatedTime
    };
  }

  getEventsList() {
    try {
      const deletedSet = this._getDeletedEvents();
      const raw = localStorage.getItem(this.registryStorageKey);
      let list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
      list = list
        .map(e => this._normalizeRegistryItem(e))
        .filter(e => e && !deletedSet.has(e.code));

      // Sort STRICTLY by creation order descending (newest event first).
      // We NEVER compare updatedAt because timers running continuously mutate updatedAt!
      list.sort((a, b) => {
        const timeA = Number(a.createdAt) || 0;
        const timeB = Number(b.createdAt) || 0;
        if (timeB !== timeA) return timeB - timeA;
        return (a.code || '').localeCompare(b.code || '');
      });
      return list;
    } catch (e) {
      return [];
    }
  }

  _saveEventsList(list, publish = true, forceReplace = false) {
    const deletedSet = this._getDeletedEvents();
    const normalized = (list || [])
      .map(e => this._normalizeRegistryItem(e))
      .filter(e => e && !deletedSet.has(e.code));

    // Sort strictly before saving to localStorage and publishing
    normalized.sort((a, b) => {
      const timeA = Number(a.createdAt) || 0;
      const timeB = Number(b.createdAt) || 0;
      if (timeB !== timeA) return timeB - timeA;
      return (a.code || '').localeCompare(b.code || '');
    });

    try {
      localStorage.setItem(this.registryStorageKey, JSON.stringify(normalized));
    } catch (e) {}
    if (publish && this.mqttClient && this.mqttClient.connected) {
      try {
        const payload = JSON.stringify({ sender: this.clientId, forceReplace, events: normalized });
        this.mqttClient.publish(this.mqttTopicRegistry, payload, { qos: 0, retain: true });
      } catch (e) {}
    }
    this._emit('events-list-update', normalized);
  }

  _mergeIncomingRegistry(incomingList, forceReplace = false) {
    if (!Array.isArray(incomingList)) return;
    const deletedSet = this._getDeletedEvents();

    const validIncoming = incomingList
      .filter(item => item && !deletedSet.has((item.code || item.id || '').toUpperCase()))
      .map(rawItem => this._normalizeRegistryItem(rawItem))
      .filter(Boolean);

    if (forceReplace) {
      if (validIncoming.length === 0) {
        this._saveEventsList([], false);
      } else {
        const incomingCodes = new Set();
        validIncoming.forEach(e => {
          incomingCodes.add(e.code);
          if (Array.isArray(e.stages)) {
            e.stages.forEach(st => incomingCodes.add(st.code));
          }
        });

        try {
          Object.keys(localStorage).forEach(key => {
            if (key.startsWith('stagetimer_live_state_')) {
              const roomCode = key.replace('stagetimer_live_state_', '').toUpperCase();
              if (roomCode && !incomingCodes.has(roomCode) && roomCode !== 'PALCO1') {
                localStorage.removeItem(key);
                this._recordDeletedEvent(roomCode);
              }
            }
          });
        } catch (e) {}

        this._saveEventsList(validIncoming, false);
      }
      return;
    }

    // Incremental merge (forceReplace === false): Never discard local events
    const currentList = this.getEventsList();
    const map = new Map();
    currentList.forEach(e => {
      if (e && e.code && !deletedSet.has(e.code)) {
        map.set(e.code, e);
      }
    });

    validIncoming.forEach(inc => {
      if (!inc || !inc.code || deletedSet.has(inc.code)) return;
      if (!map.has(inc.code)) {
        map.set(inc.code, inc);
      } else {
        const existing = map.get(inc.code);
        const incUpdated = Number(inc.updatedAt) || 0;
        const existUpdated = Number(existing.updatedAt) || 0;

        let mergedStages = existing.stages || [];
        if (Array.isArray(inc.stages) && inc.stages.length > 0) {
          if (!mergedStages || mergedStages.length === 0 || inc.stages.length >= mergedStages.length) {
            mergedStages = inc.stages;
          }
        }

        const mergedItem = this._normalizeRegistryItem({
          ...existing,
          ...inc,
          title: incUpdated >= existUpdated ? (inc.title || existing.title) : (existing.title || inc.title),
          eventType: incUpdated >= existUpdated ? (inc.eventType || existing.eventType) : (existing.eventType || inc.eventType),
          stagesCount: Math.max(existing.stagesCount || 1, inc.stagesCount || 1, mergedStages.length),
          stages: mergedStages,
          timersCount: Math.max(existing.timersCount || 0, inc.timersCount || 0),
          createdAt: Math.min(Number(existing.createdAt) || Date.now(), Number(inc.createdAt) || Date.now()),
          updatedAt: Math.max(existUpdated, incUpdated)
        });
        map.set(inc.code, mergedItem);
      }
    });

    const mergedList = Array.from(map.values());
    this._saveEventsList(mergedList, false);
  }

  _syncEventInRegistry(publish = true) {
    if (!this._state) return;
    if (this.role === 'viewer') return; // Viewers never publish or alter the registry
    const deletedSet = this._getDeletedEvents();
    if (deletedSet.has(this.cleanRoom)) return;

    const list = this.getEventsList();
    const idx = list.findIndex(e => e.code === this.cleanRoom || (e.stages && e.stages.some(st => st.code === this.cleanRoom)));
    if (idx < 0) {
      // NEVER resurrect deleted events!
      return;
    }

    const existing = list[idx];
    let count = 0;
    if (this._state.days && typeof this._state.days === 'object') {
      Object.values(this._state.days).forEach(arr => {
        if (Array.isArray(arr)) count += arr.length;
      });
    }
    if (count === 0 && Array.isArray(this._state.timers)) {
      count = this._state.timers.length;
    }

    let updatedStages = existing.stages || [];
    if (Array.isArray(updatedStages) && updatedStages.length > 0) {
      updatedStages = updatedStages.map(st => {
        if (st.code === this.cleanRoom || st.id === this.cleanRoom) {
          return { ...st, timersCount: count };
        }
        return st;
      });
    }

    const totalCount = updatedStages.length > 0
      ? updatedStages.reduce((sum, s) => sum + (s.timersCount || 0), 0)
      : count;

    const titleChanged = this._state.name && existing.title !== this._state.name;
    const countChanged = existing.timersCount !== totalCount;
    const dayChanged = (this._state.currentDay || 1) !== (existing.currentDay || 1);

    // If nothing structural changed, do NOT touch or re-publish registry to avoid event swapping feedback loops
    if (!titleChanged && !countChanged && !dayChanged) {
      return;
    }

    const entry = this._normalizeRegistryItem({
      ...existing,
      title: titleChanged ? this._state.name : existing.title,
      timersCount: totalCount,
      artistCount: totalCount,
      stages: updatedStages,
      currentDay: this._state.currentDay || existing.currentDay || 1,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    });
    list[idx] = entry;
    this._saveEventsList(list, publish);
  }

  createNewCleanEvent(titleInput) {
    const cleanTitle = (titleInput || '').trim() || `Palco ${this.getEventsList().length + 1}`;
    let code = cleanTitle
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 14);
    if (!code) code = 'PALCO-' + Math.floor(100 + Math.random() * 900);

    // Unmark as deleted if re-used
    this._unmarkDeletedEvent(code);

    const newRoomState = {
      id: code,
      name: cleanTitle,
      currentDay: 1,
      days: { '1': [] },
      timers: [],
      activeTimerId: null,
      message: { text: '', visible: false, level: 'info' },
      regieCall: { fohCallingStage: false, stageCallingFoh: false, triggeredAt: 0, triggeredBy: '' },
      regieMessage: { id: '', text: '', visible: false, sentAt: 0, sentTimeStr: '', ackFoh: null, ackStage: null },
      regieHistory: [],
      theatre: this._createDefaultTheatreState(),
      theme: { viewerBg: '#000000', controllerBg: '#0f0f1a' },
      updatedAt: Date.now()
    };

    try {
      localStorage.setItem(`stagetimer_v10_state_${code}`, JSON.stringify(newRoomState));
      localStorage.setItem('stagetimer_device_room', code);
      localStorage.setItem('stagetimer_last_room', code);
    } catch (e) {}

    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          `stagetimer_v10/${code}/state`,
          JSON.stringify({ sender: this.clientId, sentAt: Date.now(), data: newRoomState }),
          { qos: 0, retain: true }
        );
      } catch (e) {}
    }

    const list = this.getEventsList();
    const existingIdx = list.findIndex(e => e.code === code);
    const entry = this._normalizeRegistryItem({
      id: code,
      code,
      title: cleanTitle,
      timersCount: 0,
      artistCount: 0,
      currentDay: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.push(entry);
    }
    this._saveEventsList(list, true, true);
    return code;
  }

  generateUniquePin(excludeCode = null) {
    let existing = [];
    try {
      const raw = localStorage.getItem(this.registryStorageKey);
      existing = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(existing)) existing = [];
    } catch (_) {}
    const usedPins = new Set(
      existing
        .filter(e => e && (!excludeCode || e.code !== excludeCode))
        .map(e => String(e.pin || '').trim())
        .filter(p => /^\d{4}$/.test(p))
    );

    let pin = '';
    let attempts = 0;
    while (attempts < 10000) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000));
      if (!usedPins.has(candidate)) {
        pin = candidate;
        break;
      }
      attempts++;
    }
    return pin || String(Math.floor(1000 + Math.random() * 9000));
  }

  createEventWithStages({ title, stagesCount = 1, eventType = 'concert', masterPass = '' }) {
    if (masterPass !== '1379brito') {
      throw new Error('Apenas o Master com a senha 1379brito pode criar eventos.');
    }
    const cleanTitle = (title || '').trim() || `Evento ${this.getEventsList().length + 1}`;
    let baseCode = cleanTitle
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 14);
    if (!baseCode) baseCode = 'EVT-' + Math.floor(100 + Math.random() * 900);

    let resolvedEventType = eventType === 'theatre' ? 'theatre' : 'concert';
    const lowerTitle = cleanTitle.toLowerCase();
    if (lowerTitle.includes('teatro') || lowerTitle.includes('peça') || lowerTitle.includes('peca') || lowerTitle.includes('cena') || lowerTitle.includes('espetaculo') || lowerTitle.includes('espetáculo')) {
      resolvedEventType = 'theatre';
    }

    // Unmark baseCode from deleted list if it was previously deleted
    this._unmarkDeletedEvent(baseCode);

    const pin = this.generateUniquePin(baseCode);
    const count = Math.max(1, Math.min(20, parseInt(stagesCount, 10) || 1));
    const stages = [];

    for (let i = 1; i <= count; i++) {
      const stageCode = count === 1 ? baseCode : `${baseCode}-P${i}`;
      const stageName = count === 1 ? (cleanTitle || 'Palco Principal') : `Palco ${i}`;
      this._unmarkDeletedEvent(stageCode);

      const stageState = {
        id: stageCode,
        name: stageName,
        currentDay: 1,
        days: { '1': [] },
        timers: [],
        activeTimerId: null,
        message: { text: '', visible: false, level: 'info' },
        theme: { viewerBg: '#000000', controllerBg: '#0f0f1a' },
        updatedAt: Date.now()
      };

      try {
        localStorage.setItem(`stagetimer_v10_state_${stageCode}`, JSON.stringify(stageState));
        if (i === 1) {
          localStorage.setItem('stagetimer_device_room', stageCode);
          localStorage.setItem('stagetimer_last_room', stageCode);
        }
      } catch (e) {}

      if (this.mqttClient && this.mqttClient.connected) {
        try {
          this.mqttClient.publish(
            `stagetimer_v10/${stageCode}/state`,
            JSON.stringify({ sender: this.clientId, sentAt: Date.now(), data: stageState }),
            { qos: 0, retain: true }
          );
        } catch (e) {}
      }

      stages.push({
        id: stageCode,
        code: stageCode,
        name: stageName,
        timersCount: 0
      });
    }

    let eventItem = this._normalizeRegistryItem({
      id: baseCode,
      code: baseCode,
      title: cleanTitle,
      pin,
      stagesCount: count,
      stages,
      timersCount: 0,
      artistCount: 0,
      currentDay: 1,
      eventType: resolvedEventType,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    if (!eventItem) {
      eventItem = {
        id: baseCode,
        code: baseCode,
        title: cleanTitle,
        pin,
        stagesCount: count,
        stages,
        timersCount: 0,
        artistCount: 0,
        currentDay: 1,
        eventType: resolvedEventType,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }

    const list = this.getEventsList().filter(e => e.code !== baseCode);
    list.unshift(eventItem);
    this._saveEventsList(list, true, true);

    return eventItem;
  }

  verifyEventPin(eventCode, inputPin) {
    const list = this.getEventsList();
    const cleanCode = (eventCode || '').trim().toUpperCase();
    const ev = list.find(e => e.code === cleanCode || e.id === cleanCode);
    if (!ev) return { valid: false, error: 'Evento não encontrado' };
    const cleanPin = String(inputPin || '').trim();
    if (cleanPin === '1379brito' || cleanPin === String(ev.pin || '').trim()) {
      return { valid: true, event: ev };
    }
    return { valid: false, error: 'PIN de 4 dígitos incorreto' };
  }

  renameEvent(code, newTitle) {
    if (!code || !newTitle) return;
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;
    const cleanCode = code.toUpperCase().trim();
    const list = this.getEventsList();
    const item = list.find(e => e.code === cleanCode);
    if (item) {
      item.title = cleanTitle;
      item.updatedAt = Date.now();

      // If the event has only 1 stage and it was sharing the event title, align it too
      if (Array.isArray(item.stages) && item.stages.length === 1) {
        item.stages[0].name = cleanTitle;
        const stCode = (item.stages[0].code || item.stages[0].id || cleanCode).toUpperCase().trim();
        if (stCode && stCode !== cleanCode) {
          try {
            const stKey = `stagetimer_v10_state_${stCode}`;
            const stRaw = localStorage.getItem(stKey);
            if (stRaw) {
              const stParsed = JSON.parse(stRaw);
              stParsed.name = cleanTitle;
              stParsed.updatedAt = Date.now();
              localStorage.setItem(stKey, JSON.stringify(stParsed));
              if (this.mqttClient && this.mqttClient.connected) {
                this.mqttClient.publish(
                  `stagetimer_v10/${stCode}/state`,
                  JSON.stringify({ sender: this.clientId, sentAt: Date.now(), data: stParsed }),
                  { qos: 0, retain: true }
                );
              }
            }
          } catch (_) {}
        }
      }

      this._saveEventsList(list, true, true);

      // Also update local state & MQTT for that event
      try {
        const key = `stagetimer_v10_state_${cleanCode}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.name = cleanTitle;
          parsed.updatedAt = Date.now();
          localStorage.setItem(key, JSON.stringify(parsed));
          if (this.mqttClient && this.mqttClient.connected) {
            this.mqttClient.publish(
              `stagetimer_v10/${cleanCode}/state`,
              JSON.stringify({ sender: this.clientId, sentAt: Date.now(), data: parsed }),
              { qos: 0, retain: true }
            );
          }
        }
      } catch (_) {}

      if (this.cleanRoom === cleanCode && this._state) {
        this._state.name = cleanTitle;
        this._commitStateChange(true);
      }
    }
  }

  renameStage(eventCode, stageCode, newStageName) {
    if (!stageCode || !newStageName) return;
    const cleanStageName = newStageName.trim();
    if (!cleanStageName) return;
    const cleanStageCode = stageCode.toUpperCase().trim();
    const cleanEventCode = (eventCode || '').toUpperCase().trim();

    const list = this.getEventsList();
    let updated = false;

    list.forEach(ev => {
      if (cleanEventCode && ev.code !== cleanEventCode) return;
      if (Array.isArray(ev.stages)) {
        const st = ev.stages.find(s => (s.code || s.id || '').toUpperCase() === cleanStageCode);
        if (st) {
          st.name = cleanStageName;
          ev.updatedAt = Date.now();
          updated = true;
        }
      }
    });

    if (updated) {
      this._saveEventsList(list, true, true);

      // Also update stored stage state & publish over MQTT
      try {
        const key = `stagetimer_v10_state_${cleanStageCode}`;
        const raw = localStorage.getItem(key);
        let parsed = raw ? JSON.parse(raw) : null;
        if (!parsed) {
          parsed = {
            id: cleanStageCode,
            name: cleanStageName,
            currentDay: 1,
            days: { '1': [] },
            timers: [],
            activeTimerId: null,
            message: { text: '', visible: false, level: 'info' },
            theme: { viewerBg: '#000000', controllerBg: '#0f0f1a' },
            updatedAt: Date.now()
          };
        } else {
          parsed.name = cleanStageName;
          parsed.updatedAt = Date.now();
        }
        localStorage.setItem(key, JSON.stringify(parsed));

        if (this.mqttClient && this.mqttClient.connected) {
          this.mqttClient.publish(
            `stagetimer_v10/${cleanStageCode}/state`,
            JSON.stringify({ sender: this.clientId, sentAt: Date.now(), data: parsed }),
            { qos: 0, retain: true }
          );
        }
      } catch (_) {}

      if (this.cleanRoom === cleanStageCode && this._state) {
        this._state.name = cleanStageName;
        this._commitStateChange(true);
      }
    }
  }

  removeStageFromEvent(eventCode, stageCode) {
    if (!eventCode || !stageCode) return;
    const cleanEventCode = eventCode.toUpperCase().trim();
    const cleanStageCode = stageCode.toUpperCase().trim();
    const list = this.getEventsList();
    const ev = list.find(e => e.code === cleanEventCode);
    if (!ev || !Array.isArray(ev.stages) || ev.stages.length <= 1) {
      throw new Error('Não é possível apagar o único palco deste evento.');
    }

    this._recordDeletedEvent(cleanStageCode);
    ev.stages = ev.stages.filter(s => (s.code || s.id || '').toUpperCase() !== cleanStageCode);
    ev.stagesCount = ev.stages.length;
    ev.updatedAt = Date.now();

    try {
      localStorage.removeItem(`stagetimer_v10_state_${cleanStageCode}`);
    } catch (_) {}

    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          `stagetimer_v10/${cleanStageCode}/state`,
          JSON.stringify({ deleted: true, sender: this.clientId, sentAt: Date.now(), data: null }),
          { qos: 0, retain: true }
        );
      } catch (_) {}
    }

    this._saveEventsList(list, true, true);
    return ev;
  }

  deleteEvent(code) {
    return this.deleteEventFromRegistry(code);
  }

  addStageToEvent(eventCode, stageNameInput = '') {
    const cleanCode = (eventCode || '').toUpperCase().trim();
    const list = this.getEventsList();
    const ev = list.find(e => e.code === cleanCode);
    if (!ev) throw new Error('Evento não encontrado');

    const currentStages = Array.isArray(ev.stages) && ev.stages.length > 0
      ? [...ev.stages]
      : [{ code: ev.code, name: ev.title || 'Palco Principal', timersCount: 0 }];

    const nextIndex = currentStages.length + 1;
    const stageName = (stageNameInput || '').trim() || `Palco ${nextIndex}`;
    const stageCode = `${cleanCode}-P${nextIndex}`;

    this._unmarkDeletedEvent(stageCode);

    const stageState = {
      id: stageCode,
      name: stageName,
      currentDay: 1,
      days: { '1': [] },
      timers: [],
      activeTimerId: null,
      message: { text: '', visible: false, level: 'info' },
      regieCall: { fohCallingStage: false, stageCallingFoh: false, triggeredAt: 0, triggeredBy: '' },
      regieMessage: { id: '', text: '', visible: false, sentAt: 0, sentTimeStr: '', ackFoh: null, ackStage: null },
      regieHistory: [],
      theatre: this._createDefaultTheatreState(),
      theme: { viewerBg: '#000000', controllerBg: '#0f0f1a' },
      updatedAt: Date.now()
    };

    try {
      localStorage.setItem(`stagetimer_v10_state_${stageCode}`, JSON.stringify(stageState));
    } catch (e) {}

    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          `stagetimer_v10/${stageCode}/state`,
          JSON.stringify({ sender: this.clientId, sentAt: Date.now(), data: stageState }),
          { qos: 0, retain: true }
        );
      } catch (e) {}
    }

    currentStages.push({
      id: stageCode,
      code: stageCode,
      name: stageName,
      timersCount: 0
    });

    ev.stages = currentStages;
    ev.stagesCount = currentStages.length;
    ev.updatedAt = Date.now();

    this._saveEventsList(list, true, true);
    return ev;
  }

  deleteEventFromRegistry(codeToDelete) {
    if (!codeToDelete) return this.getEventsList();
    const cleanCode = codeToDelete.toUpperCase().trim();
    this._recordDeletedEvent(cleanCode);

    let list = this.getEventsList().filter(e => e.code !== cleanCode);
    try {
      localStorage.removeItem(`stagetimer_v10_state_${cleanCode}`);
      localStorage.removeItem(`stagetimer_v8_state_${cleanCode}`);
      localStorage.removeItem(`stagetimer_live_state_${cleanCode}`);
      if (localStorage.getItem('stagetimer_device_room') === cleanCode) {
        localStorage.removeItem('stagetimer_device_room');
      }
      if (localStorage.getItem('stagetimer_last_room') === cleanCode) {
        localStorage.removeItem('stagetimer_last_room');
      }
    } catch (e) {}

    // Broadcast purge command so every connected screen purges this event immediately
    this.sendDeviceCommand('ALL', { action: 'purge_event', code: cleanCode });

    // Clear retained state on MQTT for that deleted room
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          `stagetimer_v10/${cleanCode}/state`,
          JSON.stringify({ deleted: true, sender: this.clientId, sentAt: Date.now(), data: null }),
          { qos: 0, retain: true }
        );
      } catch (e) {}
    }

    this._saveEventsList(list, true, true);
    return list;
  }

  forceCloudRegistrySync() {
    const list = this.getEventsList();
    const activeCodes = list.map(e => e.code);
    this.sendDeviceCommand('ALL', { action: 'purge_all_ghosts', activeCodes });
    this._saveEventsList(list, true, true);
    return list;
  }

  clearAllEvents() {
    const list = this.getEventsList();
    list.forEach(e => {
      this._recordDeletedEvent(e.code);
      if (this.mqttClient && this.mqttClient.connected) {
        try {
          this.mqttClient.publish(
            `stagetimer_v10/${e.code}/state`,
            JSON.stringify({ deleted: true, sender: this.clientId, sentAt: Date.now(), data: null }),
            { qos: 0, retain: true }
          );
        } catch (err) {}
      }
    });

    // Clear legacy registry topics on MQTT broker
    if (this.mqttClient && this.mqttClient.connected) {
      ['stagetimer_live/_events_list', 'stagetimer_live/_events_list_v6', 'stagetimer_live/_events_list_v7', 'stagetimer_live/_events_list_v8', 'stagetimer_v8/_events_list', 'stagetimer_v10/_events_list', this.mqttTopicRegistry].forEach(top => {
        try {
          this.mqttClient.publish(top, JSON.stringify({ sender: this.clientId, forceReplace: true, events: [] }), { qos: 0, retain: true });
        } catch (_) {}
      });
    }

    try {
      Object.keys(localStorage).forEach((k) => {
        if (
          k.startsWith('stagetimer_live_') ||
          k.startsWith('stagetimer_events_registry_') ||
          k.startsWith('stagetimer_deleted_events_') ||
          k.startsWith('stagetimer_v8_') ||
          k.startsWith('stagetimer_v10_') ||
          k.startsWith('stagetimer_v63_') ||
          k.startsWith('stagetimer_device_room') ||
          k.startsWith('stagetimer_last_room') ||
          k.startsWith('stagetimer_unlocked_event') ||
          k.startsWith('stagetimer_clean_slate_epoch_')
        ) {
          if (k !== 'stagetimer_auth_unlocked' && k !== 'stagetimer_master_auth_v12' && k !== 'stagetimer_device_uuid' && k !== 'stagetimer_master_active') {
            localStorage.removeItem(k);
          }
        }
      });
      sessionStorage.removeItem('stagetimer_active_room');
      sessionStorage.removeItem('stagetimer_unlocked_event');
      localStorage.setItem('stagetimer_clean_slate_epoch_v63', 'true');
    } catch (e) {}

    this._recordDeletedEvent('PALCO1');

    this.sendDeviceCommand('ALL', { action: 'purge_clean_slate_v63' });
    setTimeout(() => {
      try { this.sendDeviceCommand('ALL', { action: 'reload' }); } catch (_) {}
    }, 400);

    this._saveEventsList([], true, true);
    this._state = null;
    return [];
  }

  replaceAllTimers(timers, roomName = null) {
    if (!Array.isArray(timers)) return;
    this._ensureDaysStructure();
    if (roomName) this._state.name = roomName;
    this._state.timers = timers;
    this._state.days[String(this._state.currentDay || 1)] = [...timers];
    this._state.activeTimerId = timers.length > 0 ? timers[0].id : null;
    this._commitStateChange(true);
  }

  replaceAllDays(daysMap, roomName = null, activeDay = 1) {
    if (!daysMap || typeof daysMap !== 'object') return;
    this._ensureDaysStructure();
    if (roomName) this._state.name = roomName;

    const newDays = {};
    const dayKeys = Object.keys(daysMap).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (dayKeys.length === 0) return;

    dayKeys.forEach(k => {
      const arr = Array.isArray(daysMap[String(k)]) ? daysMap[String(k)] : (Array.isArray(daysMap[k]) ? daysMap[k] : []);
      newDays[String(k)] = [...arr];
    });

    this._state.days = newDays;
    const targetDay = newDays[String(activeDay)] ? Number(activeDay) : (dayKeys[0] || 1);
    this._state.currentDay = targetDay;
    this._state.timers = [...(newDays[String(targetDay)] || [])];
    this._state.activeTimerId = this._state.timers.length > 0 ? this._state.timers[0].id : null;
    this._commitStateChange(true);
  }

  replaceDayTimers(dayNumber, timers) {
    if (!Array.isArray(timers)) return;
    this._ensureDaysStructure();
    const dKey = String(Number(dayNumber) || 1);
    this._state.days[dKey] = [...timers];
    if (String(this._state.currentDay || 1) === dKey) {
      this._state.timers = [...timers];
      this._state.activeTimerId = timers.length > 0 ? timers[0].id : null;
    }
    this._commitStateChange(true);
  }

  clearAllTimers() {
    this._ensureDaysStructure();
    this._state.timers = [];
    this._state.days[String(this._state.currentDay || 1)] = [];
    this._state.activeTimerId = null;
    this._state.message = { text: '', visible: false, level: 'info' };
    this._commitStateChange(true);
  }

  _saveLocal() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this._state));
    } catch (e) {}
  }

  _applyIncomingState(incoming, fromCloud = false, sentAt = null) {
    if (!incoming || !Array.isArray(incoming.timers)) return;

    const currentUpdatedAt = this._state?.updatedAt || 0;
    const incomingUpdatedAt = incoming.updatedAt || 0;
    const isCurrentEmpty = Boolean(
      this._state?.isEmptyDefault ||
      currentUpdatedAt === 0
    );

    // Discard stale incoming states (monotonic clock check)
    // If incoming state has an older timestamp, ignore it to prevent jump-back glitches!
    if (!isCurrentEmpty && currentUpdatedAt > 0 && incomingUpdatedAt > 0 && incomingUpdatedAt < currentUpdatedAt) {
      return;
    }

    // Protection against echo / race conditions if a local action occurred recently (< 2.5 seconds)
    if (this._lastLocalActionAt && (this.getTrueTime() - this._lastLocalActionAt < 2500)) {
      if (this._state?.activeTimerId && incoming.activeTimerId !== this._state.activeTimerId) {
        incoming.activeTimerId = this._state.activeTimerId;
      }
    }

    // Protection against day switch echo / race conditions (< 3 seconds)
    if (this._lastDaySwitchAt && (this.getTrueTime() - this._lastDaySwitchAt < 3000)) {
      if (this._state?.currentDay && incoming.currentDay !== this._state.currentDay) {
        incoming.currentDay = this._state.currentDay;
        if (incoming.days && incoming.days[String(incoming.currentDay)]) {
          incoming.timers = [...incoming.days[String(incoming.currentDay)]];
        }
      }
    }

    // Preserve local days map if incoming does not have them or is partial
    if (this._state?.days && typeof this._state.days === 'object') {
      incoming.days = { ...(this._state.days || {}), ...(incoming.days || {}) };
    }

    const trueNow = this.getTrueTime();

    incoming.timers.forEach(incomingT => {
      if (incomingT.state === 'running') {
        const anchor = incomingT.serverStartedAt || incomingT.startedAt;
        if (anchor) {
          incomingT.serverStartedAt = anchor;
          incomingT.startedAt = anchor;
        } else {
          const liveElapsed = typeof incomingT.liveElapsed === 'number'
            ? incomingT.liveElapsed
            : (incomingT.elapsed || 0);
          incomingT.serverStartedAt = trueNow - liveElapsed;
          incomingT.startedAt = incomingT.serverStartedAt;
        }
      }
    });

    try { delete incoming.isEmptyDefault; } catch (_) {}
    this._state = incoming;
    this._ensureDaysStructure();
    this._ensureTheatreStructure();
    this._enforceInactiveReset();

    // Prevent storage circular feedback ping-pong between local tabs
    if (fromCloud) {
      this._saveLocal();
    } else {
      this._syncEventInRegistry(false);
    }

    this._emit('room-state', this._state);
  }

  _enforceInactiveReset() {
    if (!this._state || !Array.isArray(this._state.timers)) return;
    for (const t of this._state.timers) {
      if (t.id !== this._state.activeTimerId) {
        t.state = 'stopped';
        t.elapsed = 0;
        t.liveElapsed = 0;
        t.startedAt = null;
        t.serverStartedAt = null;
      }
    }
  }

  _commitStateChange(retain = true) {
    this._ensureDaysStructure();
    this._enforceInactiveReset();
    if (this._state && this._state.id !== this.cleanRoom) {
      this._state.id = this.cleanRoom;
    }
    const trueNow = this.getTrueTime();
    this._state.updatedAt = trueNow;

    // Save active day lineup in days map
    this._state.days[String(this._state.currentDay || 1)] = [...(this._state.timers || [])];

    // Bake liveElapsed and maintain atomic anchor serverStartedAt
    this._state.timers.forEach(t => {
      if (t.state === 'running') {
        const anchor = t.serverStartedAt || t.startedAt || trueNow;
        t.serverStartedAt = anchor;
        t.startedAt = anchor;
        t.liveElapsed = (t.elapsed || 0) + Math.max(0, trueNow - anchor);
      } else {
        t.liveElapsed = t.elapsed || 0;
      }
    });

    // Also bake liveElapsed for any running timer in other days!
    if (this._state.days && typeof this._state.days === 'object') {
      Object.values(this._state.days).forEach(dayList => {
        if (Array.isArray(dayList)) {
          dayList.forEach(t => {
            if (t.state === 'running') {
              const anchor = t.serverStartedAt || t.startedAt || trueNow;
              t.serverStartedAt = anchor;
              t.startedAt = anchor;
              t.liveElapsed = (t.elapsed || 0) + Math.max(0, trueNow - anchor);
            }
          });
        }
      });
    }

    this._saveLocal();
    this._syncEventInRegistry();

    // 1. Broadcast to local tabs
    if (this.channel) {
      try {
        this.channel.postMessage({
          type: 'room-state',
          sender: this.clientId,
          sentAt: trueNow,
          data: this._state
        });
      } catch (e) {}
    }

    // 2. Publish to Cloud MQTT
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        const payload = JSON.stringify({
          sender: this.clientId,
          sentAt: trueNow,
          data: this._state
        });
        this.mqttClient.publish(this.mqttTopicState, payload, { qos: 0, retain });
      } catch (e) {}
    }

    this._emit('room-state', this._state);
  }

  _startRenderLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      if (!this._state) return;
      let shouldTick = false;

      const activeTimer = UniversalSyncClient.getActiveTimer(this._state);
      if (activeTimer && activeTimer.mode === 'clock') {
        shouldTick = true;
      }

      for (const timer of this._state.timers) {
        if (timer.state === 'running' && timer.startedAt) {
          shouldTick = true;
        }
      }

      if (this._state.days && typeof this._state.days === 'object') {
        for (const dayList of Object.values(this._state.days)) {
          if (Array.isArray(dayList)) {
            for (const t of dayList) {
              if (t.state === 'running' && t.startedAt) {
                shouldTick = true;
              }
            }
          }
        }
      }

      if (shouldTick) {
        this._emit('room-state', this._state);
      }
    }, 100);
  }

  // ─── Actions (Work from Controller, Operator & Master) ─────────────

  createTimer(data = {}) {
    if (!this._state.theme) {
      this._state.theme = { viewerBg: '#000000', controllerBg: '#0f0f1a' };
    }
    const timer = {
      id: data.id || ('t_' + Math.random().toString(36).substring(2, 9)),
      name: data.name || 'Novo Artista',
      notes: data.notes || '',
      startTime: data.startTime || '',
      mode: data.mode || 'countdown',
      duration: data.duration || 300000,
      elapsed: 0,
      state: 'stopped',
      warnAt: data.warnAt ?? 60000,
      dangerAt: data.dangerAt ?? 10000,
      startedAt: null
    };
    this._state.timers.push(timer);
    if (!this._state.activeTimerId || data.setActive) {
      this._state.activeTimerId = timer.id;
    }
    this._commitStateChange();
    return timer;
  }

  _parseStartMins(str) {
    if (!str) return null;
    const m = String(str).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  _formatMins(totalMins) {
    const norm = ((Math.round(totalMins) % 1440) + 1440) % 1440;
    const hh = String(Math.floor(norm / 60)).padStart(2, '0');
    const mm = String(norm % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  _formatSlotRange(startMins, durationMs) {
    const durMins = Math.round((durationMs || 0) / 60000);
    return `${this._formatMins(startMins)} – ${this._formatMins(startMins + durMins)}`;
  }

  _cascadeSubsequentTimers(fromIdx, deltaMins) {
    if (!deltaMins || !this._state?.timers) return;
    for (let j = fromIdx + 1; j < this._state.timers.length; j++) {
      const nextT = this._state.timers[j];
      const sMins = this._parseStartMins(nextT.startTime);
      if (sMins !== null) {
        const newStart = sMins + deltaMins;
        nextT.startTime = this._formatSlotRange(newStart, nextT.duration);
      }
    }
  }

  updateTimer(id, updates) {
    const idx = this._state.timers.findIndex(t => t.id === id);
    if (idx < 0) return;
    const timer = this._state.timers[idx];

    if (typeof updates.duration === 'number' && updates.duration !== timer.duration) {
      const deltaMins = Math.round((updates.duration - timer.duration) / 60000);
      timer.duration = updates.duration;
      const sMins = this._parseStartMins(timer.startTime);
      if (sMins !== null) {
        timer.startTime = this._formatSlotRange(sMins, timer.duration);
      }
      this._cascadeSubsequentTimers(idx, deltaMins);
      delete updates.duration;
    }

    if (typeof updates.startTime === 'string' && updates.startTime !== timer.startTime) {
      const oldStart = this._parseStartMins(timer.startTime);
      const newStart = this._parseStartMins(updates.startTime);
      const rangeMatch = updates.startTime.match(/(\d{1,2})\s*[:hH]\s*(\d{2})\s*[-–—a]\s*(\d{1,2})\s*[:hH]\s*(\d{2})/);
      if (rangeMatch && newStart !== null) {
        const endMins = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10);
        let durMins = endMins - newStart;
        if (durMins <= 0) durMins += 1440;
        timer.duration = durMins * 60000;
        updates.startTime = this._formatSlotRange(newStart, timer.duration);
      } else if (newStart !== null) {
        updates.startTime = this._formatSlotRange(newStart, timer.duration);
      }
      if (oldStart !== null && newStart !== null) {
        let deltaMins = newStart - oldStart;
        if (deltaMins > 720) deltaMins -= 1440;
        if (deltaMins < -720) deltaMins += 1440;
        this._cascadeSubsequentTimers(idx, deltaMins);
      }
    }

    Object.assign(timer, updates);
    this._commitStateChange();
  }

  deleteTimer(id) {
    const idx = this._state.timers.findIndex(t => t.id === id);
    if (idx >= 0) {
      const deletedId = this._state.timers[idx].id;
      this._state.timers.splice(idx, 1);
      if (this._state.activeTimerId === deletedId) {
        this._state.activeTimerId = this._state.timers[0]?.id || null;
      }
      this._commitStateChange();
    }
  }

  timerAction(id, action) {
    let timer = this._state.timers.find(t => t.id === id);
    if (!timer && this._state.days) {
      for (const dayList of Object.values(this._state.days)) {
        if (Array.isArray(dayList)) {
          const found = dayList.find(t => t.id === id);
          if (found) { timer = found; break; }
        }
      }
    }
    if (!timer) return;
    const trueNow = this.getTrueTime();

    switch (action) {
      case 'start':
        this._lastLocalActionAt = trueNow;
        // Stop any previously running timer across ALL days and timers so only the fired timer runs
        if (this._state.days && typeof this._state.days === 'object') {
          for (const dayList of Object.values(this._state.days)) {
            if (Array.isArray(dayList)) {
              for (const other of dayList) {
                if (other.id !== timer.id && other.state === 'running') {
                  const anchor = other.serverStartedAt || other.startedAt;
                  if (anchor) other.elapsed += Math.max(0, trueNow - anchor);
                  other.state = 'stopped';
                  other.startedAt = null;
                  other.serverStartedAt = null;
                }
              }
            }
          }
        }
        for (const other of this._state.timers) {
          if (other.id !== timer.id && other.state === 'running') {
            const anchor = other.serverStartedAt || other.startedAt;
            if (anchor) other.elapsed += Math.max(0, trueNow - anchor);
            other.state = 'stopped';
            other.startedAt = null;
            other.serverStartedAt = null;
          }
        }
        // ONLY ON FIRE / START: this timer becomes the active on-air timer!
        this._state.activeTimerId = timer.id;
        if (timer.state !== 'running') {
          if (timer.state === 'finished') timer.elapsed = 0;
          timer.state = 'running';
          timer.startedAt = trueNow;
          timer.serverStartedAt = trueNow;
        }
        break;
      case 'pause':
        if (timer.state === 'running') {
          const anchor = timer.serverStartedAt || timer.startedAt;
          if (anchor) timer.elapsed += Math.max(0, trueNow - anchor);
          timer.state = 'stopped';
          timer.startedAt = null;
          timer.serverStartedAt = null;
        }
        break;
      case 'reset':
        timer.state = 'stopped';
        timer.elapsed = 0;
        timer.liveElapsed = 0;
        timer.startedAt = null;
        timer.serverStartedAt = null;
        break;
      case 'toggle':
        if (timer.state === 'running') {
          this.timerAction(id, 'pause');
        } else {
          this.timerAction(id, 'start');
        }
        return;
    }
    this._commitStateChange();
  }

  adjustTime(id, deltaMs) {
    let timer = this._state.timers.find(t => t.id === id);
    if (!timer && this._state.days) {
      for (const dayList of Object.values(this._state.days)) {
        if (Array.isArray(dayList)) {
          const found = dayList.find(t => t.id === id);
          if (found) { timer = found; break; }
        }
      }
    }
    if (!timer) return;

    const oldDuration = timer.duration;
    timer.duration = Math.max(60000, timer.duration + deltaMs);
    const actualDeltaMins = Math.round((timer.duration - oldDuration) / 60000);

    if (timer.state === 'finished' && timer.duration > timer.elapsed) {
      timer.state = 'stopped';
    }

    const idx = this._state.timers.findIndex(t => t.id === id);
    if (actualDeltaMins !== 0 && idx >= 0) {
      const sMins = this._parseStartMins(timer.startTime);
      if (sMins !== null) {
        timer.startTime = this._formatSlotRange(sMins, timer.duration);
      }
      this._cascadeSubsequentTimers(idx, actualDeltaMins);
    }

    this._commitStateChange();
  }

  setActiveTimer(id) {
    let timer = this._state.timers.find(t => t.id === id);
    if (!timer && this._state.days) {
      for (const dayList of Object.values(this._state.days)) {
        if (Array.isArray(dayList)) {
          const found = dayList.find(t => t.id === id);
          if (found) { timer = found; break; }
        }
      }
    }
    if (timer) {
      this._lastLocalActionAt = this.getTrueTime();
      this._state.activeTimerId = id;
      this._commitStateChange();
    }
  }

  sendMessage(text, visible = true, level = 'info') {
    this._state.message = { text, visible, level };
    this._commitStateChange();
  }

  clearMessage() {
    this._state.message = { text: '', visible: false, level: 'info' };
    this._commitStateChange();
  }

  // ─── Régie Intercom Call & Messages ─────────────────────────────────

  triggerRegieCall(target, fromStation = '') {
    if (!this._state) return;
    this._ensureRegieStructure();
    const now = Date.now();
    const tgt = String(target || '').toLowerCase();
    let sender = fromStation;
    let targetName = 'Todos';

    if (tgt === 'stage' || tgt === 'palco') {
      this._state.regieCall.fohCallingStage = true;
      this._state.regieCall.triggeredAt = now;
      this._state.regieCall.triggeredBy = fromStation || 'FOH';
      sender = fromStation || 'FOH';
      targetName = 'Palco';
    } else if (tgt === 'foh' || tgt === 'frente') {
      this._state.regieCall.stageCallingFoh = true;
      this._state.regieCall.triggeredAt = now;
      this._state.regieCall.triggeredBy = fromStation || 'PALCO';
      sender = fromStation || 'PALCO';
      targetName = 'FOH';
    } else {
      this._state.regieCall.fohCallingStage = true;
      this._state.regieCall.stageCallingFoh = true;
      this._state.regieCall.triggeredAt = now;
      this._state.regieCall.triggeredBy = fromStation || 'ALL';
      sender = fromStation || 'ALL';
      targetName = 'Geral';
    }

    // Record in history log
    if (!Array.isArray(this._state.regieHistory)) {
      this._state.regieHistory = [];
    }
    const callTimeStr = (new Date()).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this._state.regieHistory.unshift({
      id: 'rc_' + now + '_' + Math.random().toString(36).substr(2, 4),
      type: 'call',
      from: sender,
      target: targetName,
      text: `Chamada de Intercom (${sender} ➔ ${targetName})`,
      timeStr: callTimeStr,
      ts: now
    });
    if (this._state.regieHistory.length > 30) {
      this._state.regieHistory = this._state.regieHistory.slice(0, 30);
    }

    this._commitStateChange();

    // Auto-expire call after exactly 5 seconds
    if (this._regieCallTimer) clearTimeout(this._regieCallTimer);
    this._regieCallTimer = setTimeout(() => {
      this.clearRegieCall(target);
    }, 5000);
  }

  clearRegieCall(target = 'all') {
    if (!this._state) return;
    this._ensureRegieStructure();
    const tgt = String(target || '').toLowerCase();
    if (tgt === 'stage' || tgt === 'palco') {
      this._state.regieCall.fohCallingStage = false;
    } else if (tgt === 'foh' || tgt === 'frente') {
      this._state.regieCall.stageCallingFoh = false;
    } else {
      this._state.regieCall.fohCallingStage = false;
      this._state.regieCall.stageCallingFoh = false;
    }
    this._commitStateChange();
  }

  sendRegieMessage(text) {
    if (!this._state) return;
    this._ensureRegieStructure();
    const cleanText = (text || '').trim();
    if (!cleanText) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const msgId = 'rm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    this._state.regieMessage = {
      id: msgId,
      text: cleanText,
      visible: true,
      sentAt: Date.now(),
      sentTimeStr: timeStr,
      ackFoh: null,
      ackStage: null
    };

    // Record in history log
    if (!Array.isArray(this._state.regieHistory)) {
      this._state.regieHistory = [];
    }
    this._state.regieHistory.unshift({
      id: msgId,
      type: 'msg',
      from: 'Stage Manager',
      text: cleanText,
      timeStr: timeStr,
      ts: Date.now(),
      ackFoh: null,
      ackStage: null
    });
    if (this._state.regieHistory.length > 30) {
      this._state.regieHistory = this._state.regieHistory.slice(0, 30);
    }

    this._commitStateChange();
  }

  clearRegieMessage() {
    if (!this._state) return;
    this._ensureRegieStructure();
    this._state.regieMessage = {
      id: '',
      text: '',
      visible: false,
      sentAt: 0,
      sentTimeStr: '',
      ackFoh: null,
      ackStage: null
    };
    this._commitStateChange();
  }

  ackRegieMessage(station) {
    if (!this._state) return;
    this._ensureRegieStructure();
    if (!this._state.regieMessage || !this._state.regieMessage.visible) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const st = String(station || '').toLowerCase();
    if (st === 'foh' || st === 'frente') {
      this._state.regieMessage.ackFoh = timeStr;
    } else if (st === 'stage' || st === 'palco') {
      this._state.regieMessage.ackStage = timeStr;
    }

    // Update read receipts in history item
    if (Array.isArray(this._state.regieHistory)) {
      const histItem = this._state.regieHistory.find(h => h.id === this._state.regieMessage.id);
      if (histItem) {
        if (st === 'foh' || st === 'frente') histItem.ackFoh = timeStr;
        if (st === 'stage' || st === 'palco') histItem.ackStage = timeStr;
      }
    }

    this._commitStateChange();

    // If both stations have acknowledged reading, auto-clear message after 5 seconds
    if (this._state.regieMessage.ackFoh && this._state.regieMessage.ackStage) {
      if (this._regieMsgClearTimer) clearTimeout(this._regieMsgClearTimer);
      this._regieMsgClearTimer = setTimeout(() => {
        this.clearRegieMessage();
      }, 5000);
    }
  }

  // ─── Theatre Suite (Mesa DC & Cue Stations) ─────────────────────────

  standbyCue(cueId) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    const target = th.cues.find(c => c.id === cueId);
    if (!target) return;

    // Reset previous standby if any
    th.cues.forEach(c => {
      if (c.status === 'standby' && c.id !== cueId) {
        c.status = 'pending';
      }
    });

    target.status = 'standby';
    target.standbyAt = Date.now();
    th.standbyCueId = target.id;
    this._commitStateChange();
  }

  fireCue(cueId) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    const target = th.cues.find(c => c.id === cueId);
    if (!target) return;

    const now = Date.now();
    let elapsedMs = 0;
    if (th.showStartTime > 0) {
      elapsedMs = Math.max(0, now - th.showStartTime);
    }

    const elapsedTotalSecs = Math.floor(elapsedMs / 1000);
    const hh = String(Math.floor(elapsedTotalSecs / 3600)).padStart(2, '0');
    const mm = String(Math.floor((elapsedTotalSecs % 3600) / 60)).padStart(2, '0');
    const ss = String(elapsedTotalSecs % 60).padStart(2, '0');
    const timecode = `+${hh}:${mm}:${ss}`;

    target.status = 'fired';
    target.firedAt = now;
    target.firedTimecode = timecode;
    th.activeCueId = target.id;
    th.standbyCueId = null;

    // Record in Telemetry log
    if (!Array.isArray(th.telemetry)) th.telemetry = [];
    th.telemetry.unshift({
      id: 'tel_' + now + '_' + Math.random().toString(36).substr(2, 4),
      cueId: target.id,
      num: target.num,
      name: target.name,
      departments: [...(target.departments || [])],
      timecode: timecode,
      firedAt: now,
      feedbacks: []
    });

    if (th.telemetry.length > 100) {
      th.telemetry = th.telemetry.slice(0, 100);
    }

    this._commitStateChange();
  }

  completeCue(cueId) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    const target = th.cues.find(c => c.id === cueId);
    if (!target) return;
    target.status = 'completed';
    if (th.activeCueId === cueId) th.activeCueId = null;
    this._commitStateChange();
  }

  resetCue(cueId) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    const target = th.cues.find(c => c.id === cueId);
    if (!target) return;
    target.status = 'pending';
    target.standbyAt = 0;
    target.firedAt = 0;
    target.firedTimecode = '';
    target.feedbacks = [];
    if (th.standbyCueId === cueId) th.standbyCueId = null;
    if (th.activeCueId === cueId) th.activeCueId = null;
    this._commitStateChange();
  }

  startTheatreShow() {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    th.showState = 'running';
    if (!th.showStartTime || th.showStartTime === 0) {
      th.showStartTime = Date.now();
    } else if (th.showPausedAt > 0) {
      const pauseDuration = Date.now() - th.showPausedAt;
      th.showStartTime += pauseDuration;
      th.showPausedAt = 0;
    }
    this._commitStateChange();
  }

  pauseTheatreShow() {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    th.showState = 'paused';
    th.showPausedAt = Date.now();
    this._commitStateChange();
  }

  endTheatreShow() {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    th.showState = 'ended';
    if (th.showStartTime > 0) {
      th.showElapsedMs = Date.now() - th.showStartTime;
    }
    this._commitStateChange();
  }

  resetTheatreShow() {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    th.showState = 'pre';
    th.showStartTime = 0;
    th.showPausedAt = 0;
    th.showElapsedMs = 0;
    th.activeCueId = null;
    th.standbyCueId = null;
    th.cues.forEach(c => {
      c.status = 'pending';
      c.standbyAt = 0;
      c.firedAt = 0;
      c.firedTimecode = '';
      c.feedbacks = [];
    });
    this._commitStateChange();
  }

  toggleChecklistItem(dept, itemId, done) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    if (!th.checklists || !Array.isArray(th.checklists[dept])) return;
    const item = th.checklists[dept].find(i => i.id === itemId);
    if (!item) return;
    item.done = Boolean(done);
    this._commitStateChange();
  }

  addChecklistItem(dept, label, isOneOff = false) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    if (!th.checklists) th.checklists = {};
    if (!Array.isArray(th.checklists[dept])) th.checklists[dept] = [];
    const cleanLabel = (label || '').trim();
    if (!cleanLabel) return;
    th.checklists[dept].push({
      id: 'chk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      label: cleanLabel,
      done: false,
      isOneOff: Boolean(isOneOff)
    });
    this._commitStateChange();
  }

  removeChecklistItem(dept, itemId) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    if (!th.checklists || !Array.isArray(th.checklists[dept])) return;
    th.checklists[dept] = th.checklists[dept].filter(i => i.id !== itemId);
    this._commitStateChange();
  }

  sendUrgentNotice(text, level = 'warn') {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const cleanText = (text || '').trim();
    if (!cleanText) return;
    this._state.theatre.urgentNotice = {
      text: cleanText,
      level: level || 'warn',
      visible: true,
      sentAt: Date.now()
    };
    this._commitStateChange();
  }

  clearUrgentNotice() {
    if (!this._state) return;
    this._ensureTheatreStructure();
    this._state.theatre.urgentNotice = {
      text: '',
      level: 'warn',
      visible: false,
      sentAt: 0
    };
    this._commitStateChange();
  }

  sendTechnicalFeedback(cueId, dept, feedbackType, note = '') {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    const cue = th.cues.find(c => c.id === cueId);
    if (!cue) return;
    if (!Array.isArray(cue.feedbacks)) cue.feedbacks = [];
    const fb = {
      dept: dept || 'Técnico',
      type: feedbackType,
      note: (note || '').trim(),
      ts: Date.now()
    };
    cue.feedbacks.push(fb);

    if (Array.isArray(th.telemetry)) {
      const tel = th.telemetry.find(t => t.cueId === cueId);
      if (tel) {
        if (!Array.isArray(tel.feedbacks)) tel.feedbacks = [];
        tel.feedbacks.push(fb);
      }
    }

    this._commitStateChange();
  }

  deleteCue(cueId) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    if (!Array.isArray(th.cues)) return;
    th.cues = th.cues.filter(c => c.id !== cueId);
    if (th.standbyCueId === cueId) th.standbyCueId = null;
    if (th.activeCueId === cueId) th.activeCueId = null;
    this._commitStateChange();
  }

  editCue(cueId, cueData = {}) {
    if (!this._state) return;
    this._ensureTheatreStructure();
    const th = this._state.theatre;
    if (!Array.isArray(th.cues)) return;
    const target = th.cues.find(c => c.id === cueId);
    if (!target) return;
    if (cueData.num !== undefined) target.num = String(cueData.num).trim();
    if (cueData.name !== undefined) target.name = String(cueData.name).trim();
    if (cueData.targetText !== undefined) target.targetText = String(cueData.targetText).trim();
    if (cueData.notes !== undefined) target.notes = String(cueData.notes).trim();
    if (Array.isArray(cueData.departments)) target.departments = [...cueData.departments];
    this._commitStateChange();
  }

  clearAllCues() {
    if (!this._state) return;
    this._ensureTheatreStructure();
    this._state.theatre.cues = [];
    this._state.theatre.standbyCueId = null;
    this._state.theatre.activeCueId = null;
    this._commitStateChange();
  }

  updateTheatreCues(cues) {
    if (!this._state || !Array.isArray(cues)) return;
    this._ensureTheatreStructure();
    this._state.theatre.cues = cues;
    this._commitStateChange();
  }

  updateTheatreScript(script) {
    if (!this._state || !Array.isArray(script)) return;
    this._ensureTheatreStructure();
    this._state.theatre.script = script;
    this._commitStateChange();
  }

  updateTheme(theme) {
    this._state.theme = { ...(this._state.theme || {}), ...theme };
    this._commitStateChange();
  }

  reorderTimers(order) {
    if (Array.isArray(order)) {
      const oldTimers = this._state.timers || [];
      const posMeta = oldTimers.map((t, i) => {
        const sMins = this._parseStartMins(t.startTime);
        const durMins = Math.round((t.duration || 0) / 60000);
        return { sMins, endMins: sMins !== null ? sMins + durMins : null };
      });
      const gaps = posMeta.map((cur, i) => {
        if (i === 0 || cur.sMins === null || posMeta[i - 1].endMins === null) return null;
        let diff = cur.sMins - (posMeta[i - 1].endMins % 1440);
        if (diff < -720) diff += 1440;
        if (diff > 720) diff -= 1440;
        if (Math.abs(diff) > 120) return null;
        return diff;
      });

      const reordered = [];
      for (const id of order) {
        const t = oldTimers.find(item => item.id === id);
        if (t) reordered.push(t);
      }
      for (const t of oldTimers) {
        if (!reordered.includes(t)) reordered.push(t);
      }

      let prevEnd = null;
      reordered.forEach((t, i) => {
        if (t.mode === 'clock') return;
        let curStart = null;
        if (i === 0 || gaps[i] === null || prevEnd === null) {
          curStart = posMeta[i]?.sMins ?? this._parseStartMins(t.startTime);
        } else {
          curStart = prevEnd + gaps[i];
        }
        if (curStart !== null) {
          t.startTime = this._formatSlotRange(curStart, t.duration);
          prevEnd = curStart + Math.round((t.duration || 0) / 60000);
        }
      });

      this._state.timers = reordered;
      this._commitStateChange();
    }
  }

  globalAction(action) {
    for (const t of this._state.timers) {
      this.timerAction(t.id, action);
    }
    if (action === 'reset' && this._state.timers.length > 0) {
      this._state.activeTimerId = this._state.timers[0].id;
      this._state.message = { text: '', visible: false, level: 'info' };
      this._commitStateChange(true);
    }
  }

  // ─── Mathematical Timing Helpers (Unified Across All Modes) ─────────

  static computeCascadeSchedule(state) {
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) {
      return { slots: [], eventEndStr: '--:--' };
    }

    const trueNow = UniversalSyncClient.globalTrueTime();
    const activeIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const activeTimer = activeIdx >= 0 ? state.timers[activeIdx] : null;

    const formatMins = (m) => {
      const norm = ((Math.round(m) % 1440) + 1440) % 1440;
      const hh = String(Math.floor(norm / 60)).padStart(2, '0');
      const mm = String(norm % 60).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    const parseMins = (str) => {
      if (!str) return null;
      const match = String(str).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
      if (!match) return null;
      return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    };

    const localDate = new Date(trueNow);
    const nowMins = localDate.getHours() * 60 + localDate.getMinutes() + localDate.getSeconds() / 60;

    const slots = [];
    let lastEndMins = null;

    for (let i = 0; i < state.timers.length; i++) {
      const t = state.timers[i];
      if (t.mode === 'clock') {
        slots.push({
          id: t.id,
          startStr: '--:--',
          endStr: '--:--',
          endStrClean: '--:--',
          slotRange: 'Relógio',
          isOvertime: false,
          overtimeMins: 0
        });
        continue;
      }

      const durMins = Math.max(0.1, (t.duration || 0) / 60000);
      const isAct = (i === activeIdx);
      const isRunning = isAct && t.state === 'running';
      const isPaused = isAct && t.state === 'paused';
      const elapsed = isAct ? UniversalSyncClient.getTimerElapsed(t) : (t.elapsed || 0);
      const elapsedMins = elapsed / 60000;
      const overtimeMins = Math.max(0, Math.floor((elapsed - (t.duration || 0)) / 60000));
      const remainingMins = Math.max(0, durMins - elapsedMins);

      let itemStartMins;
      let itemEndMins;

      const explicitStart = parseMins(t.startTime);

      if (isRunning || isPaused) {
        // Active timer live on air: its expected finish is NOW + remaining time
        itemStartMins = (lastEndMins !== null)
          ? lastEndMins
          : (explicitStart !== null ? explicitStart : (nowMins - elapsedMins));
        itemEndMins = nowMins + remainingMins;
      } else if (i < activeIdx || t.state === 'finished') {
        // Already finished timer
        itemStartMins = (explicitStart !== null)
          ? explicitStart
          : (lastEndMins !== null ? lastEndMins : nowMins);
        itemEndMins = itemStartMins + durMins;
      } else {
        // Upcoming or waiting timer
        if (lastEndMins !== null) {
          // If previous timer finished later than this timer's explicit schedule, cascade pushed forward!
          if (explicitStart !== null && explicitStart > lastEndMins && (!activeTimer || activeTimer.state !== 'running')) {
            itemStartMins = explicitStart;
          } else {
            itemStartMins = lastEndMins;
          }
        } else {
          itemStartMins = (explicitStart !== null) ? explicitStart : nowMins;
        }
        itemEndMins = itemStartMins + durMins;
      }

      lastEndMins = itemEndMins;

      const startStr = formatMins(itemStartMins);
      const endStr = formatMins(itemEndMins);
      const otStr = (isRunning || isPaused) && overtimeMins > 0 ? ` (+${overtimeMins}m)` : '';

      slots.push({
        id: t.id,
        startMins: itemStartMins,
        endMins: itemEndMins,
        startStr,
        endStr: `${endStr}${otStr}`,
        endStrClean: endStr,
        slotRange: `${startStr} – ${endStr}`,
        isOvertime: overtimeMins > 0,
        overtimeMins
      });
    }

    const countdownSlots = slots.filter(s => s.slotRange !== 'Relógio');
    const lastCountdown = countdownSlots.length > 0 ? countdownSlots[countdownSlots.length - 1] : null;
    const eventEndStr = lastCountdown ? lastCountdown.endStr : '--:--';

    return { slots, eventEndStr };
  }

  static computeTimerEndTime(state, timerId) {
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) return '';
    const cascade = UniversalSyncClient.computeCascadeSchedule(state);
    const slot = cascade.slots.find(s => s.id === timerId);
    return slot ? slot.endStr : '';
  }

  static getActiveTimer(state) {
    if (!state) return null;
    const targetId = state.activeTimerId;
    if (targetId) {
      // 1. Check in currently active/viewed timers array
      if (Array.isArray(state.timers)) {
        const found = state.timers.find(t => t.id === targetId);
        if (found) return found;
      }
      // 2. Check across all days!
      if (state.days && typeof state.days === 'object') {
        for (const dayList of Object.values(state.days)) {
          if (Array.isArray(dayList)) {
            const found = dayList.find(t => t.id === targetId);
            if (found) return found;
          }
        }
      }
    }
    // 3. Priority fallback: check if ANY timer across any day is currently running!
    if (state.days && typeof state.days === 'object') {
      for (const dayList of Object.values(state.days)) {
        if (Array.isArray(dayList)) {
          const running = dayList.find(t => t.state === 'running');
          if (running) return running;
        }
      }
    }
    if (Array.isArray(state.timers)) {
      const running = state.timers.find(t => t.state === 'running');
      if (running) return running;
    }
    // 4. Default fallback: first timer of current day
    return state.timers?.[0] || null;
  }

  static computeEventEndTime(state) {
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) return '--:--';
    const countdownTimers = state.timers.filter(t => t.mode !== 'clock');
    if (countdownTimers.length === 0) return '--:--';
    if (countdownTimers.every(t => t.state === 'finished')) return 'Concluído';

    const cascade = UniversalSyncClient.computeCascadeSchedule(state);
    return cascade.eventEndStr;
  }

  // ─── Event System ───────────────────────────────────────────────────

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  _emit(event, data) {
    this.listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch (e) { console.error(e); }
    });
  }
}

window.StageTimerClient = UniversalSyncClient;
