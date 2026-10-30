// ─── StageTimer Régies Mode (FOH & Palco Intercom & Lineup) ────────

const params = new URLSearchParams(window.location.search);
const urlRoom = (params.get('room') || '').toUpperCase().trim();
let roomId = urlRoom;

if (!roomId) {
  try {
    const savedDev = (localStorage.getItem('stagetimer_device_room') || '').toUpperCase().trim();
    const savedLast = (localStorage.getItem('stagetimer_last_room') || '').toUpperCase().trim();
    const savedActive = (sessionStorage.getItem('stagetimer_active_room') || '').toUpperCase().trim();
    roomId = savedDev || savedLast || savedActive || 'PALCO1';
  } catch (e) {
    roomId = 'PALCO1';
  }
}

try {
  localStorage.setItem('stagetimer_device_room', roomId);
  localStorage.setItem('stagetimer_last_room', roomId);
  sessionStorage.setItem('stagetimer_active_room', roomId);
} catch (e) {}

const client = new StageTimerClient({
  role: 'regies',
  room: roomId
});

let state = null;

// Station Mode: 'foh' (Régie Frente), 'stage' (Régie Palco) or 'tech' (Modo Técnico Mobile)
let currentStation = 'foh';
const urlStation = (params.get('station') || '').toLowerCase().trim();
if (urlStation === 'tech' || urlStation === 'tecnico' || urlStation === 'técnico') {
  currentStation = 'tech';
} else if (urlStation === 'stage' || urlStation === 'palco') {
  currentStation = 'stage';
} else if (urlStation === 'foh' || urlStation === 'frente') {
  currentStation = 'foh';
} else {
  try {
    const savedStation = localStorage.getItem('stagetimer_regie_station');
    if (savedStation === 'stage' || savedStation === 'foh' || savedStation === 'tech') {
      currentStation = savedStation;
    }
  } catch (_) {}
}

// Audio Alert Toggle
let audioEnabled = true;
try {
  const savedAudio = localStorage.getItem('stagetimer_regie_audio');
  if (savedAudio !== null) {
    audioEnabled = savedAudio === 'true';
  }
} catch (_) {}

// DOM Elements
const $screen = document.getElementById('lineup-screen');
const $roomBadge = document.getElementById('lineup-room-badge');
const $localClock = document.getElementById('lineup-local-clock');
const $nowBadge = document.getElementById('lineup-now-badge');
const $nowName = document.getElementById('lineup-now-name');
const $nowSlot = document.getElementById('lineup-now-slot');
const $nowTimer = document.getElementById('lineup-now-timer');
const $nowNotes = document.getElementById('lineup-now-notes');
const $list = document.getElementById('lineup-list');
const $lineupStageBadge = document.getElementById('lineup-stage-badge');
const $lineupEventSelect = document.getElementById('lineup-event-select');
const $lineupStagePills = document.getElementById('lineup-stage-pills');

// Régie Specific DOM
const $btnFoh = document.getElementById('regie-btn-foh');
const $btnStage = document.getElementById('regie-btn-stage');
const $btnTech = document.getElementById('regie-btn-tech');
const $btnCall = document.getElementById('regie-call-btn');
const $btnCallText = document.getElementById('regie-call-btn-text');
const $btnAudio = document.getElementById('regie-audio-btn');
const $audioIcon = document.getElementById('regie-audio-icon');

const $incomingAlert = document.getElementById('regie-incoming-alert');
const $incomingTitle = document.getElementById('regie-incoming-title');
const $incomingSub = document.getElementById('regie-incoming-sub');
const $incomingAckBtn = document.getElementById('regie-incoming-ack-btn');

const $msgBanner = document.getElementById('regie-msg-banner');
const $msgText = document.getElementById('regie-msg-text');
const $msgTime = document.getElementById('regie-msg-time');
const $receiptFoh = document.getElementById('regie-receipt-foh');
const $receiptStage = document.getElementById('regie-receipt-stage');
const $receiptTech = document.getElementById('regie-receipt-tech');
const $msgAckBtn = document.getElementById('regie-msg-ack-btn');

const $mobileTabs = document.getElementById('regie-mobile-tabs');
const $mainBody = document.getElementById('regie-main-body');

// Web Audio API Synthesizer for Intercom Call Chime
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playIntercomChime() {
  if (!audioEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Beep 1: 880 Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.23);

    // Beep 2: 1320 Hz (E6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.14);
    gain2.gain.setValueAtTime(0, now + 0.14);
    gain2.gain.linearRampToValueAtTime(0.4, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.43);
  } catch (e) {}
}

// ─── Station Switcher Setup ──────────────────────────────────────────

function setStation(station) {
  if (station === 'tech' || station === 'tecnico') {
    currentStation = 'tech';
  } else if (station === 'stage' || station === 'palco') {
    currentStation = 'stage';
  } else {
    currentStation = 'foh';
  }

  try {
    localStorage.setItem('stagetimer_regie_station', currentStation);
  } catch (_) {}

  if ($btnFoh) $btnFoh.classList.toggle('active', currentStation === 'foh');
  if ($btnStage) $btnStage.classList.toggle('active', currentStation === 'stage');
  if ($btnTech) $btnTech.classList.toggle('active', currentStation === 'tech');

  if ($screen) {
    $screen.classList.toggle('is-station-tech', currentStation === 'tech');
    $screen.classList.toggle('is-station-stage', currentStation === 'stage');
    $screen.classList.toggle('is-station-foh', currentStation === 'foh');
  }

  updateRegieControls();
}

if ($btnFoh) {
  $btnFoh.addEventListener('click', () => setStation('foh'));
}
if ($btnStage) {
  $btnStage.addEventListener('click', () => setStation('stage'));
}
if ($btnTech) {
  $btnTech.addEventListener('click', () => setStation('tech'));
}

// ─── Audio Toggle Setup ──────────────────────────────────────────────

function updateAudioUI() {
  if (!$btnAudio) return;
  if (audioEnabled) {
    $btnAudio.classList.add('enabled');
    $btnAudio.innerHTML = `<span>🔔</span> Som Ativo`;
  } else {
    $btnAudio.classList.remove('enabled');
    $btnAudio.innerHTML = `<span>🔕</span> Som Mudo`;
  }
}

if ($btnAudio) {
  $btnAudio.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    try {
      localStorage.setItem('stagetimer_regie_audio', String(audioEnabled));
    } catch (_) {}
    if (audioEnabled) {
      getAudioContext();
      playIntercomChime();
    }
    updateAudioUI();
  });
}
updateAudioUI();

// ─── Call Button Setup ───────────────────────────────────────────────

if ($btnCall) {
  $btnCall.addEventListener('click', () => {
    getAudioContext();
    if (!state) return;
    const rc = state.regieCall || {};

    if (currentStation === 'foh') {
      if (rc.fohCallingStage) {
        // Cancel call
        client.clearRegieCall('stage');
      } else {
        // Trigger call to Stage
        client.triggerRegieCall('stage', 'FOH');
      }
    } else if (currentStation === 'stage') {
      if (rc.stageCallingFoh) {
        // Cancel call
        client.clearRegieCall('foh');
      } else {
        // Trigger call to FOH
        client.triggerRegieCall('foh', 'PALCO');
      }
    } else {
      // Modo Técnico: Chamada às Régies
      if (rc.fohCallingStage || rc.stageCallingFoh) {
        client.clearRegieCall('all');
      } else {
        client.triggerRegieCall('all', 'TÉCNICO');
      }
    }
  });
}

if ($incomingAckBtn) {
  $incomingAckBtn.addEventListener('click', () => {
    if (!state) return;
    if (currentStation === 'foh') {
      client.clearRegieCall('foh');
    } else if (currentStation === 'stage') {
      client.clearRegieCall('stage');
    } else {
      client.clearRegieCall('all');
    }
  });
}

// ─── Mobile Segment Tabs (Now vs Lineup) ─────────────────────────────
document.querySelectorAll('.regie-mobile-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.regieView;
    document.querySelectorAll('.regie-mobile-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if ($mainBody) {
      if (view === 'lineup') {
        $mainBody.classList.add('show-lineup-only');
        $mainBody.classList.remove('show-now-only');
      } else {
        $mainBody.classList.add('show-now-only');
        $mainBody.classList.remove('show-lineup-only');
      }
    }
  });
});

// ─── Stage Manager Regie Message Ack Button (5s Auto-Dismiss) ───────

let dismissedMessageId = null;
let dismissCountdownTimer = null;

if ($msgAckBtn) {
  $msgAckBtn.addEventListener('click', () => {
    if (!state || !state.regieMessage || !state.regieMessage.visible) return;
    const msgId = state.regieMessage.id;
    client.ackRegieMessage(currentStation);

    $msgAckBtn.classList.add('acknowledged');
    $msgAckBtn.disabled = true;

    let countdown = 5;
    $msgAckBtn.textContent = `✓ LIDO (a fechar em ${countdown}s...)`;

    if (dismissCountdownTimer) clearInterval(dismissCountdownTimer);
    dismissCountdownTimer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        $msgAckBtn.textContent = `✓ LIDO (a fechar em ${countdown}s...)`;
      } else {
        clearInterval(dismissCountdownTimer);
        dismissCountdownTimer = null;
        dismissedMessageId = msgId;
        $msgBanner.style.opacity = '0';
        $msgBanner.style.transform = 'translateY(-8px)';
        setTimeout(() => {
          $msgBanner.classList.remove('visible');
          $msgBanner.style.display = 'none';
        }, 400);
      }
    }, 1000);
  });
}

// ─── Regie Controls & Alerts Update ──────────────────────────────────

let lastIncomingCallState = false;

function updateRegieControls() {
  if (!state) return;

  const rc = state.regieCall || {};
  const isFoh = currentStation === 'foh';
  const isStage = currentStation === 'stage';
  const isTech = currentStation === 'tech';
  const now = Date.now();

  // 1. Outgoing Call Button Status (Active for 5 seconds)
  let isCallingOut = false;
  if (isFoh) isCallingOut = Boolean(rc.fohCallingStage);
  else if (isStage) isCallingOut = Boolean(rc.stageCallingFoh);
  else isCallingOut = Boolean(rc.fohCallingStage && rc.stageCallingFoh);

  if (isCallingOut) {
    const elapsedSecs = Math.floor((now - (rc.triggeredAt || now)) / 1000);
    const remSecs = Math.max(1, 5 - elapsedSecs);
    $btnCall.classList.add('is-calling');
    if (isFoh) $btnCallText.textContent = `A CHAMAR PALCO (${remSecs}s)...`;
    else if (isStage) $btnCallText.textContent = `A CHAMAR FOH (${remSecs}s)...`;
    else $btnCallText.textContent = `A CHAMAR RÉGIES (${remSecs}s)...`;
  } else {
    $btnCall.classList.remove('is-calling');
    if (isFoh) $btnCallText.textContent = 'CALL PALCO';
    else if (isStage) $btnCallText.textContent = 'CALL FOH';
    else $btnCallText.textContent = 'CALL RÉGIES';
  }

  // 2. Incoming Call Alert (Active for 5 seconds)
  // CRITICAL: Técnico mode DOES NOT receive incoming calls! ("so nao recebe as calls o resto e tudo igual")
  let isIncoming = false;
  if (isFoh) {
    isIncoming = Boolean(rc.stageCallingFoh);
  } else if (isStage) {
    isIncoming = Boolean(rc.fohCallingStage);
  } else {
    isIncoming = false; // Never receives incoming calls in Técnico mode
  }

  if (isIncoming) {
    const elapsedSecs = Math.floor((now - (rc.triggeredAt || now)) / 1000);
    const remSecs = Math.max(1, 5 - elapsedSecs);
    $incomingAlert.classList.add('visible');
    if (isFoh) {
      $incomingTitle.textContent = `🚨 ATENÇÃO FOH: PALCO ESTÁ A CHAMAR (${remSecs}s)!`;
      $incomingSub.textContent = 'A Régie de Palco está a chamar no intercomunicador. Por favor coloque os auscultadores.';
    } else {
      $incomingTitle.textContent = `🚨 ATENÇÃO PALCO: FOH ESTÁ A CHAMAR (${remSecs}s)!`;
      $incomingSub.textContent = 'A Régie da Frente está a chamar no intercomunicador. Por favor coloque os auscultadores.';
    }

    // Play chime when new incoming call begins
    if (!lastIncomingCallState) {
      playIntercomChime();
    }
  } else {
    $incomingAlert.classList.remove('visible');
  }
  lastIncomingCallState = isIncoming;

  // 3. Stage Manager Technical Message Banner (With 5s Auto-Dismiss after Ack)
  const rm = state.regieMessage;
  if (rm && rm.visible && rm.text && rm.text.trim()) {
    // If user already acknowledged and dismissed this message locally, keep hidden
    if (dismissedMessageId === rm.id) {
      $msgBanner.classList.remove('visible');
      $msgBanner.style.display = 'none';
      return;
    }

    $msgBanner.style.display = 'flex';
    $msgBanner.style.opacity = '1';
    $msgBanner.style.transform = 'none';
    $msgBanner.classList.add('visible');
    $msgText.textContent = `"${rm.text.trim()}"`;
    $msgTime.textContent = rm.sentTimeStr ? `• Enviada às ${rm.sentTimeStr}` : '';

    const fohRead = Boolean(rm.ackFoh);
    const stageRead = Boolean(rm.ackStage);
    const techRead = Boolean(rm.ackTech);

    if ($receiptFoh) {
      $receiptFoh.className = `regie-msg-receipt-pill ${fohRead ? 'read' : ''}`;
      $receiptFoh.textContent = fohRead ? `🎚️ FOH: ✓ Lido (${rm.ackFoh})` : '🎚️ FOH: ⏳ Aguarda';
    }
    if ($receiptStage) {
      $receiptStage.className = `regie-msg-receipt-pill ${stageRead ? 'read' : ''}`;
      $receiptStage.textContent = stageRead ? `🎛️ Palco: ✓ Lido (${rm.ackStage})` : '🎛️ Palco: ⏳ Aguarda';
    }
    if ($receiptTech) {
      $receiptTech.className = `regie-msg-receipt-pill ${techRead ? 'read' : ''}`;
      $receiptTech.textContent = techRead ? `🔧 Técnico: ✓ Lido (${rm.ackTech})` : '🔧 Técnico: ⏳ Aguarda';
    }

    const myAck = isFoh ? fohRead : (isStage ? stageRead : techRead);
    if ($msgAckBtn) {
      if (myAck) {
        if (!dismissCountdownTimer) {
          $msgAckBtn.classList.add('acknowledged');
          $msgAckBtn.disabled = true;
          $msgAckBtn.textContent = isFoh ? '✓ LIDO POR FOH' : (isStage ? '✓ LIDO POR PALCO' : '✓ LIDO POR TÉCNICO');
        }
      } else {
        $msgAckBtn.classList.remove('acknowledged');
        $msgAckBtn.disabled = false;
        $msgAckBtn.textContent = '✓ CONFIRMAR LEITURA';
      }
    }
  } else {
    $msgBanner.classList.remove('visible');
    $msgBanner.style.display = 'none';
    dismissedMessageId = null;
    if (dismissCountdownTimer) {
      clearInterval(dismissCountdownTimer);
      dismissCountdownTimer = null;
    }
  }
}

// ─── Communications History Log ─────────────────────────────────────

const $regieHistoryCard = document.getElementById('regie-history-card');
const $regieHistoryList = document.getElementById('regie-history-list');
const $regieHistoryCount = document.getElementById('regie-history-count');

let lastHistorySig = '';

function renderRegieHistory() {
  if (!$regieHistoryList) return;
  const history = Array.isArray(state?.regieHistory) ? state.regieHistory : [];

  if ($regieHistoryCount) {
    $regieHistoryCount.textContent = history.length;
  }

  const sig = history.map(h => `${h.id}:${h.timeStr}:${h.type}:${h.ackFoh || ''}:${h.ackStage || ''}:${h.ackTech || ''}`).join('|');
  if (sig === lastHistorySig) return;
  lastHistorySig = sig;

  if (history.length === 0) {
    $regieHistoryList.innerHTML = `<div class="regie-history-empty">Sem avisos ou chamadas registados nesta sessão.</div>`;
    return;
  }

  $regieHistoryList.innerHTML = history.map(item => {
    const isCall = item.type === 'call';
    const isMsg = item.type === 'msg';
    const icon = isCall ? '🚨' : '📢';
    const sender = isCall ? `CHAMADA: ${escapeHtml(item.from || 'RÉGIE')}` : `STAGE MANAGER`;

    let receiptsHtml = '';
    if (isMsg) {
      const fohRead = Boolean(item.ackFoh);
      const stageRead = Boolean(item.ackStage);
      const techRead = Boolean(item.ackTech);
      receiptsHtml = `
        <div class="regie-history-receipts">
          <span class="regie-history-receipt-tag ${fohRead ? 'read' : ''}">🎚️ FOH: ${fohRead ? `✓ Lido (${escapeHtml(item.ackFoh)})` : '⏳ Aguarda'}</span>
          <span class="regie-history-receipt-tag ${stageRead ? 'read' : ''}">🎛️ Palco: ${stageRead ? `✓ Lido (${escapeHtml(item.ackStage)})` : '⏳ Aguarda'}</span>
          <span class="regie-history-receipt-tag ${techRead ? 'read' : ''}">🔧 Técnico: ${techRead ? `✓ Lido (${escapeHtml(item.ackTech)})` : '⏳ Aguarda'}</span>
        </div>
      `;
    }

    return `
      <div class="regie-history-item ${isCall ? 'is-call' : 'is-msg'}">
        <div class="regie-history-meta">
          <span class="regie-history-sender">${icon} ${sender}</span>
          <span class="regie-history-time">${escapeHtml(item.timeStr || '')}</span>
        </div>
        <div class="regie-history-body">${escapeHtml(item.text || '')}</div>
        ${receiptsHtml}
      </div>
    `;
  }).join('');
}

// ─── Stage Navigation and Multi-Stage Logic ─────────────────────────

let lastLineupStagePillsSig = '';
let lastLineupSelectSig = '';

function updateLineupStageUI(force = false) {
  const list = client.getEventsList();
  const currentCode = (state?.id || roomId || '').toUpperCase();

  if ($lineupStageBadge) {
    let name = currentCode;
    const currentEvent = list.find(e => {
      if (e.code === currentCode) return true;
      if (Array.isArray(e.stages)) {
        return e.stages.some(s => (s.code || s.id || '').toUpperCase() === currentCode);
      }
      return false;
    });
    if (currentEvent) {
      if (Array.isArray(currentEvent.stages) && currentEvent.stages.length > 1) {
        const st = currentEvent.stages.find(s => (s.code || s.id || '').toUpperCase() === currentCode);
        name = `${currentEvent.title || currentEvent.code} • ${st?.name || currentCode}`;
      } else {
        name = currentEvent.title || currentEvent.code;
      }
    }
    if ($lineupStageBadge.textContent !== name) {
      $lineupStageBadge.textContent = name;
    }
  }

  if ($lineupStagePills) {
    const allStages = [];
    list.forEach(ev => {
      const evTitle = ev.title || ev.code;
      const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code, name: evTitle }];
      stages.forEach(st => {
        const stCode = (st.code || st.id || '').toUpperCase();
        allStages.push({
          code: stCode,
          name: st.name || stCode,
          eventTitle: evTitle,
          isCurrent: stCode === currentCode
        });
      });
    });

    if (allStages.length > 1) {
      $lineupStagePills.style.display = 'flex';
      const pillsSig = allStages.map(s => `${s.code}:${s.name}:${s.isCurrent}`).join('|');
      if (force || pillsSig !== lastLineupStagePillsSig) {
        lastLineupStagePillsSig = pillsSig;
        $lineupStagePills.innerHTML = allStages.map(st => {
          const label = list.length > 1 && allStages.some(o => o.name === st.name && o.code !== st.code)
            ? `${st.eventTitle} • ${st.name}`
            : st.name;
          return `
            <button type="button" class="stage-pill ${st.isCurrent ? 'active' : ''}" data-switch-stage="${escapeHtml(st.code)}">
              🎪 ${escapeHtml(label)}
            </button>
          `;
        }).join('');
      }
    } else {
      $lineupStagePills.style.display = 'none';
      if (lastLineupStagePillsSig !== '') {
        $lineupStagePills.innerHTML = '';
        lastLineupStagePillsSig = '';
      }
    }
  }

  let totalStagesCount = 0;
  list.forEach(e => {
    totalStagesCount += (Array.isArray(e.stages) && e.stages.length > 0) ? e.stages.length : 1;
  });

  if ($lineupEventSelect) {
    if (list.length > 1 || totalStagesCount > 1) {
      $lineupEventSelect.style.display = 'inline-block';
      const selectSig = list.map(ev => `${ev.code}:${ev.title}:${(ev.stages || []).map(s => `${s.code}:${s.name}`).join(';')}`).join('||') + `::${currentCode}`;
      if (force || selectSig !== lastLineupSelectSig) {
        lastLineupSelectSig = selectSig;
        let optionsHtml = '';
        list.forEach(ev => {
          const evTitle = ev.title || ev.code;
          const stages = Array.isArray(ev.stages) && ev.stages.length > 0 ? ev.stages : [{ code: ev.code, name: 'Palco Principal' }];
          if (stages.length > 1) {
            optionsHtml += `<optgroup label="🎪 ${escapeHtml(evTitle)} (${stages.length} Palcos)">`;
            stages.forEach(st => {
              const stCode = (st.code || st.id || '').toUpperCase();
              const isSel = stCode === currentCode;
              optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>🎪 ${escapeHtml(evTitle)} • ${escapeHtml(st.name || stCode)}</option>`;
            });
            optionsHtml += `</optgroup>`;
          } else {
            const stCode = (stages[0].code || ev.code).toUpperCase();
            const isSel = stCode === currentCode;
            optionsHtml += `<option value="${escapeHtml(stCode)}" ${isSel ? 'selected' : ''}>🎪 ${escapeHtml(evTitle)}</option>`;
          }
        });
        $lineupEventSelect.innerHTML = optionsHtml;
      }
    } else {
      $lineupEventSelect.style.display = 'none';
      $lineupEventSelect.innerHTML = '';
      lastLineupSelectSig = '';
    }
  }
}

if ($lineupStageBadge && $lineupEventSelect) {
  $lineupStageBadge.style.cursor = 'pointer';
  $lineupStageBadge.addEventListener('click', () => {
    if ($lineupEventSelect.style.display !== 'none') {
      $lineupEventSelect.focus();
      try { $lineupEventSelect.showPicker(); } catch (_) {}
    }
  });
}

document.addEventListener('click', (e) => {
  const pill = e.target.closest('[data-switch-stage]');
  if (pill) {
    const targetRoom = (pill.dataset.switchStage || '').toUpperCase().trim();
    if (targetRoom && targetRoom !== (state?.id || roomId).toUpperCase()) {
      try {
        localStorage.setItem('stagetimer_device_room', targetRoom);
        localStorage.setItem('stagetimer_last_room', targetRoom);
        sessionStorage.setItem('stagetimer_active_room', targetRoom);
      } catch (_) {}
      window.location.replace(`regies.html?room=${encodeURIComponent(targetRoom)}`);
    }
  }
});

if ($lineupEventSelect) {
  $lineupEventSelect.addEventListener('change', () => {
    const chosen = $lineupEventSelect.value;
    if (chosen && chosen !== (state?.id || roomId)) {
      try {
        localStorage.setItem('stagetimer_device_room', chosen.toUpperCase());
        localStorage.setItem('stagetimer_last_room', chosen.toUpperCase());
        sessionStorage.setItem('stagetimer_active_room', chosen.toUpperCase());
      } catch (e) {}
      window.location.replace(`regies.html?room=${encodeURIComponent(chosen)}`);
    }
  });
}

function updateRegieNavLinks(code) {
  // Navigation is streamlined through the home link
}
updateRegieNavLinks(roomId);

function updateClock() {
  if ($localClock) {
    $localClock.textContent = StageTimerClient.getTrueTimeString();
  }
}
updateClock();
setInterval(updateClock, 1000);

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(ms) {
  return StageTimerClient.formatTime(ms);
}

function getTimerElapsed(timer) {
  return StageTimerClient.getTimerElapsed(timer);
}

function getTimerColor(timer) {
  if (!timer) return 'safe';
  if (timer.state === 'finished') return 'finished';
  const elapsed = getTimerElapsed(timer);
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    if (remaining <= 0) return 'finished';
    if (timer.duration > 0) {
      const pct = (elapsed / timer.duration) * 100;
      if (pct > 95) return 'danger';
      if (pct > 80) return 'warn';
      return 'safe';
    }
    if (remaining <= timer.dangerAt) return 'danger';
    if (remaining <= timer.warnAt) return 'warn';
    return 'safe';
  }
  return 'safe';
}

function getTimerDisplayValue(timer) {
  if (!timer) return '--:--';
  if (timer.mode === 'clock') {
    return StageTimerClient.getTrueTimeString();
  }
  const elapsed = getTimerElapsed(timer);
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    return formatTime(remaining);
  }
  return formatTime(elapsed);
}

function computeScheduleSlots(timers, activeIdx) {
  if (!state) return [];
  if (typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.computeCascadeSchedule === 'function') {
    const cascade = StageTimerClient.computeCascadeSchedule(state);
    if (cascade && Array.isArray(cascade.slots) && cascade.slots.length > 0) {
      return timers.map(t => {
        const slot = cascade.slots.find(s => s.id === t.id);
        if (slot) return slot.slotRange;
        return t.startTime ? t.startTime.trim() : '--:--';
      });
    }
  }

  const rollingMs = StageTimerClient.globalTrueTime();
  return timers.map((t, i) => {
    if (t.startTime && t.startTime.trim()) return t.startTime.trim();
    if (i < activeIdx) return 'Concluído';
    if (i === activeIdx) return 'Agora';
    let offsetMs = 0;
    for (let j = activeIdx >= 0 ? activeIdx : 0; j < i; j++) {
      const prev = timers[j];
      if (!prev) continue;
      let rem = prev.duration;
      if (j === activeIdx && prev.mode === 'countdown') {
        const el = getTimerElapsed(prev);
        rem = Math.max(0, prev.duration - el);
      }
      offsetMs += rem;
    }
    const est = new Date(rollingMs + offsetMs);
    return est.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
  });
}

function getEventEndTime(st) {
  return StageTimerClient.computeEventEndTime(st);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ─── Auto-Scroll Centering ──────────────────────────────────────────

let lastLineupSig = '';
let lastUserScrollAt = 0;

const $mainScroll = document.querySelector('.lineup-main-scroll');
if ($mainScroll) {
  $mainScroll.addEventListener('wheel', () => { lastUserScrollAt = Date.now(); }, { passive: true });
  $mainScroll.addEventListener('touchmove', () => { lastUserScrollAt = Date.now(); }, { passive: true });
}
window.addEventListener('wheel', () => { lastUserScrollAt = Date.now(); }, { passive: true });
window.addEventListener('touchmove', () => { lastUserScrollAt = Date.now(); }, { passive: true });

function centerActiveArtist(smooth = true) {
  const activeRow = $list?.querySelector('.lineup-row.is-active');
  if (!activeRow) return;

  const container = document.querySelector('.lineup-main-scroll');
  if (container && window.innerWidth > 860 && container.scrollHeight > container.clientHeight) {
    const targetTop = activeRow.offsetTop - (container.clientHeight / 2) + (activeRow.clientHeight / 2);
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: smooth ? 'smooth' : 'auto'
    });
  } else {
    activeRow.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'center'
    });
  }
}

setInterval(() => {
  if (Date.now() - lastUserScrollAt > 6000) {
    centerActiveArtist(true);
  }
}, 7000);

// ─── Render ─────────────────────────────────────────────────────────

function render() {
  if (!state) return;

  if (state.theme?.viewerBg && state.theme.viewerBg !== '#000000') {
    $screen.style.backgroundColor = state.theme.viewerBg;
    document.body.style.backgroundColor = state.theme.viewerBg;
  }

  if ($roomBadge) {
    $roomBadge.textContent = state.name || roomId;
  }

  const $eventEnd = document.getElementById('lineup-event-end');
  if ($eventEnd) {
    $eventEnd.textContent = getEventEndTime(state);
  }

  // Update Call & Intercom status
  updateRegieControls();
  renderRegieHistory();

  const activeTimer = StageTimerClient.getActiveTimer(state);
  const activeIdx = state.timers.findIndex(t => t.id === (activeTimer?.id || state.activeTimerId));
  const slots = computeScheduleSlots(state.timers, activeIdx);

  // Left card: Active Artist
  if (!activeTimer) {
    $nowBadge.textContent = 'AGUARDANDO INÍCIO';
    $nowName.textContent = 'Sem artista ativo';
    $nowSlot.textContent = '';
    $nowTimer.textContent = '--:--';
    $nowTimer.className = 'lineup-now-timer';
    $nowNotes.style.display = 'none';
  } else {
    const color = getTimerColor(activeTimer);
    const displayVal = getTimerDisplayValue(activeTimer);
    const isLong = displayVal.length > 5;
    $nowBadge.textContent = activeTimer.state === 'running' ? '● EM PALCO AGORA' : '● PREPARADO EM PALCO';
    $nowName.textContent = activeTimer.name;
    const activeCascade = typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.computeCascadeSchedule === 'function' ? StageTimerClient.computeCascadeSchedule(state) : null;
    const activeSlot = activeCascade?.slots?.find(s => s.id === activeTimer.id);
    $nowSlot.textContent = activeSlot ? `Horário Previsto: ${activeSlot.slotRange}` : (activeTimer.startTime ? `Horário: ${activeTimer.startTime}` : `Duração: ${formatTime(activeTimer.duration)}`);
    $nowTimer.textContent = displayVal;
    $nowTimer.className = `lineup-now-timer ${color}${isLong ? ' is-long' : ''}`;

    if (activeTimer.notes && activeTimer.notes.trim()) {
      $nowNotes.textContent = activeTimer.notes.trim();
      $nowNotes.style.display = 'block';
    } else {
      $nowNotes.style.display = 'none';
    }
  }

  // Right table: All Artists
  const sig = state.timers.map((t, idx) => `${t.id}:${t.name}:${slots[idx]}:${t.duration}:${t.notes || ''}:${t.state}:${idx === activeIdx}`).join('|');
  if (sig !== lastLineupSig) {
    const isFirstRender = !lastLineupSig;
    lastLineupSig = sig;

    $list.innerHTML = state.timers.map((t, idx) => {
      const isActive = idx === activeIdx;
      const isNext = activeIdx >= 0 && idx === activeIdx + 1;
      const isDone = (activeIdx >= 0 && idx < activeIdx) || t.state === 'finished';

      let rowClass = 'lineup-row';
      let statusClass = 'status-upcoming';
      let statusText = 'AGUARDA';

      if (isActive) {
        rowClass += ' is-active';
        statusClass = 'status-live';
        statusText = t.state === 'running' ? '● EM PALCO' : '● NO AR';
      } else if (isNext) {
        rowClass += ' is-next';
        statusClass = 'status-next';
        statusText = '⏭ NEXT';
      } else if (isDone) {
        rowClass += ' is-done';
        statusClass = 'status-done';
        statusText = '✓ FIM';
      }

      const timeDisplay = slots[idx] || '--:--';
      let timeIn = timeDisplay;
      let timeOut = '';

      const rangeMatch = String(timeDisplay).match(/(\d{1,2}\s*[:hH]\s*\d{2})\s*[-–—a]\s*(\d{1,2}\s*[:hH]\s*\d{2})/);
      if (rangeMatch) {
        timeIn = rangeMatch[1].replace(/[hH]/, ':').replace(/\s+/g, '');
        timeOut = rangeMatch[2].replace(/[hH]/, ':').replace(/\s+/g, '');
      } else {
        const singleMatch = String(timeDisplay).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
        if (singleMatch) {
          const sMins = parseInt(singleMatch[1], 10) * 60 + parseInt(singleMatch[2], 10);
          const eMins = (sMins + Math.round((t.duration || 0) / 60000)) % 1440;
          timeIn = `${String(Math.floor(sMins / 60)).padStart(2, '0')}:${String(sMins % 60).padStart(2, '0')}`;
          timeOut = `${String(Math.floor(eMins / 60)).padStart(2, '0')}:${String(eMins % 60).padStart(2, '0')}`;
        }
      }

      return `
        <div class="${rowClass}" data-timer-id="${t.id}">
          <div class="lineup-col-time">
            <span class="lineup-time-in">${escapeHtml(timeIn)}</span>
            ${timeOut ? `<span class="lineup-time-out">${escapeHtml(timeOut)}</span>` : ''}
          </div>
          <div class="lineup-col-artist">
            <span class="lineup-artist-name">${escapeHtml(t.name)}</span>
            ${t.notes ? `<span class="lineup-artist-notes">${escapeHtml(t.notes)}</span>` : ''}
          </div>
          <div class="lineup-col-duration">${formatTime(t.duration)}</div>
          <div class="lineup-col-status">
            <span class="lineup-status-pill ${statusClass}">${statusText}</span>
          </div>
        </div>
      `;
    }).join('');

    if (isFirstRender) {
      setTimeout(() => centerActiveArtist(false), 200);
    }
  }
}

// ─── Event Listeners ────────────────────────────────────────────────

client.on('room-state', (newState) => {
  state = newState;
  updateLineupStageUI();
  render();
});

client.on('events-list-update', () => {
  updateLineupStageUI(true);
});

client.on('tick', () => {
  render();
});

client.connect();
setStation(currentStation);
