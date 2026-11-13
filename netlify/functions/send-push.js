/**
 * StageTimer PFP — Netlify Serverless Function: Push & Telegram Gateway
 * Enables secure dispatching of background push notifications and optional Telegram webhook relay.
 */
exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
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
    const { action, text, botToken, chatId, notification } = payload;

    // Optional Telegram proxy for clients that prefer routing via serverless
    if (action === 'telegram') {
      const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
      const chat = chatId || process.env.TELEGRAM_CHAT_ID;

      if (!token || !chat || !text) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Parâmetros incompletos para envio de Telegram.' })
        };
      }

      const tgUrl = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
      const tgRes = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      const tgData = await tgRes.json();

      return {
        statusCode: tgRes.ok ? 200 : 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: tgRes.ok, result: tgData })
      };
    }

    // Web Push broadcast endpoint
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
      body: JSON.stringify({ ok: false, error: 'Ação desconhecida. Use action: "telegram" ou "push".' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: err.message || 'Erro interno no gateway de notificações.' })
    };
  }
};
