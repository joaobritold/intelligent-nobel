/**
 * StageTimer Universal Cloud + Local Synchronizer
 * Uses:
 * 1. MQTT over WSS (broker.emqx.io / broker.hivemq.com) with Retained State
 *    -> Works across ANY network (4G/5G/Wi-Fi), bypasses NAT/firewalls, supports
 *       multiple Controllers, Operators (Safari iOS), and Viewers simultaneously!
 * 2. BroadcastChannel + LocalStorage
 *    -> Zero-latency instant sync between tabs on the same computer.
 */

class UniversalSyncClient {
  constructor({ role = 'viewer', room = 'PALCO1' } = {}) {
    this.role = role;
    this.room = (room || 'PALCO1').trim().toUpperCase();
    this.cleanRoom = this.room.replace(/[^A-Z0-9_-]/g, '') || 'PALCO1';

    this.channelName = `stagetimer_room_${this.cleanRoom}`;
    this.storageKey = `stagetimer_state_${this.cleanRoom}`;
    this.mqttTopicState = `stagetimer_v2/${this.cleanRoom}/state`;
    this.mqttTopicPresence = `stagetimer_v2/${this.cleanRoom}/presence`;

    this.clientId = 'st_' + Math.random().toString(36).substring(2, 10);
    this.listeners = new Map();
    this.channel = null;
    this._state = null;
    this.tickInterval = null;
    this.mqttClient = null;
    this.peersMap = new Map();
    this.connectedPeersCount = 1;
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
      }
    });

    // 3. Load Saved State or Create Default
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        this._state = JSON.parse(saved);
      } catch (e) {}
    }

    if (!this._state) {
      this._state = this._createDefaultRoom(this.cleanRoom);
      this._saveLocal();
    }

    // 4. Local High-FPS UI Render Loop (computes countdown smoothly from timestamps)
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
      console.log(`☁️ Connected to Cloud Room [${this.cleanRoom}]`);
      this._emit('connected');

      // Subscribe to room state (retained message arrives immediately!)
      this.mqttClient.subscribe([this.mqttTopicState, this.mqttTopicPresence], { qos: 0 }, (err) => {
        if (!err) {
          this._emit('p2p-ready', { id: this.cleanRoom, count: this.connectedPeersCount });
          this._announcePresence();
          // If we already have a newer state or no retained state exists yet, controllers can seed
        }
      });
    });

    this.mqttClient.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (topic === this.mqttTopicState) {
          if (msg.sender === this.clientId) return;
          if (msg.data) {
            this._applyIncomingState(msg.data, true);
          }
        } else if (topic === this.mqttTopicPresence) {
          if (msg.clientId) {
            this.peersMap.set(msg.clientId, Date.now());
            this._cleanupPeers();
          }
        }
      } catch (e) {}
    });

    this.mqttClient.on('offline', () => {
      this._emit('disconnected');
    });

    // Heartbeat presence every 10s & re-sync running timers every 3s
    setInterval(() => this._announcePresence(), 10000);
    setInterval(() => {
      if (this.role === 'controller' && this._state?.timers?.some(t => t.state === 'running')) {
        this._commitStateChange(true);
      }
    }, 3000);
  }

  _announcePresence() {
    if (this.mqttClient && this.mqttClient.connected) {
      this.peersMap.set(this.clientId, Date.now());
      this.mqttClient.publish(
        this.mqttTopicPresence,
        JSON.stringify({ clientId: this.clientId, role: this.role, ts: Date.now() }),
        { qos: 0, retain: false }
      );
      this._cleanupPeers();
    }
  }

  _cleanupPeers() {
    const now = Date.now();
    for (const [id, lastSeen] of this.peersMap.entries()) {
      if (now - lastSeen > 28000) {
        this.peersMap.delete(id);
      }
    }
    this.connectedPeersCount = Math.max(1, this.peersMap.size);
    this._emit('p2p-peers-update', { count: this.connectedPeersCount });
  }

  _createDefaultRoom(id) {
    const timerId = 't_default_1';
    return {
      id: id,
      name: 'Stage Timer',
      updatedAt: 0,
      activeTimerId: timerId,
      message: { text: '', visible: false },
      theme: {
        viewerBg: '#000000',
        controllerBg: '#0f0f1a'
      },
      timers: [
        {
          id: timerId,
          name: 'Main Keynote',
          notes: '',
          mode: 'countdown',
          duration: 300000, // 5 min
          elapsed: 0,
          state: 'stopped',
          warnAt: 60000,
          dangerAt: 15000,
          startedAt: null
        }
      ]
    };
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
          // Exact relative elapsed at the moment packet was sent (immune to clock differences & retained delay)
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
    this._saveLocal();

    if (fromCloud && this.channel) {
      try {
        this.channel.postMessage({ type: 'room-state', sender: this.clientId, data: this._state });
      } catch (e) {}
    }

    this._emit('room-state', this._state);
  }

  _commitStateChange(retain = true) {
    const now = Date.now();
    this._state.updatedAt = now;

    // Bake liveElapsed into each running timer so receivers don't depend on wall-clock alignment
    this._state.timers.forEach(t => {
      if (t.state === 'running' && t.startedAt) {
        t.liveElapsed = t.elapsed + (now - t.startedAt);
      } else {
        t.liveElapsed = t.elapsed;
      }
    });

    this._saveLocal();

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
      const now = Date.now();
      let anyRunning = false;
      let anyFinishedJustNow = false;

      for (const timer of this._state.timers) {
        if (timer.state === 'running' && timer.startedAt) {
          anyRunning = true;
          const totalElapsed = timer.elapsed + (now - timer.startedAt);
          if (timer.mode === 'countdown' && totalElapsed >= timer.duration) {
            timer.elapsed = timer.duration;
            timer.state = 'finished';
            timer.startedAt = null;
            anyFinishedJustNow = true;
          }
        }
      }

      if (anyFinishedJustNow && this.role === 'controller') {
        this._commitStateChange();
      } else if (anyRunning || anyFinishedJustNow) {
        this._emit('room-state', this._state);
      }
    }, 100);
  }

  // ─── Actions (Work from both Controller & Mobile Operator) ──────────

  createTimer(data = {}) {
    if (!this._state.theme) {
      this._state.theme = { viewerBg: '#000000', controllerBg: '#0f0f1a' };
    }
    const timer = {
      id: data.id || ('t_' + Math.random().toString(36).substring(2, 9)),
      name: data.name || 'Novo Artista',
      notes: data.notes || '',
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

  updateTimer(id, updates) {
    const timer = this._state.timers.find(t => t.id === id);
    if (timer) {
      Object.assign(timer, updates);
      this._commitStateChange();
    }
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
    const timer = this._state.timers.find(t => t.id === id);
    if (!timer) return;
    timer.duration = Math.max(10000, timer.duration + deltaMs);
    if (timer.state === 'finished' && timer.duration > timer.elapsed) {
      timer.state = 'stopped';
    }
    this._commitStateChange();
  }

  setActiveTimer(id) {
    if (this._state.timers.some(t => t.id === id)) {
      this._state.activeTimerId = id;
      this._commitStateChange();
    }
  }

  sendMessage(text, visible = true) {
    this._state.message = { text, visible };
    this._commitStateChange();
  }

  clearMessage() {
    this._state.message = { text: '', visible: false };
    this._commitStateChange();
  }

  updateTheme(theme) {
    this._state.theme = { ...(this._state.theme || {}), ...theme };
    this._commitStateChange();
  }

  reorderTimers(order) {
    if (Array.isArray(order)) {
      const reordered = [];
      for (const id of order) {
        const t = this._state.timers.find(t => t.id === id);
        if (t) reordered.push(t);
      }
      for (const t of this._state.timers) {
        if (!reordered.includes(t)) reordered.push(t);
      }
      this._state.timers = reordered;
      this._commitStateChange();
    }
  }

  globalAction(action) {
    for (const t of this._state.timers) {
      this.timerAction(t.id, action);
    }
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
