// ─── StageTimer Cue Station (Posto Técnico) ───────────────────────────

const params = new URLSearchParams(window.location.search);
const urlRoom = (params.get('room') || '').toUpperCase().trim();
const savedActiveRoom = (sessionStorage.getItem('stagetimer_active_room') || '').toUpperCase().trim();
const savedDevRoom = (localStorage.getItem('stagetimer_device_room') || '').toUpperCase().trim();
const savedLastRoom = (localStorage.getItem('stagetimer_last_room') || '').toUpperCase().trim();
let roomId = urlRoom || savedActiveRoom || savedDevRoom || savedLastRoom || 'PALCO1';

try {
  const localEvents = JSON.parse(localStorage.getItem('stagetimer_v63_registry') || localStorage.getItem('stagetimer_v10_events_list') || '[]');
  let matchedEv = localEvents.find(e => (e.code || '').toUpperCase() === roomId || (Array.isArray(e.stages) && e.stages.some(s => (s.code || s.id || '').toUpperCase() === roomId)));
  if (!matchedEv) {
    const unlockedEvCode = (sessionStorage.getItem('stagetimer_unlocked_event') || localStorage.getItem('stagetimer_unlocked_event') || '').trim().toUpperCase();
    if (unlockedEvCode) {
      matchedEv = localEvents.find(e => (e.code || '').toUpperCase() === unlockedEvCode);
    }
    if (!matchedEv) {
      const theatreEv = localEvents.find(e => e.eventType === 'theatre');
      if (theatreEv && (!urlRoom || roomId === 'PALCO1')) {
        matchedEv = theatreEv;
      }
    }
  }
  if (matchedEv) {
    const hasCurrent = (matchedEv.code || '').toUpperCase() === roomId || (Array.isArray(matchedEv.stages) && matchedEv.stages.some(s => (s.code || s.id || '').toUpperCase() === roomId));
    if (!hasCurrent) {
      roomId = (Array.isArray(matchedEv.stages) && matchedEv.stages[0]?.code) ? matchedEv.stages[0].code.toUpperCase() : (matchedEv.code || roomId).toUpperCase();
    } else if ((matchedEv.code || '').toUpperCase() === roomId && Array.isArray(matchedEv.stages) && matchedEv.stages.length > 0) {
      const exactStage = matchedEv.stages.some(s => (s.code || s.id || '').toUpperCase() === roomId);
      if (!exactStage && matchedEv.stages[0]?.code) {
        roomId = matchedEv.stages[0].code.toUpperCase();
      }
    }
  }
} catch (_) {}

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
  'Som': { name: 'POSTO SOM', iconKey: 'volume', title: 'Técnico de Som', color: '#74b9ff', border: '#0984e3' },
  'Luz': { name: 'POSTO LUZ', iconKey: 'sun', title: 'Técnico de Luz', color: '#ffeaa7', border: '#fdcb6e' },
  'Maquinaria': { name: 'POSTO MAQUINARIA', iconKey: 'settings', title: 'Técnico de Maquinaria', color: '#fab1a0', border: '#e17055' },
  'Vídeo': { name: 'POSTO VÍDEO', iconKey: 'video', title: 'Técnico de Vídeo', color: '#55efc4', border: '#00b894' },
  'Coxias': { name: 'POSTO COXIAS', iconKey: 'theater', title: 'Técnico de Coxias / Adereços', color: '#fd79a8', border: '#e84393' },
  'Palco': { name: 'POSTO PALCO', iconKey: 'layers', title: 'Técnico de Palco', color: '#00cec9', border: '#00cec9' },
  'Pirotecnia': { name: 'POSTO PIROTECNIA', iconKey: 'zap', title: 'Efeitos / Pirotecnia', color: '#ff7675', border: '#d63031' }
};

function getDeptInfo(dept) {
  if (dept && DEPT_INFO[dept]) return DEPT_INFO[dept];
  const clean = String(dept || 'Som').trim();
  return {
    name: `POSTO ${clean.toUpperCase()}`,
    iconKey: 'settings',
    title: `Técnico de ${clean}`,
    color: '#a29bfe',
    border: '#6c5ce7'
  };
}

function resolveDeptName(deptStr) {
  if (!deptStr) return null;
  const clean = String(deptStr).trim();
  const norm = clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const d of VALID_DEPTS) {
    const dNorm = d.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (dNorm === norm) return d;
  }
  return clean ? (clean.charAt(0).toUpperCase() + clean.slice(1)) : null;
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

// Live Stage Timer DOM Elements
const $hudTimerCard = document.getElementById('cs-hud-timer-card');
const $hudTimerLabel = document.getElementById('cs-hud-timer-label');
const $hudTimerVal = document.getElementById('cs-hud-timer-val');
const $stBar = document.getElementById('cs-stage-timer-bar');
const $stStatusBadge = document.getElementById('cs-st-status-badge');
const $stTimeSlot = document.getElementById('cs-st-time-slot');
const $stActName = document.getElementById('cs-st-act-name');
const $stNotes = document.getElementById('cs-st-notes');
const $stTimer = document.getElementById('cs-st-timer');
const $stNextAct = document.getElementById('cs-st-next-act');
const $tabTimerPreview = document.getElementById('cs-tab-timer-preview');
const $eventEndBadge = document.getElementById('cs-event-end-badge');
const $rhStatusBadge = document.getElementById('cs-rh-status-badge');
const $rhSlot = document.getElementById('cs-rh-slot');
const $rhName = document.getElementById('cs-rh-name');
const $rhTimer = document.getElementById('cs-rh-timer');
const $rhProgressBar = document.getElementById('cs-rh-progress-bar');
const $rhNotes = document.getElementById('cs-rh-notes');
const $rhNext = document.getElementById('cs-rh-next');
const $rundownActsList = document.getElementById('cs-rundown-acts-list');
const $preShowBadge = document.getElementById('cs-pre-show-badge');
const $actsCountBadge = document.getElementById('cs-acts-count-badge');
const $stageNotesBox = document.getElementById('cs-stage-notes-box');
const $stageNotesList = document.getElementById('cs-stage-notes-list');
const $stageNotesCount = document.getElementById('cs-stage-notes-count');

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
const $scriptFeed = document.getElementById('cs-script-feed');
const $scriptPosPill = document.getElementById('cs-script-pos-pill');
const $scriptSyncPill = document.getElementById('cs-script-sync-pill');
let lastCsScriptSig = '';
let lastCsScriptContentSig = '';
let lastCsScriptActiveIdx = -1;

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
  if (!$deptModal) return;
  const $grid = document.querySelector('.cs-dept-modal-grid');
  if ($grid) {
    const customDepts = Object.keys(state?.theatre?.checklists || {});
    const allDepts = Array.from(new Set([...VALID_DEPTS, ...customDepts]));
    $grid.innerHTML = allDepts.map(d => {
      const info = getDeptInfo(d);
      const isSelected = d === currentDept;
      return `
        <button type="button" class="cs-modal-dept-btn ${isSelected ? 'active' : ''}" data-modal-dept="${escapeHtml(d)}" style="${isSelected ? `border-color: ${info.border}; background: rgba(255,255,255,0.12);` : ''}">
          <span style="display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 8px; background: rgba(255,255,255,0.06); color: ${info.color};">
            ${window.stIcon && info.iconKey ? window.stIcon(info.iconKey) : '<svg class="st-icon" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'}
          </span>
          <div style="text-align: left;">
            <div style="font-weight: 800; font-size: 0.95rem; color: #fff;">${escapeHtml(info.name)}</div>
            <div style="font-size: 0.72rem; color: var(--cs-muted);">${escapeHtml(info.title)}</div>
          </div>
        </button>
      `;
    }).join('');

    $grid.querySelectorAll('.cs-modal-dept-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setDepartment(btn.dataset.modalDept);
      });
    });
  }
  $deptModal.style.display = 'flex';
}

function hideDeptModal() {
  if ($deptModal) $deptModal.style.display = 'none';
}

function updateDeptUI() {
  const info = getDeptInfo(currentDept);
  const $icon = document.getElementById('cs-hud-dept-icon');
  const $name = document.getElementById('cs-hud-dept-name');
  const $sub = document.getElementById('cs-hud-dept-subtitle');
  const $heroBadge = document.getElementById('cs-hero-dept-badge');
  const $chkTitle = document.getElementById('cs-checklist-dept-title');

  const rawList = typeof client.getEventsList === 'function' ? client.getEventsList() : [];
  const currentCode = (state?.id || roomId || 'PALCO1').toUpperCase();
  const currentEvent = rawList.find(e => (e.code || '').toUpperCase() === currentCode || (Array.isArray(e.stages) && e.stages.some(s => (s.code || s.id || '').toUpperCase() === currentCode)));
  const evTitle = currentEvent ? (currentEvent.title || currentEvent.code) : (state?.name || '');

  if ($icon) $icon.innerHTML = (window.stIcon && info.iconKey) ? window.stIcon(info.iconKey) : '';
  if ($name) {
    $name.textContent = info.name;
    $name.style.color = info.color;
  }
  if ($sub) $sub.textContent = evTitle ? `${evTitle} • ${info.title}` : info.title;
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
    $audioIcon.innerHTML = window.stIcon ? window.stIcon('bell') : '';
    $audioText.textContent = 'Som Ativo';
  } else {
    $audioBtn.classList.remove('enabled');
    $audioIcon.innerHTML = window.stIcon ? window.stIcon('bell-off') : '';
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

  renderStageTimer();

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
      $feedbackStatus.textContent = `Feedback "${btn.textContent.trim()}" enviado para o Modo Jess!`;
      setTimeout(() => {
        if ($feedbackStatus) $feedbackStatus.style.display = 'none';
      }, 3000);
    }
  });
});

// ─── Cue Relevance, Filter & Hero Cue Light ─────────────────────────
let lastTriggeredStandbyCueId = null;
let lastTriggeredGoCueId = null;

let lastMyCuesSig = '';
let lastMyChecklistSig = '';
let csCuesFilterMode = 'all'; // 'all' (lista toda de cues) ou 'my' (apenas meu posto)
let lastAutoScrolledCueId = null;

function isCueRelevant(cue) {
  if (!cue) return false;
  const depts = Array.isArray(cue.departments) ? cue.departments : [];
  if (depts.length === 0) return true; // Se não tem departamentos específicos, é de interesse de todos os operadores
  const targetNorm = currentDept.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return depts.some(d => {
    const dNorm = String(d || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return dNorm.includes(targetNorm) || dNorm.includes('todo') || dNorm.includes('geral');
  });
}

let _heroGoTimer = null;
const GO_ACTIVE_DURATION_MS = 25000; // 25 segundos de sinal verde evidente

function renderHeroLight() {
  const th = state?.theatre;
  const cues = th?.cues || [];

  // Strictly filter cues for this department
  const relevantCues = cues.filter(isCueRelevant);

  const now = Date.now();
  const isFiredActive = (c) => {
    if (c.status !== 'fired') return false;
    const firedAt = c.firedAt || 0;
    const age = now - firedAt;
    const effAge = age < 0 ? 0 : age;
    return effAge < GO_ACTIVE_DURATION_MS;
  };

  const firedCue = relevantCues.find(isFiredActive) || cues.find(isFiredActive);
  const standbyCue = relevantCues.find(c => c.status === 'standby') || cues.find(c => c.status === 'standby');
  const nextMyPending = relevantCues.find(c => c.status === 'pending');
  const nextOverallPending = cues.find(c => c.status === 'pending');
  const nextPending = nextMyPending || nextOverallPending;

  // Se houve disparo de GO recente, ele tem prioridade a menos que uma deixa MAIS RECENTE tenha entrado em standby
  const hasActiveGo = firedCue && (!standbyCue || (standbyCue.standbyAt || 0) < (firedCue.firedAt || 0));

  if (hasActiveGo) {
    activeFeedbackCueId = firedCue.id;
    $heroLight.className = 'cs-hero-cue-box is-go';
    $heroIndicator.textContent = '● GO! EXECUTAR AGORA';
    $heroCueNum.textContent = firedCue.num;
    $heroCueName.textContent = firedCue.name;
    const isMine = isCueRelevant(firedCue);
    const baseTarget = firedCue.targetText ? `Ponto de Deixa: "${firedCue.targetText}"` : (firedCue.notes || '');
    const followUp = nextPending && nextPending.id !== firedCue.id ? ` • (A seguir: ${nextPending.num} ${nextPending.name})` : '';
    $heroCueTarget.textContent = (isMine ? '' : `[Posto: ${(firedCue.departments || []).join(', ')}] `) + baseTarget + followUp;

    if ($feedbackBar) $feedbackBar.style.display = 'flex';

    if (lastTriggeredGoCueId !== firedCue.id) {
      lastTriggeredGoCueId = firedCue.id;
      playGoChime();
      if (navigator.vibrate) { try { navigator.vibrate([150, 80, 150]); } catch (_) {} }

      const screenEl = document.getElementById('cue-screen');
      if (screenEl) {
        screenEl.classList.remove('has-go-alert');
        void screenEl.offsetWidth;
        screenEl.classList.add('has-go-alert');
      }
    }

    // Auto-transição para a próxima deixa após os 25 segundos de GO
    const elapsed = Math.max(0, now - (firedCue.firedAt || 0));
    const remaining = Math.max(500, GO_ACTIVE_DURATION_MS - elapsed);
    if (_heroGoTimer) clearTimeout(_heroGoTimer);
    _heroGoTimer = setTimeout(() => {
      renderHeroLight();
    }, remaining);

  } else if (standbyCue) {
    if (_heroGoTimer) { clearTimeout(_heroGoTimer); _heroGoTimer = null; }
    activeFeedbackCueId = standbyCue.id;
    $heroLight.className = 'cs-hero-cue-box is-standby';
    $heroIndicator.textContent = 'STANDBY — PREPARAR!';
    $heroCueNum.textContent = standbyCue.num;
    $heroCueName.textContent = standbyCue.name;
    const isMine = isCueRelevant(standbyCue);
    const targetText = standbyCue.targetText ? `Aguardar fala: "${standbyCue.targetText}"` : (standbyCue.notes || 'Preparado na posição de disparo');
    $heroCueTarget.textContent = (isMine ? '' : `[Posto: ${(standbyCue.departments || []).join(', ')}] `) + targetText;

    if ($feedbackBar) $feedbackBar.style.display = 'flex';

    if (lastTriggeredStandbyCueId !== standbyCue.id) {
      lastTriggeredStandbyCueId = standbyCue.id;
      playStandbyChime();
      if (navigator.vibrate) { try { navigator.vibrate([100, 50, 100]); } catch (_) {} }
    }
  } else {
    if (_heroGoTimer) { clearTimeout(_heroGoTimer); _heroGoTimer = null; }
    activeFeedbackCueId = null;

    if (nextMyPending) {
      // Automaticamente a próxima deixa a ser dada pelo meu posto
      $heroLight.className = 'cs-hero-cue-box is-idle is-next-cue';
      $heroIndicator.textContent = '● PRÓXIMA DEIXA A SER DADA';
      $heroCueNum.textContent = nextMyPending.num;
      $heroCueName.textContent = nextMyPending.name;
      $heroCueTarget.textContent = nextMyPending.targetText ? `Ponto de Deixa: "${nextMyPending.targetText}"` : (nextMyPending.notes || 'Aguardar sinal de Standby da Diretora de Cena');
    } else if (nextOverallPending) {
      // Próxima deixa geral no espetáculo
      $heroLight.className = 'cs-hero-cue-box is-idle is-next-cue';
      $heroIndicator.textContent = '● PRÓXIMA DEIXA GERAL';
      $heroCueNum.textContent = nextOverallPending.num;
      $heroCueName.textContent = `${nextOverallPending.name} [${(nextOverallPending.departments || []).join(', ')}]`;
      $heroCueTarget.textContent = nextOverallPending.targetText ? `Ponto de Deixa: "${nextOverallPending.targetText}"` : (nextOverallPending.notes || 'Aguardar sinal da Diretora de Cena');
    } else if (th?.phase === 'prep' && th.showState !== 'running') {
      $heroLight.className = 'cs-hero-cue-box is-idle';
      const timers = Array.isArray(state?.timers) ? state.timers : [];
      const firstTimer = timers.length > 0 ? timers[0] : null;
      $heroIndicator.textContent = 'PRÉ-SHOW • ALINHAMENTO DE PALCO';
      $heroCueNum.textContent = firstTimer ? '#1' : 'PRÉ';
      if (firstTimer) {
        $heroCueName.textContent = `Ato 1: ${firstTimer.name}`;
        $heroCueTarget.textContent = `Duração: ${formatTime(firstTimer.duration)} • Consulte a lista de atos e notas na aba "Alinhamento & Palco".`;
      } else {
        $heroCueName.textContent = 'Espetáculo em Preparação';
        $heroCueTarget.textContent = 'Consulte o alinhamento de palco e as notas da Diretora de Cena na aba "Alinhamento & Palco".';
      }
    } else {
      $heroLight.className = 'cs-hero-cue-box is-idle';
      $heroIndicator.textContent = '● CONCLUÍDO';
      $heroCueNum.textContent = cues.length > 0 ? 'FIM' : '✓';
      $heroCueName.textContent = cues.length > 0 ? 'Todas as Deixas Executadas' : 'Sem Deixas Pendentes';
      $heroCueTarget.textContent = cues.length > 0 ? 'Todas as deixas do espetáculo foram disparadas com sucesso.' : `Todas as deixas do Posto de ${currentDept} foram executadas nesta sessão.`;
    }

    if ($feedbackBar) $feedbackBar.style.display = 'none';
  }
}

// ─── Auto-Scroll da Lista Toda de Cues ──────────────────────────────
function autoScrollCuesList(force = false) {
  if (!$cuesList) return;
  const activeEl = $cuesList.querySelector('.cs-cue-card.is-active-go') ||
                   $cuesList.querySelector('.cs-cue-card.is-active-standby') ||
                   $cuesList.querySelector('.cs-cue-card.is-next-pending') ||
                   $cuesList.querySelector('.cs-cue-card.is-active-next');
  if (activeEl) {
    const cueId = activeEl.getAttribute('data-cue-id');
    if (force || (cueId && cueId !== lastAutoScrolledCueId)) {
      lastAutoScrolledCueId = cueId;
      requestAnimationFrame(() => {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }
}

// ─── Render Cues List (A Lista Toda de Cues com Autoscroll) ──────────
function renderCuesList() {
  const cues = state?.theatre?.cues || [];
  const myCues = cues.filter(isCueRelevant);

  const $countAllEl = document.getElementById('cs-count-all-cues');
  const $countMyEl = document.getElementById('cs-count-my-cues');
  const $totalBadge = document.getElementById('cs-cues-total-badge');
  if ($countAllEl) $countAllEl.textContent = cues.length;
  if ($countMyEl) $countMyEl.textContent = myCues.length;
  if ($totalBadge) $totalBadge.textContent = `${cues.length} Cues`;

  // Próxima deixa pendente para o meu posto ou geral
  const nextMyPending = myCues.find(c => c.status === 'pending');
  const nextOverallPending = cues.find(c => c.status === 'pending');
  const focalNextPending = nextMyPending || nextOverallPending;

  // Lista a apresentar de acordo com o filtro
  const targetList = csCuesFilterMode === 'my' ? myCues : cues;

  const sig = `${currentDept}:${csCuesFilterMode}:${targetList.map(c => `${c.id}:${c.status}:${c.firedTimecode}`).join('|')}`;
  if (sig === lastMyCuesSig) {
    autoScrollCuesList(false);
    return;
  }
  lastMyCuesSig = sig;

  if (targetList.length === 0) {
    $cuesList.innerHTML = `<div style="text-align: center; padding: 28px; color: var(--cs-muted);">${csCuesFilterMode === 'my' ? `Nenhuma deixa atribuída ao Posto de ${currentDept}.` : 'Nenhuma deixa registada no espetáculo.'}</div>`;
    return;
  }

  $cuesList.innerHTML = targetList.map(c => {
    const isMine = isCueRelevant(c);
    let cardClass = 'cs-cue-card';
    if (isMine) cardClass += ' is-my-dept-cue';

    const isStandby = c.status === 'standby';
    const isFired = c.status === 'fired' && (now - (c.firedAt || 0) < GO_ACTIVE_DURATION_MS);
    const isNext = !isStandby && !isFired && c.status === 'pending' && c.id === focalNextPending?.id;
    const isCompleted = c.status === 'completed' || (c.status === 'fired' && !isFired);

    if (isStandby) cardClass += ' is-active-standby';
    else if (isFired) cardClass += ' is-active-go';
    else if (isNext) cardClass += ' is-next-pending is-active-next';
    else if (isCompleted) cardClass += ' is-completed';

    let cardBorder = isMine ? 'rgba(85, 239, 196, 0.35)' : 'rgba(255, 255, 255, 0.08)';
    let cardBg = isMine ? 'linear-gradient(90deg, rgba(85, 239, 196, 0.07) 0%, rgba(20, 24, 38, 0.9) 100%)' : 'rgba(18, 20, 32, 0.75)';
    let numColor = isMine ? '#55efc4' : '#94a3b8';
    let badgeStyle = 'background: rgba(255, 255, 255, 0.08); color: #94a3b8;';
    let badgeText = c.status || 'pendente';

    if (isStandby) {
      cardBorder = '#ff793f';
      cardBg = 'linear-gradient(135deg, rgba(255, 121, 63, 0.22) 0%, rgba(35, 20, 15, 0.95) 100%)';
      numColor = '#ff9f43';
      badgeStyle = 'background: #ff793f; color: #000; font-weight: 900;';
      badgeText = 'STANDBY (PREPARAR)';
    } else if (isFired) {
      cardBorder = '#00ffb3';
      cardBg = 'linear-gradient(135deg, rgba(0, 255, 179, 0.3) 0%, rgba(5, 45, 30, 0.98) 100%)';
      numColor = '#00ffb3';
      badgeStyle = 'background: #00ffb3; color: #000; font-weight: 900; box-shadow: 0 0 12px rgba(0, 255, 179, 0.6);';
      badgeText = 'GO! EXECUTAR';
    } else if (isNext) {
      cardBorder = '#74b9ff';
      cardBg = 'linear-gradient(135deg, rgba(116, 185, 255, 0.16) 0%, rgba(20, 24, 38, 0.95) 100%)';
      numColor = '#74b9ff';
      badgeStyle = 'background: rgba(116, 185, 255, 0.25); color: #74b9ff; font-weight: 800; border: 1px solid rgba(116, 185, 255, 0.4);';
      badgeText = 'A SEGUIR';
    } else if (isCompleted) {
      badgeText = 'CONCLUÍDO';
      cardBg = 'rgba(255, 255, 255, 0.02)';
      numColor = '#64748b';
    }

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

    const myPostoTag = isMine ? `<span class="badge" style="background: rgba(85, 239, 196, 0.2); color: #55efc4; font-size: 0.65rem; font-weight: 800; border: 1px solid rgba(85, 239, 196, 0.4); padding: 2px 6px; border-radius: 4px;">O TEU POSTO</span>` : '';

    return `
      <div class="${cardClass}" data-cue-id="${escapeHtml(c.id)}" style="border: 1.5px solid ${cardBorder}; background: ${cardBg}; margin-bottom: 8px; padding: 12px 14px; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; transition: all 0.2s ease;">
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
          <div class="cs-cue-num" style="font-size: 1.25rem; font-weight: 900; color: ${numColor}; font-family: var(--font-mono); min-width: 48px; flex-shrink: 0;">${escapeHtml(c.num)}</div>
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="cs-cue-title" style="font-weight: 800; font-size: 0.96rem; color: #fff;">${escapeHtml(c.name)}</span>
              ${myPostoTag}
              ${deptPills}
            </div>
            <div class="cs-cue-desc" style="font-size: 0.8rem; color: #cbd5e1; margin-top: 3px; word-break: break-word;">${escapeHtml(c.targetText || c.notes || '')}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap; flex-shrink: 0;">
          ${c.firedTimecode ? `<span style="font-family: var(--font-mono); font-size: 0.8rem; color: #00ffb3; font-weight: 800; margin-right: 4px;">${escapeHtml(c.firedTimecode)}</span>` : ''}
          <span class="badge" style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; ${badgeStyle}">${escapeHtml(badgeText)}</span>
        </div>
      </div>
    `;
  }).join('');

  autoScrollCuesList(false);
}

// ─── Filter & Focus Event Listeners ─────────────────────────────────
const $filterAllBtn = document.getElementById('cs-filter-all');
const $filterMyBtn = document.getElementById('cs-filter-my');
const $btnFocusCue = document.getElementById('cs-btn-focus-cue');

if ($filterAllBtn) {
  $filterAllBtn.addEventListener('click', () => {
    csCuesFilterMode = 'all';
    $filterAllBtn.classList.add('active');
    $filterMyBtn?.classList.remove('active');
    lastMyCuesSig = '';
    renderCuesList();
  });
}

if ($filterMyBtn) {
  $filterMyBtn.addEventListener('click', () => {
    csCuesFilterMode = 'my';
    $filterMyBtn.classList.add('active');
    $filterAllBtn?.classList.remove('active');
    lastMyCuesSig = '';
    renderCuesList();
  });
}

if ($btnFocusCue) {
  $btnFocusCue.addEventListener('click', () => {
    autoScrollCuesList(true);
  });
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
    const liveTabBtn = document.querySelector('[data-tab="tab-live-split"]');
    if (liveTabBtn && !liveTabBtn.classList.contains('active')) {
      liveTabBtn.click();
    }
  }
}

// ─── Stage Timer Helpers & Logic ────────────────────────────────────
function formatTime(ms) {
  if (typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.formatTime === 'function') {
    return StageTimerClient.formatTime(ms);
  }
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSecs / 60)).padStart(2, '0');
  const ss = String(totalSecs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function getTimerElapsed(timer) {
  if (typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.getTimerElapsed === 'function') {
    return StageTimerClient.getTimerElapsed(timer);
  }
  if (!timer) return 0;
  if (timer.state === 'running') {
    return Math.max(0, Date.now() - (timer.startedAt || Date.now()) + (timer.elapsed || 0));
  }
  return timer.elapsed || 0;
}

function getTimerColor(timer) {
  if (!timer) return 'safe';
  if (timer.state === 'finished') return 'overtime';
  const elapsed = getTimerElapsed(timer);
  if (timer.mode === 'countdown') {
    const remaining = timer.duration - elapsed;
    if (remaining <= 0) return 'overtime';
    if (timer.duration > 0) {
      const pct = (elapsed / timer.duration) * 100;
      if (pct > 95) return 'danger';
      if (pct > 80) return 'warn';
      return 'safe';
    }
    if (remaining <= (timer.dangerAt || 60000)) return 'danger';
    if (remaining <= (timer.warnAt || 180000)) return 'warn';
    return 'safe';
  }
  if (timer.duration > 0 && elapsed >= timer.duration) return 'overtime';
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

function getTimerProgress(timer) {
  if (!timer || timer.mode !== 'countdown' || !timer.duration) return 0;
  const elapsed = getTimerElapsed(timer);
  return Math.min(100, Math.max(0, (elapsed / timer.duration) * 100));
}

let lastRundownSig = '';

function renderStageTimer() {
  if (!state) return;
  const timers = Array.isArray(state.timers) ? state.timers : [];
  const activeTimer = typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.getActiveTimer === 'function'
    ? StageTimerClient.getActiveTimer(state)
    : (timers.find(t => t.id === state.activeTimerId) || null);

  const activeIdx = timers.findIndex(t => t.id === (activeTimer?.id || state.activeTimerId));
  const nextTimer = activeIdx >= 0 && activeIdx + 1 < timers.length ? timers[activeIdx + 1] : null;

  // Schedule / Slots calculation
  let slots = [];
  if (typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.computeCascadeSchedule === 'function') {
    const cascade = StageTimerClient.computeCascadeSchedule(state);
    if (cascade && Array.isArray(cascade.slots) && cascade.slots.length > 0) {
      slots = timers.map(t => {
        const s = cascade.slots.find(slot => slot.id === t.id);
        return s ? s.slotRange : (t.startTime ? t.startTime.trim() : '--:--');
      });
    }
  }

  // End of event badge
  if ($eventEndBadge && typeof StageTimerClient !== 'undefined' && typeof StageTimerClient.computeEventEndTime === 'function') {
    const endStr = StageTimerClient.computeEventEndTime(state);
    $eventEndBadge.textContent = `Fim: ${endStr}`;
  }

  if ($preShowBadge) {
    const isLive = state?.theatre?.showState === 'running' || state?.theatre?.phase === 'live';
    if (isLive) {
      $preShowBadge.textContent = '● EM CENA';
      $preShowBadge.style.background = 'rgba(46, 160, 67, 0.2)';
      $preShowBadge.style.color = '#3fb950';
    } else {
      $preShowBadge.textContent = 'PRÉ-SHOW';
      $preShowBadge.style.background = 'rgba(56, 139, 253, 0.15)';
      $preShowBadge.style.color = '#79c0ff';
    }
  }

  if ($actsCountBadge) {
    $actsCountBadge.textContent = `${timers.length} ${timers.length === 1 ? 'Ato' : 'Atos'}`;
  }

  if ($stageNotesList) {
    const stageNotes = state?.theatre?.stageNotes || [];
    if ($stageNotesCount) $stageNotesCount.textContent = stageNotes.length;
    if (stageNotes.length === 0) {
      $stageNotesList.innerHTML = `<div style="font-size: 0.78rem; color: var(--cs-muted); padding: 4px 0;">Sem notas da Diretora de Cena de momento.</div>`;
    } else {
      $stageNotesList.innerHTML = stageNotes.map(n => `
        <div class="cs-stage-note-item">
          <div style="font-size: 0.84rem; color: #fff; font-weight: 600;">${escapeHtml(n.text)}</div>
          <div style="font-size: 0.7rem; color: #ffeaa7; font-family: var(--font-mono); white-space: nowrap;">${escapeHtml(n.timeStr || '')}</div>
        </div>
      `).join('');
    }
  }

  if (!activeTimer) {
    // No active timer
    if ($hudTimerVal) {
      $hudTimerVal.textContent = '--:--';
      $hudTimerVal.className = 'cs-clock-value cs-timer-val';
    }
    if ($tabTimerPreview) {
      $tabTimerPreview.textContent = '--:--';
    }
    if ($stStatusBadge) {
      $stStatusBadge.className = 'cs-st-badge pre';
      $stStatusBadge.textContent = '● AGUARDA';
    }
    if ($stTimeSlot) $stTimeSlot.textContent = '';
    if ($stActName) $stActName.textContent = 'Sem ato / artista ativo em palco';
    if ($stNotes) $stNotes.style.display = 'none';
    if ($stTimer) {
      $stTimer.textContent = '--:--';
      $stTimer.className = 'cs-st-timer';
    }
    if ($stNextAct) {
      if (timers.length > 0) {
        $stNextAct.textContent = `A SEGUIR: ${timers[0].name} (${formatTime(timers[0].duration)})`;
        $stNextAct.style.display = 'block';
      } else {
        $stNextAct.style.display = 'none';
      }
    }

    // Hero Card in Tab 3
    if ($rhStatusBadge) {
      $rhStatusBadge.className = 'cs-st-badge pre';
      $rhStatusBadge.textContent = '● AGUARDA';
    }
    if ($rhSlot) $rhSlot.textContent = '';
    if ($rhName) $rhName.textContent = timers.length > 0 ? 'Aguardando Início do 1º Ato' : 'Sem atos configurados no alinhamento';
    if ($rhTimer) {
      $rhTimer.textContent = '--:--';
      $rhTimer.className = 'cs-rh-timer';
    }
    if ($rhProgressBar) $rhProgressBar.style.width = '0%';
    if ($rhNotes) $rhNotes.style.display = 'none';
    if ($rhNext) {
      if (timers.length > 0) {
        $rhNext.textContent = `⏭️ A SEGUIR: ${timers[0].name} (${formatTime(timers[0].duration)})`;
        $rhNext.style.display = 'block';
      } else {
        $rhNext.style.display = 'none';
      }
    }
  } else {
    // Active timer exists!
    const displayVal = getTimerDisplayValue(activeTimer);
    const color = getTimerColor(activeTimer);
    const isRunning = activeTimer.state === 'running';
    const statusText = isRunning ? '● EM CENA' : '● PREPARADO';
    const badgeClass = isRunning ? 'cs-st-badge live' : 'cs-st-badge pre';

    // HUD Timer
    if ($hudTimerVal) {
      $hudTimerVal.textContent = displayVal;
      $hudTimerVal.className = `cs-clock-value cs-timer-val ${color} is-${color}`;
    }
    if ($tabTimerPreview) {
      $tabTimerPreview.textContent = displayVal;
    }

    // Live Stage Timer Bar
    if ($stStatusBadge) {
      $stStatusBadge.className = badgeClass;
      $stStatusBadge.textContent = statusText;
    }
    const slotStr = slots[activeIdx] || (activeTimer.startTime ? `Horário: ${activeTimer.startTime}` : `Duração: ${formatTime(activeTimer.duration)}`);
    if ($stTimeSlot) {
      $stTimeSlot.textContent = slotStr ? `[${slotStr}]` : '';
    }
    if ($stActName) {
      $stActName.textContent = activeTimer.name;
    }
    if ($stNotes) {
      if (activeTimer.notes && activeTimer.notes.trim()) {
        $stNotes.textContent = activeTimer.notes.trim();
        $stNotes.style.display = 'block';
      } else {
        $stNotes.style.display = 'none';
      }
    }
    if ($stTimer) {
      $stTimer.textContent = displayVal;
      $stTimer.className = `cs-st-timer ${color} is-${color}`;
    }
    if ($stNextAct) {
      if (nextTimer) {
        $stNextAct.textContent = `A SEGUIR: ${nextTimer.name} (${formatTime(nextTimer.duration)})`;
        $stNextAct.style.display = 'block';
      } else {
        $stNextAct.style.display = 'none';
      }
    }

    // Hero Card in Tab 3
    if ($rhStatusBadge) {
      $rhStatusBadge.className = badgeClass;
      $rhStatusBadge.textContent = statusText;
    }
    if ($rhSlot) {
      $rhSlot.textContent = slotStr;
    }
    if ($rhName) {
      $rhName.textContent = activeTimer.name;
    }
    if ($rhTimer) {
      $rhTimer.textContent = displayVal;
      $rhTimer.className = `cs-rh-timer ${color} is-${color}`;
    }
    if ($rhProgressBar) {
      const progress = getTimerProgress(activeTimer);
      $rhProgressBar.style.width = `${progress}%`;
      if (color === 'danger' || color === 'finished' || color === 'overtime') {
        $rhProgressBar.style.background = '#ff4757';
      } else if (color === 'warn') {
        $rhProgressBar.style.background = '#fdcb6e';
      } else {
        $rhProgressBar.style.background = '#00b894';
      }
    }
    if ($rhNotes) {
      if (activeTimer.notes && activeTimer.notes.trim()) {
        $rhNotes.textContent = `Notas: ${activeTimer.notes.trim()}`;
        $rhNotes.style.display = 'block';
      } else {
        $rhNotes.style.display = 'none';
      }
    }
    if ($rhNext) {
      if (nextTimer) {
        $rhNext.textContent = `⏭️ A SEGUIR: ${nextTimer.name} (${formatTime(nextTimer.duration)})`;
        $rhNext.style.display = 'block';
      } else {
        $rhNext.style.display = 'none';
      }
    }
  }

  // Render Rundown Acts List in Tab 3
  if ($rundownActsList) {
    const rundownSig = timers.map((t, i) => `${t.id}:${t.name}:${t.duration}:${t.state}:${i === activeIdx}:${slots[i] || ''}`).join('|');
    if (rundownSig !== lastRundownSig) {
      lastRundownSig = rundownSig;
      if (timers.length === 0) {
        $rundownActsList.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--cs-muted);">Sem atos configurados no alinhamento de palco.</div>`;
      } else {
        $rundownActsList.innerHTML = timers.map((t, idx) => {
          const isActive = idx === activeIdx;
          const isNext = activeIdx >= 0 && idx === activeIdx + 1;
          const isDone = (activeIdx >= 0 && idx < activeIdx) || t.state === 'finished';

          let itemClass = 'cs-act-item';
          let badgeText = 'AGUARDA';
          let badgeStyle = 'background: rgba(255,255,255,0.08); color: #cbd5e1;';

          if (isActive) {
            itemClass += ' is-active';
            badgeText = t.state === 'running' ? '● EM CENA' : '● EM PALCO';
            badgeStyle = 'background: #00b894; color: #000; font-weight: 800;';
          } else if (isNext) {
            itemClass += ' is-next';
            badgeText = 'A SEGUIR';
            badgeStyle = 'background: #fdcb6e; color: #000; font-weight: 800;';
          } else if (isDone) {
            itemClass += ' is-done';
            badgeText = 'TERMINADO';
            badgeStyle = 'background: rgba(255,255,255,0.05); color: #64748b;';
          }

          const slotInfo = slots[idx] || (t.startTime ? t.startTime : formatTime(t.duration));

          return `
            <div class="${itemClass}">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="cs-act-num">#${idx + 1}</span>
                <div>
                  <div class="cs-act-name">${escapeHtml(t.name)}</div>
                  <div class="cs-act-slot">${escapeHtml(slotInfo)}${t.notes ? ` • ${escapeHtml(t.notes)}` : ''}</div>
                </div>
              </div>
              <div>
                <span class="badge" style="font-size: 0.72rem; padding: 3px 8px; border-radius: 6px; ${badgeStyle}">${badgeText}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }
}

// ─── Main Render ────────────────────────────────────────────────────
function render() {
  updateDeptUI();

  if (!state) return;

  renderStageTimer();

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
  renderScriptFeed();
}

function renderScriptFeed() {
  if (!$scriptFeed) return;
  const script = state?.theatre?.script || [];
  const activeIdx = typeof state?.theatre?.scriptActiveIndex === 'number' ? state.theatre.scriptActiveIndex : 0;

  if ($scriptPosPill) {
    $scriptPosPill.textContent = script.length > 0 ? `Fala ${activeIdx + 1} / ${script.length}` : 'Fala 0 / 0';
  }

  // Verifica se o texto do guião já se encontra renderizado no DOM
  const contentSig = `${currentDept}:${script.length}:${script.map(s => s.id).join('|')}`;
  const rows = $scriptFeed.querySelectorAll('.cs-script-row');

  if (contentSig === lastCsScriptContentSig && rows.length === script.length && script.length > 0) {
    // Modo Seguidor DC Ultra-Fluido: o guião já está desenhado, atualiza apenas a linha ativa e auto-scroll suave
    if (activeIdx !== lastCsScriptActiveIdx) {
      lastCsScriptActiveIdx = activeIdx;
      rows.forEach((row, idx) => {
        const isActive = idx === activeIdx;
        if (isActive) {
          row.classList.add('active');
          row.style.borderLeft = '5px solid #55efc4';
          row.style.background = 'rgba(85, 239, 196, 0.14)';
          let metaBox = row.querySelector('.cs-script-meta-left');
          if (metaBox && !metaBox.querySelector('.cs-dc-live-badge')) {
            const b = document.createElement('span');
            b.className = 'badge cs-dc-live-badge';
            b.style.cssText = 'background: #55efc4; color: #000; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;';
            b.textContent = '● EM CENA (DC)';
            metaBox.prepend(b);
          }
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (row.classList.contains('active')) {
          row.classList.remove('active');
          row.style.borderLeft = '4px solid transparent';
          row.style.background = 'rgba(255, 255, 255, 0.02)';
          row.querySelector('.cs-dc-live-badge')?.remove();
        }
      });
    }
    return;
  }

  lastCsScriptContentSig = contentSig;
  lastCsScriptActiveIdx = activeIdx;
  lastCsScriptSig = `${activeIdx}:${contentSig}`;

  if (script.length === 0) {
    $scriptFeed.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; color: var(--cs-muted);">
        Aguardando carregamento do guião da peça pela Diretora de Cena...
      </div>
    `;
    return;
  }

  $scriptFeed.innerHTML = script.map((item, idx) => {
    const isDirection = item.type === 'direction';
    const isHeading = item.type === 'heading';
    const isBlank = item.type === 'blank';
    const isActive = idx === activeIdx;
    const hasCue = Boolean(item.cueAnchor);
    let myCueBadge = '';

    if (hasCue) {
      const cueObj = state?.theatre?.cues?.find(c => c.id === item.cueAnchor);
      if (cueObj) {
        const isMyCue = (cueObj.departments || []).includes(currentDept) || (cueObj.dept === currentDept);
        if (isMyCue) {
          myCueBadge = `<span class="badge cs-cue-anchor-jump" data-cue-id="${escapeHtml(cueObj.id)}" style="background: linear-gradient(135deg, #fdcb6e, #f39c12); color: #000; font-weight: 800; font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; box-shadow: 0 2px 8px rgba(253, 203, 110, 0.4); margin-left: 8px; cursor: pointer;" title="Tocar para focar deixa">⚡ SUA DEIXA: ${escapeHtml(cueObj.num)} (${escapeHtml(cueObj.name)})</span>`;
        } else {
          myCueBadge = `<span class="badge cs-cue-anchor-jump" data-cue-id="${escapeHtml(cueObj.id)}" style="background: rgba(255,255,255,0.08); color: var(--cs-muted); font-size: 0.68rem; padding: 2px 6px; margin-left: 8px; cursor: pointer;" title="Tocar para focar deixa">${escapeHtml(cueObj.num)}</span>`;
        }
      }
    }

    if (isBlank) {
      return `<div class="cs-script-row blank ${isActive ? 'active' : ''}" data-script-idx="${idx}" style="min-height: 14px;"></div>`;
    }

    return `
      <div class="cs-script-row ${isHeading ? 'heading' : (isDirection ? 'direction' : 'dialogue')} ${isActive ? 'active' : ''}" data-script-idx="${idx}" style="padding: 10px 14px; margin-bottom: 8px; border-radius: 8px; border-left: ${isActive ? '5px solid #55efc4' : '4px solid transparent'}; background: ${isActive ? 'rgba(85, 239, 196, 0.12)' : 'rgba(255, 255, 255, 0.02)'}; transition: all 0.2s ease;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; flex-wrap: wrap; gap: 6px;">
          <div class="cs-script-meta-left" style="display: flex; align-items: center; gap: 8px;">
            ${isActive ? `<span class="badge cs-dc-live-badge" style="background: #55efc4; color: #000; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">● EM CENA (DC)</span>` : ''}
            ${item.speaker ? `<span style="font-weight: 800; font-size: 0.82rem; color: #ffeaa7; text-transform: uppercase;">${escapeHtml(item.speaker)}</span>` : (isDirection ? '<span style="font-size: 0.75rem; color: #a29bfe; font-style: italic;">[CENA / RUBRICA]</span>' : (isHeading ? '<span style="font-size: 0.88rem; font-weight: 800; color: #55efc4;">📌 ' + escapeHtml(item.text) + '</span>' : ''))}
          </div>
          <div>${myCueBadge}</div>
        </div>
        ${!isHeading ? `<div style="font-size: 0.96rem; color: ${isActive ? '#fff' : '#cbd5e1'}; font-weight: ${isActive ? '600' : '400'}; white-space: pre-wrap; word-break: break-word;">${escapeHtml(item.text)}</div>` : ''}
      </div>
    `;
  }).join('');

  // Auto-scroll para a linha ativa suavemente
  const activeRow = $scriptFeed?.querySelector('.cs-script-row.active');
  if (activeRow) {
    activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if ($scriptSyncPill) {
  $scriptSyncPill.style.cursor = 'pointer';
  $scriptSyncPill.title = 'Tocar para recentrar na linha da DC';
  $scriptSyncPill.addEventListener('click', () => {
    const activeRow = $scriptFeed?.querySelector('.cs-script-row.active');
    if (activeRow) {
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

if ($scriptFeed) {
  $scriptFeed.addEventListener('click', (e) => {
    const jumpBtn = e.target.closest('[data-cue-id]');
    if (jumpBtn) {
      const cueId = jumpBtn.getAttribute('data-cue-id');
      if (cueId && $cuesList) {
        const cueCard = $cuesList.querySelector(`[data-cue-id="${cueId}"]`);
        if (cueCard) {
          cueCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cueCard.style.outline = '2px solid #55efc4';
          setTimeout(() => { cueCard.style.outline = ''; }, 1500);
        }
      }
    }
  });
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

// ─── Cue Station Web Notifications ───────────────────────────────────────────
(function initCueStationNotifications() {
  const $notifBtn = document.getElementById('cs-notif-btn');
  const $notifIcon = document.getElementById('cs-notif-icon');
  const $notifText = document.getElementById('cs-notif-text');
  if (!$notifBtn) return;

  function updateNotifBtn() {
    if (!window.StageTimerNotifications) return;
    const perm = window.StageTimerNotifications.getBrowserPermission();
    if (perm === 'granted') {
      if ($notifIcon) $notifIcon.innerHTML = window.stIcon ? window.stIcon('check') : '';
      if ($notifText) $notifText.textContent = 'Alertas Ativos';
      $notifBtn.classList.add('enabled');
      $notifBtn.style.borderColor = '#2ea043';
      $notifBtn.title = 'Notificações nativas ativas neste ecrã';
    } else if (perm === 'denied') {
      if ($notifIcon) $notifIcon.innerHTML = window.stIcon ? window.stIcon('alert-triangle') : '';
      if ($notifText) $notifText.textContent = 'Bloqueado';
      $notifBtn.classList.remove('enabled');
      $notifBtn.style.borderColor = '#d73a49';
      $notifBtn.title = 'Notificações bloqueadas nas definições do browser';
    } else {
      if ($notifIcon) $notifIcon.innerHTML = window.stIcon ? window.stIcon('smartphone') : '';
      if ($notifText) $notifText.textContent = 'Alertas Web';
      $notifBtn.classList.remove('enabled');
      $notifBtn.style.borderColor = '';
      $notifBtn.title = 'Tocar para ativar notificações neste telemóvel';
    }
  }

  $notifBtn.addEventListener('click', async () => {
    if (!window.StageTimerNotifications) return;
    const res = await window.StageTimerNotifications.requestBrowserPermission();
    updateNotifBtn();
    if (res.message) alert(res.message);
  });

  updateNotifBtn();

  if (window.StageTimerNotifications && client) {
    window.StageTimerNotifications.initWatcher(client, 'cue-station');
  }
})();
