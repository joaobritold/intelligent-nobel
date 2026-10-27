/**
 * StageTimer Universal Cloud + Local Synchronizer (v4)
 * - Multi-Stage / Multi-Event sessions (isolated rooms)
 * - Multi-Day lineups per stage (Dia 1, Dia 2, + Dia)
 * - Cloud MQTT over WSS + Local BroadcastChannel
 * - Zero hardcoded demo bands: new events start 100% clean (0 artists)
 * - Real-time device presence & remote screen control
 * - Reliable event deletion & unified cumulative end time calculation
 */

class UniversalSyncClient {
  constructor({ role = 'viewer', room = 'PALCO1' } = {}) {
    this.role = role;
    this.room = (room || 'PALCO1').trim().toUpperCase();
    this.cleanRoom = this.room.replace(/[^A-Z0-9_-]/g, '') || 'PALCO1';

    this.channelName = `stagetimer_live_${this.cleanRoom}`;
    this.storageKey = `stagetimer_live_state_${this.cleanRoom}`;
    this.mqttTopicState = `stagetimer_live/${this.cleanRoom}/state`;
    this.mqttTopicPresence = `stagetimer_live/${this.cleanRoom}/presence`;
    this.mqttTopicRegistry = 'stagetimer_live/_events_list';
    this.mqttTopicGlobalPresence = 'stagetimer_live/_global_presence';
    this.registryStorageKey = 'stagetimer_events_registry_v4';
    this.deletedStorageKey = 'stagetimer_deleted_events_v2';

    try {
      this.deviceUuid = localStorage.getItem('stagetimer_device_uuid') || ('dev_' + Math.random().toString(36).substring(2, 9));
      localStorage.setItem('stagetimer_device_uuid', this.deviceUuid);
    } catch (e) {
      this.deviceUuid = 'dev_' + Math.random().toString(36).substring(2, 9);
    }

    this.mqttTopicDeviceCmd = `stagetimer_live/_cmd/${this.deviceUuid}`;
    this.mqttTopicRoomCmd = `stagetimer_live/_cmd_room/${this.cleanRoom}`;
    this.mqttTopicAllCmd = 'stagetimer_live/_cmd_all';

    this.clientId = 'st_' + Math.random().toString(36).substring(2, 10);
    this.listeners = new Map();
    this.channel = null;
    this._state = null;
    this.tickInterval = null;
    this.mqttClient = null;
    this.peersMap = new Map();
    this.globalDevicesMap = new Map();
    this.connectedPeersCount = 1;
    this._needsInitialPublish = false;
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

  _getDeviceLabel() {
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    let os = 'Dispositivo';
    if (/iPhone/i.test(ua)) os = 'iPhone';
    else if (/iPad/i.test(ua)) os = 'iPad';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Mac/i.test(ua)) os = 'Mac';
    else if (/Windows/i.test(ua)) os = 'PC Windows';
    else if (/Linux/i.test(ua)) os = 'Linux';

    let roleLabel = 'Ecrã';
    const path = typeof location !== 'undefined' ? location.pathname.toLowerCase() : '';
    if (path.includes('master')) roleLabel = '👑 Painel Master';
    else if (this.role === 'controller' || path.includes('controller')) roleLabel = '🎛️ PC Régie (Controlador)';
    else if (this.role === 'operator' || path.includes('operator')) roleLabel = '📱 Telemóvel Operador';
    else if (path.includes('lineup')) roleLabel = '📋 Ecrã Lista / Backstage';
    else if (this.role === 'viewer' || path.includes('viewer')) roleLabel = '📺 Telão de Palco';

    return `${roleLabel} (${os})`;
  }

  get state() {
    return this._state;
  }

  connect() {
    // 1. Local Tab-to-Tab Sync (BroadcastChannel)
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
        this.mqttTopicGlobalPresence,
        this.mqttTopicDeviceCmd,
        this.mqttTopicRoomCmd,
        this.mqttTopicAllCmd
      ];

      // If in Master mode, also subscribe to all room state broadcasts
      if (this.role === 'master') {
        topicsToSubscribe.push('stagetimer_live/+/state');
      }

      this.mqttClient.subscribe(topicsToSubscribe, { qos: 0 }, (err) => {
        if (!err) {
          this._emit('p2p-ready', { id: this.cleanRoom, count: this.connectedPeersCount });
          this._announcePresence();
        }
      });
    });

    this.mqttClient.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());

        // Remote device commands (switch view, change room, reload)
        if (topic === this.mqttTopicDeviceCmd || topic === this.mqttTopicRoomCmd || topic === this.mqttTopicAllCmd) {
          if (msg.sender === this.clientId) return;
          if (msg.action === 'navigate' && msg.url) {
            location.href = msg.url;
            return;
          }
          if (msg.action === 'reload') {
            location.reload();
            return;
          }
          if (msg.action === 'switch_room' && msg.room) {
            const currentBase = location.pathname;
            location.href = `${currentBase}?room=${encodeURIComponent(msg.room)}`;
            return;
          }
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
        } else if (topic === this.mqttTopicRegistry) {
          if (msg && Array.isArray(msg.events)) {
            this._mergeIncomingRegistry(msg.events, Boolean(msg.forceReplace));
          }
        } else if (topic === this.mqttTopicPresence) {
          if (msg.clientId) {
            this.peersMap.set(msg.clientId, Date.now());
            this._cleanupPeers();
          }
        } else if (topic === this.mqttTopicGlobalPresence) {
          if (msg.deviceUuid && msg.ts) {
            this.globalDevicesMap.set(msg.deviceUuid, {
              ...msg,
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
      if (this.role === 'controller' && this._state?.timers?.some(t => t.state === 'running')) {
        this._commitStateChange(true);
      }
    }, 3000);
  }

  _cleanupGlobalDevices() {
    const now = Date.now();
    for (const [uuid, dev] of this.globalDevicesMap.entries()) {
      if (now - (dev.lastSeen || 0) > 18000) {
        this.globalDevicesMap.delete(uuid);
      }
    }
  }

  getOnlineDevices() {
    this._cleanupGlobalDevices();
    return Array.from(this.globalDevicesMap.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }

  sendDeviceCommand(targetDeviceUuid, command) {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    try {
      const topic = targetDeviceUuid === 'ALL'
        ? this.mqttTopicAllCmd
        : `stagetimer_live/_cmd/${targetDeviceUuid}`;
      this.mqttClient.publish(
        topic,
        JSON.stringify({ sender: this.clientId, sentAt: Date.now(), ...command }),
        { qos: 0, retain: false }
      );
    } catch (e) {}
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
        role: this.role,
        room: this.cleanRoom,
        roomTitle: this._state?.name || this.cleanRoom,
        path: pathFile,
        ts: Date.now()
      };
      const jsonStr = JSON.stringify(devPayload);
      this.mqttClient.publish(this.mqttTopicPresence, jsonStr, { qos: 0, retain: false });
      this.mqttClient.publish(this.mqttTopicGlobalPresence, jsonStr, { qos: 0, retain: false });

      // Record self in global devices
      this.globalDevicesMap.set(this.deviceUuid, { ...devPayload, lastSeen: Date.now() });
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
      updatedAt: Date.now()
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
    return {
      id: code,
      code,
      title,
      timersCount: count,
      artistCount: count,
      currentDay: item?.currentDay || 1,
      updatedAt: item?.updatedAt || Date.now()
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

      if (list.length === 0 && !deletedSet.has('PALCO1')) {
        list.push(this._normalizeRegistryItem({
          id: 'PALCO1',
          code: 'PALCO1',
          title: 'Palco Principal',
          timersCount: 0,
          currentDay: 1,
          updatedAt: Date.now()
        }));
      }
      return list;
    } catch (e) {
      return [this._normalizeRegistryItem({ id: 'PALCO1', code: 'PALCO1', title: 'Palco Principal', timersCount: 0, currentDay: 1 })];
    }
  }

  _saveEventsList(list, publish = true, forceReplace = false) {
    const deletedSet = this._getDeletedEvents();
    const normalized = (list || [])
      .map(e => this._normalizeRegistryItem(e))
      .filter(e => !deletedSet.has(e.code));

    try {
      localStorage.setItem(this.registryStorageKey, JSON.stringify(normalized));
    } catch (e) {}
    if (publish && this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(
          this.mqttTopicRegistry,
          JSON.stringify({ sender: this.clientId, forceReplace, events: normalized }),
          { qos: 0, retain: true }
        );
      } catch (e) {}
    }
    this._emit('events-list-update', normalized);
  }

  _mergeIncomingRegistry(incomingList, forceReplace = false) {
    if (!Array.isArray(incomingList)) return;
    const deletedSet = this._getDeletedEvents();

    if (forceReplace) {
      const replaced = incomingList
        .filter(item => item && !deletedSet.has((item.code || item.id || '').toUpperCase()))
        .map(rawItem => this._normalizeRegistryItem(rawItem));
      this._saveEventsList(replaced, false);
      return;
    }

    const localList = this.getEventsList();
    const map = new Map();
    localList.forEach(item => {
      if (!deletedSet.has(item.code)) map.set(item.code, item);
    });

    incomingList.forEach(rawItem => {
      if (!rawItem) return;
      const item = this._normalizeRegistryItem(rawItem);
      if (deletedSet.has(item.code)) return;
      const existing = map.get(item.code);
      if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
        map.set(item.code, item);
      }
    });
    const merged = Array.from(map.values());
    this._saveEventsList(merged, false);
  }

  _syncEventInRegistry() {
    if (!this._state) return;
    const deletedSet = this._getDeletedEvents();
    if (deletedSet.has(this.cleanRoom)) return;

    const list = this.getEventsList();
    const idx = list.findIndex(e => e.code === this.cleanRoom);
    if (idx < 0) {
      // NEVER resurrect deleted events!
      return;
    }

    const existing = list[idx];
    const count = Array.isArray(this._state.timers) ? this._state.timers.length : 0;
    const entry = this._normalizeRegistryItem({
      id: this.cleanRoom,
      code: this.cleanRoom,
      title: existing?.title || this._state.name || this.cleanRoom,
      timersCount: count,
      artistCount: count,
      currentDay: this._state.currentDay || 1,
      updatedAt: Date.now()
    });
    list[idx] = entry;
    this._saveEventsList(list, true);
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
    } catch (e) {}

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

    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('stagetimer_live_') && k !== 'stagetimer_auth_unlocked' && k !== 'stagetimer_device_uuid') {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}

    const freshCode = 'PALCO1';
    this._unmarkDeletedEvent(freshCode);
    const defaultList = [this._normalizeRegistryItem({
      id: freshCode,
      code: freshCode,
      title: 'Palco Principal',
      timersCount: 0,
      currentDay: 1,
      updatedAt: Date.now()
    })];

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

    const localNow = Date.now();

    incoming.timers.forEach(t => {
      if (t.state === 'running') {
        if (typeof t.liveElapsed === 'number') {
          const transitMs = sentAt ? Math.max(0, Math.min(1500, localNow - sentAt)) : 0;
          t.elapsed = t.liveElapsed + transitMs;
          t.startedAt = localNow;
        } else if (t.startedAt) {
          const senderNow = incoming.updatedAt || localNow;
          const clockOffset = localNow - senderNow;
          t.startedAt = t.startedAt + clockOffset;
        }
      }
    });

    this._state = incoming;
    this._ensureDaysStructure();
    this._enforceInactiveReset();
    this._saveLocal();
    this._syncEventInRegistry();

    if (fromCloud && this.channel) {
      try {
        this.channel.postMessage({ type: 'room-state', sender: this.clientId, data: this._state });
      } catch (e) {}
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
      }
    }
  }

  _commitStateChange(retain = true) {
    this._ensureDaysStructure();
    this._enforceInactiveReset();
    const now = Date.now();
    this._state.updatedAt = now;

    // Save active day lineup in days map
    this._state.days[String(this._state.currentDay || 1)] = [...(this._state.timers || [])];

    // Bake liveElapsed into each running timer
    this._state.timers.forEach(t => {
      if (t.state === 'running' && t.startedAt) {
        t.liveElapsed = t.elapsed + (now - t.startedAt);
      } else {
        t.liveElapsed = t.elapsed;
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
          sentAt: now,
          data: this._state
        });
      } catch (e) {}
    }

    // 2. Publish to Cloud MQTT
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        const payload = JSON.stringify({
          sender: this.clientId,
          sentAt: now,
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
      let anyRunning = false;

      for (const timer of this._state.timers) {
        if (timer.state === 'running' && timer.startedAt) {
          anyRunning = true;
        }
      }

      if (anyRunning) {
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
    const now = Date.now();

    switch (action) {
      case 'start':
        this._state.activeTimerId = timer.id;
        if (timer.state !== 'running') {
          if (timer.state === 'finished') timer.elapsed = 0;
          timer.state = 'running';
          timer.startedAt = now;
        }
        break;
      case 'pause':
        if (timer.state === 'running') {
          if (timer.startedAt) timer.elapsed += now - timer.startedAt;
          timer.state = 'stopped';
          timer.startedAt = null;
        }
        break;
      case 'reset':
        timer.state = 'stopped';
        timer.elapsed = 0;
        timer.startedAt = null;
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

    let activeElapsed = activeTimer?.elapsed || 0;
    if (activeTimer?.state === 'running' && activeTimer?.startedAt) {
      activeElapsed += Date.now() - activeTimer.startedAt;
    }

    const activeRemaining = activeTimer ? Math.max(0, (activeTimer.duration || 0) - activeElapsed) : 0;
    const activeOvertimeMins = activeTimer && activeElapsed > (activeTimer.duration || 0)
      ? Math.floor((activeElapsed - activeTimer.duration) / 60000)
      : 0;

    // Scheduled slot range (e.g., "21:00 - 22:30")
    if (targetTimer.startTime) {
      const rangeMatch = String(targetTimer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})\s*[-–—a]\s*(\d{1,2})\s*[:hH]\s*(\d{2})/);
      if (rangeMatch) {
        const endMins = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10) + activeOvertimeMins;
        const norm = ((endMins % 1440) + 1440) % 1440;
        const hh = String(Math.floor(norm / 60)).padStart(2, '0');
        const mm = String(norm % 60).padStart(2, '0');
        return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
      }
    }

    // Active timer finishing time
    if (targetIdx === activeIdx) {
      const end = new Date(Date.now() + activeRemaining);
      return end.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    // Future timer: activeRemaining + durations of all intermediate artists
    if (targetIdx > activeIdx) {
      let accumMs = (activeIdx >= 0) ? activeRemaining : 0;
      const startFrom = (activeIdx >= 0) ? activeIdx + 1 : 0;
      for (let i = startFrom; i <= targetIdx; i++) {
        const t = state.timers[i];
        if (t && t.mode !== 'clock') {
          accumMs += (t.duration || 0);
        }
      }
      const end = new Date(Date.now() + accumMs);
      return end.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    return '--:--';
  }

  static computeEventEndTime(state) {
    if (!state || !Array.isArray(state.timers) || state.timers.length === 0) return '--:--';
    const countdownTimers = state.timers.filter(t => t.mode !== 'clock');
    if (countdownTimers.length === 0) return '--:--';

    const activeIdx = state.timers.findIndex(t => t.id === state.activeTimerId);
    const activeTimer = activeIdx >= 0 ? state.timers[activeIdx] : null;

    let activeElapsed = activeTimer?.elapsed || 0;
    if (activeTimer?.state === 'running' && activeTimer?.startedAt) {
      activeElapsed += Date.now() - activeTimer.startedAt;
    }

    const activeRemaining = activeTimer ? Math.max(0, (activeTimer.duration || 0) - activeElapsed) : 0;
    const activeOvertimeMs = activeTimer && activeElapsed > (activeTimer.duration || 0)
      ? activeElapsed - activeTimer.duration
      : 0;
    const activeOvertimeMins = Math.floor(activeOvertimeMs / 60000);

    // If last timer has an explicit scheduled exit time
    const lastTimer = [...countdownTimers].reverse()[0];
    if (lastTimer && lastTimer.startTime) {
      const rangeMatch = String(lastTimer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})\s*[-–—a]\s*(\d{1,2})\s*[:hH]\s*(\d{2})/);
      if (rangeMatch) {
        const schedEndMins = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10) + activeOvertimeMins;
        const norm = ((schedEndMins % 1440) + 1440) % 1440;
        const hh = String(Math.floor(norm / 60)).padStart(2, '0');
        const mm = String(norm % 60).padStart(2, '0');
        return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
      }
      const singleMatch = String(lastTimer.startTime).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
      if (singleMatch) {
        const startMins = parseInt(singleMatch[1], 10) * 60 + parseInt(singleMatch[2], 10);
        const endMins = startMins + Math.round((lastTimer.duration || 0) / 60000) + activeOvertimeMins;
        const norm = ((endMins % 1440) + 1440) % 1440;
        const hh = String(Math.floor(norm / 60)).padStart(2, '0');
        const mm = String(norm % 60).padStart(2, '0');
        return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
      }
    }

    // Sequential cumulative calculation: active remaining + all subsequent timers
    let totalRemainingMs = (activeIdx >= 0) ? activeRemaining : 0;
    const startFrom = (activeIdx >= 0) ? activeIdx + 1 : 0;
    for (let i = startFrom; i < state.timers.length; i++) {
      const t = state.timers[i];
      if (t && t.mode !== 'clock') {
        totalRemainingMs += (t.duration || 0);
      }
    }

    const endDate = new Date(Date.now() + totalRemainingMs);
    const hh = String(endDate.getHours()).padStart(2, '0');
    const mm = String(endDate.getMinutes()).padStart(2, '0');
    return activeOvertimeMins > 0 ? `${hh}:${mm} (+${activeOvertimeMins}m)` : `${hh}:${mm}`;
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
