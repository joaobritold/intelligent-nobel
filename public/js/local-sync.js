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
        const parsed = JSON.parse(saved);
        // Auto-upgrade old single "Main Keynote" default to Receção ao Caloiro Dia 1
        if (parsed && parsed.timers?.length === 1 && parsed.timers[0].name === 'Main Keynote') {
          this._state = this._createDefaultRoom(this.cleanRoom);
          this._saveLocal();
        } else {
          this._state = parsed;
        }
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

  _makeItem(id, name, startTime, durationMins) {
    const duration = durationMins * 60000;
    return {
      id,
      name,
      startTime,
      notes: '',
      mode: 'countdown',
      duration,
      elapsed: 0,
      state: 'stopped',
      warnAt: Math.min(600000, Math.floor(duration * 0.2)),
      dangerAt: Math.min(120000, Math.floor(duration * 0.05)),
      startedAt: null
    };
  }

  _getDiaLineup(day = 1) {
    switch (Number(day)) {
      case 1:
        return [
          this._makeItem('rc_d1_sc1', 'Minhotos Marotos (Soundcheck)', '18:00 – 19:30', 90),
          this._makeItem('rc_d1_1', 'Dj Residente', '23:00 – 00:15', 75),
          this._makeItem('rc_d1_2', 'Tunas', '23:30 – 01:30', 120),
          this._makeItem('rc_d1_ch1', 'Minhotos Marotos (Changeover / Line Check)', '01:30 – 01:45', 15),
          this._makeItem('rc_d1_3', 'Minhotos Marotos', '01:45 – 03:15', 90),
          this._makeItem('rc_d1_4', 'Dj Beça', '03:30 – 05:00', 90)
        ];
      case 2:
        return [
          this._makeItem('rc_d2_sc1', 'Tay (Soundcheck)', '17:00 – 18:30', 90),
          this._makeItem('rc_d2_sc2', 'Batalha de Berço (Soundcheck)', '18:30 – 19:30', 60),
          this._makeItem('rc_d2_1', 'DJ Residente', '23:00 – 00:00', 60),
          this._makeItem('rc_d2_2', 'Batalha de Berço', '00:15 – 01:15', 60),
          this._makeItem('rc_d2_ch1', 'Tay (Changeover / Line Check)', '01:15 – 01:30', 15),
          this._makeItem('rc_d2_3', 'Tay', '01:30 – 02:30', 60),
          this._makeItem('rc_d2_4', 'Fábio Vasquez', '02:30 – 03:45', 75),
          this._makeItem('rc_d2_5', 'Pedro Maia', '03:45 – 05:00', 75)
        ];
      case 3:
        return [
          this._makeItem('rc_d3_sc1', 'Baile do STE (Soundcheck)', '18:00 – 19:30', 90),
          this._makeItem('rc_d3_1', 'Dj Residente', '23:00 – 00:30', 90),
          this._makeItem('rc_d3_2', 'MC Leozin', '00:30 – 01:15', 45),
          this._makeItem('rc_d3_ch1', 'Baile do STE (Changeover / Line Check)', '01:15 – 01:30', 15),
          this._makeItem('rc_d3_3', 'Baile do STE', '01:30 – 03:00', 90),
          this._makeItem('rc_d3_4', 'João Miguens', '03:00 – 04:15', 75),
          this._makeItem('rc_d3_5', 'Rafman', '04:15 – 05:30', 75)
        ];
      case 4:
        return [
          this._makeItem('rc_d4_sc1', 'Boy Teddy (Soundcheck)', '18:00 – 19:00', 60),
          this._makeItem('rc_d4_sc2', 'Quim das Remisturas (Soundcheck)', '19:00 – 19:30', 30),
          this._makeItem('rc_d4_1', 'Dj Residente', '23:00 – 00:50', 110),
          this._makeItem('rc_d4_2', 'Dj Kardo', '00:00 – 01:20', 80),
          this._makeItem('rc_d4_3', 'Boy Teddy', '01:30 – 02:15', 45),
          this._makeItem('rc_d4_4', 'Quim das Remisturas', '02:30 – 04:00', 90),
          this._makeItem('rc_d4_5', 'Dj Echosound', '04:00 – 05:30', 90)
        ];
      default:
        return [];
    }
  }

  _createDefaultRoom(id) {
    const timers = this._getDiaLineup(1);
    return {
      id: id,
      name: 'Receção ao Caloiro 2026 - Dia 1',
      updatedAt: 0,
      activeTimerId: timers[0].id,
      message: { text: '', visible: false, level: 'info' },
      theme: {
        viewerBg: '#000000',
        controllerBg: '#0f0f1a'
      },
      timers
    };
  }

  loadPresetDay(day = 1) {
    const timers = this._getDiaLineup(day);
    if (!timers.length) return;
    this._state.name = `Receção ao Caloiro 2026 - Dia ${day}`;
    this._state.timers = timers;
    this._state.activeTimerId = timers[0].id;
    this._commitStateChange(true);
  }

  loadPresetDia1() {
    this.loadPresetDay(1);
  }

  replaceAllTimers(timers, roomName = null) {
    if (!Array.isArray(timers) || timers.length === 0) return;
    if (roomName) this._state.name = roomName;
    this._state.timers = timers;
    this._state.activeTimerId = timers[0].id;
    this._commitStateChange(true);
  }

  clearAllTimers() {
    this._state.name = 'Novo Evento';
    this._state.timers = [];
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
    this._enforceInactiveReset();
    this._saveLocal();

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
    this._enforceInactiveReset();
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

  // ─── Actions (Work from both Controller & Mobile Operator) ──────────

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

    // If duration was edited, update this timer's exit time and shift subsequent timers
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

    // If startTime was edited manually, shift subsequent timers by the difference in start time
    if (typeof updates.startTime === 'string' && updates.startTime !== timer.startTime) {
      const oldStart = this._parseStartMins(timer.startTime);
      const newStart = this._parseStartMins(updates.startTime);
      // Check if user typed a full range "HH:MM - HH:MM" or single time "HH:MM"
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
        // Starting any timer automatically makes it the active ON AIR timer
        // and resets all other timers
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

    // Update current artist's exit time & cascade to all subsequent artists
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
      // Capture original slot starts and inter-slot gaps by position index
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
        // If gap is huge (> 2 hours, e.g. between afternoon soundcheck and 23:00 show), treat as new block anchor
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

      // Recalculate sequential slots for the new order
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
