const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '16kb' }));

// ─── Authentication & Security Configuration (Env / Salted Hash) ────
const AUTH_SALT = process.env.AUTH_SALT || 'st_pfp_v1_salt_9f8e7d6c';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

function computePasswordHash(plainText) {
  const normalized = String(plainText || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(`${AUTH_SALT}:${normalized}`).digest('hex');
}

function safeCompareHex(hashA, hashB) {
  try {
    const bufA = Buffer.from(String(hashA || ''), 'hex');
    const bufB = Buffer.from(String(hashB || ''), 'hex');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (_) {
    return false;
  }
}

// Hashes can be overridden via environment variables (MASTER_PASSWORD, OPERATOR_PASSWORD, or pre-hashed *_HASH)
const MASTER_HASHES = (
  process.env.MASTER_PASSWORD
    ? [computePasswordHash(process.env.MASTER_PASSWORD)]
    : (process.env.MASTER_PASSWORD_HASH ? process.env.MASTER_PASSWORD_HASH.split(',').map(s => s.trim()) : [
        'fb2e5f099f5a42d505f0e1114d2f0e28c667852ebcecb6f7202d3fe9d955f346'
      ])
);

const OPERATOR_HASHES = (
  process.env.OPERATOR_PASSWORD
    ? [computePasswordHash(process.env.OPERATOR_PASSWORD)]
    : (process.env.OPERATOR_PASSWORD_HASH ? process.env.OPERATOR_PASSWORD_HASH.split(',').map(s => s.trim()) : [
        'f62cd1e7b7ab0ba4e545477674d5e8788c8119d17be4e2e1367cd27b29f55972',
        'c823786caa78b9c35b7719b058021956a1cf8406a7ac466d9b91e1cf62683a65'
      ])
);

function createSessionToken(role, isMaster) {
  const payload = `${role}:${isMaster ? '1' : '0'}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

app.post('/api/auth/verify', (req, res) => {
  const { password, role } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'Palavra-passe obrigatória.' });
  }

  const candidateHash = computePasswordHash(password);
  const isMasterMatch = MASTER_HASHES.some(h => safeCompareHex(candidateHash, h));
  const isOperatorMatch = OPERATOR_HASHES.some(h => safeCompareHex(candidateHash, h));

  if (role === 'master') {
    if (isMasterMatch) {
      return res.json({
        ok: true,
        role: 'master',
        isMaster: true,
        token: createSessionToken('master', true)
      });
    }
    return res.status(401).json({ ok: false, error: 'Credencial Master inválida.' });
  }

  if (isMasterMatch || isOperatorMatch) {
    return res.json({
      ok: true,
      role: isMasterMatch ? 'master' : 'operator',
      isMaster: isMasterMatch,
      token: createSessionToken(isMasterMatch ? 'master' : 'operator', isMasterMatch)
    });
  }

  return res.status(401).json({ ok: false, error: 'Credencial de acesso inválida.' });
});

// Serve static files with no-cache for scripts/styles so updates apply immediately
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Redirect root to controller
app.get('/', (req, res) => {
  res.redirect('/controller.html');
});

// ─── State Management ────────────────────────────────────────────────

const rooms = new Map();

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex'); // 6-char hex id
}

function createRoom(id) {
  return {
    id,
    name: 'Stage Timer',
    activeTimerId: null,
    message: { text: '', visible: false },
    timers: [],
    clients: new Set(),
  };
}

function createTimer(data = {}) {
  return {
    id: crypto.randomUUID(),
    name: data.name || 'New Timer',
    mode: data.mode || 'countdown',       // countdown | countup | clock
    duration: data.duration || 300000,     // 5 min default (ms)
    elapsed: 0,
    state: 'stopped',                      // stopped | running | finished
    warnAt: data.warnAt ?? 60000,          // 1 min warning
    dangerAt: data.dangerAt ?? 10000,      // 10s danger
    startedAt: null,                       // internal: timestamp
  };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId));
  }
  return rooms.get(roomId);
}

function getRoomState(room) {
  return {
    id: room.id,
    name: room.name,
    activeTimerId: room.activeTimerId,
    message: { ...room.message },
    timers: room.timers.map(t => {
      const { startedAt, ...rest } = t;
      // For running timers, compute current elapsed on the fly
      if (t.state === 'running' && t.startedAt) {
        rest.elapsed = t.elapsed + (Date.now() - t.startedAt);
        if (t.mode === 'countdown' && rest.elapsed >= t.duration) {
          rest.elapsed = t.duration;
        }
      }
      return rest;
    }),
  };
}

function broadcastRoomState(room) {
  const state = getRoomState(room);
  const msg = JSON.stringify({ type: 'room-state', data: state });
  for (const client of room.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// ─── Timer Tick Loop ─────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let hasRunning = false;
    for (const timer of room.timers) {
      if (timer.state === 'running' && timer.startedAt) {
        hasRunning = true;
        const totalElapsed = timer.elapsed + (now - timer.startedAt);

        // Check if countdown finished
        if (timer.mode === 'countdown' && totalElapsed >= timer.duration) {
          timer.elapsed = timer.duration;
          timer.state = 'finished';
          timer.startedAt = null;
        }
      }
    }
    if (hasRunning || room.timers.some(t => t.state === 'finished')) {
      broadcastRoomState(room);
      // Clear finished flag after broadcasting (keep state as finished)
    }
  }
}, 100);

// ─── Timer Actions ───────────────────────────────────────────────────

function handleTimerAction(timer, action) {
  const now = Date.now();
  switch (action) {
    case 'start':
      if (timer.state !== 'running') {
        if (timer.state === 'finished') {
          timer.elapsed = 0;
        }
        timer.state = 'running';
        timer.startedAt = now;
      }
      break;
    case 'pause':
      if (timer.state === 'running') {
        if (timer.startedAt) {
          timer.elapsed += now - timer.startedAt;
        }
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
        handleTimerAction(timer, 'pause');
      } else {
        handleTimerAction(timer, 'start');
      }
      break;
  }
}

// ─── WebSocket Handling ──────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room') || generateRoomId();
  const role = url.searchParams.get('role') || 'viewer';

  const room = getRoom(roomId);
  room.clients.add(ws);
  ws.roomId = roomId;
  ws.role = role;

  // Send initial state with the actual room ID
  ws.send(JSON.stringify({
    type: 'room-state',
    data: getRoomState(room),
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(ws, room, msg);
    } catch (e) {
      console.error('Invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    // Clean up empty rooms after 5 minutes
    if (room.clients.size === 0) {
      setTimeout(() => {
        if (room.clients.size === 0) {
          rooms.delete(room.id);
        }
      }, 5 * 60 * 1000);
    }
  });
});

function handleMessage(ws, room, msg) {
  switch (msg.type) {
    case 'create-timer': {
      const timer = createTimer(msg.data || {});
      room.timers.push(timer);
      if (!room.activeTimerId) {
        room.activeTimerId = timer.id;
      }
      break;
    }

    case 'update-timer': {
      const timer = room.timers.find(t => t.id === msg.data?.id);
      if (timer) {
        const allowed = ['name', 'mode', 'duration', 'warnAt', 'dangerAt'];
        for (const key of allowed) {
          if (msg.data[key] !== undefined) {
            timer[key] = msg.data[key];
          }
        }
      }
      break;
    }

    case 'delete-timer': {
      const idx = room.timers.findIndex(t => t.id === msg.data?.id);
      if (idx >= 0) {
        const deletedId = room.timers[idx].id;
        room.timers.splice(idx, 1);
        if (room.activeTimerId === deletedId) {
          room.activeTimerId = room.timers[0]?.id || null;
        }
      }
      break;
    }

    case 'timer-action': {
      const timer = room.timers.find(t => t.id === msg.data?.id);
      if (timer) {
        handleTimerAction(timer, msg.data.action);
      }
      break;
    }

    case 'set-active-timer': {
      if (room.timers.find(t => t.id === msg.data?.id)) {
        room.activeTimerId = msg.data.id;
      }
      break;
    }

    case 'send-message': {
      room.message = {
        text: msg.data?.text || '',
        visible: !!msg.data?.visible,
      };
      break;
    }

    case 'reorder-timers': {
      const order = msg.data?.order;
      if (Array.isArray(order)) {
        const reordered = [];
        for (const id of order) {
          const t = room.timers.find(t => t.id === id);
          if (t) reordered.push(t);
        }
        for (const t of room.timers) {
          if (!reordered.includes(t)) reordered.push(t);
        }
        room.timers = reordered;
      }
      break;
    }

    case 'global-action': {
      for (const timer of room.timers) {
        handleTimerAction(timer, msg.data?.action);
      }
      break;
    }

    case 'update-room': {
      if (msg.data?.name) room.name = msg.data.name;
      break;
    }

    default:
      return; // Don't broadcast unknown messages
  }

  broadcastRoomState(room);
}

// ─── Start Server ────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  🎭 StageTimer is running!');
  console.log('');
  console.log(`  Controller → http://localhost:${PORT}/controller.html`);
  console.log(`  Viewer     → http://localhost:${PORT}/viewer.html`);
  console.log('');
});
