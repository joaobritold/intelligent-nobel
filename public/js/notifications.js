/**
 * StageTimer PFP — High-Reliability Real-Time Notifications & Telegram Messaging Engine
 *
 * Architecture:
 *  1. Persistent Priority Outbox Queue (FIFO + High-Priority Jump, localStorage backed)
 *  2. Non-Blocking Per-Chat Token Bucket Rate Limiter (Prevents HTTP 429 & respects retry_after)
 *  3. Exponential Backoff with Full Jitter + Serverless Gateway Failover + Plain-Text Fallback
 *  4. Strict HTML Entity Sanitizer & Scannable Message Formatter (Zero parse_mode errors)
 *  5. Cross-Tab & Cross-Device Idempotent Deduplication (Zero duplicate alerts, zero lost alerts)
 *  6. Two-Way Telegram Inbound Polling Engine (getUpdates: /status, /regie, /palco, /ack, /chamar, replies)
 *  7. Native Mobile / Web Push Notifications + Web Audio Synthesizer Chimes
 */
(function (global) {
  'use strict';

  const OUTBOX_STORAGE_KEY = 'stagetimer_tg_outbox_v2';
  const SENT_CACHE_STORAGE_KEY = 'stagetimer_tg_sent_cache_v2';
  const MAX_OUTBOX_SIZE = 50;
  const MAX_RETRIES = 5;
  const BASE_BACKOFF_MS = 1000;
  const FETCH_TIMEOUT_MS = 8000;
  const MIN_CHAT_INTERVAL_MS = 1100; // Telegram group safe sustained pacing (~1 msg / 1.1s after burst)
  const BURST_ALLOWANCE = 3;

  // ─── 0. HTML Sanitizer & Time Formatters ─────────────────────────────────
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripHtmlTags(str) {
    return String(str ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  }

  function truncateTelegramText(text, maxLen = 3950) {
    const s = String(text || '');
    if (s.length <= maxLen) return s;
    return s.substring(0, maxLen) + '…';
  }

  function formatDurationMs(ms) {
    const isNeg = ms < 0;
    const totalSecs = Math.floor(Math.abs(ms) / 1000);
    const hh = Math.floor(totalSecs / 3600);
    const mm = Math.floor((totalSecs % 3600) / 60);
    const ss = totalSecs % 60;
    const sign = isNeg ? '-' : '';
    if (hh > 0) {
      return `${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  function getNowTimeStr(withSeconds = true) {
    try {
      if (global.UniversalSyncClient && typeof global.UniversalSyncClient.getTrueTimeString === 'function') {
        return global.UniversalSyncClient.getTrueTimeString(withSeconds);
      }
    } catch (_) {}
    const opts = withSeconds
      ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' };
    return new Date().toLocaleTimeString('pt-PT', opts);
  }

  // ─── Web Audio Context Chime Synthesizer ─────────────────────────────────
  let _audioCtx = null;
  function _playChime(type = 'cue') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!_audioCtx || _audioCtx.state === 'suspended') {
        _audioCtx = new AudioCtx();
        if (_audioCtx.state === 'suspended') {
          _audioCtx.resume().catch(() => {});
        }
      }
      const now = _audioCtx.currentTime;
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.connect(gain);
      gain.connect(_audioCtx.destination);

      if (type === 'go') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'standby') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'warning') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(554.37, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN ENGINE: StageTimerNotifications
  // ══════════════════════════════════════════════════════════════════════════
  const StageTimerNotifications = {
    _syncClient: null,
    _role: 'general',
    _clientId: null,
    _outbox: [],
    _isProcessingQueue: false,
    _chatRateBuckets: new Map(), // chatId -> { tokens, lastRefill, blockedUntil }
    _dispatchedEvents: new Map(), // eventKey -> timestamp
    _roomWatchState: new Map(),   // roomCode -> per-room tracking state
    _seededRooms: new Set(),      // rooms whose initial snapshot was seeded
    _watcherInterval: null,
    _inboundPollInterval: null,
    _isPollingInbound: false,

    // ──────────────────────────────────────────────────────────────────────
    // 1. BROWSER & MOBILE NATIVE NOTIFICATIONS
    // ──────────────────────────────────────────────────────────────────────
    isBrowserSupported() {
      return ('Notification' in window) && ('serviceWorker' in navigator);
    },

    isIosWithoutPwa() {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = window.navigator.standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
      return isIos && !isStandalone;
    },

    getBrowserPermission() {
      if (!('Notification' in window)) return 'unsupported';
      return Notification.permission;
    },

    async requestBrowserPermission() {
      if (this.isIosWithoutPwa()) {
        return {
          status: 'ios_safari_needs_pwa',
          message: 'No iPhone, adicione primeiro a aplicação ao Ecrã Principal (Partilhar ➔ Adicionar ao Ecrã Principal) para ativar notificações nativas.'
        };
      }
      if (!('Notification' in window)) {
        return { status: 'unsupported', message: 'Este navegador não suporta notificações nativas.' };
      }

      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          this.showLocalNotification('🔔 Notificações Ativadas!', {
            body: 'O StageTimer PFP enviará alertas de palco, chamadas e comunicações para este dispositivo.',
            tag: 'stagetimer-welcome',
            vibrate: [100, 50, 100]
          });
          return { status: 'granted', message: 'Notificações ativadas com sucesso!' };
        } else if (permission === 'denied') {
          return { status: 'denied', message: 'Permissão recusada nas definições do navegador.' };
        }
        return { status: 'default', message: 'Permissão pendente.' };
      } catch (e) {
        return { status: 'error', message: e.message || 'Erro ao solicitar permissões.' };
      }
    },

    async showLocalNotification(title, options = {}) {
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        return false;
      }

      if (navigator.vibrate) {
        try {
          navigator.vibrate(options.vibrate || [150, 80, 150]);
        } catch (_) {}
      }

      const notifOptions = {
        body: options.body || '',
        icon: options.icon || './icon-192.png',
        badge: options.badge || './icon-192.png',
        vibrate: options.vibrate || [150, 80, 150],
        tag: options.tag || ('stagetimer-' + Date.now()),
        renotify: options.renotify !== false,
        data: options.data || { url: window.location.href }
      };

      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready;
          if (reg && reg.showNotification) {
            await reg.showNotification(title, notifOptions);
            return true;
          }
        }
        new Notification(title, notifOptions);
        return true;
      } catch (_) {
        try {
          new Notification(title, notifOptions);
          return true;
        } catch (__) {
          return false;
        }
      }
    },

    // ──────────────────────────────────────────────────────────────────────
    // 2. CONFIGURATION RESOLUTION (MULTI-ROOM & FALLBACKS)
    // ──────────────────────────────────────────────────────────────────────
    _resolveTelegramConfig(roomCode = null, customConfig = null) {
      if (customConfig && customConfig.botToken && customConfig.chatId) {
        return customConfig;
      }

      const cleanRoom = String(roomCode || this._syncClient?.cleanRoom || 'PALCO1').toUpperCase().trim();

      // 1. Direct helper on UniversalSyncClient (checks memory + stagetimer_v10_telegram_<ROOM> + state)
      if (this._syncClient && typeof this._syncClient.getRoomTelegramConfig === 'function') {
        const roomCfg = this._syncClient.getRoomTelegramConfig(cleanRoom);
        if (roomCfg && roomCfg.botToken && roomCfg.chatId) {
          return roomCfg;
        }
      }

      // 2. Check dedicated localStorage key for target room
      try {
        const rawDedicated = localStorage.getItem(`stagetimer_v10_telegram_${cleanRoom}`);
        if (rawDedicated) {
          const parsed = JSON.parse(rawDedicated);
          if (parsed && parsed.botToken && parsed.chatId) return parsed;
        }
      } catch (_) {}

      // 3. Check room state in localStorage
      try {
        const rawState = localStorage.getItem(`stagetimer_v10_state_${cleanRoom}`);
        if (rawState) {
          const parsedState = JSON.parse(rawState);
          if (parsedState?.integrations?.telegram?.botToken) {
            return parsedState.integrations.telegram;
          }
        }
      } catch (_) {}

      // 4. Current syncClient active state
      if (this._syncClient && typeof this._syncClient.getIntegrations === 'function') {
        const integ = this._syncClient.getIntegrations();
        if (integ?.telegram?.botToken) return integ.telegram;
      }

      // 5. Global last saved config fallback (if user configured in Master for the event)
      try {
        const rawGlobal = localStorage.getItem('stagetimer_v10_telegram_GLOBAL_LAST');
        if (rawGlobal) {
          const parsedGlobal = JSON.parse(rawGlobal);
          if (parsedGlobal && parsedGlobal.botToken && parsedGlobal.chatId && customConfig?.enabled !== false) {
            return customConfig ? { ...parsedGlobal, ...customConfig } : parsedGlobal;
          }
        }
      } catch (_) {}

      return customConfig || null;
    },

    // ──────────────────────────────────────────────────────────────────────
    // 3. PERSISTENT PRIORITY QUEUE, RATE LIMITER & EXPONENTIAL BACKOFF
    // ──────────────────────────────────────────────────────────────────────
    _loadOutbox() {
      try {
        const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const now = Date.now();
            // Keep only messages younger than 10 minutes
            this._outbox = arr.filter(item => item && item.text && (now - (item.createdAt || 0) < 600000));
          }
        }
      } catch (_) {
        this._outbox = [];
      }
    },

    _saveOutbox() {
      try {
        if (this._outbox.length > MAX_OUTBOX_SIZE) {
          this._outbox = this._outbox.slice(0, MAX_OUTBOX_SIZE);
        }
        localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(this._outbox));
      } catch (_) {}
    },

    _getRateDelayMs(chatId) {
      const now = Date.now();
      let bucket = this._chatRateBuckets.get(chatId);
      if (!bucket) {
        bucket = { tokens: BURST_ALLOWANCE, lastRefill: now, blockedUntil: 0 };
        this._chatRateBuckets.set(chatId, bucket);
      }

      if (bucket.blockedUntil > now) {
        return bucket.blockedUntil - now;
      }

      const elapsed = now - bucket.lastRefill;
      if (elapsed >= MIN_CHAT_INTERVAL_MS) {
        const refillCount = Math.floor(elapsed / MIN_CHAT_INTERVAL_MS);
        bucket.tokens = Math.min(BURST_ALLOWANCE, bucket.tokens + refillCount);
        bucket.lastRefill = now;
      }

      if (bucket.tokens > 0) {
        bucket.tokens -= 1;
        return 0;
      }

      const waitMs = Math.max(250, MIN_CHAT_INTERVAL_MS - (now - bucket.lastRefill));
      return waitMs;
    },

    _setChatRateBlock(chatId, retryAfterSeconds) {
      const waitMs = (Math.max(1, Number(retryAfterSeconds) || 3) * 1000) + 300;
      const blockedUntil = Date.now() + waitMs;
      this._chatRateBuckets.set(chatId, {
        tokens: 0,
        lastRefill: Date.now(),
        blockedUntil
      });
    },

    async sendTelegramMessage(text, customConfig = null, options = {}) {
      const roomCode = options.room || customConfig?.room || this._syncClient?.cleanRoom || 'PALCO1';
      const cfg = this._resolveTelegramConfig(roomCode, customConfig);

      if (!cfg || !cfg.enabled) {
        return { success: false, reason: 'disabled' };
      }

      const token = String(cfg.botToken || '').trim();
      const chatId = String(cfg.chatId || '').trim();

      if (!token || !chatId) {
        return { success: false, error: 'Token ou Chat ID do Telegram não configurados.' };
      }

      const eventKey = options.eventKey || null;
      if (eventKey && this._isEventAlreadyDispatched(eventKey)) {
        return { success: true, deduplicated: true };
      }
      if (eventKey) {
        this._markEventDispatched(eventKey, roomCode);
      }

      const job = {
        id: 'tgjob_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        eventKey,
        room: roomCode,
        token,
        chatId,
        text: truncateTelegramText(text),
        priority: options.priority || 'normal',
        replyToMessageId: options.replyToMessageId || null,
        attempts: 0,
        createdAt: Date.now(),
        nextAttemptAt: Date.now()
      };

      // If immediate interactive call (like Test button), execute and return directly
      if (options.immediate === true) {
        return await this._executeTelegramJob(job);
      }

      // Enqueue with priority support
      if (job.priority === 'high') {
        const firstNormalIdx = this._outbox.findIndex(item => item.priority !== 'high');
        if (firstNormalIdx === -1) {
          this._outbox.push(job);
        } else {
          this._outbox.splice(firstNormalIdx, 0, job);
        }
      } else {
        this._outbox.push(job);
      }

      this._saveOutbox();
      this._processQueue();
      return { success: true, queued: true, jobId: job.id };
    },

    async _processQueue() {
      if (this._isProcessingQueue) return;
      this._isProcessingQueue = true;

      try {
        while (this._outbox.length > 0) {
          const now = Date.now();
          // Find next ready job
          const readyIdx = this._outbox.findIndex(j => (j.nextAttemptAt || 0) <= now);
          if (readyIdx === -1) {
            const earliest = Math.min(...this._outbox.map(j => j.nextAttemptAt || (now + 1000)));
            const sleepMs = Math.min(5000, Math.max(200, earliest - now));
            await new Promise(r => setTimeout(r, sleepMs));
            continue;
          }

          const job = this._outbox[readyIdx];

          // Check if another device already dispatched this eventKey while queued
          if (job.eventKey && this._isEventClaimedByPeer(job.eventKey)) {
            this._outbox.splice(readyIdx, 1);
            this._saveOutbox();
            continue;
          }

          // Check Token Bucket Rate Limit for this chatId
          const rateWaitMs = this._getRateDelayMs(job.chatId);
          if (rateWaitMs > 0) {
            await new Promise(r => setTimeout(r, rateWaitMs));
          }

          const res = await this._executeTelegramJob(job);

          if (res.success || res.permanentFailure) {
            this._outbox.splice(readyIdx, 1);
            this._saveOutbox();
          } else {
            job.attempts = (job.attempts || 0) + 1;
            if (job.attempts >= MAX_RETRIES) {
              console.error('[StageTimer Telegram] Mensagem descartada após máximo de tentativas:', job.id, res.error);
              this._outbox.splice(readyIdx, 1);
              this._saveOutbox();
            } else {
              const backoff = res.retryAfterMs
                ? res.retryAfterMs
                : (BASE_BACKOFF_MS * Math.pow(2, job.attempts - 1)) + Math.floor(Math.random() * 400);
              job.nextAttemptAt = Date.now() + backoff;
              this._saveOutbox();
              await new Promise(r => setTimeout(r, Math.min(backoff, 2500)));
            }
          }
        }
      } finally {
        this._isProcessingQueue = false;
      }
    },

    async _executeTelegramJob(job) {
      const payload = {
        chat_id: job.chatId,
        text: job.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (job.replyToMessageId) {
        payload.reply_to_message_id = job.replyToMessageId;
        payload.allow_sending_without_reply = true;
      }

      // 1. Direct Telegram Bot API Call with AbortController Timeout
      const directResult = await this._postTelegramApi(job.token, 'sendMessage', payload);

      if (directResult.ok) {
        return {
          success: true,
          messageId: directResult.result?.message_id || null
        };
      }

      // 2. Handle Supergroup Migration (migrate_to_chat_id)
      if (directResult.migrateToChatId) {
        const newChatId = String(directResult.migrateToChatId);
        job.chatId = newChatId;
        payload.chat_id = newChatId;
        const migRes = await this._postTelegramApi(job.token, 'sendMessage', payload);
        if (migRes.ok) {
          return { success: true, messageId: migRes.result?.message_id || null };
        }
      }

      // 3. Handle HTML Entity Parse Error -> Automatic Plain-Text Fallback (Guaranteed Delivery)
      if (directResult.statusCode === 400 && /can't parse entities|parse/i.test(directResult.description || '')) {
        const plainPayload = {
          chat_id: job.chatId,
          text: stripHtmlTags(job.text),
          disable_web_page_preview: true
        };
        const plainRes = await this._postTelegramApi(job.token, 'sendMessage', plainPayload);
        if (plainRes.ok) {
          return { success: true, messageId: plainRes.result?.message_id || null };
        }
      }

      // 4. Handle Rate Limit (HTTP 429)
      if (directResult.statusCode === 429) {
        const retrySecs = directResult.retryAfter || 3;
        this._setChatRateBlock(job.chatId, retrySecs);
        return {
          success: false,
          retryAfterMs: (retrySecs * 1000) + 300,
          error: `Rate limit (aguardar ${retrySecs}s)`
        };
      }

      // 5. Permanent Client Errors (400 chat not found, 401 unauthorized, 403 bot kicked)
      if (directResult.statusCode === 400 || directResult.statusCode === 401 || directResult.statusCode === 403) {
        return {
          success: false,
          permanentFailure: true,
          error: directResult.description || `Erro HTTP ${directResult.statusCode}`
        };
      }

      // 6. Network Error or 5xx -> Try Serverless Gateway Relay Fallback (/.netlify/functions/send-push)
      if (directResult.networkError || (directResult.statusCode && directResult.statusCode >= 500)) {
        try {
          const relayCtrl = new AbortController();
          const relayTimer = setTimeout(() => relayCtrl.abort(), FETCH_TIMEOUT_MS);
          const relayRes = await fetch('/.netlify/functions/send-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'telegram',
              botToken: job.token,
              chatId: job.chatId,
              text: job.text
            }),
            signal: relayCtrl.signal
          });
          clearTimeout(relayTimer);
          if (relayRes.ok) {
            const relayData = await relayRes.json();
            if (relayData && relayData.ok) {
              return {
                success: true,
                messageId: relayData.result?.result?.message_id || null
              };
            }
          }
        } catch (_) {}
      }

      return {
        success: false,
        error: directResult.description || 'Falha temporária de rede ao contactar o Telegram.'
      };
    },

    async _postTelegramApi(token, method, payload, timeoutMs = FETCH_TIMEOUT_MS) {
      const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl ? ctrl.signal : undefined
        });
        if (timer) clearTimeout(timer);

        const data = await response.json().catch(() => null);
        if (data && data.ok) {
          return { ok: true, statusCode: response.status, result: data.result };
        }

        return {
          ok: false,
          statusCode: response.status,
          description: data?.description || `HTTP ${response.status}`,
          retryAfter: data?.parameters?.retry_after || null,
          migrateToChatId: data?.parameters?.migrate_to_chat_id || null
        };
      } catch (err) {
        if (timer) clearTimeout(timer);
        return {
          ok: false,
          networkError: true,
          statusCode: 0,
          description: err?.name === 'AbortError'
            ? 'Tempo limite excedido (timeout) ao contactar api.telegram.org'
            : (err?.message || 'Erro de ligação à rede')
        };
      }
    },

    async testTelegram(botToken, chatId, stageName = 'Palco') {
      const token = String(botToken || '').trim();
      const chat = String(chatId || '').trim();

      if (!token || !chat) {
        return { success: false, error: 'Por favor, preencha o Bot Token e o Chat ID.' };
      }

      const nowStr = getNowTimeStr(true);
      const safeStage = escapeHtml(stageName || 'Palco');
      const testMsg =
        `🧪 <b>STAGETIMER PFP — TESTE DE LIGAÇÃO</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ <b>Estado:</b> Operacional (Tempo Real)\n` +
        `🎪 <b>Palco / Sala:</b> <code>${safeStage}</code>\n` +
        `⏰ <b>Hora Sincronizada:</b> <code>${nowStr}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔔 <i>Alertas ativos: Avisos 5m/1m/Fim, Chamadas de Régie, Comunicações Técnicas e Prompter.</i>\n` +
        `💬 <i>Dica: Envie <code>/status</code>, <code>/regie mensagem</code> ou <code>/ok</code> neste grupo para interagir com a régie!</i>`;

      return await this.sendTelegramMessage(
        testMsg,
        { enabled: true, botToken: token, chatId: chat },
        { immediate: true, priority: 'high', room: stageName }
      );
    },

    // ──────────────────────────────────────────────────────────────────────
    // 4. DISTRIBUTED DEDUPLICATION & LEADER ELECTION
    // ──────────────────────────────────────────────────────────────────────
    _getMyClientId() {
      if (!this._clientId) {
        this._clientId = (this._syncClient && this._syncClient.clientId) ||
          ('st_' + Math.random().toString(36).substring(2, 9));
      }
      return this._clientId;
    },

    _loadSentCache() {
      try {
        const raw = localStorage.getItem(SENT_CACHE_STORAGE_KEY);
        if (raw) {
          const obj = JSON.parse(raw);
          const now = Date.now();
          Object.entries(obj || {}).forEach(([k, v]) => {
            if (now - (v.ts || 0) < 3600000) {
              this._dispatchedEvents.set(k, v);
            }
          });
        }
      } catch (_) {}
    },

    _saveSentCache() {
      try {
        const now = Date.now();
        const obj = {};
        for (const [k, v] of this._dispatchedEvents.entries()) {
          if (now - (v.ts || 0) < 3600000) {
            obj[k] = v;
          } else {
            this._dispatchedEvents.delete(k);
          }
        }
        localStorage.setItem(SENT_CACHE_STORAGE_KEY, JSON.stringify(obj));
      } catch (_) {}
    },

    _isEventAlreadyDispatched(eventKey) {
      if (!eventKey) return false;
      if (this._dispatchedEvents.has(eventKey)) return true;
      try {
        const raw = localStorage.getItem(SENT_CACHE_STORAGE_KEY);
        if (raw) {
          const obj = JSON.parse(raw);
          if (obj && obj[eventKey]) {
            this._dispatchedEvents.set(eventKey, obj[eventKey]);
            return true;
          }
        }
      } catch (_) {}
      return false;
    },

    _isEventClaimedByPeer(eventKey) {
      const entry = this._dispatchedEvents.get(eventKey);
      if (!entry) return false;
      return Boolean(entry.by && entry.by !== this._getMyClientId());
    },

    _markEventDispatched(eventKey, roomCode = 'PALCO1', claimedBy = null) {
      if (!eventKey) return;
      const myId = this._getMyClientId();
      const author = claimedBy || myId;
      this._dispatchedEvents.set(eventKey, { by: author, ts: Date.now() });
      this._saveSentCache();

      // Broadcast claim to peers so other open devices/tabs don't duplicate
      if (!claimedBy && this._syncClient && typeof this._syncClient.sendRoomCommand === 'function') {
        try {
          this._syncClient.sendRoomCommand(roomCode, {
            action: 'tg_event_claimed',
            room: roomCode,
            eventKey,
            by: myId,
            ts: Date.now()
          });
        } catch (_) {}
      }
    },

    _isTelegramLeader(room) {
      const cleanRoom = String(room || 'PALCO1').toUpperCase().trim();
      const roomKey = `stagetimer_tg_leader_${cleanRoom}`;
      const now = Date.now();
      const myId = this._getMyClientId();

      try {
        const raw = localStorage.getItem(roomKey);
        if (raw) {
          const leader = JSON.parse(raw);
          if (leader.id === myId || (now - (leader.ts || 0)) > 4500) {
            localStorage.setItem(roomKey, JSON.stringify({ id: myId, ts: now, role: this._role }));
            return true;
          }
          return false;
        }
        localStorage.setItem(roomKey, JSON.stringify({ id: myId, ts: now, role: this._role }));
        return true;
      } catch (_) {
        return true;
      }
    },

    // ──────────────────────────────────────────────────────────────────────
    // 5. AUTOMATED REAL-TIME EVENT & TIMER WATCHER
    // ──────────────────────────────────────────────────────────────────────
    _getRoomWatchState(roomCode) {
      const code = String(roomCode || 'PALCO1').toUpperCase().trim();
      if (!this._roomWatchState.has(code)) {
        this._roomWatchState.set(code, {
          lastTimerId: null,
          sent5m: false,
          sent1m: false,
          sentEnd: false,
          lastStandbyCueId: null,
          lastActiveCueId: null,
          lastRegieMsgId: null,
          lastRegieCallAt: 0,
          lastTheatreNoticeAt: 0,
          lastStageMsgKey: null
        });
      }
      return this._roomWatchState.get(code);
    },

    _seedInitialRoomSnapshot(state) {
      if (!state) return;
      const roomCode = String(state.id || this._syncClient?.cleanRoom || 'PALCO1').toUpperCase().trim();
      if (this._seededRooms.has(roomCode)) return;
      this._seededRooms.add(roomCode);

      const rState = this._getRoomWatchState(roomCode);
      const now = Date.now();

      // Seed existing visible messages older than 12 seconds so page reload doesn't re-alert old state
      if (state.regieMessage && state.regieMessage.visible && state.regieMessage.id) {
        const ageMs = now - (state.regieMessage.sentAt || 0);
        if (!state.regieMessage.sentAt || ageMs > 12000) {
          rState.lastRegieMsgId = state.regieMessage.id;
        }
      }
      if (state.regieCall && state.regieCall.triggeredAt) {
        if (now - state.regieCall.triggeredAt > 8000) {
          rState.lastRegieCallAt = state.regieCall.triggeredAt;
        }
      }
      if (state.theatre?.urgentNotice?.visible && state.theatre.urgentNotice.sentAt) {
        if (now - state.theatre.urgentNotice.sentAt > 12000) {
          rState.lastTheatreNoticeAt = state.theatre.urgentNotice.sentAt;
        }
      }
      if (state.message && state.message.visible && state.message.text) {
        const msgAge = state.message.sentAt ? (now - state.message.sentAt) : 999999;
        if (msgAge > 12000) {
          rState.lastStageMsgKey = state.message.id || state.message.text;
        }
      }
      if (state.theatre) {
        if (state.theatre.standbyCueId) rState.lastStandbyCueId = state.theatre.standbyCueId;
        if (state.theatre.activeCueId) rState.lastActiveCueId = state.theatre.activeCueId;
      }
    },

    initWatcher(syncClient, currentRole = 'general') {
      if (!syncClient) return;
      this._syncClient = syncClient;
      this._role = currentRole;
      this._loadOutbox();
      this._loadSentCache();

      if (this._outbox.length > 0) {
        this._processQueue();
      }

      // Listen to peer deduplication claims
      if (typeof syncClient.on === 'function') {
        syncClient.on('tg-event-claimed', (claim) => {
          if (claim && claim.eventKey) {
            this._markEventDispatched(claim.eventKey, claim.room || 'PALCO1', claim.by || 'peer');
          }
        });

        // Listen to room state updates
        syncClient.on('room-state', (state) => {
          this._lastState = state;
          this._seedInitialRoomSnapshot(state);
          this.checkStateEvents(state);
        });

        // Listen to multi-room updates (Master Mode)
        syncClient.on('multi-room-state', ({ room, data }) => {
          if (data && typeof data === 'object') {
            if (!data.id && room) data.id = room;
            this._seedInitialRoomSnapshot(data);
            this.checkStateEvents(data);
            this.checkTimerTick(data);
          }
        });

        syncClient.on('multi-room-regie-call', ({ room, regieCall }) => {
          if (room && regieCall) {
            this.checkStateEvents({ id: room, name: room, regieCall });
          }
        });

        syncClient.on('multi-room-regie-msg', ({ room, regieMessage }) => {
          if (room && regieMessage) {
            this.checkStateEvents({ id: room, name: room, regieMessage });
          }
        });
      }

      // 1-second precision timer threshold watcher
      if (this._watcherInterval) {
        clearInterval(this._watcherInterval);
      }
      this._watcherInterval = setInterval(() => {
        if (this._syncClient) {
          const st = (typeof this._syncClient.getState === 'function')
            ? this._syncClient.getState()
            : this._syncClient.state;
          if (st) this.checkTimerTick(st);
        }
      }, 1000);

      // Start Two-Way Telegram Inbound Polling Engine (getUpdates)
      this._startInboundPolling();
    },

    checkTimerTick(state) {
      if (!state || !Array.isArray(state.timers)) return;
      const roomCode = String(state.id || this._syncClient?.cleanRoom || 'PALCO1').toUpperCase().trim();
      const rState = this._getRoomWatchState(roomCode);

      const activeTimer = (global.UniversalSyncClient && typeof global.UniversalSyncClient.getActiveTimer === 'function')
        ? global.UniversalSyncClient.getActiveTimer(state)
        : state.timers.find(t => t.id === state.activeTimerId);

      if (!activeTimer || activeTimer.mode === 'clock') {
        rState.lastTimerId = null;
        rState.sent5m = false;
        rState.sent1m = false;
        rState.sentEnd = false;
        return;
      }

      if (activeTimer.id !== rState.lastTimerId) {
        rState.lastTimerId = activeTimer.id;
        rState.sent5m = false;
        rState.sent1m = false;
        rState.sentEnd = false;
      }

      if (activeTimer.state !== 'running') return;

      // Normalize duration & elapsed to milliseconds (StageTimer stores duration/elapsed in ms)
      const rawDuration = Number(activeTimer.duration) || 0;
      const isMs = rawDuration > 10000; // >10,000 means milliseconds (e.g. 60,000ms = 1min)
      const durationMs = isMs ? rawDuration : (rawDuration * 1000);

      let elapsedMs = 0;
      if (global.UniversalSyncClient && typeof global.UniversalSyncClient.getTimerElapsed === 'function' && isMs) {
        elapsedMs = global.UniversalSyncClient.getTimerElapsed(activeTimer);
      } else {
        const baseElapsed = Number(activeTimer.elapsed) || 0;
        const baseElapsedMs = isMs ? baseElapsed : (baseElapsed * 1000);
        const anchor = activeTimer.serverStartedAt || activeTimer.startedAt;
        if (anchor) {
          const trueNow = (this._syncClient && typeof this._syncClient.getTrueTime === 'function')
            ? this._syncClient.getTrueTime()
            : Date.now();
          elapsedMs = baseElapsedMs + Math.max(0, trueNow - anchor);
        } else {
          const live = Number(activeTimer.liveElapsed) || baseElapsed;
          elapsedMs = isMs ? live : (live * 1000);
        }
      }

      const remainingMs = durationMs - elapsedMs;
      const stageName = state.name || roomCode || 'Palco';
      const safeStage = escapeHtml(stageName);
      const timerTitle = activeTimer.name || activeTimer.title || 'Artista / Ato';
      const safeArtist = escapeHtml(timerTitle);
      const tgCfg = this._resolveTelegramConfig(roomCode, state.integrations?.telegram);
      const isLeader = this._isTelegramLeader(roomCode);
      const nowStr = getNowTimeStr(false);

      // Reset flags if user added time (+1m / +5m) back above threshold
      if (remainingMs > 305000) rState.sent5m = false;
      if (remainingMs > 65000) rState.sent1m = false;
      if (remainingMs > 5000) rState.sentEnd = false;

      // ⏳ 1. Aviso 5 Minutos (<= 300,000ms and > 60,000ms, for timers >= 5m30s)
      if (durationMs >= 330000 && remainingMs <= 300000 && remainingMs > 60000 && !rState.sent5m) {
        rState.sent5m = true;
        const eventKey = `tg_5m_${roomCode}_${activeTimer.id}`;
        _playChime('warning');

        this.showLocalNotification(`⏳ Faltam 5 Minutos — ${stageName}`, {
          body: `${timerTitle}: restam 05:00 de atuação no palco.`,
          tag: eventKey,
          vibrate: [200, 100, 200]
        });

        if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alert5m !== false) {
          this.sendTelegramMessage(
            `⏳ <b>AVISO 5 MINUTOS</b> • <code>${safeStage}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🎤 <b>Em Palco:</b> ${safeArtist}\n` +
            `⏱️ <b>Tempo Restante:</b> <code>05:00</code>\n` +
            `⏰ <b>Hora:</b> ${nowStr}`,
            tgCfg,
            { eventKey, room: roomCode, priority: 'normal' }
          );
        }
      }

      // ⚠️ 2. Aviso 1 Minuto (<= 60,000ms and > 0ms, for timers >= 1m10s)
      if (durationMs >= 70000 && remainingMs <= 60000 && remainingMs > 0 && !rState.sent1m) {
        rState.sent1m = true;
        const eventKey = `tg_1m_${roomCode}_${activeTimer.id}`;
        _playChime('warning');

        this.showLocalNotification(`⚠️ Falta 1 Minuto — ${stageName}`, {
          body: `${timerTitle}: reta final! Restam 60 segundos.`,
          tag: eventKey,
          vibrate: [300, 100, 300]
        });

        if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alert1m !== false) {
          this.sendTelegramMessage(
            `⚠️ <b>AVISO 1 MINUTO</b> • <code>${safeStage}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🎤 <b>Em Palco:</b> ${safeArtist}\n` +
            `⏱️ <b>Tempo Restante:</b> <code>01:00</code> (Reta Final)\n` +
            `⏭️ <i>Próxima atuação / mudança de palco a postos!</i>`,
            tgCfg,
            { eventKey, room: roomCode, priority: 'high' }
          );
        }
      }

      // 🛑 3. Fim do Tempo / Overtime (<= 0ms)
      if (durationMs > 0 && remainingMs <= 0 && !rState.sentEnd) {
        rState.sentEnd = true;
        const eventKey = `tg_end_${roomCode}_${activeTimer.id}`;
        _playChime('warning');

        this.showLocalNotification(`🛑 Tempo Esgotado — ${stageName}`, {
          body: `${timerTitle}: tempo regulamentar terminado (Overtime)!`,
          tag: eventKey,
          vibrate: [500, 150, 500]
        });

        if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertEnd !== false) {
          this.sendTelegramMessage(
            `🛑 <b>TEMPO ESGOTADO (OVERTIME)</b> • <code>${safeStage}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🎤 <b>Artista:</b> ${safeArtist}\n` +
            `⏱️ <b>Estado:</b> Tempo regulamentar concluído (<code>00:00</code>)\n` +
            `⏰ <b>Hora:</b> ${nowStr}`,
            tgCfg,
            { eventKey, room: roomCode, priority: 'high' }
          );
        }
      }
    },

    checkStateEvents(state) {
      if (!state) return;
      const roomCode = String(state.id || this._syncClient?.cleanRoom || 'PALCO1').toUpperCase().trim();
      const rState = this._getRoomWatchState(roomCode);
      const stageName = state.name || roomCode || 'Palco';
      const safeStage = escapeHtml(stageName);
      const tgCfg = this._resolveTelegramConfig(roomCode, state.integrations?.telegram);
      const isLeader = this._isTelegramLeader(roomCode);
      const timeStr = getNowTimeStr(false);

      // 1. Chamadas entre Régies (Intercom: FOH ⇄ Palco ⇄ Geral)
      if (state.regieCall && state.regieCall.triggeredAt && (state.regieCall.fohCallingStage || state.regieCall.stageCallingFoh)) {
        if (state.regieCall.triggeredAt !== rState.lastRegieCallAt) {
          rState.lastRegieCallAt = state.regieCall.triggeredAt;
          const eventKey = `tg_rcall_${roomCode}_${state.regieCall.triggeredAt}`;
          _playChime('warning');

          let callTitle = 'Chamada de Régie';
          let callBody = 'Uma régie está a chamar com urgência!';
          let callRoute = 'INTERCOM';
          const caller = escapeHtml(state.regieCall.triggeredBy || 'Régie');

          if (state.regieCall.fohCallingStage && state.regieCall.stageCallingFoh) {
            callTitle = '📞 CHAMADA GERAL DE RÉGIE';
            callBody = 'Alerta máximo: chamada geral para todas as régies e postos técnicos!';
            callRoute = `${caller} ➔ TODAS AS RÉGIES`;
          } else if (state.regieCall.fohCallingStage) {
            callTitle = '📞 FOH ➔ PALCO';
            callBody = 'A Régie de Frente (FOH) está a chamar a Régie de Palco com urgência!';
            callRoute = 'FOH (Frente) ➔ PALCO';
          } else if (state.regieCall.stageCallingFoh) {
            callTitle = '📞 PALCO ➔ FOH';
            callBody = 'A Régie de Palco está a chamar a Frente (FOH) com urgência!';
            callRoute = 'PALCO ➔ FOH (Frente)';
          }

          this.showLocalNotification(`${callTitle} — ${stageName}`, {
            body: callBody,
            tag: eventKey,
            vibrate: [300, 100, 300, 100, 300]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertRegieCalls !== false) {
            this.sendTelegramMessage(
              `📞 <b>CHAMADA URGENTE DE RÉGIE</b> • <code>${safeStage}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `📡 <b>Direção:</b> <b>${callRoute}</b>\n` +
              `🚨 <i>${escapeHtml(callBody)}</i>\n` +
              `⏰ <b>Hora:</b> ${timeStr}`,
              tgCfg,
              { eventKey, room: roomCode, priority: 'high' }
            );
          }
        }
      }

      // 2. Comunicações dadas para as Régies e Técnicos
      if (state.regieMessage && state.regieMessage.visible && state.regieMessage.text) {
        if (state.regieMessage.id && state.regieMessage.id !== rState.lastRegieMsgId) {
          rState.lastRegieMsgId = state.regieMessage.id;
          const eventKey = `tg_rmsg_${roomCode}_${state.regieMessage.id}`;
          _playChime('warning');

          this.showLocalNotification(`📟 Comunicação Régie — ${stageName}`, {
            body: state.regieMessage.text,
            tag: eventKey,
            vibrate: [200, 100, 200]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertRegieMsg !== false) {
            const safeMsg = escapeHtml(state.regieMessage.text);
            const msgTime = escapeHtml(state.regieMessage.sentTimeStr || timeStr);
            this.sendTelegramMessage(
              `📟 <b>COMUNICAÇÃO RÉGIES &amp; TÉCNICOS</b> • <code>${safeStage}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `💬 <b>"${safeMsg}"</b>\n\n` +
              `⏰ <b>Hora:</b> ${msgTime} • <i>Responda <code>/ok</code> para confirmar receção</i>`,
              tgCfg,
              { eventKey, room: roomCode, priority: 'high' }
            );
          }
        }
      }

      // 3. Avisos Urgentes de Direção de Cena (Modo Teatro / DC)
      if (state.theatre?.urgentNotice?.visible && state.theatre.urgentNotice.text) {
        const noticeTs = state.theatre.urgentNotice.sentAt || 1;
        if (noticeTs !== rState.lastTheatreNoticeAt) {
          rState.lastTheatreNoticeAt = noticeTs;
          const eventKey = `tg_dcnotice_${roomCode}_${noticeTs}`;
          _playChime('warning');

          this.showLocalNotification(`📢 Aviso de Cena — ${stageName}`, {
            body: state.theatre.urgentNotice.text,
            tag: eventKey,
            vibrate: [250, 100, 250]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertRegieMsg !== false) {
            const safeNotice = escapeHtml(state.theatre.urgentNotice.text);
            this.sendTelegramMessage(
              `📢 <b>AVISO DIREÇÃO DE CENA</b> • <code>${safeStage}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `💬 <b>"${safeNotice}"</b>\n` +
              `⏰ <b>Hora:</b> ${timeStr}`,
              tgCfg,
              { eventKey, room: roomCode, priority: 'high' }
            );
          }
        }
      }

      // 4. Mensagens de Palco (Prompter / Ecrã dos Artistas)
      if (state.message && state.message.visible && state.message.text) {
        // Key strictly by message ID or text (never state.updatedAt which ticks every 1.5s!)
        const msgKey = state.message.id || `${state.message.text}_${state.message.sentAt || ''}`;
        if (msgKey !== rState.lastStageMsgKey) {
          rState.lastStageMsgKey = msgKey;
          const eventKey = `tg_smsg_${roomCode}_${msgKey}`;
          _playChime('warning');

          this.showLocalNotification(`🚨 Mensagem de Palco — ${stageName}`, {
            body: state.message.text,
            tag: eventKey,
            vibrate: [250, 100, 250, 100, 250]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertUrgent !== false) {
            const safePrompter = escapeHtml(state.message.text);
            const lvl = state.message.level === 'danger' ? '🔴 URGENTE' : (state.message.level === 'warn' ? '🟡 AVISO' : '🔵 INFO');
            this.sendTelegramMessage(
              `🚨 <b>MENSAGEM NO ECRÃ DE PALCO</b> • <code>${safeStage}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `📺 <b>[${lvl}]:</b> <b>"${safePrompter}"</b>\n` +
              `⏰ <b>Hora:</b> ${timeStr}`,
              tgCfg,
              { eventKey, room: roomCode, priority: 'high' }
            );
          }
        }
      } else if (state.message && !state.message.visible) {
        rState.lastStageMsgKey = null;
      }

      // 5. Deixas Cênicas (Cues) — Apenas quando ativado explicitamente (desativado por defeito)
      if (tgCfg && tgCfg.alertCues === true && state.theatre && Array.isArray(state.theatre.cues)) {
        const standbyId = state.theatre.standbyCueId;
        if (standbyId && standbyId !== rState.lastStandbyCueId) {
          rState.lastStandbyCueId = standbyId;
          const cue = state.theatre.cues.find(c => c.id === standbyId);
          if (cue) {
            const eventKey = `tg_cue_sb_${roomCode}_${cue.id}_${cue.standbyAt || 1}`;
            _playChime('standby');
            const cueNum = cue.num || cue.number || '?';
            const targetDept = Array.isArray(cue.departments) && cue.departments.length > 0
              ? cue.departments.join(', ')
              : (cue.target || 'Geral');
            const cueDesc = cue.name || cue.action || cue.title || cue.notes || '';

            this.showLocalNotification(`🟡 STANDBY: Cue ${cueNum} (${targetDept})`, {
              body: `Atenção ${targetDept}: ${cueDesc || 'Aguardar sinal de GO'}`,
              tag: eventKey,
              vibrate: [150, 80, 150]
            });

            if (isLeader && tgCfg.enabled) {
              this.sendTelegramMessage(
                `🟡 <b>STANDBY DEIXA ${escapeHtml(cueNum)}</b> • <code>${safeStage}</code>\n` +
                `🎯 <b>Depto:</b> ${escapeHtml(targetDept)}\n` +
                `📋 <i>${escapeHtml(cueDesc || 'Preparar disparo')}</i>`,
                tgCfg,
                { eventKey, room: roomCode, priority: 'normal' }
              );
            }
          }
        }

        const activeCueId = state.theatre.activeCueId;
        if (activeCueId && activeCueId !== rState.lastActiveCueId) {
          rState.lastActiveCueId = activeCueId;
          const cue = state.theatre.cues.find(c => c.id === activeCueId);
          if (cue) {
            const eventKey = `tg_cue_go_${roomCode}_${cue.id}_${cue.firedAt || 1}`;
            _playChime('go');
            const cueNum = cue.num || cue.number || '?';
            const targetDept = Array.isArray(cue.departments) && cue.departments.length > 0
              ? cue.departments.join(', ')
              : (cue.target || 'Geral');
            const cueDesc = cue.name || cue.action || cue.title || cue.notes || '';

            this.showLocalNotification(`🟢 GO: Cue ${cueNum} (${targetDept})`, {
              body: `EXECUTAR AGORA: ${cueDesc || 'GO!'}`,
              tag: eventKey,
              vibrate: [400, 100, 400]
            });

            if (isLeader && tgCfg.enabled) {
              this.sendTelegramMessage(
                `🟢 <b>GO DEIXA ${escapeHtml(cueNum)}</b> 🚀 • <code>${safeStage}</code>\n` +
                `🎯 <b>Depto:</b> ${escapeHtml(targetDept)}\n` +
                `🎬 <b>${escapeHtml(cueDesc || 'EXECUTAR AGORA')}</b>`,
                tgCfg,
                { eventKey, room: roomCode, priority: 'high' }
              );
            }
          }
        }
      }
    },

    // ──────────────────────────────────────────────────────────────────────
    // 6. TWO-WAY TELEGRAM INBOUND POLLING (getUpdates: Receive Commands & Replies)
    // ──────────────────────────────────────────────────────────────────────
    _isBotPollingLeader(tokenHash) {
      const key = `stagetimer_tg_poll_leader_${tokenHash}`;
      const now = Date.now();
      const myId = this._getMyClientId();
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const leader = JSON.parse(raw);
          if (leader.id === myId || (now - (leader.ts || 0)) > 6000) {
            localStorage.setItem(key, JSON.stringify({ id: myId, ts: now }));
            return true;
          }
          return false;
        }
        localStorage.setItem(key, JSON.stringify({ id: myId, ts: now }));
        return true;
      } catch (_) {
        return true;
      }
    },

    _startInboundPolling() {
      if (this._inboundPollInterval) {
        clearInterval(this._inboundPollInterval);
      }
      this._inboundPollInterval = setInterval(() => {
        this._pollTelegramUpdates().catch(() => {});
      }, 3500);
    },

    async _pollTelegramUpdates() {
      if (this._isPollingInbound || !this._syncClient) return;
      const roomCode = this._syncClient.cleanRoom || 'PALCO1';
      const cfg = this._resolveTelegramConfig(roomCode);
      if (!cfg || !cfg.enabled || !cfg.botToken || !cfg.chatId) return;

      const token = String(cfg.botToken).trim();
      const tokenHash = token.slice(-10).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!this._isBotPollingLeader(tokenHash)) return;

      this._isPollingInbound = true;
      const offsetKey = `stagetimer_tg_offset_${tokenHash}`;

      try {
        let offset = Number(localStorage.getItem(offsetKey)) || 0;
        const isFirstSeed = offset === 0;

        const res = await this._postTelegramApi(token, 'getUpdates', {
          offset: offset > 0 ? offset : undefined,
          limit: 15,
          timeout: 0,
          allowed_updates: ['message', 'channel_post']
        }, 5000);

        if (!res.ok || !Array.isArray(res.result)) return;

        let maxUpdateId = offset;
        for (const upd of res.result) {
          if (upd.update_id >= maxUpdateId) {
            maxUpdateId = upd.update_id + 1;
          }
          // On very first boot without offset, only process messages sent in the last 15 seconds
          const msg = upd.message || upd.channel_post;
          if (!msg) continue;
          const msgAgeSec = (Date.now() / 1000) - (msg.date || 0);
          if (isFirstSeed && msgAgeSec > 15) continue;

          await this._handleInboundTelegramMessage(msg, cfg, roomCode);
        }

        if (maxUpdateId > offset) {
          try {
            localStorage.setItem(offsetKey, String(maxUpdateId));
          } catch (_) {}
        }
      } finally {
        this._isPollingInbound = false;
      }
    },

    async _handleInboundTelegramMessage(msg, cfg, defaultRoomCode) {
      if (!msg || (msg.from && msg.from.is_bot)) return;

      const incomingChatId = String(msg.chat?.id || '');
      const configuredChatId = String(cfg.chatId || '').trim();
      if (configuredChatId && !configuredChatId.startsWith('@') && incomingChatId !== configuredChatId) {
        return;
      }

      const rawText = String(msg.text || msg.caption || '').trim();
      if (!rawText) return;

      const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
        msg.from?.username ||
        msg.chat?.title ||
        'Equipa Telegram';

      const cleanCmd = rawText.replace(/@\S+/, '').trim();
      const lower = cleanCmd.toLowerCase();
      const state = (this._syncClient && typeof this._syncClient.getState === 'function')
        ? this._syncClient.getState()
        : this._syncClient?.state;
      const stageName = state?.name || defaultRoomCode || 'Palco';

      // 1. /status or /estado -> Reply with live stage & timer status
      if (lower === '/status' || lower === '/estado') {
        const activeTimer = (global.UniversalSyncClient && state)
          ? global.UniversalSyncClient.getActiveTimer(state)
          : state?.timers?.find(t => t.id === state?.activeTimerId);

        let statusLines = `📊 <b>ESTADO DO PALCO</b> • <code>${escapeHtml(stageName)}</code>\n━━━━━━━━━━━━━━━━━━━━\n`;
        if (activeTimer) {
          const isMs = (Number(activeTimer.duration) || 0) > 10000;
          const durMs = isMs ? Number(activeTimer.duration) : (Number(activeTimer.duration || 0) * 1000);
          const elMs = (global.UniversalSyncClient && isMs)
            ? global.UniversalSyncClient.getTimerElapsed(activeTimer)
            : (Number(activeTimer.liveElapsed || activeTimer.elapsed || 0) * (isMs ? 1 : 1000));
          const remMs = durMs - elMs;
          const stBadge = activeTimer.state === 'running'
            ? '🟢 EM EXECUÇÃO (ON AIR)'
            : (activeTimer.state === 'paused' ? '⏸️ PAUSADO' : '⏹️ PARADO');

          statusLines +=
            `🎤 <b>Artista / Ato:</b> ${escapeHtml(activeTimer.name || 'Artista')}\n` +
            `📡 <b>Estado:</b> ${stBadge}\n` +
            `⏱️ <b>Tempo Restante:</b> <code>${formatDurationMs(remMs)}</code>\n`;
        } else {
          statusLines += `ℹ️ <i>Nenhum artista ativo no momento.</i>\n`;
        }
        statusLines += `⏰ <b>Hora:</b> ${getNowTimeStr(true)}`;

        await this.sendTelegramMessage(statusLines, cfg, {
          replyToMessageId: msg.message_id,
          priority: 'high',
          room: defaultRoomCode
        });
        return;
      }

      // 2. /ack, /ok, or short confirmation reply ("ok", "recebido", "👍", "✅")
      const isShortAck = ['ok', 'ack', 'recebido', 'confirmado', '👍', '✅', '/ok', '/ack'].includes(lower);
      if (isShortAck) {
        if (this._syncClient && typeof this._syncClient.ackRegieMessage === 'function') {
          this._syncClient.ackRegieMessage('tech', `TG: ${senderName}`);
        }
        await this.sendTelegramMessage(
          `✅ <b>Confirmado (ACK)</b> na régie por <b>${escapeHtml(senderName)}</b> às ${getNowTimeStr(false)}.`,
          cfg,
          { replyToMessageId: msg.message_id, priority: 'high', room: defaultRoomCode }
        );
        return;
      }

      // 3. /chamar or /call -> Trigger Intercom Call on StageTimer screens
      if (lower.startsWith('/chamar') || lower.startsWith('/call')) {
        if (this._syncClient && typeof this._syncClient.triggerRegieCall === 'function') {
          this._syncClient.triggerRegieCall('all', `TG: ${senderName}`);
        }
        await this.sendTelegramMessage(
          `📞 <b>Chamada Geral disparada</b> nos ecrãs de Régie e Palco por <b>${escapeHtml(senderName)}</b>!`,
          cfg,
          { replyToMessageId: msg.message_id, priority: 'high', room: defaultRoomCode }
        );
        return;
      }

      // 4. /palco <texto> -> Send message to Stage Prompter
      if (lower.startsWith('/palco ')) {
        const body = cleanCmd.substring(7).trim();
        if (body && this._syncClient && typeof this._syncClient.sendMessage === 'function') {
          this._syncClient.sendMessage(body, true, 'warn');
          await this.sendTelegramMessage(
            `📺 <b>Mensagem enviada para o Ecrã de Palco:</b>\n<i>"${escapeHtml(body)}"</i>`,
            cfg,
            { replyToMessageId: msg.message_id, priority: 'high', room: defaultRoomCode }
          );
        }
        return;
      }

      // 5. /regie <texto>, /msg <texto>, or direct Reply to a Bot message in the group
      const isRegieCmd = lower.startsWith('/regie ') || lower.startsWith('/msg ');
      const isReplyToBot = Boolean(msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot && !lower.startsWith('/'));

      if (isRegieCmd || isReplyToBot) {
        const content = isRegieCmd
          ? cleanCmd.replace(/^\/(regie|msg)\s+/i, '').trim()
          : rawText;

        if (content && this._syncClient && typeof this._syncClient.sendRegieMessage === 'function') {
          const formattedForRegie = `[TG • ${senderName}] ${content}`;
          // Mark in rState before sending so our own inbound message doesn't echo back to Telegram
          this._syncClient.sendRegieMessage(formattedForRegie);
          const curMsgId = this._syncClient.state?.regieMessage?.id;
          if (curMsgId) {
            const rState = this._getRoomWatchState(defaultRoomCode);
            rState.lastRegieMsgId = curMsgId;
            this._markEventDispatched(`tg_rmsg_${defaultRoomCode}_${curMsgId}`, defaultRoomCode);
          }

          await this.sendTelegramMessage(
            `📟 <b>Entregue nas Régies (${escapeHtml(stageName)}):</b>\n💬 <i>"${escapeHtml(content)}"</i>`,
            cfg,
            { replyToMessageId: msg.message_id, priority: 'high', room: defaultRoomCode }
          );
        }
        return;
      }

      // 6. /ajuda or /help
      if (lower === '/ajuda' || lower === '/help') {
        const helpMsg =
          `🤖 <b>COMANDOS STAGETIMER PFP (${escapeHtml(stageName)})</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `• <code>/status</code> — Ver artista em palco e tempo restante\n` +
          `• <code>/regie texto</code> — Enviar mensagem para o painel das Régies\n` +
          `• <code>/palco texto</code> — Mostrar mensagem no ecrã do Palco\n` +
          `• <code>/chamar</code> — Disparar alerta de chamada nas Régies\n` +
          `• <code>/ok</code> — Confirmar receção (ACK) da última comunicação\n` +
          `💡 <i>Também pode responder diretamente (Reply) a qualquer alerta do bot para enviar mensagem às Régies!</i>`;

        await this.sendTelegramMessage(helpMsg, cfg, {
          replyToMessageId: msg.message_id,
          priority: 'normal',
          room: defaultRoomCode
        });
      }
    }
  };

  global.StageTimerNotifications = StageTimerNotifications;
})(typeof window !== 'undefined' ? window : this);
