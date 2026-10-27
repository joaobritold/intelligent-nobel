/**
 * WebSocket client with auto-reconnection and event handling.
 */
class StageTimerClient {
  constructor({ role = 'viewer', room = null } = {}) {
    this.role = role;
    this.room = room;
    this.ws = null;
    this.listeners = new Map();
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 10000;
    this.currentDelay = this.reconnectDelay;
    this.shouldReconnect = true;
    this._state = null;
  }

  get state() {
    return this._state;
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ role: this.role });
    if (this.room) params.set('room', this.room);

    const url = `${protocol}//${location.host}/ws?${params}`;

    // In case ws module is on same port but path differs, use raw connection
    // The WebSocketServer handles upgrade on any path by default
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.currentDelay = this.reconnectDelay;
      this._emit('connected');
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'room-state') {
          this._state = msg.data;
          // Update room ID from server (in case it was generated)
          if (!this.room && msg.data?.id) {
            this.room = msg.data.id;
          }
        }
        this._emit(msg.type, msg.data);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });

    this.ws.addEventListener('close', () => {
      this._emit('disconnected');
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.currentDelay);
        this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxReconnectDelay);
      }
    });

    this.ws.addEventListener('error', (e) => {
      console.error('WebSocket error:', e);
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
    }
  }

  send(type, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  // ─── Convenience Methods ─────────────────────────────────────────

  createTimer(data = {}) {
    this.send('create-timer', data);
  }

  updateTimer(id, updates) {
    this.send('update-timer', { id, ...updates });
  }

  deleteTimer(id) {
    this.send('delete-timer', { id });
  }

  timerAction(id, action) {
    this.send('timer-action', { id, action });
  }

  setActiveTimer(id) {
    this.send('set-active-timer', { id });
  }

  sendMessage(text, visible = true) {
    this.send('send-message', { text, visible });
  }

  clearMessage() {
    this.send('send-message', { text: '', visible: false });
  }

  reorderTimers(order) {
    this.send('reorder-timers', { order });
  }

  globalAction(action) {
    this.send('global-action', { action });
  }

  updateRoom(data) {
    this.send('update-room', data);
  }

  // ─── Event System ────────────────────────────────────────────────

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
      try { cb(data); } catch (e) { console.error('Listener error:', e); }
    });
  }
}
