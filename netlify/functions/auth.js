const crypto = require('crypto');

const AUTH_SALT = process.env.AUTH_SALT || 'st_pfp_v1_salt_9f8e7d6c';
const AUTH_SECRET = process.env.AUTH_SECRET || 'st_pfp_serverless_hmac_secret';

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const password = body.password || '';
    const role = body.role || 'operator';

    if (!password || typeof password !== 'string') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
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

    const candidateHash = computePasswordHash(password);
    const isMasterMatch = masterHashes.some(h => safeCompareHex(candidateHash, h));
    const isOperatorMatch = operatorHashes.some(h => safeCompareHex(candidateHash, h));

    if (role === 'master' && !isMasterMatch) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Credencial Master inválida.' })
      };
    }

    if (isMasterMatch || isOperatorMatch) {
      const payload = `${isMasterMatch ? 'master' : 'operator'}:${isMasterMatch ? '1' : '0'}:${Date.now()}`;
      const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
      const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          role: isMasterMatch ? 'master' : 'operator',
          isMaster: isMasterMatch,
          token
        })
      };
    }

    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Credencial de acesso inválida.' })
    };
  } catch (_) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Erro interno na autenticação.' })
    };
  }
};
