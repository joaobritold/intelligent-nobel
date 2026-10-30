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

// ─── Department Resolution & Isolation ────────────────────────────────
const VALID_DEPTS = ['Som', 'Luz', 'Maquinaria', 'Vídeo', 'Coxias'];

const DEPT_INFO = {
  'Som': { name: 'POSTO SOM', icon: '🔊', title: 'Técnico de Som', color: '#74b9ff', border: '#0984e3' },
  'Luz': { name: 'POSTO LUZ', icon: '💡', title: 'Técnico de Luz', color: '#ffeaa7', border: '#fdcb6e' },
  'Maquinaria': { name: 'POSTO MAQUINARIA', icon: '⚙️', title: 'Técnico de Maquinaria', color: '#fab1a0', border: '#e17055' },
  'Vídeo': { name: 'POSTO VÍDEO', icon: '🎥', title: 'Técnico de Vídeo', color: '#55efc4', border: '#00b894' },
  'Coxias': { name: 'POSTO COXIAS', icon: '🎭', title: 'Técnico de Coxias / Adereços', color: '#fd79a8', border: '#e84393' }
};

function resolveDeptName(deptStr) {
  if (!deptStr) return null;
  const norm = String(deptStr).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  for (const d of VALID_DEPTS) {
    const dNorm = d.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (dNorm === norm) return d;
  }
  return null;
}

const urlDeptParam = resolveDeptName(params.get('dept'));
let currentDept = urlDeptParam;

if (!currentDept) {
  try {
    const saved = localStorage.getItem('stagetimer_cue_dept');
    currentDept = resolveDeptName(saved);
  } catch (_) {}
}

let promptDeptModal = false;
if (!currentDept) {
  currentDept = 'Som';
  promptDeptModal = true;
} else {
  try {
    localStorage.setItem('stagetimer_cue_dept', currentDept);
  } catch (_) {}
}

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

// Tabs & Items
const $myCuesCount = document.getElementById('cs-my-cues-count');
const $myChecklistCount = document.getElementById('cs-my-checklist-count');
const $cuesList = document.getElementById('cs-cues-list');
const $checklistProgressPill = document.getElementById('cs-checklist-progress-pill');
const $myChecklistItems = document.getElementById('cs-my-checklist-items');

// Modal Elements
const $deptModal = document.getElementById('cs-dept-modal');
const $btnChangeDept = document.getElementById('cs-btn-change-dept');
const $btnDeptModalClose = document.getElementById('cs-dept-modal-close');

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

// ─── Department Switching & UI ──────────────────────────────────────
function showDeptModal() {
  if ($deptModal) $deptModal.style.display = 'flex';
}

function hideDeptModal() {
  if ($deptModal) $deptModal.style.display = 'none';
}

function updateDeptUI() {
  const info = DEPT_INFO[currentDept] || DEPT_INFO['Som'];
  const $icon = document.getElementById('cs-hud-dept-icon');
  const $name = document.getElementById('cs-hud-dept-name');
  const $sub = document.getElementById('cs-hud-dept-subtitle');
  const $heroBadge = document.getElementById('cs-hero-dept-badge');
  const $chkTitle = document.getElementById('cs-checklist-dept-title');

  if ($icon) $icon.textContent = info.icon;
  if ($name) {
    $name.textContent = info.name;
    $name.style.color = info.color;
  }
  if ($sub) $sub.textContent = info.title;
  if ($heroBadge) {
    $heroBadge.textContent = `${info.name}`;
    $heroBadge.style.color = info.color;
    $heroBadge.style.borderColor = info.border;
  }
  if ($chkTitle) {
    $chkTitle.textContent = `Validação de Equipamentos & Presets (${currentDept})`;
  }
}

function setDepartment(dept) {
  const resolved = resolveDeptName(dept) || 'Som';
  currentDept = resolved;
  try {
    localStorage.setItem('stagetimer_cue_dept', currentDept);
  } catch (_) {}

  try {
    const u = new URL(window.location.href);
    u.searchParams.set('dept', currentDept);
    window.history.replaceState(null, '', u.toString());
  } catch (_) {}

  hideDeptModal();
  updateDeptUI();
  lastMyCuesSig = '';
  lastMyChecklistSig = '';
  render();
}

if ($btnChangeDept) {
  $btnChangeDept.addEventListener('click', showDeptModal);
}
if ($btnDeptModalClose) {
  $btnDeptModalClose.addEventListener('click', hideDeptModal);
}

document.querySelectorAll('.cs-modal-dept-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setDepartment(btn.dataset.modalDept);
  });
});

if (promptDeptModal) {
  showDeptModal();
}

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
updateDeptUI();

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
      $feedbackStatus.textContent = `✓ Feedback "${btn.textContent.trim()}" enviado para o Modo Jess!`;
      setTimeout(() => {
        if ($feedbackStatus) $feedbackStatus.style.display = 'none';
      }, 3000);
    }
  });
});

// ─── Cue Relevance & Hero Cue Light ─────────────────────────────────
let lastTriggeredStandbyCueId = null;
let lastTriggeredGoCueId = null;

let lastMyCuesSig = '';
let lastMyChecklistSig = '';

function isCueRelevant(cue) {
  if (!cue) return false;
  const targetNorm = currentDept.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const depts = Array.isArray(cue.departments) ? cue.departments : [];
  return depts.some(d => {
    const dNorm = String(d || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return dNorm.includes(targetNorm);
  });
}

function renderHeroLight() {
  const th = state?.theatre;
  const cues = th?.cues || [];

  // Strictly filter cues for this department
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
    if (th?.phase === 'prep' && th.showState !== 'running') {
      $heroIndicator.textContent = '🛠️ FASE DE PREPARAÇÃO';
      $heroCueNum.textContent = 'PREP';
      $heroCueName.textContent = 'Afinações & Testes do Posto';
      $heroCueTarget.textContent = 'Consulte e valide os itens da sua equipa na aba "Checklist do Posto & Preset".';
    } else {
      $heroIndicator.textContent = '● REPOUSO';
      $heroCueNum.textContent = '--';
      if (nextPending) {
        $heroCueName.textContent = `Aguardando Deixa ${nextPending.num}`;
        $heroCueTarget.textContent = `Próxima: ${nextPending.name} (${nextPending.targetText || nextPending.notes || 'Aguardar sinal'})`;
      } else {
        $heroCueName.textContent = 'Sem Deixas Pendentes';
        $heroCueTarget.textContent = `Todas as deixas do Posto de ${currentDept} foram executadas nesta sessão.`;
      }
    }

    if ($feedbackBar) $feedbackBar.style.display = 'none';
  }
}

// ─── Render Cues List (Strictly for this Department) ────────────────
function renderCuesList() {
  const cues = state?.theatre?.cues || [];
  const myCues = cues.filter(isCueRelevant);

  const $countMyEl = document.getElementById('cs-count-my-cues');
  if ($countMyEl) $countMyEl.textContent = myCues.length;
  if ($myCuesCount) $myCuesCount.textContent = myCues.length;

  const sig = `${currentDept}:${myCues.map(c => `${c.id}:${c.status}:${c.firedTimecode}`).join('|')}`;
  if (sig === lastMyCuesSig) return;
  lastMyCuesSig = sig;

  if (myCues.length === 0) {
    $cuesList.innerHTML = `<div style="text-align: center; padding: 28px; color: var(--cs-muted);">Nenhuma deixa atribuída ao Posto de ${currentDept} neste espetáculo.</div>`;
    return;
  }

  $cuesList.innerHTML = myCues.map(c => {
    let cardClass = 'cs-cue-card is-my-dept-cue';
    if (c.status === 'standby') cardClass += ' is-active-standby';
    else if (c.status === 'fired') cardClass += ' is-active-go';

    const depts = Array.isArray(c.departments) ? c.departments : [];
    const deptPills = depts.map(d => {
      const dClean = String(d || '').toLowerCase();
      let color = '#a29bfe';
      let border = 'rgba(108, 92, 231, 0.4)';
      let bg = 'rgba(108, 92, 231, 0.18)';
      if (dClean.includes('luz')) { color = '#ffeaa7'; border = '#fdcb6e'; bg = 'rgba(253, 203, 110, 0.18)'; }
      else if (dClean.includes('som')) { color = '#74b9ff'; border = '#0984e3'; bg = 'rgba(9, 132, 227, 0.18)'; }
      else if (dClean.includes('maq')) { color = '#fab1a0'; border = '#e17055'; bg = 'rgba(225, 112, 85, 0.18)'; }
      else if (dClean.includes('vid')) { color = '#55efc4'; border = '#00b894'; bg = 'rgba(0, 184, 148, 0.18)'; }
      else if (dClean.includes('cox')) { color = '#fd79a8'; border = '#e84393'; bg = 'rgba(232, 67, 147, 0.18)'; }
      return `<span style="background: ${bg}; color: ${color}; border: 1px solid ${border}; font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 6px;">${escapeHtml(d)}</span>`;
    }).join(' ');

    return `
      <div class="${cardClass}" style="border: 1.5px solid #00b894; background: linear-gradient(135deg, rgba(0, 184, 148, 0.12) 0%, rgba(20, 24, 38, 0.95) 100%); margin-bottom: 8px; padding: 12px 14px; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div class="cs-cue-num" style="font-size: 1.3rem; font-weight: 900; color: #55efc4; font-family: var(--font-mono);">${escapeHtml(c.num)}</div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="cs-cue-title" style="font-weight: 800; font-size: 1rem; color: #fff;">${escapeHtml(c.name)}</span>
              ${deptPills}
            </div>
            <div class="cs-cue-desc" style="font-size: 0.82rem; color: #cbd5e1; margin-top: 4px;">${escapeHtml(c.targetText || c.notes || '')}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
          ${c.firedTimecode ? `<span style="font-family: var(--font-mono); font-size: 0.82rem; color: #00ffb3; font-weight: 800; margin-right: 4px;">${escapeHtml(c.firedTimecode)}</span>` : ''}
          <span class="badge" style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; ${c.status === 'standby' ? 'background: #fdcb6e; color: #000;' : (c.status === 'fired' ? 'background: #00b894; color: #000;' : '')}">${escapeHtml(c.status)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Default Checklist Fallback ──────────────────────────────────────
const DEFAULT_CHECKLISTS_FALLBACK = {
  'Som': [
    { id: 'chk_s_1', label: 'Baterias novas nos microfones emissores (Atores 1 e 2)', done: true, isOneOff: false },
    { id: 'chk_s_2', label: 'Teste de ganho e equalização nas caixas de boca de cena', done: true, isOneOff: false },
    { id: 'chk_s_3', label: 'Carregar e testar trilhas no software de playback', done: false, isOneOff: false },
    { id: 'chk_s_4', label: 'Comunicação Intercom verificada com Modo Jess', done: false, isOneOff: false }
  ],
  'Luz': [
    { id: 'chk_l_1', label: 'Verificar canais de DMX e splitters', done: true, isOneOff: false },
    { id: 'chk_l_2', label: 'Afinar varas frontais e contra-luz', done: true, isOneOff: false },
    { id: 'chk_l_3', label: 'Testar dimmers e lâmpadas de reserva', done: false, isOneOff: false },
    { id: 'chk_l_4', label: 'Preset de sala a 80%', done: false, isOneOff: false }
  ],
  'Maquinaria': [
    { id: 'chk_m_1', label: 'Inspecionar cabos de aço e contrapesos das varas', done: true, isOneOff: false },
    { id: 'chk_m_2', label: 'Teste de abertura/fecho da cortina de boca', done: true, isOneOff: false },
    { id: 'chk_m_3', label: 'Carris lubrificados e livres de obstrução', done: false, isOneOff: false }
  ],
  'Vídeo': [
    { id: 'chk_v_1', label: 'Calibração de foco e keystone do projetor principal', done: true, isOneOff: false },
    { id: 'chk_v_2', label: 'Teste de envio HDMI / fibra para o ciclorama', done: false, isOneOff: false },
    { id: 'chk_v_3', label: 'Verificar obturador (shutter) de proteção', done: false, isOneOff: false }
  ],
  'Coxias': [
    { id: 'chk_c_1', label: 'Passagens laterais limpas e sinalizadas com luz azul', done: true, isOneOff: false },
    { id: 'chk_c_2', label: 'Mesa de adereços conferida (cadeira, relógio de bolso, capa)', done: false, isOneOff: false },
    { id: 'chk_c_3', label: 'Água e toalhas prontas nos postos de entrada', done: false, isOneOff: false }
  ]
};

// ─── Render Checklist (Strictly for this Department) ────────────────
function renderChecklist() {
  const checklists = state?.theatre?.checklists || {};
  
  let items = checklists[currentDept];
  if (!Array.isArray(items) || items.length === 0) {
    const norm = currentDept.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const k of Object.keys(checklists)) {
      if (k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === norm) {
        items = checklists[k];
        break;
      }
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    items = DEFAULT_CHECKLISTS_FALLBACK[currentDept] || [];
  }

  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if ($myChecklistCount) $myChecklistCount.textContent = `${pct}%`;
  if ($checklistProgressPill) $checklistProgressPill.textContent = `${pct}% Concluído (${done}/${total})`;

  const sig = `${currentDept}:${items.map(i => `${i.id}:${i.done}:${i.label}`).join(';')}`;
  if (sig === lastMyChecklistSig) return;
  lastMyChecklistSig = sig;

  if (items.length === 0) {
    $myChecklistItems.innerHTML = `<div style="text-align: center; padding: 28px; color: var(--cs-muted);">Sem tarefas de checklist para ${currentDept}. Pode adicionar uma tarefa rápida no botão abaixo.</div>`;
    return;
  }

  $myChecklistItems.innerHTML = items.map(item => {
    return `
      <div class="cs-chk-row ${item.done ? 'done' : ''}" data-cs-chk-row="${escapeHtml(item.id)}" data-cs-dept="${escapeHtml(currentDept)}" style="user-select: none;">
        <input type="checkbox" class="cs-chk-box" data-cs-chk="${escapeHtml(item.id)}" data-cs-dept="${escapeHtml(currentDept)}" ${item.done ? 'checked' : ''}>
        <span style="flex: 1; font-weight: 600; font-size: 0.9rem; color: ${item.done ? '#94a3b8' : '#fff'};">${escapeHtml(item.label)}</span>
        ${item.isOneOff ? `<span class="badge" style="background: rgba(253, 203, 110, 0.2); color: #fdcb6e; font-size: 0.65rem;">Só Hoje</span>` : ''}
      </div>
    `;
  }).join('');
}

// ─── Click & Input Delegation for Checklist ─────────────────────────
document.addEventListener('click', (e) => {
  // Click row to toggle checklist
  const chkRow = e.target.closest('[data-cs-chk-row]');
  if (chkRow && e.target.type !== 'checkbox') {
    const chkBox = chkRow.querySelector('input[type="checkbox"]');
    if (chkBox) {
      chkBox.checked = !chkBox.checked;
      const itemId = chkBox.dataset.csChk;
      const dept = chkBox.dataset.csDept || currentDept;
      client.toggleChecklistItem(dept, itemId, chkBox.checked);
    }
  }
});

document.addEventListener('change', (e) => {
  const chk = e.target.closest('[data-cs-chk]');
  if (chk) {
    const itemId = chk.dataset.csChk;
    const dept = chk.dataset.csDept || currentDept;
    client.toggleChecklistItem(dept, itemId, chk.checked);
  }
});

// Quick Add Task Button for Technician Post
const $newTaskInput = document.getElementById('cs-new-task-input');
const $newTaskBtn = document.getElementById('cs-new-task-btn');

function handleAddNewTask() {
  const label = ($newTaskInput?.value || '').trim();
  if (!label) return;
  client.addChecklistItem(currentDept, label, false);
  if ($newTaskInput) $newTaskInput.value = '';
}

if ($newTaskBtn) {
  $newTaskBtn.addEventListener('click', handleAddNewTask);
}
if ($newTaskInput) {
  $newTaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNewTask();
    }
  });
}

// ─── Phase Auto-Tab Switching (Prep vs Live) ──────────────────────
let lastSeenPhase = null;

function syncPhaseTab(phase, showState) {
  const currentKey = `${phase}:${showState}`;
  if (currentKey === lastSeenPhase) return;
  lastSeenPhase = currentKey;

  if (phase === 'live' || showState === 'running') {
    const cuesTabBtn = document.querySelector('[data-tab="tab-my-cues"]');
    if (cuesTabBtn && !cuesTabBtn.classList.contains('active')) {
      cuesTabBtn.click();
    }
  } else if (phase === 'prep' && showState !== 'running') {
    const chkTabBtn = document.querySelector('[data-tab="tab-my-checklist"]');
    if (chkTabBtn && !chkTabBtn.classList.contains('active')) {
      chkTabBtn.click();
    }
  }
}

// ─── Main Render ────────────────────────────────────────────────────
function render() {
  updateDeptUI();

  if (!state) return;

  const th = state.theatre;
  if (!th) return;

  syncPhaseTab(th.phase || 'prep', th.showState || 'pre');

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

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Client Event Handlers ──────────────────────────────────────────
client.on('room-state', (newState) => {
  state = newState;
  render();
});

client.on('tick', () => {
  render();
});

client.connect();
render();
