/**
 * ShowFlow — Hub Local de Régie & Palco (Servidor Híbrido LAN / Offline)
 * 
 * Permite a sincronização em tempo real de todos os 10 ecrãs na rede local
 * mesmo em recintos com corte total de Internet / 4G.
 * 
 * Modos de Operação:
 * - 100% Plug-and-Play (Zero dependências externas obrigatórias, com fallback nativo)
 * - Compatível com express + ws se instalados
 * - Sincronização de Estado (State), Comandos Remotos (Cmds), Intercom Régies e Presença
 * - Sincronização de Milissegundos em LAN (NTP Local)
 * - Persistência automática em disco local (pasta ./data/)
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Configurações & Segurança ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const AUTH_SALT = process.env.AUTH_SALT || 'st_pfp_v1_salt_9f8e7d6c';
const AUTH_SECRET = process.env.AUTH_SECRET || 'st_pfp_serverless_hmac_secret';
const DATA_DIR = path.join(__dirname, 'data');

// Garantir pasta de persistência local
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (_) {}

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

const MASTER_HASHES = process.env.MASTER_PASSWORD
  ? [computePasswordHash(process.env.MASTER_PASSWORD)]
  : (process.env.MASTER_PASSWORD_HASH
      ? process.env.MASTER_PASSWORD_HASH.split(',').map(s => s.trim())
      : ['fb2e5f099f5a42d505f0e1114d2f0e28c667852ebcecb6f7202d3fe9d955f346']);

const OPERATOR_HASHES = process.env.OPERATOR_PASSWORD
  ? [computePasswordHash(process.env.OPERATOR_PASSWORD)]
  : (process.env.OPERATOR_PASSWORD_HASH
      ? process.env.OPERATOR_PASSWORD_HASH.split(',').map(s => s.trim())
      : [
          'f62cd1e7b7ab0ba4e545477674d5e8788c8119d17be4e2e1367cd27b29f55972',
          'c823786caa78b9c35b7719b058021956a1cf8406a7ac466d9b91e1cf62683a65'
        ]);

const REGIES_HASHES = [
  '08db75a469b66d3614c20f1dda8366634e22d549d46bdfdf0c75dc72657a1d73', // 0000
  ...MASTER_HASHES
];

function createSessionToken(role, isMaster) {
  const payload = `${role}:${isMaster ? '1' : '0'}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

// ─── MIME Types para Servir Ficheiros Estáticos ─────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// ─── Armazenamento em Memória & Persistência Local ──────────────────────
const roomStates = new Map(); // roomCode -> state object
const roomClients = new Map(); // roomCode -> Set of ws clients
const allClients = new Set(); // all connected ws clients

function loadPersistedState(roomCode) {
  const clean = String(roomCode || 'PALCO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const filePath = path.join(DATA_DIR, `state_${clean}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

function persistRoomState(roomCode, state) {
  if (!state || typeof state !== 'object') return;
  const clean = String(roomCode || 'PALCO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const filePath = path.join(DATA_DIR, `state_${clean}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}

function getRoomState(roomCode) {
  const clean = String(roomCode || 'PALCO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!roomStates.has(clean)) {
    const fromDisk = loadPersistedState(clean);
    if (fromDisk) {
      roomStates.set(clean, fromDisk);
    }
  }
  return roomStates.get(clean) || null;
}

// ─── Servidor HTTP & Handlers de Rotas ──────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // 1. API: /api/auth/verify (Idêntico ao Netlify Serverless Auth)
  if (pathname === '/api/auth/verify' && req.method === 'POST') {
    let bodyRaw = '';
    req.on('data', chunk => { bodyRaw += chunk; });
    req.on('end', () => {
      try {
        const body = JSON.parse(bodyRaw || '{}');
        const password = String(body.password || '').trim();
        const role = body.role || 'operator';

        if (!password) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'Palavra-passe obrigatória.' }));
        }

        const candidateHash = computePasswordHash(password);
        const isMasterMatch = MASTER_HASHES.some(h => safeCompareHex(candidateHash, h));
        const isOperatorMatch = OPERATOR_HASHES.some(h => safeCompareHex(candidateHash, h));
        const isRegiesMatch = REGIES_HASHES.some(h => safeCompareHex(candidateHash, h));

        if (role === 'master' && !isMasterMatch) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'Credencial Master inválida.' }));
        }

        if (role === 'regies' && !isRegiesMatch && !isOperatorMatch && !isMasterMatch) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'Credencial Régies inválida.' }));
        }

        if (isMasterMatch || isOperatorMatch || (role === 'regies' && isRegiesMatch)) {
          const assignedRole = isMasterMatch ? 'master' : (role === 'regies' ? 'regies' : 'operator');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            role: assignedRole,
            isMaster: isMasterMatch,
            token: createSessionToken(assignedRole, isMasterMatch)
          }));
        }

        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'Credencial de acesso inválida.' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'Erro no servidor de autenticação.' }));
      }
    });
    return;
  }

  // 2. API: /api/hub/status
  if (pathname === '/api/hub/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      service: 'ShowFlow Local Hub',
      version: 'v139',
      connectedClients: allClients.size,
      roomsActive: roomClients.size,
      uptimeSecs: Math.round(process.uptime()),
      trueTime: Date.now()
    }));
  }

  // 3. API: /api/hub/state/:room (GET & POST)
  if (pathname.startsWith('/api/hub/state/')) {
    const roomCode = pathname.replace('/api/hub/state/', '').toUpperCase().trim();
    if (req.method === 'GET') {
      const state = getRoomState(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, room: roomCode, data: state }));
    }
    if (req.method === 'POST') {
      let bodyRaw = '';
      req.on('data', chunk => { bodyRaw += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(bodyRaw || '{}');
          if (body.data) {
            roomStates.set(roomCode, body.data);
            persistRoomState(roomCode, body.data);
            broadcastToRoom(roomCode, null, {
              type: 'sync_state',
              room: roomCode,
              sender: 'hub_rest_api',
              sentAt: Date.now(),
              data: body.data
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, room: roomCode }));
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'Corpo JSON inválido.' }));
        }
      });
      return;
    }
  }

  // 4. Servir Ficheiros Estáticos da pasta public/
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

  // Prevenir Directory Traversal
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    return res.end('Acesso Proibido');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Se não encontrar o ficheiro exato, tentar fallback com .html
      const htmlFallback = filePath + '.html';
      if (fs.existsSync(htmlFallback)) {
        filePath = htmlFallback;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Ficheiro não encontrado no ShowFlow Hub');
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // No-cache para assets dinâmicos garantindo atualizações instantâneas no recinto
    res.setHeader('Content-Type', contentType);
    if (ext === '.html' || ext === '.js' || ext === '.css' || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// ─── WebSocket Hub Relay (Suporte a biblioteca 'ws' ou Upgrade Nativo) ──
let wss = null;
try {
  const { WebSocketServer } = require('ws');
  wss = new WebSocketServer({ noServer: true });
} catch (_) {}

function broadcastToRoom(roomCode, senderWs, payloadObj) {
  const clean = String(roomCode || 'PALCO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const clients = roomClients.get(clean);
  if (!clients || clients.size === 0) return;

  const rawJson = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
  for (const client of clients) {
    if (client !== senderWs && (client.readyState === 1 || client._isOpen)) {
      try {
        if (typeof client.send === 'function') {
          client.send(rawJson);
        } else if (typeof client._sendRaw === 'function') {
          client._sendRaw(rawJson);
        }
      } catch (_) {}
    }
  }
}

function broadcastToAll(senderWs, payloadObj) {
  const rawJson = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
  for (const client of allClients) {
    if (client !== senderWs && (client.readyState === 1 || client._isOpen)) {
      try {
        if (typeof client.send === 'function') {
          client.send(rawJson);
        } else if (typeof client._sendRaw === 'function') {
          client._sendRaw(rawJson);
        }
      } catch (_) {}
    }
  }
}

function handleClientMessage(ws, rawData) {
  try {
    const msg = JSON.parse(rawData.toString('utf8'));
    if (!msg || typeof msg !== 'object') return;

    const roomCode = String(msg.room || ws.roomCode || 'PALCO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');

    // 1. Time Sync Ping / Pong (NTP de Milissegundo em LAN)
    if (msg.type === 'time_ping') {
      const pong = JSON.stringify({
        type: 'time_pong',
        clientTs: msg.clientTs,
        serverTs: Date.now()
      });
      if (typeof ws.send === 'function') ws.send(pong);
      else if (typeof ws._sendRaw === 'function') ws._sendRaw(pong);
      return;
    }

    // 2. State Sync (Distribuição atómica de alinhamentos e timers)
    if (msg.type === 'sync_state' && msg.data) {
      roomStates.set(roomCode, msg.data);
      persistRoomState(roomCode, msg.data);
      broadcastToRoom(roomCode, ws, {
        type: 'sync_state',
        room: roomCode,
        sender: ws.clientId,
        sentAt: msg.sentAt || Date.now(),
        data: msg.data
      });
      return;
    }

    // 3. Comandos Remotos de Palco (Navegação, Reload, etc.)
    if (msg.type === 'remote_cmd') {
      broadcastToRoom(roomCode, ws, msg);
      return;
    }

    // 4. Intercom de Régies (Mensagens, ACKs e Chamadas Gerais)
    if (msg.type === 'regie_msg' || msg.type === 'regie_ack' || msg.type === 'regie_call') {
      broadcastToRoom(roomCode, ws, msg);
      return;
    }

    // 5. Presença em Tempo Real de Dispositivos Técnicos
    if (msg.type === 'presence') {
      broadcastToRoom(roomCode, ws, msg);
      broadcastToAll(ws, msg); // Para a Super Régie Master ver todos os palcos
      return;
    }

    // 6. Registo de Eventos (Multi-Room)
    if (msg.type === 'events_registry') {
      broadcastToAll(ws, msg);
      return;
    }
  } catch (_) {}
}

function registerConnectedWs(ws, req) {
  const url = new URL(req.url, 'http://localhost');
  const roomCode = String(url.searchParams.get('room') || 'PALCO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const clientId = url.searchParams.get('clientId') || ('client_' + Math.random().toString(36).substring(2, 8));
  const role = url.searchParams.get('role') || 'viewer';

  ws.roomCode = roomCode;
  ws.clientId = clientId;
  ws.role = role;
  ws._isOpen = true;

  if (!roomClients.has(roomCode)) {
    roomClients.set(roomCode, new Set());
  }
  roomClients.get(roomCode).add(ws);
  allClients.add(ws);

  // Enviar estado atual em memória ou disco assim que o ecrã se liga
  const curState = getRoomState(roomCode);
  if (curState) {
    const initPayload = JSON.stringify({
      type: 'sync_state',
      room: roomCode,
      sender: 'hub_server',
      sentAt: Date.now(),
      data: curState
    });
    try {
      if (typeof ws.send === 'function') ws.send(initPayload);
      else if (typeof ws._sendRaw === 'function') ws._sendRaw(initPayload);
    } catch (_) {}
  }

  const onClose = () => {
    ws._isOpen = false;
    allClients.delete(ws);
    const roomSet = roomClients.get(roomCode);
    if (roomSet) {
      roomSet.delete(ws);
      if (roomSet.size === 0) roomClients.delete(roomCode);
    }
  };

  if (typeof ws.on === 'function') {
    ws.on('message', data => handleClientMessage(ws, data));
    ws.on('close', onClose);
    ws.on('error', onClose);
  }

  return onClose;
}

// Suporte a Upgrade HTTP -> WebSocket
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/ws' && pathname !== '/') {
    socket.destroy();
    return;
  }

  // 1. Se o pacote 'ws' estiver disponível, usar a sua implementação
  if (wss) {
    wss.handleUpgrade(req, socket, head, ws => {
      registerConnectedWs(ws, req);
    });
    return;
  }

  // 2. Fallback Nativo RFC 6455 (Zero dependências externas)
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    ''
  ].join('\r\n');

  socket.write(headers + '\r\n');

  const customWs = {
    readyState: 1,
    _isOpen: true,
    _sendRaw: text => {
      const payload = Buffer.from(text, 'utf8');
      const len = payload.length;
      let header;
      if (len < 126) {
        header = Buffer.from([0x81, len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      socket.write(Buffer.concat([header, payload]));
    },
    close: () => socket.end()
  };

  const cleanup = registerConnectedWs(customWs, req);

  // Descodificador simples de frames WebSocket
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const isMasked = (buffer[1] & 0x80) === 0x80;
      let payloadLen = buffer[1] & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskOffset = offset;
      const dataOffset = isMasked ? maskOffset + 4 : maskOffset;
      const totalLen = dataOffset + payloadLen;
      if (buffer.length < totalLen) return;

      const dataBuf = buffer.slice(dataOffset, totalLen);
      if (isMasked) {
        const maskKey = buffer.slice(maskOffset, maskOffset + 4);
        for (let i = 0; i < dataBuf.length; i++) {
          dataBuf[i] ^= maskKey[i % 4];
        }
      }

      handleClientMessage(customWs, dataBuf);
      buffer = buffer.slice(totalLen);
    }
  });

  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

// ─── Iniciar Servidor & Apresentar IPs de Rede ──────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  console.log('\n  ╔═══════════════════════════════════════════════════════════════════╗');
  console.log('  ║             🎪 SHOWFLOW — HUB LOCAL DE RÉGIE & PALCO              ║');
  console.log('  ║                    MODO HÍBRIDO LAN / OFFLINE                     ║');
  console.log('  ╚═══════════════════════════════════════════════════════════════════╝\n');
  console.log(`  🚀 Servidor ativo na porta ${PORT} com sincronização LAN ativada.\n`);
  console.log('  Aceda nos ecrãs de palco, iPads e telemóveis ligados à mesma rede:');
  console.log(`  ➜ Local (este PC):  http://localhost:${PORT}`);
  ips.forEach(ip => {
    console.log(`  ➜ Na Rede Wi-Fi:    http://${ip}:${PORT}`);
    console.log(`  ➜ WebSocket LAN:    ws://${ip}:${PORT}/ws`);
  });
  console.log('\n  💡 Se a Internet falhar no recinto, a sincronização LAN mantém-se 100% ativa!\n');
});
