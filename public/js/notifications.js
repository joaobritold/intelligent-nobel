/**
 * StageTimer PFP — Unified Notifications Engine
 * Handles:
 *  1. Telegram Bot API Integration (Group/Channel alerts, 5m/1m warnings, Cues, Urgent Messages)
 *  2. Native Mobile / Web Push Notifications (Service Worker showNotification, Haptic Vibration, Audio Chimes)
 *  3. Multi-Device Leader Dispatcher (Prevents duplicate Telegram broadcasts when multiple tabs are open)
 */
(function (global) {
  'use strict';

  // Audio Context chime synthesizer for instant audible alerts
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

  const StageTimerNotifications = {
    // ══════════════════════════════════════════════════════════════════════
    // 1. BROWSER & MOBILE NATIVE NOTIFICATIONS
    // ══════════════════════════════════════════════════════════════════════
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
      return Notification.permission; // 'granted', 'denied', 'default'
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
          // Send welcome test notification
          this.showLocalNotification('🔔 Notificações Ativadas!', {
            body: 'O StageTimer PFP enviará alertas de palco e deixas para este dispositivo.',
            tag: 'stagetimer-welcome',
            vibrate: [100, 50, 100]
          });
          return { status: 'granted', message: 'Notificações ativadas com sucesso!' };
        } else if (permission === 'denied') {
          return { status: 'denied', message: 'Permissão recusada nas definições do navegador.' };
        } else {
          return { status: 'default', message: 'Permissão pendente.' };
        }
      } catch (e) {
        return { status: 'error', message: e.message || 'Erro ao solicitar permissões.' };
      }
    },

    async showLocalNotification(title, options = {}) {
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        return false;
      }

      // Haptic feedback
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
        tag: options.tag || 'stagetimer-' + Date.now(),
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
      } catch (err) {
        try {
          new Notification(title, notifOptions);
          return true;
        } catch (_) {
          return false;
        }
      }
    },

    // ══════════════════════════════════════════════════════════════════════
    // 2. TELEGRAM BOT API DISPATCH
    // ══════════════════════════════════════════════════════════════════════
    async sendTelegramMessage(text, customConfig = null) {
      let cfg = customConfig;
      if (!cfg && this._syncClient && typeof this._syncClient.getIntegrations === 'function') {
        const integrations = this._syncClient.getIntegrations();
        cfg = integrations ? integrations.telegram : null;
      }
      if (!cfg && this._syncClient && this._syncClient._state && this._syncClient._state.integrations) {
        cfg = this._syncClient._state.integrations.telegram;
      }
      if (!cfg && this._lastState && this._lastState.integrations) {
        cfg = this._lastState.integrations.telegram;
      }

      // Fallback: check localStorage for saved room state if state not fully hydrated
      if (!cfg || !cfg.botToken) {
        try {
          const roomKey = this._syncClient?.cleanRoom || (typeof localStorage !== 'undefined' ? (localStorage.getItem('stagetimer_device_room') || localStorage.getItem('stagetimer_last_room') || 'PALCO1') : 'PALCO1');
          const localRaw = localStorage.getItem(`stagetimer_v10_state_${roomKey}`);
          if (localRaw) {
            const parsed = JSON.parse(localRaw);
            if (parsed && parsed.integrations && parsed.integrations.telegram) {
              cfg = parsed.integrations.telegram;
            }
          }
        } catch (_) {}
      }

      if (!cfg || !cfg.enabled) {
        console.warn('[StageTimer Telegram] Alerta não enviado: Telegram desativado ou sem configuração.', cfg);
        return { success: false, reason: 'disabled' };
      }

      const token = (cfg.botToken || '').trim();
      const chatId = (cfg.chatId || '').trim();

      if (!token || !chatId) {
        console.warn('[StageTimer Telegram] Alerta não enviado: Token ou Chat ID vazio.', { token, chatId });
        return { success: false, error: 'Token ou Chat ID do Telegram não configurados.' };
      }

      console.log('[StageTimer Telegram] A enviar mensagem para o chat:', chatId);

      const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
      const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data && data.ok) {
          console.log('[StageTimer Telegram] Mensagem enviada com sucesso! Message ID:', data.result?.message_id);
          return { success: true, messageId: data.result ? data.result.message_id : null };
        } else {
          const errDesc = data ? (data.description || 'Erro da API do Telegram') : 'Erro desconhecido';
          console.error('[StageTimer Telegram] Erro da API:', errDesc);
          return { success: false, error: errDesc };
        }
      } catch (netErr) {
        console.error('[StageTimer Telegram] Erro de rede:', netErr);
        return { success: false, error: 'Erro de rede ou bloqueio ao contactar api.telegram.org: ' + netErr.message };
      }
    },

    async testTelegram(botToken, chatId, stageName = 'Palco') {
      const token = (botToken || '').trim();
      const chat = (chatId || '').trim();

      if (!token || !chat) {
        return { success: false, error: 'Por favor, preencha o Bot Token e o Chat ID.' };
      }

      const nowStr = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const testMsg = `🧪 <b>StageTimer PFP — Teste de Notificação</b>\n\n` +
        `✅ A ligação ao Telegram está <b>ativa e operacional</b>!\n` +
        `🎪 <b>Palco:</b> ${stageName}\n` +
        `⏰ <b>Hora:</b> ${nowStr}\n\n` +
        `🔔 <i>Os alertas automáticos de 5m, 1m, fim de tempo e deixas serão entregues aqui.</i>`;

      return await this.sendTelegramMessage(testMsg, { enabled: true, botToken: token, chatId: chat });
    },

    // ══════════════════════════════════════════════════════════════════════
    // 3. MULTI-DEVICE LEADER ELECTION (Avoid duplicate Telegram posts)
    // ══════════════════════════════════════════════════════════════════════
    _isTelegramLeader(room) {
      const roomKey = `stagetimer_tg_leader_${room || 'default'}`;
      const now = Date.now();
      if (!this._clientId) {
        this._clientId = (this._syncClient && this._syncClient.clientId) || ('st_' + Math.random().toString(36).substring(2, 9));
      }
      const myId = this._clientId;
      
      try {
        const raw = localStorage.getItem(roomKey);
        if (raw) {
          const leader = JSON.parse(raw);
          if (leader.id === myId || (now - (leader.ts || 0)) > 4500) {
            localStorage.setItem(roomKey, JSON.stringify({ id: myId, ts: now }));
            return true;
          }
          return false;
        } else {
          localStorage.setItem(roomKey, JSON.stringify({ id: myId, ts: now }));
          return true;
        }
      } catch (_) {
        return true;
      }
    },

    // ══════════════════════════════════════════════════════════════════════
    // 4. AUTOMATED EVENT WATCHER (5m, 1m, End, Cues, Messages)
    // ══════════════════════════════════════════════════════════════════════
    _state: {
      lastTimerId: null,
      sent5m: false,
      sent1m: false,
      sentEnd: false,
      lastStandbyCueId: null,
      lastActiveCueId: null,
      lastRegieMsgId: null,
      lastRegieCallAt: 0,
      lastTheatreNoticeAt: 0,
      lastUrgentNoticeId: null,
      watcherInterval: null
    },

    initWatcher(syncClient, currentRole = 'general') {
      if (!syncClient) return;
      this._syncClient = syncClient;
      this._role = currentRole;

      // Listen to room state updates
      syncClient.on('room-state', (state) => {
        this.checkStateEvents(state);
      });

      // Regular tick check for timer thresholds (every 1 second)
      if (this._state.watcherInterval) {
        clearInterval(this._state.watcherInterval);
      }
      this._state.watcherInterval = setInterval(() => {
        if (this._syncClient && this._syncClient.getState) {
          this.checkTimerTick(this._syncClient.getState());
        }
      }, 1000);
    },

    checkTimerTick(state) {
      if (!state || !Array.isArray(state.timers)) return;
      const activeTimer = state.timers.find(t => t.id === state.activeTimerId);
      if (!activeTimer) {
        this._state.lastTimerId = null;
        this._state.sent5m = false;
        this._state.sent1m = false;
        this._state.sentEnd = false;
        return;
      }

      // Reset milestone flags if active timer changed
      if (activeTimer.id !== this._state.lastTimerId) {
        this._state.lastTimerId = activeTimer.id;
        this._state.sent5m = false;
        this._state.sent1m = false;
        this._state.sentEnd = false;
      }

      if (activeTimer.state !== 'running') return;

      const duration = activeTimer.duration || 0;
      let liveElapsed = activeTimer.liveElapsed || activeTimer.elapsed || 0;
      if (activeTimer.startedAt && this._syncClient && this._syncClient.getTrueTime) {
        const trueNow = this._syncClient.getTrueTime();
        liveElapsed = (activeTimer.elapsed || 0) + Math.max(0, Math.floor((trueNow - activeTimer.startedAt) / 1000));
      }

      const remaining = duration - liveElapsed;
      const stageName = state.name || state.id || 'Palco';
      const timerTitle = activeTimer.title || 'Artista / Ato';
      const tgCfg = state.integrations?.telegram;
      const isLeader = this._isTelegramLeader(state.id);

      // ⏳ 5 Minutes Alert (<= 300s and > 60s)
      if (duration > 330 && remaining <= 300 && remaining > 60 && !this._state.sent5m) {
        this._state.sent5m = true;
        _playChime('warning');
        
        // Local Browser / PWA Notification
        this.showLocalNotification(`⏳ Faltam 5 Minutos — ${stageName}`, {
          body: `${timerTitle}: restam 5:00 de atuação no palco.`,
          tag: `timer-5m-${activeTimer.id}`,
          vibrate: [200, 100, 200]
        });

        // Telegram Broadcast (Leader only)
        if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alert5m !== false) {
          this.sendTelegramMessage(
            `⏳ <b>AVISO 5 MINUTOS [${stageName}]</b>\n` +
            `🎤 <b>${timerTitle}</b> tem <b>5 minutos</b> restantes no palco.\n` +
            `⏰ Hora: ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`,
            tgCfg
          );
        }
      }

      // ⚠️ 1 Minute Alert (<= 60s and > 0s)
      if (duration > 70 && remaining <= 60 && remaining > 0 && !this._state.sent1m) {
        this._state.sent1m = true;
        _playChime('warning');

        // Local Browser / PWA Notification
        this.showLocalNotification(`⚠️ Falta 1 Minuto — ${stageName}`, {
          body: `${timerTitle}: reta final! Restam 60 segundos.`,
          tag: `timer-1m-${activeTimer.id}`,
          vibrate: [300, 100, 300]
        });

        // Telegram Broadcast (Leader only)
        if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alert1m !== false) {
          this.sendTelegramMessage(
            `⚠️ <b>AVISO 1 MINUTO [${stageName}]</b>\n` +
            `🎤 <b>${timerTitle}</b>: <b>último minuto</b>!\n` +
            `⏰ Próxima atuação a postos!`,
            tgCfg
          );
        }
      }

      // 🛑 End / Overtime Alert (<= 0s)
      if (duration > 0 && remaining <= 0 && !this._state.sentEnd) {
        this._state.sentEnd = true;
        _playChime('warning');

        // Local Browser / PWA Notification
        this.showLocalNotification(`🛑 Tempo Terminado — ${stageName}`, {
          body: `${timerTitle}: tempo de palco esgotado!`,
          tag: `timer-end-${activeTimer.id}`,
          vibrate: [500, 150, 500]
        });

        // Telegram Broadcast (Leader only)
        if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertEnd !== false) {
          this.sendTelegramMessage(
            `🛑 <b>TEMPO ESGOTADO [${stageName}]</b>\n` +
            `🎤 <b>${timerTitle}</b> terminou o tempo regulamentar!\n` +
            `⏱️ Entrando em Overtime.`,
            tgCfg
          );
        }
      }
    },

    checkStateEvents(state) {
      if (!state) return;
      const stageName = state.name || state.id || 'Palco';
      const tgCfg = state.integrations?.telegram;
      const isLeader = this._isTelegramLeader(state.id);
      const timeStr = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

      // 1. Chamadas entre Régies (Intercom: FOH ⇄ Palco ⇄ Geral)
      if (state.regieCall && state.regieCall.triggeredAt && (state.regieCall.fohCallingStage || state.regieCall.stageCallingFoh)) {
        if (state.regieCall.triggeredAt !== this._state.lastRegieCallAt) {
          this._state.lastRegieCallAt = state.regieCall.triggeredAt;
          _playChime('warning');

          let callTitle = 'Chamada de Régie';
          let callBody = 'Uma régie está a chamar com urgência!';
          let tgHeadline = '📞 <b>CHAMADA DE RÉGIE</b>';

          if (state.regieCall.fohCallingStage && state.regieCall.stageCallingFoh) {
            callTitle = '📞 CHAMADA GERAL DE RÉGIE';
            callBody = 'Alerta máximo: chamada geral para todas as régies e postos técnicos!';
            tgHeadline = `📞 <b>CHAMADA GERAL DE RÉGIE [${stageName}]</b>\n🚨 <i>Atenção máxima requerida em todos os postos técnicos!</i>`;
          } else if (state.regieCall.fohCallingStage) {
            callTitle = '📞 FOH ➔ PALCO';
            callBody = 'A Régie de Frente (FOH) está a chamar a Régie de Palco com urgência!';
            tgHeadline = `📞 <b>CHAMADA DE RÉGIE: FOH ➔ PALCO [${stageName}]</b>\n🚨 <i>A Régie de Frente (FOH) está a chamar o Palco com urgência!</i>`;
          } else if (state.regieCall.stageCallingFoh) {
            callTitle = '📞 PALCO ➔ FOH';
            callBody = 'A Régie de Palco está a chamar a Frente (FOH) com urgência!';
            tgHeadline = `📞 <b>CHAMADA DE RÉGIE: PALCO ➔ FOH [${stageName}]</b>\n🚨 <i>A Régie de Palco está a chamar a Frente (FOH) com urgência!</i>`;
          }

          this.showLocalNotification(`${callTitle} — ${stageName}`, {
            body: callBody,
            tag: `regie-call-${state.regieCall.triggeredAt}`,
            vibrate: [300, 100, 300, 100, 300]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertRegieCalls !== false) {
            this.sendTelegramMessage(
              `${tgHeadline}\n` +
              `⏰ Hora: <b>${timeStr}</b>\n` +
              `🎪 Palco: <b>${stageName}</b>`,
              tgCfg
            );
          }
        }
      }

      // 2. Todas as Comunicações dadas para as Régies e Técnicos
      if (state.regieMessage && state.regieMessage.visible && state.regieMessage.text) {
        if (state.regieMessage.id && state.regieMessage.id !== this._state.lastRegieMsgId) {
          this._state.lastRegieMsgId = state.regieMessage.id;
          _playChime('warning');

          this.showLocalNotification(`📟 Comunicação Régie — ${stageName}`, {
            body: state.regieMessage.text,
            tag: `regie-msg-${state.regieMessage.id}`,
            vibrate: [200, 100, 200]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertRegieMsg !== false) {
            this.sendTelegramMessage(
              `📟 <b>COMUNICAÇÃO RÉGIES & TÉCNICOS [${stageName}]</b>\n\n` +
              `💬 <i>"${state.regieMessage.text}"</i>\n` +
              `⏰ Hora: ${state.regieMessage.sentTimeStr || timeStr}`,
              tgCfg
            );
          }
        }
      }

      // 3. Avisos Urgentes de Cena / Técnicos (Direção de Cena)
      if (state.theatre && state.theatre.urgentNotice && state.theatre.urgentNotice.visible && state.theatre.urgentNotice.text) {
        const noticeTs = state.theatre.urgentNotice.sentAt || 1;
        if (noticeTs !== this._state.lastTheatreNoticeAt) {
          this._state.lastTheatreNoticeAt = noticeTs;
          _playChime('warning');

          this.showLocalNotification(`📢 Aviso de Cena — ${stageName}`, {
            body: state.theatre.urgentNotice.text,
            tag: `dc-urgent-${noticeTs}`,
            vibrate: [250, 100, 250]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertRegieMsg !== false) {
            this.sendTelegramMessage(
              `📢 <b>AVISO DIREÇÃO DE CENA [${stageName}]</b>\n\n` +
              `💬 <i>"${state.theatre.urgentNotice.text}"</i>\n` +
              `⏰ Hora: ${timeStr}`,
              tgCfg
            );
          }
        }
      }

      // 4. Mensagens de Palco (Prompter / Ecrã dos Artistas)
      if (state.message && state.message.visible && state.message.text) {
        const msgKey = state.message.text + '_' + (state.updatedAt || 0);
        if (msgKey !== this._state.lastUrgentNoticeId) {
          this._state.lastUrgentNoticeId = msgKey;
          _playChime('warning');

          this.showLocalNotification(`🚨 Mensagem de Palco — ${stageName}`, {
            body: state.message.text,
            tag: `stage-msg-${Date.now()}`,
            vibrate: [250, 100, 250, 100, 250]
          });

          if (isLeader && tgCfg && tgCfg.enabled && tgCfg.alertUrgent !== false) {
            this.sendTelegramMessage(
              `🚨 <b>MENSAGEM DE PALCO [${stageName}]</b>\n\n` +
              `💬 <i>"${state.message.text}"</i>`,
              tgCfg
            );
          }
        }
      }

      // 5. Deixas Cênicas (Cues) — Desativadas por defeito a pedido
      if (tgCfg && tgCfg.alertCues === true && state.theatre && Array.isArray(state.theatre.cues)) {
        // STANDBY Cue
        const standbyId = state.theatre.standbyCueId;
        if (standbyId && standbyId !== this._state.lastStandbyCueId) {
          this._state.lastStandbyCueId = standbyId;
          const cue = state.theatre.cues.find(c => c.id === standbyId);
          if (cue) {
            _playChime('standby');
            const targetDept = cue.target || 'Geral';
            const cueDesc = cue.action || cue.title || cue.description || '';

            this.showLocalNotification(`🟡 STANDBY: Cue ${cue.number} (${targetDept})`, {
              body: `Atenção ${targetDept}: ${cueDesc || 'Aguardar sinal de GO'}`,
              tag: `cue-standby-${cue.id}`,
              vibrate: [150, 80, 150]
            });

            if (isLeader && tgCfg && tgCfg.enabled) {
              this.sendTelegramMessage(
                `🟡 <b>STANDBY CUE ${cue.number} [${targetDept}]</b>\n` +
                `📋 <i>${cueDesc || 'Preparar disparo'}</i>\n` +
                `🎪 ${stageName}`,
                tgCfg
              );
            }
          }
        }

        // GO Cue
        const activeCueId = state.theatre.activeCueId;
        if (activeCueId && activeCueId !== this._state.lastActiveCueId) {
          this._state.lastActiveCueId = activeCueId;
          const cue = state.theatre.cues.find(c => c.id === activeCueId);
          if (cue) {
            _playChime('go');
            const targetDept = cue.target || 'Geral';
            const cueDesc = cue.action || cue.title || cue.description || '';

            this.showLocalNotification(`🟢 GO: Cue ${cue.number} (${targetDept})`, {
              body: `EXECUTAR AGORA: ${cueDesc || 'GO!'}`,
              tag: `cue-go-${cue.id}`,
              vibrate: [400, 100, 400]
            });

            if (isLeader && tgCfg && tgCfg.enabled) {
              this.sendTelegramMessage(
                `🟢 <b>GO CUE ${cue.number} [${targetDept}]</b> 🚀\n` +
                `🎬 <b>${cueDesc || 'Executado'}</b>\n` +
                `🎪 ${stageName}`,
                tgCfg
              );
            }
          }
        }
      }
    }
  };

  global.StageTimerNotifications = StageTimerNotifications;
})(typeof window !== 'undefined' ? window : this);
