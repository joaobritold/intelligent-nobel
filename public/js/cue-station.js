// ─── StageTimer Cue Station (Posto Técnico) ───────────────────────────

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
  role: 'cue-station',
  room: roomId
});

let state = null;

// Department: 'Luz', 'Som', 'Maquinaria', 'Vídeo', 'Coxias', 'Geral'
let currentDept = 'Luz';
try {
  const savedDept = localStorage.getItem('stagetimer_cue_dept');
  if (savedDept) currentDept = savedDept;
} catch (_) {}

// Audio Alert Toggle
let audioEnabled = true;
try {
  const savedAudio = localStorage.getItem('stagetimer_cue_audio');
  if (savedAudio !== null) {
    audioEnabled = savedAudio === 'true';
  }
} catch (_) {}

// DOM Elements: HUD
const $screen = document.getElementById('cue-screen');
const $deptSubtitle = document.getElementById('cs-hud-dept-subtitle');
const $audioBtn = document.getElementById('cs-audio-btn');
const $audioIcon = document.getElementById('cs-audio-icon');
const $audioText = document.getElementById('cs-audio-text');
const $clockElapsed = document.getElementById('cs-clock-elapsed');
const $clockReal = document.getElementById('cs-clock-real');

// Urgent Banner
const $urgentBanner = document.getElementById('cs-urgent-banner');
const $urgentMessageText = document.getElementById('cs-urgent-message-text');
const $urgentAckBtn = document.getElementById('cs-urgent-ack-btn');

// Hero Cue Light
const $heroLight = document.getElementById('cs-hero-light');
const $heroIndicator = document.getElementById('cs-hero-indicator');
const $heroDeptBadge = document.getElementById('cs-hero-dept-badge');
const $heroCueNum = document.getElementById('cs-hero-cue-num');
const $heroCueName = document.getElementById('cs-hero-cue-name');
const $heroCueTarget = document.getElementById('cs-hero-cue-target');

// Feedback Bar
const $feedbackBar = document.getElementById('cs-feedback-bar');
const $feedbackStatus = document.getElementById('cs-feedback-status');

// Tabs
const $myCuesCount = document.getElementById('cs-my-cues-count');
const $myChecklistCount = document.getElementById('cs-my-checklist-count');
const $cuesList = document.getElementById('cs-cues-list');
const $checklistProgressPill = document.getElementById('cs-checklist-progress-pill');
const $myChecklistItems = document.getElementById('cs-my-checklist-items');

// ─── Web Audio Synthesizer for Cue Beacons ───────────────────────────
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

function playStandbyChime() {
  if (!audioEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Tone 1: 587 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.23);

    // Tone 2: 880 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.14);
    gain2.gain.setValueAtTime(0, now + 0.14);
    gain2.gain.linearRampToValueAtTime(0.38, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.46);
  } catch (e) {}
}

function playGoChime() {
  if (!audioEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Triple harmonic chime for GO
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1046, now); // C6
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.65);
  } catch (e) {}
}

// ─── Department Switching ───────────────────────────────────────────
function setDepartment(dept) {
  currentDept = dept || 'Luz';
  try {
    localStorage.setItem('stagetimer_cue_dept', currentDept);
  } catch (_) {}

  document.querySelectorAll('.cs-dept-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dept === currentDept);
  });

  if ($deptSubtitle) {
    $deptSubtitle.textContent = `Departamento: ${currentDept}`;
  }
  if ($heroDeptBadge) {
    $heroDeptBadge.textContent = `DEPARTAMENTO: ${currentDept.toUpperCase()}`;
  }

  render();
}

document.querySelectorAll('.cs-dept-btn').forEach(b => {
  b.addEventListener('click', () => {
    setDepartment(b.dataset.dept);
  });
});

// ─── Audio Toggle Setup ─────────────────────────────────────────────
function updateAudioUI() {
  if (!$audioBtn) return;
  if (audioEnabled) {
    $audioBtn.classList.add('enabled');
    $audioIcon.textContent = '🔔';
    $audioText.textContent = 'Som Ativo';
  } else {
    $audioBtn.classList.remove('enabled');
    $audioIcon.textContent = '🔕';
    $audioText.textContent = 'Som Mudo';
  }
}

if ($audioBtn) {
  $audioBtn.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    try {
      localStorage.setItem('stagetimer_cue_audio', String(audioEnabled));
    } catch (_) {}
    if (audioEnabled) {
      getAudioContext();
      playStandbyChime();
    }
    updateAudioUI();
  });
}
updateAudioUI();

// ─── Clocks Loop ────────────────────────────────────────────────────
function formatElapsed(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSecs % 60).padStart(2, '0');
  return `+${hh}:${mm}:${ss}`;
}

function updateClocks() {
  if ($clockReal) {
    $clockReal.textContent = StageTimerClient.getTrueTimeString(true);
  }

  const th = state?.theatre;
  if (!th) return;

  const now = Date.now();
  let elapsedMs = 0;

  if (th.showState === 'running') {
    if (th.showStartTime > 0) {
      elapsedMs = Math.max(0, now - th.showStartTime);
    }
  } else if (th.showState === 'paused' || th.showState === 'ended') {
    elapsedMs = th.showElapsedMs || (th.showStartTime > 0 ? (th.showPausedAt || now) - th.showStartTime : 0);
  }

  if ($clockElapsed) {
    $clockElapsed.textContent = formatElapsed(elapsedMs);
  }
}
setInterval(updateClocks, 250);

// ─── Tabs Navigation Setup ───────────────────────────────────────────
document.querySelectorAll('.cs-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.cs-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.cs-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const content = document.getElementById(target);
    if (content) content.classList.add('active');
  });
});

// ─── Urgent Notice Ack ──────────────────────────────────────────────
let dismissedNoticeText = '';

if ($urgentAckBtn) {
  $urgentAckBtn.addEventListener('click', () => {
    const noticeText = state?.theatre?.urgentNotice?.text;
    if (noticeText) {
      dismissedNoticeText = noticeText;
      if ($urgentBanner) $urgentBanner.style.display = 'none';
    }
  });
}

// ─── Feedback Buttons Setup ──────────────────────────────────────────
let activeFeedbackCueId = null;

document.querySelectorAll('.cs-fb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!activeFeedbackCueId) return;
    const fbType = btn.dataset.fbType;
    client.sendTechnicalFeedback(activeFeedbackCueId, currentDept, fbType);

    if ($feedbackStatus) {
      $feedbackStatus.style.display = 'inline-block';
      $feedbackStatus.textContent = `✓ Feedback "${btn.textContent.trim()}" enviado!`;
      setTimeout(() => {
        if ($feedbackStatus) $feedbackStatus.style.display = 'none';
      }, 3000);
    }
  });
});

// ─── Render Functions ────────────────────────────────────────────────
let lastTriggeredStandbyCueId = null;
let lastTriggeredGoCueId = null;

let lastMyCuesSig = '';
let lastMyChecklistSig = '';

function isCueRelevant(cue) {
  if (!cue) return false;
  if (currentDept === 'Geral') return true;
  const depts = Array.isArray(cue.departments) ? cue.departments.map(d => String(d).toLowerCase()) : [];
  return depts.some(d => d.includes(currentDept.toLowerCase()));
}

function renderHeroLight() {
  const th = state?.theatre;
  const cues = th?.cues || [];

  // Filter cues for this department
  const relevantCues = cues.filter(isCueRelevant);

  // Check if any relevant cue is currently FIRED or on STANDBY
  const firedCue = relevantCues.find(c => c.status === 'fired' && (Date.now() - (c.firedAt || 0) < 12000));
  const standbyCue = relevantCues.find(c => c.status === 'standby');
  const nextPending = relevantCues.find(c => c.status === 'pending');

  if (firedCue) {
    activeFeedbackCueId = firedCue.id;
    $heroLight.className = 'cs-hero-cue-box is-go';
    $heroIndicator.textContent = '🟢 GO! EXECUTAR AGORA';
    $heroCueNum.textContent = firedCue.num;
    $heroCueName.textContent = firedCue.name;
    $heroCueTarget.textContent = firedCue.targetText ? `Ponto de Deixa: "${firedCue.targetText}"` : (firedCue.notes || '');

    if ($feedbackBar) $feedbackBar.style.display = 'flex';

    if (lastTriggeredGoCueId !== firedCue.id) {
      lastTriggeredGoCueId = firedCue.id;
      playGoChime();
      if (navigator.vibrate) { try { navigator.vibrate([100, 50, 100]); } catch (_) {} }
    }
  } else if (standbyCue) {
    activeFeedbackCueId = standbyCue.id;
    $heroLight.className = 'cs-hero-cue-box is-standby';
    $heroIndicator.textContent = '🟡 STANDBY — PREPARAR';
    $heroCueNum.textContent = standbyCue.num;
    $heroCueName.textContent = standbyCue.name;
    $heroCueTarget.textContent = standbyCue.targetText ? `Aguardar fala: "${standbyCue.targetText}"` : (standbyCue.notes || 'Preparado na posição');

    if ($feedbackBar) $feedbackBar.style.display = 'flex';

    if (lastTriggeredStandbyCueId !== standbyCue.id) {
      lastTriggeredStandbyCueId = standbyCue.id;
      playStandbyChime();
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (_) {} }
    }
  } else {
    activeFeedbackCueId = null;
    $heroLight.className = 'cs-hero-cue-box is-idle';
    $heroIndicator.textContent = '● REPOUSO';
    $heroCueNum.textContent = '--';
    if (nextPending) {
      $heroCueName.textContent = `Aguardando Deixa ${nextPending.num}`;
      $heroCueTarget.textContent = `Próxima: ${nextPending.name} (${nextPending.targetText || nextPending.notes || 'Aguardar sinal'})`;
    } else {
      $heroCueName.textContent = 'Sem Deixas Pendentes';
      $heroCueTarget.textContent = 'Todas as deixas do seu departamento foram executadas nesta sessão.';
    }

    if ($feedbackBar) $feedbackBar.style.display = 'none';
  }
}

function renderCuesList() {
  const cues = state?.theatre?.cues || [];
  const relevantCues = cues.filter(isCueRelevant);

  if ($myCuesCount) $myCuesCount.textContent = relevantCues.length;

  const sig = `${currentDept}:${relevantCues.map(c => `${c.id}:${c.status}:${c.firedTimecode}`).join('|')}`;
  if (sig === lastMyCuesSig) return;
  lastMyCuesSig = sig;

  if (relevantCues.length === 0) {
    $cuesList.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--cs-muted);">Nenhuma deixa atribuída ao departamento ${currentDept}.</div>`;
    return;
  }

  $cuesList.innerHTML = relevantCues.map(c => {
    let cardClass = 'cs-cue-card';
    if (c.status === 'standby') cardClass += ' is-active-standby';
    else if (c.status === 'fired') cardClass += ' is-active-go';

    return `
      <div class="${cardClass}">
        <div class="cs-cue-num">${escapeHtml(c.num)}</div>
        <div>
          <div class="cs-cue-title">${escapeHtml(c.name)}</div>
          <div class="cs-cue-desc">${escapeHtml(c.targetText || c.notes || '')}</div>
        </div>
        <div>
          ${c.firedTimecode ? `<span style="font-family: var(--font-mono); font-size: 0.82rem; color: #00ffb3; font-weight: 800; margin-right: 6px;">${escapeHtml(c.firedTimecode)}</span>` : ''}
          <span class="badge" style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase;">${escapeHtml(c.status)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderChecklist() {
  const checklists = state?.theatre?.checklists || {};
  const items = currentDept === 'Geral'
    ? Object.keys(checklists).flatMap(d => (checklists[d] || []).map(item => ({ ...item, dept: d })))
    : (checklists[currentDept] || []);

  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if ($myChecklistCount) $myChecklistCount.textContent = `${pct}%`;
  if ($checklistProgressPill) $checklistProgressPill.textContent = `${pct}% Concluído (${done}/${total})`;

  const sig = `${currentDept}:${items.map(i => `${i.id}:${i.done}:${i.label}`).join(';')}`;
  if (sig === lastMyChecklistSig) return;
  lastMyChecklistSig = sig;

  if (items.length === 0) {
    $myChecklistItems.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--cs-muted);">Sem tarefas de checklist para ${currentDept}. A Mesa da DC pode adicionar tarefas a qualquer momento.</div>`;
    return;
  }

  $myChecklistItems.innerHTML = items.map(item => {
    const itemDept = item.dept || currentDept;
    return `
      <label class="cs-chk-row ${item.done ? 'done' : ''}">
        <input type="checkbox" class="cs-chk-box" data-cs-chk="${escapeHtml(item.id)}" data-cs-dept="${escapeHtml(itemDept)}" ${item.done ? 'checked' : ''}>
        <span style="flex: 1; font-weight: 600; font-size: 0.88rem;">${escapeHtml(item.label)}</span>
        ${item.dept ? `<span class="badge" style="font-size: 0.65rem;">${escapeHtml(item.dept)}</span>` : ''}
        ${item.isOneOff ? `<span class="badge" style="background: rgba(253, 203, 110, 0.2); color: #fdcb6e; font-size: 0.65rem;">Só Hoje</span>` : ''}
      </label>
    `;
  }).join('');
}

function render() {
  if (!state) return;

  const th = state.theatre;
  if (!th) return;

  // Urgent Notice check
  if ($urgentBanner && $urgentMessageText) {
    const notice = th.urgentNotice;
    if (notice && notice.visible && notice.text && notice.text !== dismissedNoticeText) {
      $urgentBanner.style.display = 'flex';
      $urgentMessageText.textContent = notice.text;
    } else {
      $urgentBanner.style.display = 'none';
    }
  }

  renderHeroLight();
  renderCuesList();
  renderChecklist();
}

// Checklist toggle delegation
document.addEventListener('change', (e) => {
  const chk = e.target.closest('[data-cs-chk]');
  if (chk) {
    const itemId = chk.dataset.csChk;
    const dept = chk.dataset.csDept || currentDept;
    client.toggleChecklistItem(dept, itemId, chk.checked);
  }
});

// ─── Client Event Handlers ──────────────────────────────────────────
client.on('room-state', (newState) => {
  state = newState;
  render();
});

client.on('tick', () => {
  render();
});

client.connect();
setDepartment(currentDept);
