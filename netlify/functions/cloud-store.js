const crypto = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || 'st_pfp_serverless_hmac_secret';

// In-memory fallback cache (used when Netlify Blobs is not configured)
const memoryStore = new Map();
const revisionsStore = new Map();

let getStore = null;
try {
  getStore = require('@netlify/blobs').getStore;
} catch (_) {}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const o = String(origin).toLowerCase().trim();
  return (
    o.includes('localhost') ||
    o.includes('127.0.0.1') ||
    o.endsWith('.netlify.app') ||
    o.endsWith('stagetimer.io') ||
    o.endsWith('showflow.app') ||
    o.endsWith('github.io')
  );
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [b64Payload, sig] = parts;
    const rawPayload = Buffer.from(b64Payload, 'base64url').toString('utf8');
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(rawPayload).digest('hex');
    if (sig !== expectedSig) return false;
    const [, , tsStr] = rawPayload.split(':');
    const ts = Number(tsStr);
    return ts && (Date.now() - ts < 48 * 3600 * 1000);
  } catch (_) {
    return false;
  }
}

function sanitizeState(state) {
  if (!state || typeof state !== 'object') return state;
  try {
    const cloned = JSON.parse(JSON.stringify(state));
    if (cloned.integrations?.telegram) {
      cloned.integrations.telegram = {
        ...cloned.integrations.telegram,
        hasToken: Boolean(cloned.integrations.telegram.botToken),
        botToken: ''
      };
    }
    return cloned;
  } catch (_) {
    return state;
  }
}

async function getNetlifyBlob(storeName, key) {
  if (getStore && process.env.NETLIFY_BLOBS_CONTEXT) {
    try {
      const store = getStore(storeName);
      const data = await store.get(key, { type: 'json' });
      return data;
    } catch (_) {}
  }
  return memoryStore.get(`${storeName}:${key}`) || null;
}

async function setNetlifyBlob(storeName, key, value) {
  memoryStore.set(`${storeName}:${key}`, value);
  if (getStore && process.env.NETLIFY_BLOBS_CONTEXT) {
    try {
      const store = getStore(storeName);
      await store.setJSON(key, value);
    } catch (_) {}
  }
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowed = isOriginAllowed(origin);

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed ? (origin || '*') : 'null',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!allowed) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Origem não autorizada.' })
    };
  }

  let body = {};
  if (event.httpMethod === 'POST') {
    try {
      body = JSON.parse(event.body || '{}');
    } catch (_) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'Corpo JSON inválido.' })
      };
    }
  }

  const query = event.queryStringParameters || {};
  const action = body.action || query.action || 'get_state';
  const room = (body.room || query.room || 'PALCO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');

  try {
    // ─── ACTION 1: SALVAR ESTADO E CRIAR REVISÃO ───────────────────────
    if (action === 'save_state') {
      const token = body.token || event.headers.authorization?.replace(/^Bearer\s+/i, '');
      const state = body.state;

      if (!state || typeof state !== 'object') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Objeto de estado inválido.' })
        };
      }

      const now = Date.now();
      const sanitized = sanitizeState(state);
      sanitized.updatedAt = sanitized.updatedAt || now;

      const revId = `rev_${now}_${Math.random().toString(36).substr(2, 6)}`;
      const revSummary = {
        revId,
        savedAt: now,
        savedTimeStr: new Date(now).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        timerCount: Array.isArray(sanitized.timers) ? sanitized.timers.length : 0,
        showState: sanitized.theatre?.showState || 'pre',
        currentDay: sanitized.currentDay || 1,
        sender: String(body.sender || 'unknown').slice(0, 32)
      };

      // Guardar estado principal
      await setNetlifyBlob('showflow_states', room, {
        latest: sanitized,
        latestRevId: revId,
        updatedAt: now
      });

      // Guardar snapshot de revisão individual
      await setNetlifyBlob('showflow_revisions', `${room}_${revId}`, sanitized);

      // Atualizar lista de revisões (máx. 25 mais recentes)
      let revList = revisionsStore.get(room) || [];
      revList.unshift(revSummary);
      if (revList.length > 25) revList = revList.slice(0, 25);
      revisionsStore.set(room, revList);
      await setNetlifyBlob('showflow_revisions_index', room, revList);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          room,
          revision: revId,
          savedAt: now,
          timerCount: revSummary.timerCount
        })
      };
    }

    // ─── ACTION 2: OBTER ESTADO ATUAL OU REVISÃO ESPECÍFICA ────────────
    if (action === 'get_state') {
      const targetRevId = query.revId || body.revId;

      if (targetRevId) {
        const snap = await getNetlifyBlob('showflow_revisions', `${room}_${targetRevId}`);
        if (!snap) {
          return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({ ok: false, error: 'Revisão histórica não encontrada.' })
          };
        }
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, room, revision: targetRevId, state: snap })
        };
      }

      const stored = await getNetlifyBlob('showflow_states', room);
      if (!stored || !stored.latest) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, room, state: null, exists: false })
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          room,
          revision: stored.latestRevId,
          updatedAt: stored.updatedAt,
          state: stored.latest,
          exists: true
        })
      };
    }

    // ─── ACTION 3: LISTAR HISTÓRICO DE REVISÕES ───────────────────────
    if (action === 'list_revisions') {
      let revList = revisionsStore.get(room);
      if (!revList) {
        revList = (await getNetlifyBlob('showflow_revisions_index', room)) || [];
        revisionsStore.set(room, revList);
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, room, revisions: revList })
      };
    }

    // ─── ACTION 4: REGISTO DE EVENTOS DA NUVEM ────────────────────────
    if (action === 'save_registry') {
      const events = body.events || [];
      if (!Array.isArray(events)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Lista de eventos inválida.' })
        };
      }
      await setNetlifyBlob('showflow_registry', 'events_list', events);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, count: events.length })
      };
    }

    if (action === 'get_registry') {
      const events = (await getNetlifyBlob('showflow_registry', 'events_list')) || [];
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, events })
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: `Ação desconhecida: ${action}` })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Erro interno no Cloud Store.' })
    };
  }
};
