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
const $btnSaveReport = document.getElementById('dc-btn-save-report');
const $savedReportsCount = document.getElementById('dc-saved-reports-count');
const $savedReportsList = document.getElementById('dc-saved-reports-list');

// Modal Ver Relatório
const $modalViewReport = document.getElementById('dc-modal-view-report');
const $modalViewReportTitle = document.getElementById('dc-modal-view-report-title');
const $modalViewReportBody = document.getElementById('dc-modal-view-report-body');
const $modalViewReportClose = document.getElementById('dc-modal-view-report-close');
const $modalViewReportCopy = document.getElementById('dc-modal-view-report-copy');
const $modalViewReportDownload = document.getElementById('dc-modal-view-report-download');

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

// Views: Stage (Fase 1) vs Cues (Fase 2)
const $viewStage = document.getElementById('dc-view-stage');
const $viewCues = document.getElementById('dc-view-cues');
const $btnStartShowPrep = document.getElementById('dc-btn-start-show-prep');
const $btnReturnStage = document.getElementById('dc-btn-return-stage');

// Stage Prep Elements
const $stageArtistsList = document.getElementById('dc-stage-artists-list');
const $stageArtistsCount = document.getElementById('dc-stage-artists-count');
const $btnStageAddArtist = document.getElementById('dc-btn-stage-add-artist');
const $btnStageImportSchedule = document.getElementById('dc-btn-stage-import-schedule');
const $btnStageClearSchedule = document.getElementById('dc-btn-stage-clear-schedule');
const $stageArtistNameInput = document.getElementById('dc-stage-artist-name-input');
const $stageArtistDurInput = document.getElementById('dc-stage-artist-dur-input');
const $stageArtistAddBtn = document.getElementById('dc-stage-artist-add-btn');
const $stageNotesList = document.getElementById('dc-stage-notes-list');
const $stageNoteInput = document.getElementById('dc-stage-note-input');
const $stageNoteAddBtn = document.getElementById('dc-stage-note-add-btn');
const $prepCuesCount = document.getElementById('dc-prep-cues-count');
const $btnPrepAddCue = document.getElementById('dc-btn-prep-add-cue');
const $btnPrepViewScript = document.getElementById('dc-btn-prep-view-script');

// Modal Importar Alinhamento
const $modalImportSchedule = document.getElementById('dc-modal-import-schedule');
const $schedDropzone = document.getElementById('dc-sched-dropzone');
const $schedFileInput = document.getElementById('dc-sched-file-input');
const $schedImportTextarea = document.getElementById('dc-sched-import-textarea');
const $schedPreviewContainer = document.getElementById('dc-sched-preview-container');
const $schedPreviewCount = document.getElementById('dc-sched-preview-count');
const $schedPreviewFileInfo = document.getElementById('dc-sched-preview-file-info');
const $schedPreviewBox = document.getElementById('dc-sched-preview-box');
const $schedImportConfirm = document.getElementById('dc-sched-import-confirm');

// Modal Editar Artista
const $modalEditArtist = document.getElementById('dc-modal-edit-artist');
const $editArtistId = document.getElementById('dc-edit-artist-id');
const $editArtistName = document.getElementById('dc-edit-artist-name');
const $editArtistDur = document.getElementById('dc-edit-artist-dur');
const $editArtistStart = document.getElementById('dc-edit-artist-start');
const $editArtistNotes = document.getElementById('dc-edit-artist-notes');
const $editArtistDeleteBtn = document.getElementById('dc-edit-artist-delete-btn');
const $editArtistConfirm = document.getElementById('dc-edit-artist-confirm');

// Hero Cue Elements (Opção A)
const $heroCueNum = document.getElementById('dc-hero-cue-num');
const $heroCueName = document.getElementById('dc-hero-cue-name');
const $heroCueDepts = document.getElementById('dc-hero-cue-depts');
const $heroCueTarget = document.getElementById('dc-hero-cue-target');
const $heroCueNotes = document.getElementById('dc-hero-cue-notes');
const $btnUndoCue = document.getElementById('dc-btn-undo-cue');
const $btnSkipCue = document.getElementById('dc-btn-skip-cue');

// Script Modal & Telemetry Drawer
const $modalViewScript = document.getElementById('dc-modal-view-script');
const $btnToggleScriptModal = document.getElementById('dc-btn-toggle-script-modal');
const $btnToggleTelemetry = document.getElementById('dc-btn-toggle-telemetry');
const $telemetryDrawer = document.getElementById('dc-telemetry-drawer');

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
      // Auto-save show report into the event before ending
      try {
        const rep = buildReportText();
        const dur = $telemetryDuration?.textContent || '00:00:00';
        const fCount = state?.theatre?.telemetry?.length || 0;
        client.saveTheatreReport({
          text: rep,
          duration: dur,
          cuesCount: fCount
        });
      } catch (_) {}
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
  if ($prepCuesCount) $prepCuesCount.textContent = `${cues.length} Deixa${cues.length === 1 ? '' : 's'}`;

  // Active Standby / Pending Cue for Hero Box (Opção A)
  const standbyCue = cues.find(c => c.status === 'standby');
  const nextPendingCue = cues.find(c => c.status === 'pending');
  const activeCue = standbyCue || nextPendingCue;

  if ($heroCueNum) {
    if (activeCue) {
      $heroCueNum.textContent = activeCue.num;
      $heroCueNum.style.color = standbyCue ? 'var(--dc-gold)' : '#55efc4';
    } else {
      $heroCueNum.textContent = '--';
      $heroCueNum.style.color = 'var(--dc-muted)';
    }
  }

  if ($heroCueName) {
    if (activeCue) {
      $heroCueName.textContent = activeCue.name;
    } else {
      $heroCueName.textContent = cues.length > 0 ? 'Todas as deixas disparadas' : 'Nenhuma deixa registada';
    }
  }

  if ($heroCueDepts) {
    if (activeCue && Array.isArray(activeCue.departments) && activeCue.departments.length > 0) {
      $heroCueDepts.innerHTML = activeCue.departments.map(d => {
        const dClean = String(d || '').toLowerCase();
        let cls = 'luz';
        if (dClean.includes('som')) cls = 'som';
        else if (dClean.includes('maq')) cls = 'maquinaria';
        else if (dClean.includes('vid')) cls = 'video';
        else if (dClean.includes('cox')) cls = 'coxias';
        return `<span class="dc-dept-tag ${cls}">${escapeHtml(d)}</span>`;
      }).join('');
    } else {
      $heroCueDepts.innerHTML = '';
    }
  }

  if ($heroCueTarget) {
    $heroCueTarget.textContent = activeCue?.targetText || (activeCue ? 'Ponto indicado no guião' : '--');
  }

  if ($heroCueNotes) {
    $heroCueNotes.textContent = activeCue?.notes || (activeCue ? 'Sem notas adicionais' : '--');
  }

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
    $cuesList.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--dc-muted);">Nenhuma deixa registada. Clique em "+ Nova Deixa" ou importe em PDF/Excel para começar.</div>`;
    return;
  }

  $cuesList.innerHTML = cues.map(cue => {
    const isStandby = cue.status === 'standby';
    const isFired = cue.status === 'fired';
    const isCompleted = cue.status === 'completed';

    let rowClass = 'dc-cue-row-full';
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
        <div class="dc-cue-num-col" style="font-family: var(--font-mono); font-weight: 900; font-size: 1.35rem; color: ${isStandby ? 'var(--dc-gold)' : (isFired ? '#00b894' : '#fff')}; min-width: 55px;">
          ${escapeHtml(cue.num)}
        </div>
        <div class="dc-cue-info-col" style="flex: 1; min-width: 0;">
          <div style="font-weight: 800; font-size: 1.05rem; color: #fff;">${escapeHtml(cue.name)}</div>
          ${(cue.targetText || cue.notes) ? `<div style="font-size: 0.82rem; color: #cbd5e1; margin-top: 2px;">${escapeHtml(cue.targetText || cue.notes)}</div>` : ''}
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;">
            ${deptsHtml} ${feedbacksHtml}
          </div>
        </div>
        <div class="dc-cue-actions-col" style="display: flex; align-items: center; gap: 8px;">
          ${cue.firedTimecode ? `<span style="font-family: var(--font-mono); font-size: 0.82rem; color: #00ffb3; font-weight: 800;">${escapeHtml(cue.firedTimecode)}</span>` : ''}
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

// ─── Stage Phase Render (Artistas, Alinhamento & Notas Rápidas) ───────────
let lastArtistsSig = '__INIT__';
let lastNotesSig = '__INIT__';

function renderStagePhase() {
  const timers = state?.timers || [];
  const th = state?.theatre;
  const stageNotes = th?.stageNotes || [];

  if ($stageArtistsCount) {
    $stageArtistsCount.textContent = `${timers.length} Artista${timers.length === 1 ? '' : 's'} / Atos`;
  }

  // 1. Render Artists / Lineup
  const activeIdx = timers.findIndex(t => t.id === state?.activeTimerId);
  const artistsSig = timers.map((t, idx) => `${t.id}:${t.name}:${t.duration}:${t.state}:${idx === activeIdx}`).join('|');

  if (artistsSig !== lastArtistsSig && $stageArtistsList) {
    lastArtistsSig = artistsSig;
    if (timers.length === 0) {
      $stageArtistsList.innerHTML = `
        <div style="text-align: center; padding: 26px 16px; border: 1.5px dashed rgba(255,255,255,0.12); border-radius: 10px; margin: 6px 0;">
          <div style="font-size: 2rem; margin-bottom: 6px;">🎭</div>
          <div style="font-weight: 800; font-size: 0.95rem; color: #fff; margin-bottom: 4px;">Nenhum artista ou ato no alinhamento de palco</div>
          <div style="font-size: 0.78rem; color: var(--dc-muted); margin-bottom: 12px;">Crie a sua lista de palco diretamente aqui ou carregue uma folha de horários.</div>
          <div style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;">
            <button id="dc-btn-stage-empty-demo" type="button" class="dc-tool-btn" style="color: #ffeaa7; border-color: rgba(253, 203, 110, 0.5); font-weight: 800;">✨ Carregar Exemplo de Peça</button>
            <button id="dc-btn-stage-empty-import" type="button" class="dc-tool-btn">📂 Importar Ficheiro</button>
          </div>
        </div>
      `;
      document.getElementById('dc-btn-stage-empty-demo')?.addEventListener('click', loadDemoTheatreData);
      document.getElementById('dc-btn-stage-empty-import')?.addEventListener('click', () => {
        if ($modalImportSchedule) $modalImportSchedule.style.display = 'flex';
      });
    } else {
      $stageArtistsList.innerHTML = timers.map((t, idx) => {
        const isActive = idx === activeIdx;
        const isFinished = t.state === 'finished' || (activeIdx >= 0 && idx < activeIdx);
        const isNext = activeIdx >= 0 && idx === activeIdx + 1;

        let statusBadge = '<span class="dc-artist-badge waiting">Espera</span>';
        if (isActive) statusBadge = '<span class="dc-artist-badge active">🔴 AO VIVO</span>';
        else if (isNext) statusBadge = '<span class="dc-artist-badge next">🟡 A SEGUIR</span>';
        else if (isFinished) statusBadge = '<span class="dc-artist-badge done">✓ Terminado</span>';

        const durMin = Math.round((t.duration || 0) / 60000);
        const timeLabel = t.startTime ? t.startTime : (durMin > 0 ? `${durMin} min` : '--');

        return `
          <div class="dc-artist-item ${isActive ? 'is-active' : ''}" data-artist-id="${escapeHtml(t.id)}">
            <span class="dc-artist-order">#${idx + 1}</span>
            <div class="dc-artist-time">${escapeHtml(timeLabel)}</div>
            <div class="dc-artist-info">
              <div class="dc-artist-name">${escapeHtml(t.name || 'Sem nome')}</div>
              ${t.notes ? `<div class="dc-artist-notes">${escapeHtml(t.notes)}</div>` : ''}
            </div>
            <div class="dc-artist-actions">
              ${statusBadge}
              ${idx > 0 ? `<button type="button" class="dc-tool-btn" data-move-artist="up" data-id="${escapeHtml(t.id)}" title="Mover para cima">▲</button>` : ''}
              ${idx < timers.length - 1 ? `<button type="button" class="dc-tool-btn" data-move-artist="down" data-id="${escapeHtml(t.id)}" title="Mover para baixo">▼</button>` : ''}
              <button type="button" class="dc-tool-btn" data-edit-artist="${escapeHtml(t.id)}" title="Editar Artista">✏️</button>
              <button type="button" class="dc-tool-btn" data-delete-artist="${escapeHtml(t.id)}" style="color: #ff7675; border-color: rgba(235, 87, 87, 0.4);" title="Eliminar Artista">🗑️</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Render Stage Notes
  const notesSig = stageNotes.map(n => `${n.id}:${n.text}:${n.timeStr || n.createdAt}`).join('|');
  if (notesSig !== lastNotesSig && $stageNotesList) {
    lastNotesSig = notesSig;
    if (stageNotes.length === 0) {
      $stageNotesList.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--dc-muted); font-size: 0.82rem; font-style: italic;">
          Sem notas de palco registadas para esta récita.<br>
          Adicione notas de camarim, avisos de adereços ou entradas de atores acima.
        </div>
      `;
    } else {
      $stageNotesList.innerHTML = stageNotes.map(n => {
        const timeStr = n.timeStr || (n.createdAt ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
        return `
          <div class="dc-note-item" data-note-id="${escapeHtml(n.id)}">
            <div style="flex: 1;">
              <div class="dc-note-text">${escapeHtml(n.text)}</div>
              <div class="dc-note-meta">${escapeHtml(n.author || 'DC')} • ${escapeHtml(timeStr)}</div>
            </div>
            <button type="button" class="dc-note-del-btn" data-delete-stage-note="${escapeHtml(n.id)}" title="Remover anotação">✕</button>
          </div>
        `;
      }).join('');
    }
  }
}

let lastChecklistSig = '__INIT__';

function renderChecklists() {
  const defaultDepts = ['Luz', 'Som', 'Maquinaria', 'Vídeo', 'Coxias'];
  let checklists = state?.theatre?.checklists;
  if (!checklists || typeof checklists !== 'object' || Object.keys(checklists).length === 0) {
    if (client && typeof client._createDefaultChecklists === 'function') {
      checklists = client._createDefaultChecklists();
      if (state?.theatre) state.theatre.checklists = checklists;
    } else {
      checklists = {};
    }
  }

  const depts = Array.from(new Set([...defaultDepts, ...Object.keys(checklists)]));

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

  if (!state.theatre || typeof state.theatre !== 'object') {
    if (client && typeof client._createDefaultTheatreState === 'function') {
      state.theatre = client._createDefaultTheatreState();
    } else {
      state.theatre = { showState: 'pre', phase: 'prep', cues: [], script: [], checklists: {}, stageNotes: [] };
    }
  }
  const th = state.theatre;

  // Show status UI
  if ($showStatusBadge && $showStatusText) {
    $showStatusBadge.className = `dc-show-status-pill ${th.showState || 'pre'}`;
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

  try { renderScript(); } catch (e) { console.error('Error in renderScript:', e); }
  try { renderCues(); } catch (e) { console.error('Error in renderCues:', e); }
  try { renderChecklists(); } catch (e) { console.error('Error in renderChecklists:', e); }
  try { renderTelemetry(); } catch (e) { console.error('Error in renderTelemetry:', e); }
  try { renderSavedReports(); } catch (e) { console.error('Error in renderSavedReports:', e); }
  try { renderPhase(th); } catch (e) { console.error('Error in renderPhase:', e); }
}

// ─── Click Delegation for Cues & Tasks ──────────────────────────────
document.addEventListener('click', (e) => {
  // Jump from script anchor to cue
  const jumpBtn = e.target.closest('[data-jump-cue]');
  if (jumpBtn) {
    const cueId = jumpBtn.dataset.jumpCue;
    if (cueId) {
      client.standbyCue(cueId);
      if (state?.theatre?.phase !== 'live') client.setTheatrePhase('live');
      if ($modalViewScript) $modalViewScript.style.display = 'none';
      const cueRow = $cuesList?.querySelector(`[data-cue-id="${cueId}"]`);
      if (cueRow) cueRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Click on cue row in list to focus / put in standby
  const cueRowEl = e.target.closest('.dc-cue-row-full');
  if (cueRowEl && !e.target.closest('button')) {
    const cueId = cueRowEl.dataset.cueId;
    if (cueId) {
      client.standbyCue(cueId);
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
    return;
  }

  // Delete stage note
  const delNoteBtn = e.target.closest('[data-delete-stage-note]');
  if (delNoteBtn) {
    const noteId = delNoteBtn.dataset.deleteStageNote;
    if (confirm('Eliminar esta anotação de palco?')) {
      client.deleteStageNote(noteId);
    }
    return;
  }

  // Move artist up / down
  const moveArtistBtn = e.target.closest('[data-move-artist]');
  if (moveArtistBtn) {
    const id = moveArtistBtn.dataset.id;
    const dir = moveArtistBtn.dataset.moveArtist;
    moveArtist(id, dir);
    return;
  }

  // Edit artist modal
  const editArtistBtn = e.target.closest('[data-edit-artist]');
  if (editArtistBtn) {
    const id = editArtistBtn.dataset.editArtist;
    openEditArtistModal(id);
    return;
  }

  // Delete artist / act
  const delArtistBtn = e.target.closest('[data-delete-artist]');
  if (delArtistBtn) {
    const id = delArtistBtn.dataset.deleteArtist;
    const item = state?.timers?.find(t => t.id === id);
    const label = item?.name || 'este artista/ato';
    if (confirm(`Eliminar "${label}" da lista de palco?`)) {
      client.deleteTimer(id);
    }
    return;
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
function handleAddChecklistTask() {
  const dept = $taskDeptSelect?.value || 'Luz';
  const rawLabel = ($taskLabelInput?.value || '').trim();
  const label = rawLabel || `Verificação de ${dept}`;
  const isOneOff = Boolean($taskOneOffCheck?.checked);
  client.addChecklistItem(dept, label, isOneOff);
  if ($taskLabelInput) $taskLabelInput.value = '';
  if ($taskOneOffCheck) $taskOneOffCheck.checked = false;
}

if ($taskAddBtn) {
  $taskAddBtn.addEventListener('click', handleAddChecklistTask);
}
if ($taskLabelInput) {
  $taskLabelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddChecklistTask();
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

// ─── Phase Switcher (Fase 1: Preparação vs Fase 2: Decorrer do Espetáculo) ───
function renderPhase(th) {
  const phase = th?.phase || 'prep';
  const $phaseBtnPrep = document.getElementById('dc-phase-btn-prep');
  const $phaseBtnLive = document.getElementById('dc-phase-btn-live');
  const $phasePrepBadge = document.getElementById('dc-phase-prep-badge');
  const $phaseLiveBadge = document.getElementById('dc-phase-live-badge');

  // Calculate readiness percentage across all 5 departments
  let totalTasks = 0;
  let doneTasks = 0;
  const checklists = th?.checklists || {};
  ['Luz', 'Som', 'Maquinaria', 'Vídeo', 'Coxias'].forEach(d => {
    const list = checklists[d] || [];
    totalTasks += list.length;
    doneTasks += list.filter(t => t.done).length;
  });
  const readinessPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  if ($phasePrepBadge) {
    $phasePrepBadge.textContent = `PRONTIDÃO ${readinessPct}%`;
  }
  if ($phaseLiveBadge) {
    $phaseLiveBadge.textContent = th?.showState === 'running' ? 'EM CENA / LIVE' : 'A POSTOS';
  }

  if (phase === 'live' || th?.showState === 'running') {
    $phaseBtnPrep?.classList.remove('active');
    $phaseBtnLive?.classList.add('active', 'live');
    if ($viewStage) $viewStage.style.display = 'none';
    if ($viewCues) $viewCues.style.display = 'block';
  } else {
    $phaseBtnPrep?.classList.add('active');
    $phaseBtnLive?.classList.remove('active', 'live');
    if ($viewStage) $viewStage.style.display = 'block';
    if ($viewCues) $viewCues.style.display = 'none';
  }

  renderStagePhase();
}

const $phaseBtnPrep = document.getElementById('dc-phase-btn-prep');
const $phaseBtnLive = document.getElementById('dc-phase-btn-live');
const $btnPrepGoLive = document.getElementById('dc-btn-prep-go-live');
const $btnPrepImportScript = document.getElementById('dc-btn-prep-import-script');

if ($phaseBtnPrep) {
  $phaseBtnPrep.addEventListener('click', () => {
    client.setTheatrePhase('prep');
  });
}
if ($phaseBtnLive) {
  $phaseBtnLive.addEventListener('click', () => {
    client.setTheatrePhase('live');
  });
}
if ($btnPrepGoLive) {
  $btnPrepGoLive.addEventListener('click', () => {
    client.setTheatrePhase('live');
  });
}

// Fase 1: Botão de Arranque de Espetáculo
if ($btnStartShowPrep) {
  $btnStartShowPrep.addEventListener('click', () => {
    client.startTheatreShow();
  });
}

// Fase 2: Botão para consultar trabalhos de palco
if ($btnReturnStage) {
  $btnReturnStage.addEventListener('click', () => {
    client.setTheatrePhase('prep');
  });
}

// Fase 2: Hero Undo Cue & Skip Cue
if ($btnUndoCue) {
  $btnUndoCue.addEventListener('click', () => {
    client.undoLastCue();
  });
}

if ($btnSkipCue) {
  $btnSkipCue.addEventListener('click', () => {
    client.skipNextCue();
  });
}

// Notas Rápidas de Palco
function handleAddStageNote() {
  const text = ($stageNoteInput?.value || '').trim();
  if (!text) {
    if ($stageNoteInput) $stageNoteInput.focus();
    return;
  }
  const note = client.addStageNote(text, 'DC');
  if ($stageNoteInput) $stageNoteInput.value = '';
  if (state?.theatre) {
    if (!Array.isArray(state.theatre.stageNotes)) state.theatre.stageNotes = [];
    if (note && !state.theatre.stageNotes.some(n => n.id === note.id)) {
      state.theatre.stageNotes.unshift(note);
    }
  }
  renderStagePhase();
}

if ($stageNoteAddBtn) {
  $stageNoteAddBtn.addEventListener('click', handleAddStageNote);
}
if ($stageNoteInput) {
  $stageNoteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddStageNote();
  });
}

// Adicionar Artista / Ato de Palco diretamente no Modo DC
function handleAddStageArtist() {
  const nextIdx = (state?.timers?.length || 0) + 1;
  const rawName = ($stageArtistNameInput?.value || '').trim();
  const durMins = parseFloat($stageArtistDurInput?.value || '20') || 20;
  const name = rawName || `Artista / Ato #${nextIdx}`;
  const created = client.createTimer({
    name: name,
    mode: 'countdown',
    duration: Math.round(durMins * 60 * 1000)
  });
  if ($stageArtistNameInput) $stageArtistNameInput.value = '';
  if ($stageArtistDurInput) $stageArtistDurInput.value = '';

  if (state && created) {
    if (!Array.isArray(state.timers)) state.timers = [];
    if (!state.timers.some(t => t.id === created.id)) {
      state.timers.push(created);
    }
    if (!state.activeTimerId) state.activeTimerId = created.id;
  }
  renderStagePhase();
}

if ($stageArtistAddBtn) {
  $stageArtistAddBtn.addEventListener('click', handleAddStageArtist);
}
if ($stageArtistNameInput) {
  $stageArtistNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddStageArtist();
  });
}
if ($stageArtistDurInput) {
  $stageArtistDurInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddStageArtist();
  });
}

// Toggle Script Modal & Telemetry Drawer
if ($btnToggleScriptModal) {
  $btnToggleScriptModal.addEventListener('click', () => {
    if ($modalViewScript) $modalViewScript.style.display = 'flex';
  });
}
if ($btnPrepViewScript) {
  $btnPrepViewScript.addEventListener('click', () => {
    if ($modalViewScript) $modalViewScript.style.display = 'flex';
  });
}

if ($btnToggleTelemetry) {
  $btnToggleTelemetry.addEventListener('click', () => {
    if ($telemetryDrawer) {
      const isHidden = $telemetryDrawer.style.display === 'none';
      $telemetryDrawer.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        $telemetryDrawer.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
}

// Stage Prep Card Buttons
if ($btnPrepAddCue) {
  $btnPrepAddCue.addEventListener('click', openNewCueModal);
}

if ($btnPrepImportCues && $modalImportCues) {
  $btnPrepImportCues.addEventListener('click', () => {
    $modalImportCues.style.display = 'flex';
  });
}

if ($btnPrepImportScript && $modalImportScript) {
  $btnPrepImportScript.addEventListener('click', () => {
    $modalImportScript.style.display = 'flex';
  });
}

// ─── Universal Importer: Guião / Texto (PDF, Word, Excel, Docs, TXT) ───
let stagedScriptLines = [];

const $scriptDropzone = document.getElementById('dc-script-dropzone');
const $scriptFileInput = document.getElementById('dc-script-file-input');
const $scriptPreviewContainer = document.getElementById('dc-script-preview-container');
const $scriptPreviewCount = document.getElementById('dc-script-preview-count');
const $scriptPreviewFileInfo = document.getElementById('dc-script-preview-file-info');
const $scriptPreviewBox = document.getElementById('dc-script-preview-box');

// Tab switcher in script import modal
document.querySelectorAll('.dc-import-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dc-import-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const targetId = btn.dataset.tabPanel;
    document.querySelectorAll('#dc-modal-import-script .dc-import-panel').forEach(p => p.style.display = 'none');
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) targetPanel.style.display = 'block';
  });
});

function renderScriptPreview(lines, fileInfo = '') {
  stagedScriptLines = lines;
  if ($scriptPreviewCount) $scriptPreviewCount.textContent = lines.length;
  if ($scriptPreviewFileInfo) $scriptPreviewFileInfo.textContent = fileInfo;
  if ($scriptPreviewContainer) $scriptPreviewContainer.style.display = lines.length > 0 ? 'block' : 'none';

  if ($scriptPreviewBox) {
    if (lines.length === 0) {
      $scriptPreviewBox.innerHTML = '<div style="color: var(--dc-muted); text-align: center; padding: 12px;">Nenhuma fala ou rubrica detetada.</div>';
      return;
    }
    const sample = lines.slice(0, 30);
    $scriptPreviewBox.innerHTML = sample.map(item => {
      const isDir = item.type === 'direction';
      return `
        <div style="margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${item.speaker ? `<span style="font-weight: 800; color: #ffeaa7; margin-right: 6px;">${escapeHtml(item.speaker)}:</span>` : (isDir ? '<span style="color: #a29bfe; font-style: italic; margin-right: 6px;">[CENA]</span>' : '')}
          <span>${escapeHtml(item.text)}</span>
        </div>
      `;
    }).join('') + (lines.length > 30 ? `<div style="text-align: center; color: var(--dc-muted); font-size: 0.72rem; margin-top: 6px;">... e mais ${lines.length - 30} falas/rubricas detetadas.</div>` : '');
  }
}

async function handleScriptFile(file) {
  if (!file) return;
  try {
    const titleEl = $scriptDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = '⏳ A processar ficheiro com TheatreImporter...';
    
    const text = await TheatreImporter.extractTextFromFile(file);
    const parsed = TheatreImporter.parseScriptText(text);
    if ($scriptImportTextarea) $scriptImportTextarea.value = text;
    renderScriptPreview(parsed, `${file.name} (${Math.round(file.size / 1024)} KB)`);
    if (titleEl) titleEl.textContent = `✓ ${file.name} carregado com sucesso`;
  } catch (err) {
    console.error('Error importing script file:', err);
    alert('Erro ao processar ficheiro: ' + (err.message || err));
    const titleEl = $scriptDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = 'Clique ou arraste um ficheiro com o guião';
  }
}

if ($scriptDropzone && $scriptFileInput) {
  $scriptDropzone.addEventListener('click', () => $scriptFileInput.click());
  $scriptFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleScriptFile(file);
  });

  $scriptDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    $scriptDropzone.classList.add('dragover');
  });
  $scriptDropzone.addEventListener('dragleave', () => $scriptDropzone.classList.remove('dragover'));
  $scriptDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    $scriptDropzone.classList.remove('dragover');
    const file = e.dataTransfer.files?.[0];
    if (file) handleScriptFile(file);
  });
}

if ($scriptImportTextarea) {
  $scriptImportTextarea.addEventListener('input', () => {
    const raw = $scriptImportTextarea.value.trim();
    if (raw) {
      const parsed = TheatreImporter.parseScriptText(raw);
      renderScriptPreview(parsed, 'Texto colado manualmente');
    } else {
      renderScriptPreview([], '');
    }
  });
}

if ($btnImportScript && $modalImportScript) {
  $btnImportScript.addEventListener('click', () => {
    $modalImportScript.style.display = 'flex';
  });
}

if ($scriptImportConfirm) {
  $scriptImportConfirm.addEventListener('click', () => {
    let lines = stagedScriptLines;
    if (!lines || lines.length === 0) {
      const raw = ($scriptImportTextarea?.value || '').trim();
      if (raw) lines = TheatreImporter.parseScriptText(raw);
    }

    if (!lines || lines.length === 0) {
      alert('Por favor selecione um ficheiro (PDF, Excel, Word, Docs, TXT) ou cole o texto do guião.');
      return;
    }

    const mode = document.querySelector('input[name="dc-script-import-mode"]:checked')?.value || 'replace';
    if (mode === 'append') {
      client.appendTheatreScript(lines);
    } else {
      client.updateTheatreScript(lines);
    }

    if ($modalImportScript) $modalImportScript.style.display = 'none';
    stagedScriptLines = [];
    if ($scriptImportTextarea) $scriptImportTextarea.value = '';
    if ($scriptPreviewContainer) $scriptPreviewContainer.style.display = 'none';
    if ($scriptFileInput) $scriptFileInput.value = '';
    const titleEl = $scriptDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = 'Clique ou arraste um ficheiro com o guião';
  });
}

// ─── Universal Importer: Deixas / Cues (Excel, PDF, Word, CSV) ────────
let stagedCues = [];

const $cuesDropzone = document.getElementById('dc-cues-dropzone');
const $cuesFileInput = document.getElementById('dc-cues-file-input');
const $cuesPreviewContainer = document.getElementById('dc-cues-preview-container');
const $cuesPreviewCount = document.getElementById('dc-cues-preview-count');
const $cuesPreviewFileInfo = document.getElementById('dc-cues-preview-file-info');
const $cuesPreviewBox = document.getElementById('dc-cues-preview-box');

// Tab switcher in cues import modal
document.querySelectorAll('.dc-import-cues-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dc-import-cues-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const targetId = btn.dataset.tabPanel;
    document.querySelectorAll('#dc-modal-import-cues .dc-import-panel').forEach(p => p.style.display = 'none');
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) targetPanel.style.display = 'block';
  });
});

function renderCuesPreview(cues, fileInfo = '') {
  stagedCues = cues;
  if ($cuesPreviewCount) $cuesPreviewCount.textContent = cues.length;
  if ($cuesPreviewFileInfo) $cuesPreviewFileInfo.textContent = fileInfo;
  if ($cuesPreviewContainer) $cuesPreviewContainer.style.display = cues.length > 0 ? 'block' : 'none';

  if ($cuesPreviewBox) {
    if (cues.length === 0) {
      $cuesPreviewBox.innerHTML = '<div style="color: var(--dc-muted); text-align: center; padding: 12px;">Nenhuma deixa identificada.</div>';
      return;
    }
    const sample = cues.slice(0, 25);
    $cuesPreviewBox.innerHTML = `
      <table class="dc-cues-preview-table">
        <thead>
          <tr>
            <th style="width: 60px;">#</th>
            <th>Nome / Ação</th>
            <th>Equipas</th>
            <th>Ponto / Fala</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          ${sample.map(c => `
            <tr>
              <td style="font-weight: 800; color: #ffeaa7;">${escapeHtml(c.num)}</td>
              <td style="font-weight: 700; color: #fff;">${escapeHtml(c.name)}</td>
              <td>${(c.departments || []).map(d => `<span class="dc-dept-tag ${String(d).toLowerCase()}">${escapeHtml(d)}</span>`).join(' ')}</td>
              <td style="color: #cbd5e1;">${escapeHtml(c.targetText || '--')}</td>
              <td style="color: var(--dc-muted); font-size: 0.72rem;">${escapeHtml(c.notes || '--')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${cues.length > 25 ? `<div style="text-align: center; color: var(--dc-muted); font-size: 0.72rem; padding: 6px;">... e mais ${cues.length - 25} deixas detetadas.</div>` : ''}
    `;
  }
}

async function handleCuesFile(file) {
  if (!file) return;
  try {
    const titleEl = $cuesDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = '⏳ A analisar folha de deixas com TheatreImporter...';
    
    const parsed = await TheatreImporter.parseCuesFromFile(file);
    renderCuesPreview(parsed, `${file.name} (${Math.round(file.size / 1024)} KB)`);
    if (titleEl) titleEl.textContent = `✓ ${file.name} analisado com sucesso`;
  } catch (err) {
    console.error('Error importing cues file:', err);
    alert('Erro ao analisar folha de deixas: ' + (err.message || err));
    const titleEl = $cuesDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = 'Clique ou arraste folha Excel, PDF ou Word com deixas';
  }
}

if ($cuesDropzone && $cuesFileInput) {
  $cuesDropzone.addEventListener('click', () => $cuesFileInput.click());
  $cuesFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleCuesFile(file);
  });

  $cuesDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    $cuesDropzone.classList.add('dragover');
  });
  $cuesDropzone.addEventListener('dragleave', () => $cuesDropzone.classList.remove('dragover'));
  $cuesDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    $cuesDropzone.classList.remove('dragover');
    const file = e.dataTransfer.files?.[0];
    if (file) handleCuesFile(file);
  });
}

if ($cuesImportTextarea) {
  $cuesImportTextarea.addEventListener('input', () => {
    const raw = $cuesImportTextarea.value.trim();
    if (raw) {
      const parsed = TheatreImporter.parseCuesFromText(raw);
      renderCuesPreview(parsed, 'Texto colado manualmente');
    } else {
      renderCuesPreview([], '');
    }
  });
}

if ($btnImportCues && $modalImportCues) {
  $btnImportCues.addEventListener('click', () => {
    $modalImportCues.style.display = 'flex';
  });
}

if ($cuesImportConfirm) {
  $cuesImportConfirm.addEventListener('click', () => {
    let cues = stagedCues;
    if (!cues || cues.length === 0) {
      const raw = ($cuesImportTextarea?.value || '').trim();
      if (raw) cues = TheatreImporter.parseCuesFromText(raw);
    }

    if (!cues || cues.length === 0) {
      alert('Por favor selecione um ficheiro Excel, PDF ou Word ou cole a lista de deixas.');
      return;
    }

    const mode = document.querySelector('input[name="dc-cues-import-mode"]:checked')?.value || 'replace';
    if (mode === 'append') {
      client.appendTheatreCues(cues);
    } else {
      client.updateTheatreCues(cues);
    }

    if ($modalImportCues) $modalImportCues.style.display = 'none';
    stagedCues = [];
    if ($cuesImportTextarea) $cuesImportTextarea.value = '';
    if ($cuesPreviewContainer) $cuesPreviewContainer.style.display = 'none';
    if ($cuesFileInput) $cuesFileInput.value = '';
    const titleEl = $cuesDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = 'Clique ou arraste folha Excel, PDF ou Word com deixas';
  });
}

// Modal New Cue
function openNewCueModal() {
  if (!$modalNewCue) return;
  $modalNewCue.style.display = 'flex';
  const cues = state?.theatre?.cues || [];
  const nextNum = cues.length + 1;
  if ($newCueNum) $newCueNum.value = `Q${nextNum}`;
  if ($newCueName) {
    $newCueName.value = '';
    $newCueName.focus();
  }
  if ($newCueTarget) $newCueTarget.value = '';
  if ($newCueNotes) $newCueNotes.value = '';
}

function handleCreateNewCue() {
  const cues = Array.isArray(state?.theatre?.cues) ? state.theatre.cues : [];
  const nextNum = cues.length + 1;
  const num = ($newCueNum?.value || '').trim() || `Q${nextNum}`;
  const rawName = ($newCueName?.value || '').trim();
  const name = rawName || `Deixa ${num}`;
  const target = ($newCueTarget?.value || '').trim();
  const notes = ($newCueNotes?.value || '').trim();

  const depts = [];
  document.querySelectorAll('input[name="dc-dept"]:checked').forEach(chk => {
    depts.push(chk.value);
  });

  client.createCue({
    num: num,
    name: name,
    targetText: target,
    departments: depts.length > 0 ? depts : ['Luz'],
    notes: notes,
    status: 'pending'
  });

  if ($modalNewCue) $modalNewCue.style.display = 'none';
}

if ($btnAddCue) {
  $btnAddCue.addEventListener('click', openNewCueModal);
}

if ($newCueConfirm) {
  $newCueConfirm.addEventListener('click', handleCreateNewCue);
}

if ($newCueName) {
  $newCueName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateNewCue();
  });
}

if ($newCueTarget) {
  $newCueTarget.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateNewCue();
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

// ─── Saved Reports Management (Persisted in Event) ──────────────────
let viewingReport = null;

function renderSavedReports() {
  const reports = state?.theatre?.reports || [];
  if ($savedReportsCount) $savedReportsCount.textContent = reports.length;

  if (!$savedReportsList) return;

  if (reports.length === 0) {
    $savedReportsList.innerHTML = `<div style="text-align: center; padding: 14px; font-size: 0.8rem; color: var(--dc-muted); background: rgba(255,255,255,0.02); border-radius: 8px;">Ainda não há relatórios gravados neste evento. Ao terminar um espetáculo ou clicar em "Guardar no Evento", os relatórios ficam arquivados aqui até serem eliminados.</div>`;
    return;
  }

  $savedReportsList.innerHTML = reports.map(r => `
    <div class="dc-saved-report-card" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 14px; gap: 10px; flex-wrap: wrap;">
      <div>
        <div style="font-weight: 800; font-size: 0.9rem; color: #ffeaa7;">${escapeHtml(r.title)}</div>
        <div style="font-size: 0.74rem; color: var(--dc-muted); margin-top: 3px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <span>⏱️ Duração: <strong style="color: #fff;">${escapeHtml(r.duration)}</strong></span>
          <span>⚡ Deixas: <strong style="color: #fff;">${r.cuesCount}</strong></span>
          <span>📅 ${escapeHtml(r.dateStr)}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button type="button" class="btn btn-sm btn-open-report" data-rep-id="${escapeHtml(r.id)}" style="background: rgba(108, 92, 231, 0.2); border: 1px solid var(--accent); color: #c4b5fd; font-size: 0.75rem; padding: 4px 9px; border-radius: 6px; cursor: pointer; font-weight: 700;">👁️ Ver</button>
        <button type="button" class="btn btn-sm btn-download-saved-rep" data-rep-id="${escapeHtml(r.id)}" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; font-size: 0.75rem; padding: 4px 9px; border-radius: 6px; cursor: pointer;">📥 TXT</button>
        <button type="button" class="btn btn-sm btn-delete-saved-rep" data-rep-id="${escapeHtml(r.id)}" style="background: rgba(235, 77, 75, 0.2); border: 1px solid #eb4d4b; color: #ff7675; font-size: 0.75rem; padding: 4px 9px; border-radius: 6px; cursor: pointer;" title="Eliminar este relatório do evento">🗑️</button>
      </div>
    </div>
  `).join('');
}

if ($btnSaveReport) {
  $btnSaveReport.addEventListener('click', () => {
    const report = buildReportText();
    const dur = $telemetryDuration?.textContent || '00:00:00';
    const fCount = state?.theatre?.telemetry?.length || 0;
    client.saveTheatreReport({
      text: report,
      duration: dur,
      cuesCount: fCount
    });
    $btnSaveReport.textContent = '✓ Gravado no Evento!';
    setTimeout(() => { $btnSaveReport.textContent = '💾 Guardar no Evento'; }, 2500);
  });
}

// Delegation for saved reports list actions
document.addEventListener('click', (e) => {
  const openBtn = e.target.closest('.btn-open-report');
  if (openBtn) {
    const repId = openBtn.dataset.repId;
    const reports = state?.theatre?.reports || [];
    const rep = reports.find(r => r.id === repId);
    if (rep) {
      viewingReport = rep;
      if ($modalViewReportTitle) $modalViewReportTitle.textContent = `📜 ${rep.title}`;
      if ($modalViewReportBody) $modalViewReportBody.textContent = rep.text;
      if ($modalViewReport) $modalViewReport.style.display = 'flex';
    }
    return;
  }

  const dlBtn = e.target.closest('.btn-download-saved-rep');
  if (dlBtn) {
    const repId = dlBtn.dataset.repId;
    const reports = state?.theatre?.reports || [];
    const rep = reports.find(r => r.id === repId);
    if (rep) {
      const blob = new Blob([rep.text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Relatorio_${(state?.name || roomId).replace(/\s+/g, '_')}_${rep.id}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return;
  }

  const delBtn = e.target.closest('.btn-delete-saved-rep');
  if (delBtn) {
    const repId = delBtn.dataset.repId;
    if (confirm('Tem a certeza de que deseja eliminar este relatório guardado do evento?')) {
      client.deleteTheatreReport(repId);
    }
    return;
  }
});

// Modal View Report buttons
if ($modalViewReportClose) {
  $modalViewReportClose.addEventListener('click', () => {
    if ($modalViewReport) $modalViewReport.style.display = 'none';
  });
}

if ($modalViewReportCopy) {
  $modalViewReportCopy.addEventListener('click', () => {
    if (!viewingReport || !viewingReport.text) return;
    navigator.clipboard.writeText(viewingReport.text).then(() => {
      $modalViewReportCopy.textContent = '✓ Copiado!';
      setTimeout(() => { $modalViewReportCopy.textContent = '📋 Copiar Texto'; }, 2000);
    });
  });
}

if ($modalViewReportDownload) {
  $modalViewReportDownload.addEventListener('click', () => {
    if (!viewingReport || !viewingReport.text) return;
    const blob = new Blob([viewingReport.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Relatorio_${(state?.name || roomId).replace(/\s+/g, '_')}_${viewingReport.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ─── Modal Edit Artist / Ato ─────────────────────────────────────────
function openEditArtistModal(artistId) {
  const artist = state?.timers?.find(t => t.id === artistId);
  if (!artist || !$modalEditArtist) return;

  if ($editArtistId) $editArtistId.value = artist.id;
  if ($editArtistName) $editArtistName.value = artist.name || '';
  const mins = Math.round((artist.duration || 0) / 60000);
  if ($editArtistDur) $editArtistDur.value = mins > 0 ? mins : 15;
  if ($editArtistStart) $editArtistStart.value = artist.startTime || '';
  if ($editArtistNotes) $editArtistNotes.value = artist.notes || '';

  $modalEditArtist.style.display = 'flex';
  if ($editArtistName) $editArtistName.focus();
}

if ($editArtistConfirm) {
  $editArtistConfirm.addEventListener('click', () => {
    const artistId = $editArtistId?.value;
    if (!artistId) return;

    const name = ($editArtistName?.value || '').trim();
    const durMins = parseFloat($editArtistDur?.value || '15') || 15;
    const startTime = ($editArtistStart?.value || '').trim();
    const notes = ($editArtistNotes?.value || '').trim();

    if (!name) {
      alert('Por favor introduza o nome do artista ou ato.');
      return;
    }

    client.updateTimer(artistId, {
      name: name,
      duration: Math.round(durMins * 60000),
      startTime: startTime,
      notes: notes
    });

    $modalEditArtist.style.display = 'none';
  });
}

if ($editArtistDeleteBtn) {
  $editArtistDeleteBtn.addEventListener('click', () => {
    const artistId = $editArtistId?.value;
    if (!artistId) return;
    const artist = state?.timers?.find(t => t.id === artistId);
    const label = artist?.name || 'este artista/ato';
    if (confirm(`Eliminar permanentemente "${label}"?`)) {
      client.deleteTimer(artistId);
      $modalEditArtist.style.display = 'none';
    }
  });
}

function moveArtist(artistId, direction) {
  const timers = state?.timers || [];
  const idx = timers.findIndex(t => t.id === artistId);
  if (idx < 0) return;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= timers.length) return;

  const newOrder = timers.map(t => t.id);
  const temp = newOrder[idx];
  newOrder[idx] = newOrder[targetIdx];
  newOrder[targetIdx] = temp;

  client.reorderTimers(newOrder);
}

// ─── Stage Artist Header Buttons ─────────────────────────────────────
if ($btnStageAddArtist) {
  $btnStageAddArtist.addEventListener('click', () => {
    const nextIdx = (state?.timers?.length || 0) + 1;
    const inputVal = ($stageArtistNameInput?.value || '').trim();
    const durVal = parseFloat($stageArtistDurInput?.value || '20') || 20;
    const nameToUse = inputVal || `Artista / Ato #${nextIdx}`;
    const created = client.createTimer({
      name: nameToUse,
      mode: 'countdown',
      duration: Math.round(durVal * 60 * 1000)
    });
    if ($stageArtistNameInput) $stageArtistNameInput.value = '';
    if ($stageArtistDurInput) $stageArtistDurInput.value = '';

    if (state && created) {
      if (!Array.isArray(state.timers)) state.timers = [];
      if (!state.timers.some(t => t.id === created.id)) {
        state.timers.push(created);
      }
      if (!state.activeTimerId) state.activeTimerId = created.id;
    }
    renderStagePhase();
  });
}

if ($btnStageImportSchedule && $modalImportSchedule) {
  $btnStageImportSchedule.addEventListener('click', () => {
    $modalImportSchedule.style.display = 'flex';
  });
}

if ($btnStageClearSchedule) {
  $btnStageClearSchedule.addEventListener('click', () => {
    const total = state?.timers?.length || 0;
    if (total === 0) {
      alert('O alinhamento já está vazio.');
      return;
    }
    if (confirm(`Atenção: Deseja eliminar TODOS os ${total} artistas/atos do alinhamento de palco?\nEsta ação limpará permanentemente a lista desta sala.`)) {
      client.clearAllTimers();
    }
  });
}

// ─── Demo Data: Carregar Exemplo de Peça ──────────────────────────────
function loadDemoTheatreData() {
  if (confirm('Carregar exemplo de peça de teatro com alinhamento de atos e deixas de teste?')) {
    client.clearAllTimers();
    const demoTimers = [
      { name: 'Abertura de Sala & Chegada de Público', duration: 15 * 60000, startTime: '21:00', notes: 'Música ambiente e sala a 80%' },
      { name: 'Ato 1: O Começo da Peça', duration: 35 * 60000, startTime: '21:15', notes: 'Entrada de 3 atores em cena' },
      { name: 'Intervalo de Palco', duration: 15 * 60000, startTime: '21:50', notes: 'Mudança de cenário e adereços' },
      { name: 'Ato 2: O Desfecho & Agradecimentos', duration: 40 * 60000, startTime: '22:05', notes: 'Cena final e aplausos' }
    ];
    demoTimers.forEach(t => client.createTimer({ ...t, mode: 'countdown' }));

    const demoCues = [
      { id: 'cue_1', num: 'Q1', name: 'Abertura de Sala', departments: ['Luz', 'Som'], targetText: 'No 3º sinal da sala', notes: 'Sala a 80%, trilha suave', status: 'pending' },
      { id: 'cue_2', num: 'Q2', name: 'Blackout & Cortina', departments: ['Luz', 'Maquinaria'], targetText: 'Silêncio na sala', notes: 'Fade 3s, abrir cortina de boca', status: 'pending' },
      { id: 'cue_3', num: 'Q3', name: 'Foco Ator Principal', departments: ['Luz'], targetText: 'Na fala "aqui estamos nós"', notes: 'Foco quente centro', status: 'pending' },
      { id: 'cue_4', num: 'Q4', name: 'Apoteose Final & Pano', departments: ['Luz', 'Som', 'Maquinaria'], targetText: 'Última fala do espetáculo', notes: 'Luz geral, música de fecho e baixar cortina', status: 'pending' }
    ];
    client.updateTheatreCues(demoCues);
  }
}

// ─── Universal Importer: Alinhamento de Palco (Excel, PDF, CSV, TXT) ──
let stagedScheduleTimers = [];

// Tab switcher in schedule import modal
document.querySelectorAll('.dc-import-sched-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dc-import-sched-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const targetId = btn.dataset.tabPanel;
    document.querySelectorAll('#dc-modal-import-schedule .dc-import-panel').forEach(p => p.style.display = 'none');
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) targetPanel.style.display = 'block';
  });
});

function renderSchedulePreview(timers, fileInfo = '') {
  stagedScheduleTimers = timers;
  if ($schedPreviewCount) $schedPreviewCount.textContent = timers.length;
  if ($schedPreviewFileInfo) $schedPreviewFileInfo.textContent = fileInfo;
  if ($schedPreviewContainer) $schedPreviewContainer.style.display = timers.length > 0 ? 'block' : 'none';

  if ($schedPreviewBox) {
    if (timers.length === 0) {
      $schedPreviewBox.innerHTML = '<div style="color: var(--dc-muted); text-align: center; padding: 12px;">Nenhum artista ou horário válido detetado.</div>';
      return;
    }
    $schedPreviewBox.innerHTML = timers.map(t => {
      const durMins = Math.round((t.duration || 0) / 60000);
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.82rem;">
          <div>
            <strong style="color: #fff;">${escapeHtml(t.name)}</strong>
            ${t.notes ? `<span style="color: var(--dc-muted); margin-left: 6px;">(${escapeHtml(t.notes)})</span>` : ''}
          </div>
          <div style="font-family: var(--font-mono); color: #ffeaa7;">
            ${t.startTime ? escapeHtml(t.startTime) + ' • ' : ''}${durMins} min
          </div>
        </div>
      `;
    }).join('');
  }
}

async function handleScheduleFile(file) {
  if (!file) return;
  try {
    const titleEl = $schedDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = '⏳ A processar ficheiro de horários...';

    let text = '';
    if (typeof TheatreImporter !== 'undefined' && typeof TheatreImporter.extractTextFromFile === 'function') {
      text = await TheatreImporter.extractTextFromFile(file);
    }

    let parsedTimers = [];
    if (typeof ScheduleImporter !== 'undefined' && typeof ScheduleImporter.parseTextToTimers === 'function') {
      parsedTimers = ScheduleImporter.parseTextToTimers(text);
    }

    if (!parsedTimers || parsedTimers.length === 0) {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      parsedTimers = lines.map(line => {
        const timeMatch = line.match(/(\d{1,2}[:.h]\d{2})/i);
        const durMatch = line.match(/(\d{1,3})\s*(?:m|min|minutos)/i);
        const nameClean = line.replace(/(\d{1,2}[:.h]\d{2})/g, '').replace(/(\d{1,3})\s*(?:m|min|minutos)/gi, '').replace(/^[-—–|;>]\s*/, '').replace(/\s*[-—–|;>]\s*$/, '').trim();
        return {
          name: nameClean || line,
          startTime: timeMatch ? timeMatch[1].replace('h', ':').replace('.', ':') : '',
          duration: durMatch ? parseInt(durMatch[1], 10) * 60000 : 20 * 60000,
          mode: 'countdown'
        };
      });
    }

    if ($schedImportTextarea) $schedImportTextarea.value = text;
    renderSchedulePreview(parsedTimers, `${file.name} (${Math.round(file.size / 1024)} KB)`);
    if (titleEl) titleEl.textContent = `✓ ${file.name} carregado com sucesso`;
  } catch (err) {
    console.error('Error importing schedule file:', err);
    alert('Erro ao processar ficheiro de horários: ' + (err.message || err));
    const titleEl = $schedDropzone?.querySelector('.dc-import-dropzone-title');
    if (titleEl) titleEl.textContent = 'Clique ou arraste um ficheiro com o alinhamento de palco';
  }
}

if ($schedDropzone && $schedFileInput) {
  $schedDropzone.addEventListener('click', () => $schedFileInput.click());
  $schedFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleScheduleFile(file);
  });

  $schedDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    $schedDropzone.classList.add('dragover');
  });
  $schedDropzone.addEventListener('dragleave', () => $schedDropzone.classList.remove('dragover'));
  $schedDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    $schedDropzone.classList.remove('dragover');
    const file = e.dataTransfer.files?.[0];
    if (file) handleScheduleFile(file);
  });
}

if ($schedImportTextarea) {
  $schedImportTextarea.addEventListener('input', () => {
    const val = $schedImportTextarea.value || '';
    if (!val.trim()) {
      renderSchedulePreview([]);
      return;
    }
    let parsed = [];
    if (typeof ScheduleImporter !== 'undefined' && typeof ScheduleImporter.parseTextToTimers === 'function') {
      parsed = ScheduleImporter.parseTextToTimers(val);
    }
    if (!parsed || parsed.length === 0) {
      const lines = val.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      parsed = lines.map(line => {
        const timeMatch = line.match(/(\d{1,2}[:.h]\d{2})/i);
        const durMatch = line.match(/(\d{1,3})\s*(?:m|min|minutos)/i);
        const nameClean = line.replace(/(\d{1,2}[:.h]\d{2})/g, '').replace(/(\d{1,3})\s*(?:m|min|minutos)/gi, '').replace(/^[-—–|;>]\s*/, '').trim();
        return {
          name: nameClean || line,
          startTime: timeMatch ? timeMatch[1].replace('h', ':').replace('.', ':') : '',
          duration: durMatch ? parseInt(durMatch[1], 10) * 60000 : 20 * 60000,
          mode: 'countdown'
        };
      });
    }
    renderSchedulePreview(parsed, 'Texto colado');
  });
}

if ($schedImportConfirm) {
  $schedImportConfirm.addEventListener('click', () => {
    if (!stagedScheduleTimers || stagedScheduleTimers.length === 0) {
      alert('Nenhum artista detetado para importar.');
      return;
    }

    const modeRadio = document.querySelector('input[name="dc-sched-import-mode"]:checked');
    const mode = modeRadio?.value || 'replace';

    if (mode === 'replace') {
      client.clearAllTimers();
    }

    stagedScheduleTimers.forEach(t => {
      client.createTimer({
        name: t.name,
        duration: t.duration || 20 * 60000,
        startTime: t.startTime || '',
        notes: t.notes || '',
        mode: 'countdown'
      });
    });

    $modalImportSchedule.style.display = 'none';
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
  if (!newState) return;
  state = newState;
  if (!state.theatre || typeof state.theatre !== 'object') {
    if (client && typeof client._createDefaultTheatreState === 'function') {
      state.theatre = client._createDefaultTheatreState();
    } else {
      state.theatre = { showState: 'pre', phase: 'prep', cues: [], script: [], checklists: {}, stageNotes: [] };
    }
  }
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
