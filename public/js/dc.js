// ─── StageTimer — Modo Jess (Diretora de Cena) ─────────────────────────

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
  role: 'dc',
  room: roomId
});

let state = null;

// DOM Elements: HUD
const $screen = document.getElementById('dc-screen');
const $stageBadge = document.getElementById('dc-stage-badge');
const $stageSelect = document.getElementById('dc-stage-select');
const $stageContainer = document.getElementById('dc-stage-badge-container');

const $showStatusBadge = document.getElementById('dc-show-status-badge');
const $showStatusText = document.getElementById('dc-show-status-text');
const $btnStartShow = document.getElementById('dc-btn-start-show');
const $btnPauseShow = document.getElementById('dc-btn-pause-show');
const $btnEndShow = document.getElementById('dc-btn-end-show');
const $btnResetShow = document.getElementById('dc-btn-reset-show');

const $clockElapsed = document.getElementById('dc-clock-elapsed');
const $clockEnd = document.getElementById('dc-clock-end');
const $clockReal = document.getElementById('dc-clock-real');

// Urgent Notice
const $btnUrgentToggle = document.getElementById('dc-btn-urgent-toggle');
const $urgentBar = document.getElementById('dc-urgent-bar');
const $urgentInput = document.getElementById('dc-urgent-input');
const $urgentSendBtn = document.getElementById('dc-urgent-send-btn');
const $urgentClearBtn = document.getElementById('dc-urgent-clear-btn');
const $urgentActiveTag = document.getElementById('dc-urgent-active-tag');

// Script Feed
const $scriptFeed = document.getElementById('dc-script-feed');
const $btnImportScript = document.getElementById('dc-btn-import-script');
const $btnAddLine = document.getElementById('dc-btn-add-line');
const $toggleAutoscroll = document.getElementById('dc-toggle-autoscroll');
const $scriptFontMinus = document.getElementById('dc-script-font-minus');
const $scriptFontPlus = document.getElementById('dc-script-font-plus');
const $scriptScrollToggle = document.getElementById('dc-script-scroll-toggle');
const $scriptScrollSpeed = document.getElementById('dc-script-scroll-speed');
const $btnEditScriptText = document.getElementById('dc-btn-edit-script-text');

// Cues Tab
const $cuesCountBadge = document.getElementById('dc-cues-count-badge');
const $nextCueSummary = document.getElementById('dc-next-cue-summary');
const $btnStandby = document.getElementById('dc-btn-standby');
const $btnGo = document.getElementById('dc-btn-go');
const $cuesList = document.getElementById('dc-cues-list');
const $btnAddCue = document.getElementById('dc-btn-add-cue');
const $btnImportCues = document.getElementById('dc-btn-import-cues');
const $btnResetCues = document.getElementById('dc-btn-reset-cues');
const $btnClearCues = document.getElementById('dc-btn-clear-cues');

// Checklists Tab
const $checklistsProgressBadge = document.getElementById('dc-checklists-progress-badge');
const $readinessPercent = document.getElementById('dc-readiness-percent');
const $readinessBar = document.getElementById('dc-readiness-bar');
const $deptGauges = document.getElementById('dc-dept-gauges');
const $taskDeptSelect = document.getElementById('dc-task-dept-select');
const $taskLabelInput = document.getElementById('dc-task-label-input');
const $taskOneOffCheck = document.getElementById('dc-task-oneoff-check');
const $taskAddBtn = document.getElementById('dc-task-add-btn');
const $checklistsContainer = document.getElementById('dc-checklists-container');

// Telemetry Tab
const $telemetryFiredCount = document.getElementById('dc-telemetry-fired-count');
const $telemetryDuration = document.getElementById('dc-telemetry-duration');
const $telemetryFeedbackCount = document.getElementById('dc-telemetry-feedback-count');
const $telemetryList = document.getElementById('dc-telemetry-list');
const $btnCopyReport = document.getElementById('dc-btn-copy-report');
const $btnDownloadReport = document.getElementById('dc-btn-download-report');

// Modals
const $modalImportScript = document.getElementById('dc-modal-import-script');
const $scriptImportTextarea = document.getElementById('dc-script-import-textarea');
const $scriptImportConfirm = document.getElementById('dc-script-import-confirm');

const $modalImportCues = document.getElementById('dc-modal-import-cues');
const $cuesImportTextarea = document.getElementById('dc-cues-import-textarea');
const $cuesImportConfirm = document.getElementById('dc-cues-import-confirm');

const $modalNewCue = document.getElementById('dc-modal-new-cue');
const $newCueNum = document.getElementById('dc-new-cue-num');
const $newCueName = document.getElementById('dc-new-cue-name');
const $newCueTarget = document.getElementById('dc-new-cue-target');
const $newCueNotes = document.getElementById('dc-new-cue-notes');
const $newCueConfirm = document.getElementById('dc-new-cue-confirm');

const $modalEditCue = document.getElementById('dc-modal-edit-cue');
const $editCueId = document.getElementById('dc-edit-cue-id');
const $editCueNum = document.getElementById('dc-edit-cue-num');
const $editCueName = document.getElementById('dc-edit-cue-name');
const $editCueTarget = document.getElementById('dc-edit-cue-target');
const $editCueNotes = document.getElementById('dc-edit-cue-notes');
const $editCueConfirm = document.getElementById('dc-edit-cue-confirm');
const $editCueDeleteBtn = document.getElementById('dc-edit-cue-delete-btn');

const $modalEditScriptText = document.getElementById('dc-modal-edit-script-text');
const $fullScriptTextarea = document.getElementById('dc-full-script-textarea');
const $fullScriptSave = document.getElementById('dc-full-script-save');

// ─── Helpers ────────────────────────────────────────────────────────
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatElapsed(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSecs % 60).padStart(2, '0');
  return `+${hh}:${mm}:${ss}`;
}

// ─── Clocks & Time Loop ─────────────────────────────────────────────
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

  // Estimated End: Assume average show duration of ~90 mins (or sum of cues if available)
  if ($clockEnd) {
    if (th.showState === 'running' && th.showStartTime > 0) {
      const estimatedShowDurationMs = 90 * 60 * 1000;
      const endD = new Date(th.showStartTime + estimatedShowDurationMs);
      const endH = String(endD.getHours()).padStart(2, '0');
      const endM = String(endD.getMinutes()).padStart(2, '0');
      $clockEnd.textContent = `~${endH}:${endM}`;
    } else {
      $clockEnd.textContent = '--:--';
    }
  }
}
setInterval(updateClocks, 250);

// ─── Show Controls Setup ─────────────────────────────────────────────
if ($btnStartShow) {
  $btnStartShow.addEventListener('click', () => {
    client.startTheatreShow();
  });
}

if ($btnPauseShow) {
  $btnPauseShow.addEventListener('click', () => {
    client.pauseTheatreShow();
  });
}

if ($btnEndShow) {
  $btnEndShow.addEventListener('click', () => {
    if (confirm('Tem a certeza de que deseja terminar o espetáculo e fechar a contagem?')) {
      client.endTheatreShow();
    }
  });
}

if ($btnResetShow) {
  $btnResetShow.addEventListener('click', () => {
    if (confirm('Reiniciar o espetáculo? Todas as deixas e a contagem voltarão a zero.')) {
      client.resetTheatreShow();
    }
  });
}

// ─── Urgent Notice Setup ─────────────────────────────────────────────
if ($btnUrgentToggle) {
  $btnUrgentToggle.addEventListener('click', () => {
    const isHidden = $urgentBar.style.display === 'none';
    $urgentBar.style.display = isHidden ? 'flex' : 'none';
    if (isHidden && $urgentInput) $urgentInput.focus();
  });
}

if ($urgentSendBtn) {
  $urgentSendBtn.addEventListener('click', () => {
    const text = ($urgentInput?.value || '').trim();
    if (text) {
      client.sendUrgentNotice(text, 'warn');
      if ($urgentInput) $urgentInput.value = '';
    }
  });
}

if ($urgentInput) {
  $urgentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      $urgentSendBtn?.click();
    }
  });
}

if ($urgentClearBtn) {
  $urgentClearBtn.addEventListener('click', () => {
    client.clearUrgentNotice();
    if ($urgentInput) $urgentInput.value = '';
  });
}

// ─── Tabs Navigation Setup ───────────────────────────────────────────
document.querySelectorAll('.dc-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.dc-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dc-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const content = document.getElementById(target);
    if (content) content.classList.add('active');
  });
});

// ─── Keyboard Shortcut for GO (Spacebar) ─────────────────────────────
window.addEventListener('keydown', (e) => {
  // If user is typing in any text box or modal, ignore spacebar shortcut
  const activeEl = document.activeElement;
  const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
  if (isInput) return;

  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    triggerGoAction();
  }
});

// ─── Standby & GO Actions ────────────────────────────────────────────
function triggerStandbyAction() {
  const th = state?.theatre;
  if (!th || !Array.isArray(th.cues)) return;

  // Find next pending cue or current standby cue
  let targetCue = th.cues.find(c => c.status === 'standby');
  if (!targetCue) {
    targetCue = th.cues.find(c => c.status === 'pending');
  } else {
    // If already on standby, advance to next pending cue
    const currentIdx = th.cues.findIndex(c => c.id === targetCue.id);
    const nextPending = th.cues.slice(currentIdx + 1).find(c => c.status === 'pending');
    if (nextPending) targetCue = nextPending;
  }

  if (targetCue) {
    client.standbyCue(targetCue.id);
    highlightScriptForCue(targetCue.id);
  }
}

function triggerGoAction() {
  const th = state?.theatre;
  if (!th || !Array.isArray(th.cues)) return;

  // Prefer firing cue on standby; if none, fire top pending cue
  let cueToFire = th.cues.find(c => c.status === 'standby');
  if (!cueToFire) {
    cueToFire = th.cues.find(c => c.status === 'pending');
  }

  if (cueToFire) {
    if (th.showState === 'pre') {
      client.startTheatreShow();
    }
    client.fireCue(cueToFire.id);
    highlightScriptForCue(cueToFire.id);

    // Auto put next pending cue into standby shortly after
    setTimeout(() => {
      const freshTh = state?.theatre;
      if (freshTh && Array.isArray(freshTh.cues)) {
        const nextPending = freshTh.cues.find(c => c.status === 'pending');
        if (nextPending && !freshTh.standbyCueId) {
          client.standbyCue(nextPending.id);
        }
      }
    }, 1500);
  }
}

if ($btnStandby) {
  $btnStandby.addEventListener('click', triggerStandbyAction);
}

if ($btnGo) {
  $btnGo.addEventListener('click', triggerGoAction);
}

// ─── Script Font Size & Continuous Teleprompter Scroll ───────────────
let scriptFontSize = 16;
try {
  const savedSize = parseInt(localStorage.getItem('stagetimer_dc_script_font'), 10);
  if (!isNaN(savedSize) && savedSize >= 12 && savedSize <= 36) {
    scriptFontSize = savedSize;
  }
} catch (_) {}

function applyScriptFontSize() {
  if ($scriptFeed) {
    $scriptFeed.style.fontSize = `${scriptFontSize}px`;
  }
}
applyScriptFontSize();

if ($scriptFontMinus) {
  $scriptFontMinus.addEventListener('click', () => {
    if (scriptFontSize > 12) {
      scriptFontSize -= 2;
      applyScriptFontSize();
      try { localStorage.setItem('stagetimer_dc_script_font', String(scriptFontSize)); } catch (_) {}
    }
  });
}

if ($scriptFontPlus) {
  $scriptFontPlus.addEventListener('click', () => {
    if (scriptFontSize < 36) {
      scriptFontSize += 2;
      applyScriptFontSize();
      try { localStorage.setItem('stagetimer_dc_script_font', String(scriptFontSize)); } catch (_) {}
    }
  });
}

// Teleprompter Continuous Scroll Loop
let isTeleprompterScrolling = false;
let teleprompterAnimationId = null;

function stepTeleprompter() {
  if (!isTeleprompterScrolling || !$scriptFeed) return;
  const speedVal = parseFloat($scriptScrollSpeed?.value || '2');
  const scrollIncrement = speedVal === 1 ? 0.4 : speedVal === 3 ? 1.4 : 0.8;

  $scriptFeed.scrollTop += scrollIncrement;

  if ($scriptFeed.scrollTop + $scriptFeed.clientHeight >= $scriptFeed.scrollHeight - 2) {
    stopTeleprompter();
    return;
  }
  teleprompterAnimationId = requestAnimationFrame(stepTeleprompter);
}

function startTeleprompter() {
  if (isTeleprompterScrolling) return;
  isTeleprompterScrolling = true;
  if ($scriptScrollToggle) {
    $scriptScrollToggle.textContent = '⏸ Pausar';
    $scriptScrollToggle.classList.add('active');
  }
  teleprompterAnimationId = requestAnimationFrame(stepTeleprompter);
}

function stopTeleprompter() {
  isTeleprompterScrolling = false;
  if (teleprompterAnimationId) {
    cancelAnimationFrame(teleprompterAnimationId);
    teleprompterAnimationId = null;
  }
  if ($scriptScrollToggle) {
    $scriptScrollToggle.textContent = '▶ Rolar Texto';
    $scriptScrollToggle.classList.remove('active');
  }
}

if ($scriptScrollToggle) {
  $scriptScrollToggle.addEventListener('click', () => {
    if (isTeleprompterScrolling) {
      stopTeleprompter();
    } else {
      startTeleprompter();
    }
  });
}

// ─── Script Auto-Scroll & Highlighting ──────────────────────────────
function highlightScriptForCue(cueId) {
  if (!$scriptFeed) return;
  const scriptItem = $scriptFeed.querySelector(`[data-cue-anchor="${cueId}"]`);
  if (!scriptItem) return;

  $scriptFeed.querySelectorAll('.dc-script-item').forEach(el => el.classList.remove('is-current-speaking'));
  scriptItem.classList.add('is-current-speaking');

  if ($toggleAutoscroll && $toggleAutoscroll.checked) {
    scriptItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ─── Render Functions ────────────────────────────────────────────────

let lastScriptSig = '';
let lastCuesSig = '';
let lastChecklistSig = '';
let lastTelemetrySig = '';

function renderScript() {
  const script = state?.theatre?.script || [];
  const sig = script.map(s => `${s.id}:${s.type}:${s.speaker || ''}:${s.cueAnchor || ''}:${s.text}`).join('|');
  if (sig === lastScriptSig) return;
  lastScriptSig = sig;

  if (script.length === 0) {
    $scriptFeed.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: var(--dc-muted);">
        Nenhum texto carregado no guião da peça.<br>
        <button id="dc-btn-script-empty-import" class="dc-tool-btn" style="margin-top: 10px;">📥 Importar Texto</button>
      </div>
    `;
    document.getElementById('dc-btn-script-empty-import')?.addEventListener('click', () => {
      if ($modalImportScript) $modalImportScript.style.display = 'flex';
    });
    return;
  }

  $scriptFeed.innerHTML = script.map(item => {
    const isDirection = item.type === 'direction';
    const hasCue = Boolean(item.cueAnchor);
    let cueBadgeHtml = '';

    if (hasCue) {
      const cueObj = state?.theatre?.cues?.find(c => c.id === item.cueAnchor);
      const cueNum = cueObj ? cueObj.num : 'CUE';
      const cueName = cueObj ? cueObj.name : '';
      cueBadgeHtml = `<button type="button" class="dc-cue-anchor-pill" data-jump-cue="${escapeHtml(item.cueAnchor)}" title="Focar Deixa">⚡ ${escapeHtml(cueNum)}: ${escapeHtml(cueName)}</button>`;
    }

    return `
      <div class="dc-script-item ${isDirection ? 'direction' : 'dialogue'} ${hasCue ? 'has-cue' : ''}" data-script-id="${escapeHtml(item.id)}" data-cue-anchor="${escapeHtml(item.cueAnchor || '')}">
        <div class="dc-script-meta">
          ${item.speaker ? `<span class="dc-speaker-pill">${escapeHtml(item.speaker)}</span>` : (isDirection ? '<span class="dc-direction-tag">[CENA / RUBRICA]</span>' : '')}
          ${cueBadgeHtml}
        </div>
        <div class="${isDirection ? 'dc-script-direction' : 'dc-script-text'}">
          ${escapeHtml(item.text)}
        </div>
      </div>
    `;
  }).join('');
}

function renderCues() {
  const th = state?.theatre;
  const cues = th?.cues || [];

  if ($cuesCountBadge) $cuesCountBadge.textContent = cues.length;

  // Next cue summary
  const standbyCue = cues.find(c => c.status === 'standby');
  const nextPendingCue = cues.find(c => c.status === 'pending');
  if ($nextCueSummary) {
    if (standbyCue) {
      $nextCueSummary.textContent = `🟡 STANDBY: ${standbyCue.num} (${standbyCue.name})`;
      $nextCueSummary.style.color = 'var(--dc-gold)';
    } else if (nextPendingCue) {
      $nextCueSummary.textContent = `Próxima: ${nextPendingCue.num} (${nextPendingCue.name})`;
      $nextCueSummary.style.color = '#fff';
    } else {
      $nextCueSummary.textContent = 'Sem deixas pendentes';
      $nextCueSummary.style.color = 'var(--dc-muted)';
    }
  }

  const sig = cues.map(c => `${c.id}:${c.status}:${c.firedTimecode}:${(c.feedbacks || []).length}`).join('|');
  if (sig === lastCuesSig) return;
  lastCuesSig = sig;

  if (cues.length === 0) {
    $cuesList.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--dc-muted);">Nenhuma deixa registada. Clique em "+ Nova Deixa" para começar.</div>`;
    return;
  }

  $cuesList.innerHTML = cues.map(cue => {
    const isStandby = cue.status === 'standby';
    const isFired = cue.status === 'fired';
    const isCompleted = cue.status === 'completed';

    let rowClass = 'dc-cue-row';
    if (isStandby) rowClass += ' is-standby';
    else if (isFired) rowClass += ' is-fired';
    else if (isCompleted) rowClass += ' is-completed';

    const deptsHtml = (cue.departments || []).map(d => {
      const dClean = String(d || '').toLowerCase();
      let cls = 'luz';
      if (dClean.includes('som')) cls = 'som';
      else if (dClean.includes('maq')) cls = 'maquinaria';
      else if (dClean.includes('vid')) cls = 'video';
      else if (dClean.includes('cox')) cls = 'coxias';
      return `<span class="dc-dept-tag ${cls}">${escapeHtml(d)}</span>`;
    }).join('');

    const feedbacksHtml = (cue.feedbacks || []).map(fb => {
      return `<span class="dc-feedback-chip ${escapeHtml(fb.type)}">${escapeHtml(fb.dept)}: ${escapeHtml(fb.type)}</span>`;
    }).join('');

    return `
      <div class="${rowClass}" data-cue-id="${escapeHtml(cue.id)}">
        <div class="dc-cue-num-col">${escapeHtml(cue.num)}</div>
        <div class="dc-cue-info-col">
          <div class="dc-cue-name">${escapeHtml(cue.name)}</div>
          <div class="dc-cue-target">${escapeHtml(cue.targetText || cue.notes || '')}</div>
          <div class="dc-cue-depts">${deptsHtml} ${feedbacksHtml}</div>
        </div>
        <div class="dc-cue-actions-col">
          ${cue.firedTimecode ? `<span style="font-family: var(--font-mono); font-size: 0.8rem; color: #00ffb3; font-weight: 800;">${escapeHtml(cue.firedTimecode)}</span>` : ''}
          <span class="dc-status-pill ${escapeHtml(cue.status)}">${escapeHtml(cue.status)}</span>
          <button type="button" class="dc-cue-btn" data-cue-action="standby" data-id="${escapeHtml(cue.id)}" title="Standby">🟡</button>
          <button type="button" class="dc-cue-btn" data-cue-action="go" data-id="${escapeHtml(cue.id)}" title="Disparar GO">🟢</button>
          <button type="button" class="dc-cue-btn" data-cue-action="reset" data-id="${escapeHtml(cue.id)}" title="Voltar a pendente">↩️</button>
          <button type="button" class="dc-cue-btn" data-cue-action="edit" data-id="${escapeHtml(cue.id)}" title="Editar Deixa">✏️</button>
          <button type="button" class="dc-cue-btn" data-cue-action="delete" data-id="${escapeHtml(cue.id)}" style="color: #ff7675; border-color: rgba(235, 87, 87, 0.4);" title="Eliminar Deixa">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderChecklists() {
  const checklists = state?.theatre?.checklists || {};
  const depts = Object.keys(checklists);

  let totalItems = 0;
  let doneItems = 0;
  const deptStats = [];

  depts.forEach(d => {
    const items = checklists[d] || [];
    const dTotal = items.length;
    const dDone = items.filter(i => i.done).length;
    totalItems += dTotal;
    doneItems += dDone;
    const dPct = dTotal > 0 ? Math.round((dDone / dTotal) * 100) : 0;
    deptStats.push({ dept: d, total: dTotal, done: dDone, pct: dPct });
  });

  const overallPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
  if ($checklistsProgressBadge) $checklistsProgressBadge.textContent = `${overallPct}%`;
  if ($readinessPercent) $readinessPercent.textContent = `${overallPct}% PRONTO`;
  if ($readinessBar) $readinessBar.style.width = `${overallPct}%`;

  if ($deptGauges) {
    $deptGauges.innerHTML = deptStats.map(s => `
      <div class="dc-dept-gauge-item">
        <strong style="color: #fff;">${escapeHtml(s.dept)}:</strong>
        <span style="font-family: var(--font-mono); color: ${s.pct === 100 ? '#00ffb3' : 'var(--dc-gold)'}; font-weight: 800;">${s.pct}%</span>
      </div>
    `).join('');
  }

  const sig = depts.map(d => `${d}:${(checklists[d] || []).map(i => `${i.id}:${i.done}:${i.label}`).join(';')}`).join('||');
  if (sig === lastChecklistSig) return;
  lastChecklistSig = sig;

  if ($checklistsContainer) {
    $checklistsContainer.innerHTML = depts.map(dept => {
      const items = checklists[dept] || [];
      const itemsHtml = items.map(item => `
        <div class="dc-dept-item ${item.done ? 'done' : ''}">
          <input type="checkbox" data-check-item="${escapeHtml(item.id)}" data-check-dept="${escapeHtml(dept)}" ${item.done ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px;">
          <span style="flex: 1;">${escapeHtml(item.label)}</span>
          ${item.isOneOff ? `<span class="dc-oneoff-tag" title="Tarefa pontual de hoje">Só Hoje</span>` : ''}
          <button type="button" class="dc-tool-btn" data-remove-task="${escapeHtml(item.id)}" data-remove-dept="${escapeHtml(dept)}" style="padding: 2px 6px; font-size: 0.68rem; color: #ff7675;">✕</button>
        </div>
      `).join('');

      return `
        <div class="dc-dept-card">
          <div class="dc-dept-header">
            <span class="dc-dept-title">${escapeHtml(dept)}</span>
            <span style="font-size: 0.75rem; color: var(--dc-muted);">${items.filter(i => i.done).length}/${items.length} concluídas</span>
          </div>
          <div>${itemsHtml || '<div style="font-size: 0.78rem; color: var(--dc-muted); font-style: italic;">Sem tarefas registadas.</div>'}</div>
        </div>
      `;
    }).join('');
  }
}

function renderTelemetry() {
  const telemetry = state?.theatre?.telemetry || [];
  if ($telemetryFiredCount) $telemetryFiredCount.textContent = telemetry.length;

  let totalFb = 0;
  telemetry.forEach(t => {
    if (Array.isArray(t.feedbacks)) totalFb += t.feedbacks.length;
  });
  if ($telemetryFeedbackCount) $telemetryFeedbackCount.textContent = totalFb;

  const th = state?.theatre;
  if ($telemetryDuration) {
    const elapsed = th?.showElapsedMs || (th?.showStartTime > 0 ? Date.now() - th.showStartTime : 0);
    $telemetryDuration.textContent = formatElapsed(elapsed).replace('+', '');
  }

  const sig = telemetry.map(t => `${t.id}:${t.timecode}:${(t.feedbacks || []).length}`).join('|');
  if (sig === lastTelemetrySig) return;
  lastTelemetrySig = sig;

  if ($telemetryList) {
    if (telemetry.length === 0) {
      $telemetryList.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--dc-muted);">Nenhum registo de telemetria ainda. Inicie o espetáculo e execute deixas para gerar o histórico.</div>`;
      return;
    }

    $telemetryList.innerHTML = telemetry.map(t => {
      const fbList = (t.feedbacks || []).map(f => `<span class="dc-feedback-chip ${escapeHtml(f.type)}">${escapeHtml(f.dept)}: ${escapeHtml(f.type)}</span>`).join(' ');
      return `
        <div class="dc-telemetry-row">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="dc-telemetry-timecode">${escapeHtml(t.timecode)}</span>
            <strong style="color: #fff;">${escapeHtml(t.num)}</strong>
            <span>${escapeHtml(t.name)}</span>
          </div>
          <div>${fbList}</div>
        </div>
      `;
    }).join('');
  }
}

function render() {
  if (!state) return;

  const th = state.theatre;
  if (!th) return;

  // Show status UI
  if ($showStatusBadge && $showStatusText) {
    $showStatusBadge.className = `dc-show-status-pill ${th.showState}`;
    if (th.showState === 'running') {
      $showStatusText.textContent = 'ESPETÁCULO EM CURSO';
      $btnStartShow.style.display = 'none';
      $btnPauseShow.style.display = 'inline-flex';
      $btnEndShow.style.display = 'inline-flex';
    } else if (th.showState === 'paused') {
      $showStatusText.textContent = 'EM PAUSA';
      $btnStartShow.style.display = 'inline-flex';
      $btnStartShow.textContent = '▶ Retomar';
      $btnPauseShow.style.display = 'none';
      $btnEndShow.style.display = 'inline-flex';
    } else if (th.showState === 'ended') {
      $showStatusText.textContent = 'TERMINADO';
      $btnStartShow.style.display = 'none';
      $btnPauseShow.style.display = 'none';
      $btnEndShow.style.display = 'none';
    } else {
      $showStatusText.textContent = 'PRÉ-SHOW';
      $btnStartShow.style.display = 'inline-flex';
      $btnStartShow.textContent = '▶ Iniciar';
      $btnPauseShow.style.display = 'none';
      $btnEndShow.style.display = 'none';
    }
  }

  // Urgent Notice display
  if ($urgentActiveTag) {
    if (th.urgentNotice && th.urgentNotice.visible && th.urgentNotice.text) {
      $urgentActiveTag.style.display = 'block';
      $urgentActiveTag.textContent = `🚨 AVISO ATIVO ENVIADO: "${th.urgentNotice.text}"`;
      $urgentBar.style.display = 'flex';
    } else {
      $urgentActiveTag.style.display = 'none';
    }
  }

  renderScript();
  renderCues();
  renderChecklists();
  renderTelemetry();
}

// ─── Click Delegation for Cues & Tasks ──────────────────────────────
document.addEventListener('click', (e) => {
  // Jump from script anchor to cue
  const jumpBtn = e.target.closest('[data-jump-cue]');
  if (jumpBtn) {
    const cueId = jumpBtn.dataset.jumpCue;
    if (cueId) {
      client.standbyCue(cueId);
      // Switch to cues tab if not active
      const cuesTabBtn = document.querySelector('[data-tab="tab-cues"]');
      if (cuesTabBtn) cuesTabBtn.click();
      const cueRow = $cuesList?.querySelector(`[data-cue-id="${cueId}"]`);
      if (cueRow) cueRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Cue action button
  const cueActionBtn = e.target.closest('[data-cue-action]');
  if (cueActionBtn) {
    const action = cueActionBtn.dataset.cueAction;
    const id = cueActionBtn.dataset.id;
    if (action === 'standby') client.standbyCue(id);
    else if (action === 'go') client.fireCue(id);
    else if (action === 'reset') client.resetCue(id);
    else if (action === 'edit') openEditCueModal(id);
    else if (action === 'delete') {
      const cue = state?.theatre?.cues?.find(c => c.id === id);
      const cueLabel = cue ? `${cue.num} (${cue.name})` : 'esta deixa';
      if (confirm(`Tem a certeza de que deseja eliminar ${cueLabel}?`)) {
        client.deleteCue(id);
      }
    }
  }

  // Remove checklist item
  const removeTaskBtn = e.target.closest('[data-remove-task]');
  if (removeTaskBtn) {
    const itemId = removeTaskBtn.dataset.removeTask;
    const dept = removeTaskBtn.dataset.removeDept;
    if (confirm('Eliminar esta tarefa da checklist?')) {
      client.removeChecklistItem(dept, itemId);
    }
  }
});

// Checklist item toggle change
document.addEventListener('change', (e) => {
  const chk = e.target.closest('[data-check-item]');
  if (chk) {
    const itemId = chk.dataset.checkItem;
    const dept = chk.dataset.checkDept;
    client.toggleChecklistItem(dept, itemId, chk.checked);
  }
});

// Add Task Button
if ($taskAddBtn) {
  $taskAddBtn.addEventListener('click', () => {
    const dept = $taskDeptSelect?.value || 'Luz';
    const label = ($taskLabelInput?.value || '').trim();
    const isOneOff = Boolean($taskOneOffCheck?.checked);
    if (label) {
      client.addChecklistItem(dept, label, isOneOff);
      if ($taskLabelInput) $taskLabelInput.value = '';
      if ($taskOneOffCheck) $taskOneOffCheck.checked = false;
    }
  });
}

// ─── Modals: Open & Close Handlers ──────────────────────────────────
document.querySelectorAll('[data-close-modal]').forEach(b => {
  b.addEventListener('click', () => {
    const modalId = b.dataset.closeModal;
    const m = document.getElementById(modalId);
    if (m) m.style.display = 'none';
  });
});

if ($btnImportScript && $modalImportScript) {
  $btnImportScript.addEventListener('click', () => {
    $modalImportScript.style.display = 'flex';
    if ($scriptImportTextarea) $scriptImportTextarea.focus();
  });
}

if ($scriptImportConfirm) {
  $scriptImportConfirm.addEventListener('click', () => {
    const raw = ($scriptImportTextarea?.value || '').trim();
    if (!raw) return;

    const lines = raw.split('\n');
    const newScript = [];
    lines.forEach((line, idx) => {
      const clean = line.trim();
      if (!clean) return;

      if (clean.startsWith('[') && clean.endsWith(']')) {
        newScript.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'direction',
          text: clean,
          cueAnchor: null
        });
      } else {
        const colonIdx = clean.indexOf(':');
        if (colonIdx > 0 && colonIdx < 30) {
          const speaker = clean.substring(0, colonIdx).trim().toUpperCase();
          const text = clean.substring(colonIdx + 1).trim();
          newScript.push({
            id: 'sc_' + Date.now() + '_' + idx,
            type: 'dialogue',
            speaker: speaker,
            text: text,
            cueAnchor: null
          });
        } else {
          newScript.push({
            id: 'sc_' + Date.now() + '_' + idx,
            type: 'dialogue',
            speaker: '',
            text: clean,
            cueAnchor: null
          });
        }
      }
    });

    if (newScript.length > 0) {
      client.updateTheatreScript(newScript);
      $modalImportScript.style.display = 'none';
      if ($scriptImportTextarea) $scriptImportTextarea.value = '';
    }
  });
}

if ($btnAddLine) {
  $btnAddLine.addEventListener('click', () => {
    const text = prompt('Introduza o texto ou fala (ex: "ATOR: Estamos a postos."):');
    if (text && text.trim()) {
      const th = state?.theatre;
      const script = Array.isArray(th?.script) ? [...th.script] : [];
      script.push({
        id: 'sc_' + Date.now(),
        type: 'dialogue',
        speaker: 'ATOR',
        text: text.trim(),
        cueAnchor: null
      });
      client.updateTheatreScript(script);
    }
  });
}

// Modal Import Cues
if ($btnImportCues && $modalImportCues) {
  $btnImportCues.addEventListener('click', () => {
    $modalImportCues.style.display = 'flex';
    if ($cuesImportTextarea) $cuesImportTextarea.focus();
  });
}

if ($cuesImportConfirm) {
  $cuesImportConfirm.addEventListener('click', () => {
    const raw = ($cuesImportTextarea?.value || '').trim();
    if (!raw) return;

    const lines = raw.split('\n');
    const newCues = [];
    lines.forEach((line, idx) => {
      const clean = line.trim();
      if (!clean) return;
      const parts = clean.split(/[;,]/);
      const num = (parts[0] || `Q${idx + 1}`).trim();
      const name = (parts[1] || 'Deixa').trim();
      const depts = (parts[2] || 'Luz').split(/[\s+/]/).map(d => d.trim()).filter(Boolean);
      const target = (parts[3] || '').trim();
      const notes = (parts[4] || '').trim();

      newCues.push({
        id: 'cue_' + Date.now() + '_' + idx,
        num: num,
        name: name,
        targetText: target,
        departments: depts.length > 0 ? depts : ['Luz'],
        notes: notes,
        status: 'pending',
        standbyAt: 0,
        firedAt: 0,
        firedTimecode: '',
        feedbacks: []
      });
    });

    if (newCues.length > 0) {
      client.updateTheatreCues(newCues);
      $modalImportCues.style.display = 'none';
      if ($cuesImportTextarea) $cuesImportTextarea.value = '';
    }
  });
}

// Modal New Cue
if ($btnAddCue && $modalNewCue) {
  $btnAddCue.addEventListener('click', () => {
    $modalNewCue.style.display = 'flex';
    const nextNum = (state?.theatre?.cues?.length || 0) + 1;
    if ($newCueNum) $newCueNum.value = `Q${nextNum}`;
    if ($newCueName) $newCueName.value = '';
    if ($newCueTarget) $newCueTarget.value = '';
    if ($newCueNotes) $newCueNotes.value = '';
  });
}

if ($newCueConfirm) {
  $newCueConfirm.addEventListener('click', () => {
    const num = ($newCueNum?.value || '').trim();
    const name = ($newCueName?.value || '').trim();
    const target = ($newCueTarget?.value || '').trim();
    const notes = ($newCueNotes?.value || '').trim();

    const depts = [];
    document.querySelectorAll('input[name="dc-dept"]:checked').forEach(chk => {
      depts.push(chk.value);
    });

    if (!num || !name) {
      alert('Por favor introduza o número e o nome da deixa.');
      return;
    }

    const th = state?.theatre;
    const cues = Array.isArray(th?.cues) ? [...th.cues] : [];
    cues.push({
      id: 'cue_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      num: num,
      name: name,
      targetText: target,
      departments: depts.length > 0 ? depts : ['Luz'],
      notes: notes,
      status: 'pending',
      standbyAt: 0,
      firedAt: 0,
      firedTimecode: '',
      feedbacks: []
    });

    client.updateTheatreCues(cues);
    $modalNewCue.style.display = 'none';
  });
}

// ─── Modal Edit Cue ──────────────────────────────────────────────────
function openEditCueModal(cueId) {
  const cue = state?.theatre?.cues?.find(c => c.id === cueId);
  if (!cue || !$modalEditCue) return;

  if ($editCueId) $editCueId.value = cue.id;
  if ($editCueNum) $editCueNum.value = cue.num || '';
  if ($editCueName) $editCueName.value = cue.name || '';
  if ($editCueTarget) $editCueTarget.value = cue.targetText || '';
  if ($editCueNotes) $editCueNotes.value = cue.notes || '';

  const depts = Array.isArray(cue.departments) ? cue.departments.map(d => String(d).toLowerCase()) : ['luz'];
  document.querySelectorAll('input[name="dc-edit-dept"]').forEach(chk => {
    chk.checked = depts.some(d => d.includes(chk.value.toLowerCase()));
  });

  $modalEditCue.style.display = 'flex';
  if ($editCueName) $editCueName.focus();
}

if ($editCueConfirm) {
  $editCueConfirm.addEventListener('click', () => {
    const cueId = $editCueId?.value;
    if (!cueId) return;

    const num = ($editCueNum?.value || '').trim();
    const name = ($editCueName?.value || '').trim();
    const target = ($editCueTarget?.value || '').trim();
    const notes = ($editCueNotes?.value || '').trim();

    const depts = [];
    document.querySelectorAll('input[name="dc-edit-dept"]:checked').forEach(chk => {
      depts.push(chk.value);
    });

    if (!num || !name) {
      alert('Por favor introduza o número e o nome da deixa.');
      return;
    }

    client.editCue(cueId, {
      num: num,
      name: name,
      targetText: target,
      departments: depts.length > 0 ? depts : ['Luz'],
      notes: notes
    });

    $modalEditCue.style.display = 'none';
  });
}

if ($editCueDeleteBtn) {
  $editCueDeleteBtn.addEventListener('click', () => {
    const cueId = $editCueId?.value;
    if (!cueId) return;
    const cue = state?.theatre?.cues?.find(c => c.id === cueId);
    const cueLabel = cue ? `${cue.num} (${cue.name})` : 'esta deixa';
    if (confirm(`Eliminar permanentemente ${cueLabel}?`)) {
      client.deleteCue(cueId);
      $modalEditCue.style.display = 'none';
    }
  });
}

// ─── Clear All Cues ──────────────────────────────────────────────────
if ($btnClearCues) {
  $btnClearCues.addEventListener('click', () => {
    const total = state?.theatre?.cues?.length || 0;
    if (total === 0) {
      alert('Não existem deixas para eliminar.');
      return;
    }
    if (confirm(`Atenção: Deseja eliminar TODAS as ${total} deixas registadas?\nEsta ação limpará permanentemente a lista de deixas desta sala.`)) {
      client.clearAllCues();
    }
  });
}

// ─── Modal Edit Full Script Text ─────────────────────────────────────
if ($btnEditScriptText && $modalEditScriptText) {
  $btnEditScriptText.addEventListener('click', () => {
    const th = state?.theatre;
    const script = Array.isArray(th?.script) ? th.script : [];
    let textLines = '';
    if (script.length > 0) {
      textLines = script.map(item => {
        if (item.type === 'direction') {
          return item.text.startsWith('[') && item.text.endsWith(']') ? item.text : `[${item.text}]`;
        }
        if (item.speaker) {
          return `${item.speaker}: ${item.text}`;
        }
        return item.text;
      }).join('\n\n');
    }
    if ($fullScriptTextarea) $fullScriptTextarea.value = textLines;
    $modalEditScriptText.style.display = 'flex';
    if ($fullScriptTextarea) $fullScriptTextarea.focus();
  });
}

if ($fullScriptSave) {
  $fullScriptSave.addEventListener('click', () => {
    const raw = ($fullScriptTextarea?.value || '').trim();
    if (!raw) {
      if (confirm('Deseja limpar todo o texto do guião?')) {
        client.updateTheatreScript([]);
        $modalEditScriptText.style.display = 'none';
      }
      return;
    }

    const lines = raw.split('\n');
    const newScript = [];
    lines.forEach((line, idx) => {
      const clean = line.trim();
      if (!clean) return;

      if (clean.startsWith('[') && clean.endsWith(']')) {
        newScript.push({
          id: 'sc_' + Date.now() + '_' + idx,
          type: 'direction',
          text: clean,
          cueAnchor: null
        });
      } else {
        const colonIdx = clean.indexOf(':');
        if (colonIdx > 0 && colonIdx < 30) {
          const speaker = clean.substring(0, colonIdx).trim().toUpperCase();
          const text = clean.substring(colonIdx + 1).trim();
          newScript.push({
            id: 'sc_' + Date.now() + '_' + idx,
            type: 'dialogue',
            speaker: speaker,
            text: text,
            cueAnchor: null
          });
        } else {
          newScript.push({
            id: 'sc_' + Date.now() + '_' + idx,
            type: 'dialogue',
            speaker: '',
            text: clean,
            cueAnchor: null
          });
        }
      }
    });

    if (newScript.length > 0) {
      client.updateTheatreScript(newScript);
      $modalEditScriptText.style.display = 'none';
    }
  });
}

// ─── Report Generator (Copy & Download) ─────────────────────────────
function buildReportText() {
  const th = state?.theatre;
  const showDate = new Date().toLocaleDateString('pt-PT');
  const duration = $telemetryDuration?.textContent || '00:00:00';
  const firedCount = th?.telemetry?.length || 0;

  let text = `======================================================\n`;
  text += `🎭 RELATÓRIO DE RÉGIE — MODO JESS\n`;
  text += `Sala / Palco: ${state?.name || roomId}  •  Data: ${showDate}\n`;
  text += `Duração de Espetáculo: ${duration}  •  Deixas Executadas: ${firedCount}\n`;
  text += `======================================================\n\n`;

  text += `--- HISTÓRICO DE DEIXAS EXECUTADAS (TIMECODES) ---\n`;
  if (Array.isArray(th?.telemetry) && th.telemetry.length > 0) {
    th.telemetry.slice().reverse().forEach(t => {
      const fbStr = (t.feedbacks || []).map(f => `[${f.dept}: ${f.type}]`).join(' ');
      text += `${t.timecode}  |  ${t.num} — ${t.name} (${(t.departments || []).join(', ')}) ${fbStr ? '• Feedback: ' + fbStr : ''}\n`;
    });
  } else {
    text += `Nenhuma deixa disparada durante a sessão.\n`;
  }

  text += `\n--- ESTADO DE AFINAÇÕES PRÉ-SHOW ---\n`;
  const checklists = th?.checklists || {};
  Object.keys(checklists).forEach(d => {
    const items = checklists[d] || [];
    const done = items.filter(i => i.done).length;
    text += `${d}: ${done}/${items.length} concluídas\n`;
  });

  text += `\nGerado automaticamente via StageTimer PFP (Modo Jess).\n`;
  return text;
}

if ($btnCopyReport) {
  $btnCopyReport.addEventListener('click', () => {
    const report = buildReportText();
    navigator.clipboard.writeText(report).then(() => {
      $btnCopyReport.textContent = '✓ Relatório Copiado!';
      setTimeout(() => { $btnCopyReport.textContent = '📋 Copiar Relatório'; }, 2000);
    }).catch(() => {
      alert('Erro ao copiar. Selecione o texto manualmente.');
    });
  });
}

if ($btnDownloadReport) {
  $btnDownloadReport.addEventListener('click', () => {
    const report = buildReportText();
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Relatorio_Regie_Jess_${roomId}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ─── Stage Navigation & Switcher ────────────────────────────────────
function updateStageUI() {
  const list = client.getEventsList();
  const currentCode = (state?.id || roomId || '').toUpperCase();

  if ($stageBadge) {
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
    $stageBadge.textContent = name;
  }
}

if ($stageContainer && $stageSelect) {
  $stageContainer.addEventListener('click', () => {
    if ($stageSelect.style.display !== 'none') {
      $stageSelect.focus();
      try { $stageSelect.showPicker(); } catch (_) {}
    }
  });
}

// ─── Client Event Handlers ──────────────────────────────────────────
client.on('room-state', (newState) => {
  state = newState;
  updateStageUI();
  render();
});

client.on('events-list-update', () => {
  updateStageUI();
});

client.on('tick', () => {
  render();
});

client.connect();
