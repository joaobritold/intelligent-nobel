/**
 * StageTimer PFP — Netlify Serverless Function: Push & Telegram Gateway Relay
 * Provides resilient server-side dispatching with retry, HTML-fallback, and rate-limit handling.
 */
function stripHtml(str) {
  return String(str || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

async function callTelegramWithRetry(token, method, bodyObj, maxAttempts = 3) {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
  let lastData = null;
  let lastStatus = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj)
      });
      lastStatus = res.status;
      lastData = await res.json().catch(() => null);

      if (res.ok && lastData && lastData.ok) {
        return { ok: true, status: 200, data: lastData };
      }

      // Automatic plain-text fallback on HTML entity error
      if (res.status === 400 && bodyObj.parse_mode && /can't parse entities|parse/i.test(lastData?.description || '')) {
        const plainBody = { ...bodyObj, text: stripHtml(bodyObj.text) };
        delete plainBody.parse_mode;
        const plainRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plainBody)
        });
        const plainData = await plainRes.json().catch(() => null);
        if (plainRes.ok && plainData && plainData.ok) {
          return { ok: true, status: 200, data: plainData };
        }
      }

      // Respect HTTP 429 retry_after if short enough for serverless execution (< 4s)
      if (res.status === 429) {
        const retrySecs = Number(lastData?.parameters?.retry_after) || 2;
        if (retrySecs <= 4 && attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, (retrySecs * 1000) + 200));
          continue;
        }
        break;
      }

      // Permanent client error (400, 401, 403)
      if (res.status >= 400 && res.status < 500) {
        break;
      }
    } catch (err) {
      lastData = { ok: false, description: err.message || 'Network Error' };
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt - 1)));
    }
  }

  return { ok: false, status: lastStatus, data: lastData };
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
      body: JSON.stringify({ ok: false, error: 'Origem de requisição não autorizada.' })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { action, text, botToken, chatId, replyToMessageId, offset, notification } = payload;

    // 1. Telegram Outbound Relay
    if (action === 'telegram') {
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
      const chat = (chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

      if (!token || !chat || !text) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Parâmetros incompletos para envio de Telegram.' })
        };
      }

      const sendBody = {
        chat_id: chat,
        text: String(text).substring(0, 3950),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (replyToMessageId) {
        sendBody.reply_to_message_id = replyToMessageId;
        sendBody.allow_sending_without_reply = true;
      }

      const outcome = await callTelegramWithRetry(token, 'sendMessage', sendBody, 3);
      return {
        statusCode: outcome.ok ? 200 : (outcome.status || 400),
        headers: corsHeaders,
        body: JSON.stringify({ ok: outcome.ok, result: outcome.data })
      };
    }

    // 2. Telegram Inbound Updates Relay
    if (action === 'telegram_updates') {
      const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (!token) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Bot Token em falta.' })
        };
      }

      const outcome = await callTelegramWithRetry(token, 'getUpdates', {
        offset: offset || undefined,
        limit: 15,
        timeout: 0,
        allowed_updates: ['message', 'channel_post']
      }, 2);

      return {
        statusCode: outcome.ok ? 200 : (outcome.status || 400),
        headers: corsHeaders,
        body: JSON.stringify({ ok: outcome.ok, result: outcome.data })
      };
    }

    // 3. Web Push Broadcast Endpoint
    if (action === 'push') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          message: 'Notificação registada com sucesso.',
          received: notification || {}
        })
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Ação desconhecida. Use action: "telegram", "telegram_updates" ou "push".' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: err.message || 'Erro interno no gateway de notificações.' })
    };
  }
};
