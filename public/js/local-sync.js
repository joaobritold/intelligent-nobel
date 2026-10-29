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

    this.channelName = `stagetimer_live_${this.cleanRoom}`;
    this.cmdChannelName = 'stagetimer_global_cmds_v2';
    this.storageKey = `stagetimer_live_state_${this.cleanRoom}`;
    this.mqttTopicState = `stagetimer_live/${this.cleanRoom}/state`;
    this.mqttTopicPresence = `stagetimer_live/${this.cleanRoom}/presence`;
    this.mqttTopicRegistry = 'stagetimer_live/_events_list_v7';
    this.legacyMqttTopicRegistry = 'stagetimer_live/_events_list_v6';
    this.mqttTopicGlobalPresence = 'stagetimer_live/_global_presence';
    this.mqttTopicCommands = 'stagetimer_live/_commands';
    this.mqttTopicAllCmd = 'stagetimer_live/_cmd_all';
    this.registryStorageKey = 'stagetimer_events_registry_v7';
    this.deletedStorageKey = 'stagetimer_deleted_events_v7';

    // ── Clean Slate Epoch v7 Reset ──
    const CLEAN_SLATE_EPOCH = 'stagetimer_clean_slate_epoch_v7';
    if (localStorage.getItem(CLEAN_SLATE_EPOCH) !== 'true') {
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (
            k && (
              k.startsWith('stagetimer_events_registry_') ||
              k.startsWith('stagetimer_deleted_events_') ||
              k.startsWith('stagetimer_live_state_') ||
              k.startsWith('stagetimer_device_room') ||
              k.startsWith('stagetimer_last_room') ||
              k.startsWith('stagetimer_unlocked_event')
            )
          ) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => {
          try { localStorage.removeItem(k); } catch (_) {}
        });
        try { sessionStorage.removeItem('stagetimer_active_room'); } catch (_) {}
        localStorage.setItem(CLEAN_SLATE_EPOCH, 'true');
        localStorage.setItem('stagetimer_device_room', 'PALCO1');
        localStorage.setItem('stagetimer_last_room', 'PALCO1');
      } catch (e) {}
    }

    // Prune obsolete registry versions to eliminate ghost events
    ['stagetimer_events_registry_v1', 'stagetimer_events_registry_v2', 'stagetimer_events_registry_v3', 'stagetimer_events_registry_v4', 'stagetimer_events_registry_v5', 'stagetimer_events_registry_v6'].forEach(k => {
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

    this.mqttTopicDeviceCmd = `stagetimer_live/_cmd/${this.deviceUuid}`;
    this.mqttTopicRoomCmd = `stagetimer_live/_cmd_room/${this.cleanRoom}`;
    this.mqttTopicAllCmd = 'stagetimer_live/_cmd_all';

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
    if (path.includes('operator')) return 'operator';
    if (path.includes('viewer')) return 'viewer';
    if (path.includes('controller')) return 'controller';
    if (path.includes('index') || path === '' || path === '/') return 'index';

    if (this.role === 'master') return 'master';
    if (this.role === 'operator') return 'operator';
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
      const regItem = this.getEventsList().find(e => e.code === this.cleanRoom);
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
        const regItem = this.getEventsList().find(e => e.code === this.cleanRoom);
        this._state = this._createDefaultRoom(this.cleanRoom);
        if (regItem && regItem.title) {
          this._state.name = regItem.title;
        }
        this._saveLocal();
      }
    }

    // Ensure days structure is initialized
    this._ensureDaysStructure();
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
              'stagetimer_live/_device_removed',
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
      try { localStorage.removeItem(`stagetimer_live_state_${purgeCode}`); } catch (e) {}
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
          if (key.startsWith('stagetimer_live_state_')) {
            const c = key.replace('stagetimer_live_state_', '').toUpperCase();
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

    if (msg.action === 'purge_clean_slate_v7') {
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
        localStorage.setItem('stagetimer_clean_slate_epoch_v7', 'true');
        localStorage.setItem('stagetimer_device_room', 'PALCO1');
        localStorage.setItem('stagetimer_last_room', 'PALCO1');
      } catch (_) {}
      window.location.replace(`index.html?clean_slate=v7&_ts=${Date.now()}`);
      return;
    }

    if (msg.action === 'request_registry') {
      const list = this.getEventsList();
      if (list && list.length > 0 && this.mqttClient && this.mqttClient.connected) {
        try {
          const payload = JSON.stringify({ sender: this.clientId, forceReplace: false, events: list });
          this.mqttClient.publish(this.mqttTopicRegistry, payload, { qos: 0, retain: true });
          this.mqttClient.publish(this.legacyMqttTopicRegistry, payload, { qos: 0, retain: true });
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

      const topicsToSubscribe = [
        this.mqttTopicState,
        this.mqttTopicPresence,
        this.mqttTopicRegistry,
        this.legacyMqttTopicRegistry,
        this.mqttTopicGlobalPresence,
        this.mqttTopicCommands,
        this.mqttTopicAllCmd,
        this.mqttTopicDeviceCmd,
        this.mqttTopicRoomCmd,
        'stagetimer_live/_cmd/+',
        'stagetimer_live/_cmd_room/+',
        'stagetimer_live/_device_removed'
      ];

      // If in Master mode, also subscribe to all room state broadcasts
      if (this.role === 'master') {
        topicsToSubscribe.push('stagetimer_live/+/state');
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
            topic.startsWith('stagetimer_live/_cmd/') ||
            topic.startsWith('stagetimer_live/_cmd_room/')) {
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
        } else if (topic.startsWith('stagetimer_live/') && topic.endsWith('/state')) {
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
        } else if (topic === this.mqttTopicRegistry || topic === this.legacyMqttTopicRegistry) {
          if (msg && Array.isArray(msg.events)) {
            this._mergeIncomingRegistry(msg.events, Boolean(msg.forceReplace));
          }
        } else if (topic === this.mqttTopicPresence) {
          if (msg.clientId) {
            this.peersMap.set(msg.clientId, Date.now());
            this._cleanupPeers();
          }
        } else if (topic === 'stagetimer_live/_device_removed') {
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
          'stagetimer_live/_device_removed',
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
          this.mqttClient.publish(`stagetimer_live/_cmd/${target}`, json, { qos: 0, retain: false });
        }
      } catch (e) {}
    }
  }

  sendRoomCommand(roomCode, command) {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    try {
      const clean = (roomCode || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      const topic = `stagetimer_live/_cmd_room/${clean}`;
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
  }

  // ─── Multi-Day Management ──────────────────────────────────────────

  switchDay(dayNumber) {
    if (!this._state) return;
    this._ensureDaysStructure();
    const targetDay = Number(dayNumber) || 1;
    const curDayKey = String(this._state.currentDay || 1);
    const targetKey = String(targetDay);

    // Save current active day lineup
    this._state.days[curDayKey] = [...(this._state.timers || [])];

    // Initialize target day if needed
    if (!Array.isArray(this._state.days[targetKey])) {
      this._state.days[targetKey] = [];
    }

    this._state.currentDay = targetDay;
    this._state.timers = [...this._state.days[targetKey]];
    this._state.activeTimerId = this._state.timers.length > 0 ? this._state.timers[0].id : null;

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
    const code = (item?.code || item?.id || 'PALCO1').toUpperCase();
    const isDefault = code === 'PALCO1';
    let title = (item?.title || '').trim();
    if (!title) {
      title = isDefault ? 'Palco Principal' : code;
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
        .filter(e => !deletedSet.has(e.code));

      // Auto-discover rooms saved in localStorage
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('stagetimer_live_state_')) {
            const code = k.replace('stagetimer_live_state_', '').toUpperCase().trim();
            const isKnown = list.some(e => e.code === code || (e.stages && e.stages.some(st => st.code === code)));
            if (code && !deletedSet.has(code) && !isKnown) {
              let tCount = 0;
              let title = code === 'PALCO1' ? 'Palco Principal' : code;
              let itemUpdatedAt = 0;
              try {
                const s = JSON.parse(localStorage.getItem(k));
                if (s) {
                  title = s.name || title;
                  tCount = Array.isArray(s.timers) ? s.timers.length : 0;
                  itemUpdatedAt = Number(s.updatedAt) || 0;
                }
              } catch (_) {}
              list.push(this._normalizeRegistryItem({
                id: code,
                code,
                title,
                timersCount: tCount,
                createdAt: itemUpdatedAt,
                updatedAt: itemUpdatedAt
              }));
            }
          }
        }
      } catch (_) {}

      if (list.length === 0 && !deletedSet.has('PALCO1')) {
        list.push(this._normalizeRegistryItem({
          id: 'PALCO1',
          code: 'PALCO1',
          title: 'Palco Principal',
          timersCount: 0,
          currentDay: 1,
          createdAt: 1000000000000,
          updatedAt: 1000000000000
        }));
      }

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
      return [this._normalizeRegistryItem({ id: 'PALCO1', code: 'PALCO1', title: 'Palco Principal', timersCount: 0, currentDay: 1, createdAt: 1000000000000 })];
    }
  }

  _saveEventsList(list, publish = true, forceReplace = false) {
    const deletedSet = this._getDeletedEvents();
    const normalized = (list || [])
      .map(e => this._normalizeRegistryItem(e))
      .filter(e => !deletedSet.has(e.code));

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
        this.mqttClient.publish(this.legacyMqttTopicRegistry, payload, { qos: 0, retain: true });
      } catch (e) {}
    }
    this._emit('events-list-update', normalized);
  }

  _mergeIncomingRegistry(incomingList, forceReplace = false) {
    if (!Array.isArray(incomingList)) return;
    const deletedSet = this._getDeletedEvents();

    const validIncoming = incomingList
      .filter(item => item && !deletedSet.has((item.code || item.id || '').toUpperCase()))
      .map(rawItem => this._normalizeRegistryItem(rawItem));

    // Cloud registry is authoritative: do NOT resurrect obsolete local events
    if (validIncoming.length > 0) {
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
      return;
    }

    if (forceReplace && validIncoming.length === 0) {
      const freshCode = 'PALCO1';
      this._unmarkDeletedEvent(freshCode);
      const defaultList = [this._normalizeRegistryItem({
        id: freshCode,
        code: freshCode,
        title: 'Palco Principal',
        timersCount: 0,
        currentDay: 1,
        createdAt: 1000000000000,
        updatedAt: 1000000000000
      })];
      this._saveEventsList(defaultList, false);
    }
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
      theme: { viewerBg: '#000000', controllerBg: '#0f0f1a' },
      updatedAt: Date.now()
    };

    try {
      localStorage.setItem(`stagetimer_live_state_${code}`, JSON.stringify(newRoomState));
      localStorage.setItem('stagetimer_device_room', code);
      localStorage.setItem('stagetimer_last_room', code);
    } catch (e) {}

    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          `stagetimer_live/${code}/state`,
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

  createEventWithStages({ title, stagesCount = 1, masterPass = '' }) {
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
        localStorage.setItem(`stagetimer_live_state_${stageCode}`, JSON.stringify(stageState));
        if (i === 1) {
          localStorage.setItem('stagetimer_device_room', stageCode);
          localStorage.setItem('stagetimer_last_room', stageCode);
        }
      } catch (e) {}

      if (this.mqttClient && this.mqttClient.connected) {
        try {
          this.mqttClient.publish(
            `stagetimer_live/${stageCode}/state`,
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

    const eventItem = this._normalizeRegistryItem({
      id: baseCode,
      code: baseCode,
      title: cleanTitle,
      pin,
      stagesCount: count,
      stages,
      timersCount: 0,
      artistCount: 0,
      currentDay: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

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
    const cleanCode = code.toUpperCase().trim();
    const list = this.getEventsList();
    const item = list.find(e => e.code === cleanCode);
    if (item) {
      item.title = cleanTitle;
      item.updatedAt = Date.now();
      this._saveEventsList(list, true, true);
      if (this.cleanRoom === cleanCode && this._state) {
        this._state.name = cleanTitle;
        this._commitStateChange(true);
      }
    }
  }

  deleteEventFromRegistry(codeToDelete) {
    if (!codeToDelete) return this.getEventsList();
    const cleanCode = codeToDelete.toUpperCase().trim();
    this._recordDeletedEvent(cleanCode);

    let list = this.getEventsList().filter(e => e.code !== cleanCode);
    try {
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
          `stagetimer_live/${cleanCode}/state`,
          JSON.stringify({ deleted: true, sender: this.clientId, sentAt: Date.now(), data: null }),
          { qos: 0, retain: true }
        );
      } catch (e) {}
    }

    // If list is completely empty, provide a clean default room
    if (list.length === 0) {
      const freshCode = 'PALCO1';
      this._unmarkDeletedEvent(freshCode);
      list = [this._normalizeRegistryItem({
        id: freshCode,
        code: freshCode,
        title: 'Palco Principal',
        timersCount: 0,
        currentDay: 1,
        updatedAt: Date.now()
      })];
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
            `stagetimer_live/${e.code}/state`,
            JSON.stringify({ deleted: true, sender: this.clientId, sentAt: Date.now(), data: null }),
            { qos: 0, retain: true }
          );
        } catch (err) {}
      }
    });

    // Clear legacy registry topics on MQTT broker
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish('stagetimer_live/_events_list_v6', JSON.stringify({ sender: this.clientId, forceReplace: true, events: [] }), { qos: 0, retain: true });
        this.mqttClient.publish('stagetimer_live/_events_list', JSON.stringify({ sender: this.clientId, forceReplace: true, events: [] }), { qos: 0, retain: true });
      } catch (_) {}
    }

    try {
      Object.keys(localStorage).forEach((k) => {
        if (
          k.startsWith('stagetimer_live_') ||
          k.startsWith('stagetimer_events_registry_') ||
          k.startsWith('stagetimer_deleted_events_') ||
          k.startsWith('stagetimer_device_room') ||
          k.startsWith('stagetimer_last_room') ||
          k.startsWith('stagetimer_unlocked_event')
        ) {
          if (k !== 'stagetimer_auth_unlocked' && k !== 'stagetimer_master_auth_v12' && k !== 'stagetimer_device_uuid') {
            localStorage.removeItem(k);
          }
        }
      });
      sessionStorage.removeItem('stagetimer_active_room');
      localStorage.setItem('stagetimer_clean_slate_epoch_v7', 'true');
    } catch (e) {}

    const freshCode = 'PALCO1';
    this._unmarkDeletedEvent(freshCode);
    const defaultList = [this._normalizeRegistryItem({
      id: freshCode,
      code: freshCode,
      title: 'Palco Principal',
      timersCount: 0,
      currentDay: 1,
      updatedAt: 0
    })];

    this.sendDeviceCommand('ALL', { action: 'purge_clean_slate_v7' });
    setTimeout(() => {
      try { this.sendDeviceCommand('ALL', { action: 'reload' }); } catch (_) {}
    }, 400);

    this._saveEventsList(defaultList, true, true);
    this._state = this._createDefaultRoom(freshCode);
    this._saveLocal();
    this._commitStateChange(true);
    return defaultList;
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
      !Array.isArray(this._state?.timers) ||
      this._state.timers.length === 0 ||
      currentUpdatedAt === 0
    );

    // Discard stale incoming states (monotonic clock check)
    // If incoming state has an older timestamp, ignore it to prevent jump-back glitches!
    // But NEVER discard incoming state if our local state is an empty default or has 0 timers!
    if (!isCurrentEmpty && currentUpdatedAt > 0 && incomingUpdatedAt > 0 && incomingUpdatedAt < currentUpdatedAt) {
      return;
    }

    // Protection against echo / race conditions if a local action occurred recently (< 2.5 seconds)
    if (this._lastLocalActionAt && (this.getTrueTime() - this._lastLocalActionAt < 2500)) {
      if (this._state?.activeTimerId && incoming.activeTimerId !== this._state.activeTimerId) {
        incoming.activeTimerId = this._state.activeTimerId;
      }
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

      const activeTimer = this._state.timers.find(t => t.id === this._state.activeTimerId);
      if (activeTimer && activeTimer.mode === 'clock') {
        shouldTick = true;
      }

      for (const timer of this._state.timers) {
        if (timer.state === 'running' && timer.startedAt) {
          shouldTick = true;
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
    const timer = this._state.timers.find(t => t.id === id);
    if (!timer) return;
    const trueNow = this.getTrueTime();

    switch (action) {
      case 'start':
        this._lastLocalActionAt = trueNow;
        // Stop any previously running timer so only the fired timer runs
        for (const other of this._state.timers) {
          if (other.id !== timer.id && other.state === 'running') {
            const anchor = other.serverStartedAt || other.startedAt;
            if (anchor) other.elapsed += Math.max(0, trueNow - anchor);
            other.state = 'stopped';
            other.startedAt = null;
            other.serverStartedAt = null;
          }
        }
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
    const idx = this._state.timers.findIndex(t => t.id === id);
    if (idx < 0) return;
    const timer = this._state.timers[idx];

    const oldDuration = timer.duration;
    timer.duration = Math.max(60000, timer.duration + deltaMs);
    const actualDeltaMins = Math.round((timer.duration - oldDuration) / 60000);

    if (timer.state === 'finished' && timer.duration > timer.elapsed) {
      timer.state = 'stopped';
    }

    if (actualDeltaMins !== 0) {
      const sMins = this._parseStartMins(timer.startTime);
      if (sMins !== null) {
        timer.startTime = this._formatSlotRange(sMins, timer.duration);
      }
      this._cascadeSubsequentTimers(idx, actualDeltaMins);
    }

    this._commitStateChange();
  }

  setActiveTimer(id) {
    if (this._state.timers.some(t => t.id === id)) {
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

  static computeTimerEndTime(state, timerId) {
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) return '';
    const targetTimer = state.timers.find(t => t.id === timerId);
    if (!targetTimer || targetTimer.mode === 'clock') return '';

    const activeIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const targetIdx = state.timers.findIndex(t => t.id === timerId);
    const activeTimer = activeIdx >= 0 ? state.timers[activeIdx] : null;

    let activeElapsed = UniversalSyncClient.getTimerElapsed(activeTimer);

    const activeRemaining = activeTimer ? Math.max(0, (activeTimer.duration || 0) - activeElapsed) : 0;
    const activeOvertimeMs = activeTimer && activeElapsed > (activeTimer.duration || 0)
      ? activeElapsed - activeTimer.duration
      : 0;
    const activeOvertimeMins = Math.floor(activeOvertimeMs / 60000);

    // 1. Explicit scheduled slot range (e.g. "21:00 - 22:30")
    if (targetTimer.startTime) {
      const rangeMatch = String(targetTimer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})\s*[-–—a]\s*(\d{1,2})\s*[:hH]\s*(\d{2})/);
      if (rangeMatch) {
        const endMins = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10) + activeOvertimeMins;
        const norm = ((endMins % 1440) + 1440) % 1440;
        const hh = String(Math.floor(norm / 60)).padStart(2, '0');
        const mm = String(norm % 60).padStart(2, '0');
        return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
      }

      // 2. Explicit start time only (e.g. "21:00") -> add targetTimer duration
      const singleMatch = String(targetTimer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
      if (singleMatch) {
        const startMins = parseInt(singleMatch[1], 10) * 60 + parseInt(singleMatch[2], 10);
        const durMins = Math.round((targetTimer.duration || 0) / 60000);
        const endMins = startMins + durMins + activeOvertimeMins;
        const norm = ((endMins % 1440) + 1440) % 1440;
        const hh = String(Math.floor(norm / 60)).padStart(2, '0');
        const mm = String(norm % 60).padStart(2, '0');
        return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
      }
    }

    // 3. Active timer finishing time (live if running)
    if (targetIdx === activeIdx) {
      if (activeTimer?.state === 'running') {
        const end = new Date(Date.now() + activeRemaining);
        const hh = String(end.getHours()).padStart(2, '0');
        const mm = String(end.getMinutes()).padStart(2, '0');
        return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
      }
      return `${Math.round((activeTimer?.duration || 0) / 60000)} min`;
    }

    // 4. Future timer: cumulative projection
    if (targetIdx > activeIdx) {
      if (activeTimer?.state === 'running') {
        let accumMs = activeRemaining;
        for (let i = (activeIdx >= 0 ? activeIdx + 1 : 0); i <= targetIdx; i++) {
          const t = state.timers[i];
          if (t && t.mode !== 'clock') {
            accumMs += (t.duration || 0);
          }
        }
        const end = new Date(Date.now() + accumMs);
        const hh = String(end.getHours()).padStart(2, '0');
        const mm = String(end.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      } else {
        // Not running: calculate from earlier scheduled timers if available
        let baseMins = null;
        let accumDur = 0;
        for (let i = 0; i <= targetIdx; i++) {
          const t = state.timers[i];
          if (t.startTime) {
            const m = String(t.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
            if (m) {
              baseMins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
              accumDur = Math.round((t.duration || 0) / 60000);
              continue;
            }
          }
          if (baseMins !== null && i > 0) {
            accumDur += Math.round((t.duration || 0) / 60000);
          }
        }
        if (baseMins !== null) {
          const endMins = (baseMins + accumDur) % 1440;
          const hh = String(Math.floor(endMins / 60)).padStart(2, '0');
          const mm = String(endMins % 60).padStart(2, '0');
          return `${hh}:${mm}`;
        }
      }
    }

    return '--:--';
  }

  static computeEventEndTime(state) {
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) return '--:--';
    const countdownTimers = state.timers.filter(t => t.mode !== 'clock');
    if (countdownTimers.length === 0) return '--:--';

    const activeIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const activeTimer = activeIdx >= 0 ? state.timers[activeIdx] : null;

    let activeElapsed = UniversalSyncClient.getTimerElapsed(activeTimer);

    const activeRemaining = activeTimer ? Math.max(0, (activeTimer.duration || 0) - activeElapsed) : 0;
    const activeOvertimeMs = activeTimer && activeElapsed > (activeTimer.duration || 0)
      ? activeElapsed - activeTimer.duration
      : 0;
    const activeOvertimeMins = Math.floor(activeOvertimeMs / 60000);

    // 1. Check for scheduled time in countdown timers
    let lastKnownEndMins = null;
    let subsequentDurMins = 0;

    for (let i = 0; i < countdownTimers.length; i++) {
      const t = countdownTimers[i];
      if (t.startTime) {
        const rangeMatch = String(t.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})\s*[-–—a]\s*(\d{1,2})\s*[:hH]\s*(\d{2})/);
        if (rangeMatch) {
          lastKnownEndMins = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10);
          subsequentDurMins = 0;
          continue;
        }
        const singleMatch = String(t.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
        if (singleMatch) {
          const sMins = parseInt(singleMatch[1], 10) * 60 + parseInt(singleMatch[2], 10);
          lastKnownEndMins = sMins + Math.round((t.duration || 0) / 60000);
          subsequentDurMins = 0;
          continue;
        }
      }
      if (lastKnownEndMins !== null) {
        subsequentDurMins += Math.round((t.duration || 0) / 60000);
      }
    }

    if (lastKnownEndMins !== null) {
      const finalEndMins = (lastKnownEndMins + subsequentDurMins + activeOvertimeMins) % 1440;
      const hh = String(Math.floor(finalEndMins / 60)).padStart(2, '0');
      const mm = String(finalEndMins % 60).padStart(2, '0');
      return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
    }

    // 2. Real-time finish if active timer is running
    if (activeTimer && activeTimer.state === 'running') {
      let totalRemainingMs = activeRemaining;
      const startFrom = (activeIdx >= 0) ? activeIdx + 1 : 0;
      for (let i = startFrom; i < state.timers.length; i++) {
        const t = state.timers[i];
        if (t && t.mode !== 'clock') {
          totalRemainingMs += (t.duration || 0);
        }
      }
      const endDate = new Date(UniversalSyncClient.globalTrueTime() + totalRemainingMs);
      const hh = String(endDate.getHours()).padStart(2, '0');
      const mm = String(endDate.getMinutes()).padStart(2, '0');
      return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
    }

    // 3. Otherwise show total planned duration
    let totalDurMins = 0;
    for (const t of countdownTimers) {
      totalDurMins += Math.round((t.duration || 0) / 60000);
    }
    const totalHours = Math.floor(totalDurMins / 60);
    const remMins = totalDurMins % 60;
    if (totalHours > 0) {
      return `${totalHours}h ${remMins > 0 ? `${remMins}m` : ''}`.trim();
    }
    return `${totalDurMins}m`;
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
