const crypto = require('crypto');

const AUTH_SALT = process.env.AUTH_SALT || 'st_pfp_v1_salt_9f8e7d6c';
const AUTH_SECRET = process.env.AUTH_SECRET || 'st_pfp_serverless_hmac_secret';

// Rate limiting in-memory store
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_FAILED_ATTEMPTS = 8; // Max 8 failed attempts / min

function getClientIp(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['client-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function isRateLimited(ip) {
  if (!ip || ip === 'unknown') return false;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry) return false;
  if (now - entry.startTime > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordAttempt(ip, success) {
  if (!ip || ip === 'unknown') return;
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, startTime: now };
  if (now - entry.startTime > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.startTime = now;
  }
  if (!success) {
    entry.count += 1;
  } else {
    rateLimitMap.delete(ip);
  }
  rateLimitMap.set(ip, entry);
}

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

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowed = isOriginAllowed(origin);

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed ? (origin || '*') : 'null',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' })
    };
  }

  const clientIp = getClientIp(event);

  try {
    const body = JSON.parse(event.body || '{}');

    // 1. Token Verification Action
    if (body.action === 'verify_token') {
      const token = String(body.token || '');
      const parts = token.split('.');
      if (parts.length !== 2) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, valid: false, error: 'Token com formato inválido.' })
        };
      }

      const [b64Payload, sig] = parts;
      let rawPayload = '';
      try {
        rawPayload = Buffer.from(b64Payload, 'base64url').toString('utf8');
      } catch (_) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, valid: false, error: 'Payload base64 corrompido.' })
        };
      }

      const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(rawPayload).digest('hex');
      const isSigValid = safeCompareHex(sig, expectedSig);
      if (!isSigValid) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, valid: false, error: 'Assinatura criptográfica inválida.' })
        };
      }

      const [role, isMasterStr, tsStr] = rawPayload.split(':');
      const ts = Number(tsStr);
      const isMaster = isMasterStr === '1';

      if (!ts || Date.now() - ts > 48 * 3600 * 1000) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, valid: false, error: 'Sessão expirada (limite 48 horas).' })
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, valid: true, role, isMaster, issuedAt: ts })
      };
    }

    // 2. Rate Limiting Check for Login Attempts
    if (isRateLimited(clientIp)) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          error: 'Demasiadas tentativas de autenticação falhadas. Aguarde 1 minuto.'
        })
      };
    }

    const password = body.password || '';
    const role = body.role || 'operator';

    if (!password || typeof password !== 'string') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'Palavra-passe obrigatória.' })
      };
    }

    const masterHashes = process.env.MASTER_PASSWORD
      ? [computePasswordHash(process.env.MASTER_PASSWORD)]
      : (process.env.MASTER_PASSWORD_HASH
          ? process.env.MASTER_PASSWORD_HASH.split(',').map(s => s.trim())
          : ['fb2e5f099f5a42d505f0e1114d2f0e28c667852ebcecb6f7202d3fe9d955f346']);

    const operatorHashes = process.env.OPERATOR_PASSWORD
      ? [computePasswordHash(process.env.OPERATOR_PASSWORD)]
      : (process.env.OPERATOR_PASSWORD_HASH
          ? process.env.OPERATOR_PASSWORD_HASH.split(',').map(s => s.trim())
          : [
              'f62cd1e7b7ab0ba4e545477674d5e8788c8119d17be4e2e1367cd27b29f55972',
              'c823786caa78b9c35b7719b058021956a1cf8406a7ac466d9b91e1cf62683a65'
            ]);

    const regiesHashes = [
      '08db75a469b66d3614c20f1dda8366634e22d549d46bdfdf0c75dc72657a1d73', // 0000
      ...masterHashes
    ];

    const candidateHash = computePasswordHash(password);
    const isMasterMatch = masterHashes.some(h => safeCompareHex(candidateHash, h));
    const isOperatorMatch = operatorHashes.some(h => safeCompareHex(candidateHash, h));
    const isRegiesMatch = regiesHashes.some(h => safeCompareHex(candidateHash, h));

    if (role === 'master' && !isMasterMatch) {
      recordAttempt(clientIp, false);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'Credencial Master inválida.' })
      };
    }

    if (role === 'regies' && !isRegiesMatch && !isOperatorMatch && !isMasterMatch) {
      recordAttempt(clientIp, false);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'Credencial Régies inválida.' })
      };
    }

    if (isMasterMatch || isOperatorMatch || (role === 'regies' && isRegiesMatch)) {
      recordAttempt(clientIp, true);
      const assignedRole = isMasterMatch ? 'master' : (role === 'regies' ? 'regies' : 'operator');
      const payload = `${assignedRole}:${isMasterMatch ? '1' : '0'}:${Date.now()}`;
      const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
      const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          role: assignedRole,
          isMaster: isMasterMatch,
          token
        })
      };
    }

    recordAttempt(clientIp, false);
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Credencial de acesso inválida.' })
    };
  } catch (_) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Erro interno na autenticação.' })
    };
  }
};
