// ─── StageTimer — Guião Original da DC (Leitor Fiel PDF / Word / Notas) ─────────
// Mostra o guião EXATAMENTE como foi escrito (sem extrair texto, sem desformatar):
//  • PDF  → renderizado página a página com pdf.js (vetorial, nítido em qualquer zoom)
//  • Word → renderizado com docx-preview (páginas, fontes, alinhamentos, negritos)
//  • Notas / texto colado → preserva espaços, quebras, negrito/itálico/cores
//  • Imagens (fotos das páginas) → uma página por imagem
// Extras: modos Contínuo / Página / Livro, auto-rolagem teleprompter, linha de leitura,
// temas Noite / Luz Vermelha, marcação de deixas no papel (pins) que seguem o espetáculo,
// auto-marcação de deixas a partir do texto do PDF, pesquisa, miniaturas, GO/STANDBY no leitor.
// Armazenamento: IndexedDB local do dispositivo (não altera o state sincronizado).
(function () {
  'use strict';

  const DB_NAME = 'stagetimer_dc_scores';
  const DB_VERSION = 1;
  const PREFS_KEY = 'stagetimer_dc_score_prefs';
  const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const JSZIP_SRC = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const DOCX_SRC = 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.2/dist/docx-preview.min.js';

  // ─── Utils ──────────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const uid = () => 'pin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function getRoom() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof roomId !== 'undefined' && roomId) return String(roomId).toUpperCase();
    } catch (_) {}
    try { return (sessionStorage.getItem('stagetimer_active_room') || localStorage.getItem('stagetimer_device_room') || 'PALCO1').toUpperCase(); } catch (_) { return 'PALCO1'; }
  }
  function getClient() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof client !== 'undefined' && client) return client;
    } catch (_) {}
    return null;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-dcsr-src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.dataset.dcsrSrc = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Falha a carregar ' + src));
      document.head.appendChild(s);
    });
  }

  // ─── IndexedDB ──────────────────────────────────────────────────────
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB indisponível')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function idb(store, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const st = tx.objectStore(store);
      const req = fn(st);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const dbGet = (store, key) => idb(store, 'readonly', st => st.get(key));
  const dbPut = (store, key, val) => idb(store, 'readwrite', st => st.put(val, key));
  const dbDel = (store, key) => idb(store, 'readwrite', st => st.delete(key));

  // ─── Preferences ────────────────────────────────────────────────────
  const DEFAULT_PREFS = {
    mode: 'scroll',      // scroll | page | book
    zoom: 1,             // 1 = ajustar à largura (scroll) / à página (page/book)
    theme: 'paper',      // paper | sepia | night | red
    brightness: 1,
    guide: true,
    guideY: 0.33,
    follow: true,
    speed: 40,           // px/s
    drawer: false
  };
  let prefs = { ...DEFAULT_PREFS };
  try { prefs = { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) }; } catch (_) {}
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {} }

  // ─── Runtime State ──────────────────────────────────────────────────
  let built = false;
  let isOpen = false;
  let currentRoom = null;
  let doc = null;          // registo IDB { type, name, size, importedAt, data }
  let meta = { pins: [], lastPage: 0 };
  let pages = [];          // { idx, kind:'pdf'|'img'|'dom', w, h, el, content, canvas, renderedScale, rendering, node, url }
  let pdfDoc = null;
  let pdfText = null;      // cache de texto por página (pesquisa / auto-marcação)
  let currentPage = 0;
  let theatreState = null;
  let lastFollowKey = '';
  let markMode = false;
  let pendingPlaceCueId = null;
  let autoScroll = false;
  let autoRaf = null;
  let autoLastTs = 0;
  let holdPause = false;
  let wakeLock = null;
  let io = null;
  let urlsToRevoke = [];
  let metaSaveTimer = null;

  // DOM refs
  let ov, stage, pagesEl, guideEl, pageInput, pageTotal, titleEl, drawer, hud, emptyEl, loadingEl, popEl, importEl, settingsEl, toastEl;

  // ─── Build UI ───────────────────────────────────────────────────────
  function icon(name) { return (window.stIcon ? window.stIcon(name) : ''); }

  function build() {
    if (built) return;
    built = true;
    ov = document.createElement('div');
    ov.id = 'dcsr-overlay';
    ov.className = 'dcsr-overlay';
    ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = `
      <header class="dcsr-top">
        <button type="button" class="dcsr-btn dcsr-close" data-act="close" title="Fechar ou Voltar (Esc)">✕</button>
        <button type="button" class="dcsr-btn" data-act="expand" title="Alternar Ecrã Inteiro">⛶</button>
        <div class="dcsr-title-wrap">
          <div class="dcsr-kicker">📜 GUIÃO ORIGINAL</div>
          <div class="dcsr-title" id="dcsr-title">Sem guião carregado</div>
        </div>
        <div class="dcsr-pager">
          <button type="button" class="dcsr-btn" data-act="prev" title="Página anterior (← / PageUp)">‹</button>
          <span class="dcsr-page-ind">Pág. <input id="dcsr-page-input" type="number" min="1" value="1" inputmode="numeric"> / <b id="dcsr-page-total">0</b></span>
          <button type="button" class="dcsr-btn" data-act="next" title="Página seguinte (→ / PageDown)">›</button>
        </div>
        <div class="dcsr-seg" role="group" aria-label="Modo de leitura">
          <button type="button" data-mode="scroll" title="Rolagem contínua">⇕ Contínuo</button>
          <button type="button" data-mode="page" title="Uma página de cada vez">▭ Página</button>
          <button type="button" data-mode="book" title="Duas páginas lado a lado">▭▭ Livro</button>
        </div>
        <div class="dcsr-top-actions">
          <button type="button" class="dcsr-btn" data-act="mark" title="Marcar deixas no papel (M)">📍<span class="dcsr-lbl"> Marcar</span></button>
          <button type="button" class="dcsr-btn" data-act="drawer" title="Páginas, deixas e pesquisa">☰<span class="dcsr-lbl"> Painel</span></button>
          <button type="button" class="dcsr-btn" data-act="settings" title="Visualização">⚙<span class="dcsr-lbl"> Vista</span></button>
          <button type="button" class="dcsr-btn dcsr-btn-gold" data-act="import" title="Importar guião">⤓<span class="dcsr-lbl"> Importar</span></button>
        </div>
      </header>

      <div class="dcsr-body">
        <aside class="dcsr-drawer" id="dcsr-drawer">
          <div class="dcsr-tabs">
            <button type="button" class="active" data-tab="thumbs">Páginas</button>
            <button type="button" data-tab="cues">Deixas</button>
            <button type="button" data-tab="search">Pesquisa</button>
          </div>
          <div class="dcsr-tab-panel active" data-panel="thumbs"><div id="dcsr-thumbs" class="dcsr-thumbs"></div></div>
          <div class="dcsr-tab-panel" data-panel="cues">
            <div class="dcsr-cues-tools">
              <button type="button" class="dcsr-btn dcsr-btn-gold dcsr-btn-block" data-act="automark">⚡ Auto-marcar deixas pelo texto</button>
              <div class="dcsr-hint">Toque numa deixa sem marca e depois toque no guião onde ela acontece.</div>
            </div>
            <div id="dcsr-cue-list" class="dcsr-cue-list"></div>
          </div>
          <div class="dcsr-tab-panel" data-panel="search">
            <div class="dcsr-search-row"><input id="dcsr-search-input" type="search" placeholder="Procurar no guião (ex.: nome da personagem)" autocomplete="off"></div>
            <div id="dcsr-search-results" class="dcsr-search-results"></div>
          </div>
        </aside>

        <main class="dcsr-stage" id="dcsr-stage">
          <div class="dcsr-pages" id="dcsr-pages"></div>
          <div class="dcsr-empty" id="dcsr-empty">
            <div class="dcsr-empty-card">
              <div class="dcsr-empty-ico">📜</div>
              <h2>Carregue o guião original</h2>
              <p>O texto é mostrado <b>exatamente como foi escrito</b> — página a página, com a formatação intacta.</p>
              <div class="dcsr-empty-formats"><span>PDF</span><span>Word .docx</span><span>Notas / texto colado</span><span>Fotos das páginas</span></div>
              <button type="button" class="dcsr-btn dcsr-btn-gold dcsr-btn-xl" data-act="import">⤓ Importar Guião</button>
              <p class="dcsr-tip">Dica: para fidelidade 100% exporte o guião em <b>PDF</b>. Tudo fica guardado neste dispositivo e funciona offline.</p>
            </div>
          </div>
          <div class="dcsr-loading" id="dcsr-loading"><div class="dcsr-spinner"></div><div id="dcsr-loading-text">A preparar o guião…</div></div>
        </main>
        <div class="dcsr-guide" id="dcsr-guide" title="Arraste para ajustar a linha de leitura"><span>LEITURA</span></div>
      </div>

      <footer class="dcsr-hud" id="dcsr-hud">
        <div class="dcsr-auto">
          <button type="button" class="dcsr-btn dcsr-auto-btn" data-act="auto" title="Auto-rolagem (P)">▶ Rolar</button>
          <button type="button" class="dcsr-btn" data-act="slower" title="Mais lento ([)">−</button>
          <span class="dcsr-speed" id="dcsr-speed">40</span>
          <button type="button" class="dcsr-btn" data-act="faster" title="Mais rápido (])">+</button>
        </div>
        <div class="dcsr-cue-info" id="dcsr-cue-info">
          <div class="dcsr-cue-line"><span class="dcsr-tag">PRÓXIMA</span><b id="dcsr-cue-next">—</b></div>
          <div class="dcsr-cue-sub" id="dcsr-cue-last"></div>
        </div>
        <div class="dcsr-cue-actions">
          <button type="button" class="dcsr-btn dcsr-standby" data-act="standby" title="Standby da próxima deixa (S)">STANDBY (S)</button>
          <button type="button" class="dcsr-btn dcsr-go" data-act="go" title="GO (Espaço)">GO (Espaço)</button>
        </div>
      </footer>

      <div class="dcsr-pop" id="dcsr-pop"></div>
      <div class="dcsr-settings" id="dcsr-settings"></div>
      <div class="dcsr-import" id="dcsr-import"></div>
      <div class="dcsr-toast" id="dcsr-toast"></div>
    `;
    document.body.appendChild(ov);

    stage = $('#dcsr-stage', ov);
    pagesEl = $('#dcsr-pages', ov);
    guideEl = $('#dcsr-guide', ov);
    pageInput = $('#dcsr-page-input', ov);
    pageTotal = $('#dcsr-page-total', ov);
    titleEl = $('#dcsr-title', ov);
    drawer = $('#dcsr-drawer', ov);
    hud = $('#dcsr-hud', ov);
    emptyEl = $('#dcsr-empty', ov);
    loadingEl = $('#dcsr-loading', ov);
    popEl = $('#dcsr-pop', ov);
    importEl = $('#dcsr-import', ov);
    settingsEl = $('#dcsr-settings', ov);
    toastEl = $('#dcsr-toast', ov);

    bindUI();
    applyPrefsUI();
  }

  // ─── UI Bindings ────────────────────────────────────────────────────
  function bindUI() {
    // Botões não roubam o foco (Espaço continua a ser GO global da DC)
    ov.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    ov.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      if (modeBtn && ov.contains(modeBtn)) { setMode(modeBtn.dataset.mode); return; }
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
      const thumb = e.target.closest('[data-thumb]');
      if (thumb) { goToPage(parseInt(thumb.dataset.thumb, 10), true); if (window.innerWidth < 900) toggleDrawer(false); return; }
      const cueItem = e.target.closest('[data-cue-item]');
      if (cueItem) { onCueListClick(cueItem.dataset.cueItem); return; }
      const sres = e.target.closest('[data-sres]');
      if (sres) { onSearchResultClick(sres); return; }
      const pinEl = e.target.closest('.dcsr-pin');
      if (pinEl && !pinEl.dataset.dragged) { e.stopPropagation(); openPinPop(pinEl.dataset.pin, pinEl); return; }

      const actEl = e.target.closest('[data-act]');
      if (actEl) { handleAct(actEl.dataset.act, actEl, e); return; }

      // Clique no papel
      const pageEl = e.target.closest('.dcsr-page');
      if (pageEl && (markMode || pendingPlaceCueId)) { onPagePlace(pageEl, e); return; }
      if (!e.target.closest('.dcsr-pop')) closePop();
      if (!e.target.closest('.dcsr-settings')) closeSettings();

      // Zonas de toque laterais no modo página
      if (pageEl && prefs.mode !== 'scroll' && !markMode) {
        const r = stage.getBoundingClientRect();
        const rx = (e.clientX - r.left) / r.width;
        if (rx < 0.22) prevPage();
        else if (rx > 0.78) nextPage();
      }
    });

    pageInput.addEventListener('change', () => {
      const n = parseInt(pageInput.value, 10);
      if (!isNaN(n)) goToPage(n - 1, true);
      pageInput.blur();
    });
    pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pageInput.blur(); e.stopPropagation(); });

    const searchInput = $('#dcsr-search-input', ov);
    let sTimer = null;
    searchInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(() => runSearch(searchInput.value), 280); });
    searchInput.addEventListener('keydown', (e) => e.stopPropagation());

    stage.addEventListener('scroll', onStageScroll, { passive: true });
    stage.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(prefs.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      }
    }, { passive: false });

    // Segurar para pausar auto-rolagem + pinça para zoom + swipe no modo página
    const pointers = new Map();
    let pinchStart = null;
    let swipeStart = null;
    stage.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (autoScroll && !e.target.closest('button')) holdPause = true;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: prefs.zoom };
      } else if (pointers.size === 1) {
        swipeStart = { x: e.clientX, y: e.clientY, t: Date.now() };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchStart && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const ratio = Math.hypot(a.x - b.x, a.y - b.y) / (pinchStart.d || 1);
        pagesEl.style.transformOrigin = 'center top';
        pagesEl.style.transform = `scale(${clamp(ratio, 0.4, 4)})`;
      }
    });
    const endPointer = (e) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pinchStart && pointers.size < 2) {
        const tr = pagesEl.style.transform.match(/scale\(([\d.]+)\)/);
        const ratio = tr ? parseFloat(tr[1]) : 1;
        pagesEl.style.transform = '';
        setZoom(pinchStart.zoom * ratio);
        pinchStart = null;
        swipeStart = null;
      } else if (swipeStart && p && pointers.size === 0 && prefs.mode !== 'scroll' && !markMode) {
        const dx = p.x - swipeStart.x, dy = p.y - swipeStart.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - swipeStart.t < 600 && stage.scrollWidth <= stage.clientWidth + 2) {
          if (dx < 0) nextPage(); else prevPage();
        }
        swipeStart = null;
      }
      if (pointers.size === 0) holdPause = false;
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') holdPause = false; });

    // Arrastar a linha de leitura
    let guideDrag = false;
    guideEl.addEventListener('pointerdown', (e) => { guideDrag = true; guideEl.setPointerCapture(e.pointerId); e.preventDefault(); });
    guideEl.addEventListener('pointermove', (e) => {
      if (!guideDrag) return;
      const r = stage.getBoundingClientRect();
      prefs.guideY = clamp((e.clientY - r.top) / r.height, 0.08, 0.9);
      positionGuide();
    });
    guideEl.addEventListener('pointerup', () => { if (guideDrag) { guideDrag = false; savePrefs(); } });

    // Teclado (fase de captura para ganhar prioridade sobre o resto da DC)
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', () => { if (isOpen) relayout(); });
    document.addEventListener('visibilitychange', () => { if (isOpen && document.visibilityState === 'visible') requestWakeLock(); });

    // Drag & drop de ficheiros diretamente no leitor
    ov.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); ov.classList.add('dcsr-dragging'); } });
    ov.addEventListener('dragleave', (e) => { if (e.target === ov || !ov.contains(e.relatedTarget)) ov.classList.remove('dcsr-dragging'); });
    ov.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      ov.classList.remove('dcsr-dragging');
      importFiles([...e.dataTransfer.files]);
    });
  }

  function onKey(e) {
    if (!isOpen) return;
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (importEl.classList.contains('open')) { closeImport(); return; }
      if (popEl.classList.contains('open')) { closePop(); return; }
      if (settingsEl.classList.contains('open')) { closeSettings(); return; }
      if (markMode || pendingPlaceCueId) { setMarkMode(false); return; }
      close();
      return;
    }
    if (typing) return;
    // Com janelas abertas por cima do guião, o Espaço não dispara GO por engano
    if ((e.code === 'Space' || e.key === ' ') && (importEl.classList.contains('open') || popEl.classList.contains('open') || settingsEl.classList.contains('open'))) {
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': nextPage(); break;
      case 'ArrowLeft': case 'PageUp': prevPage(); break;
      case 'ArrowDown': if (prefs.mode === 'scroll') stage.scrollBy({ top: 80, behavior: 'smooth' }); else nextPage(); break;
      case 'ArrowUp': if (prefs.mode === 'scroll') stage.scrollBy({ top: -80, behavior: 'smooth' }); else prevPage(); break;
      case 'Home': goToPage(0, true); break;
      case 'End': goToPage(pages.length - 1, true); break;
      case 'p': case 'P': toggleAuto(); break;
      case '[': changeSpeed(-1); break;
      case ']': changeSpeed(1); break;
      case '+': case '=': setZoom(prefs.zoom * 1.12); break;
      case '-': case '_': setZoom(prefs.zoom / 1.12); break;
      case '0': setZoom(1); break;
      case 'm': case 'M': setMarkMode(!markMode); break;
      case 'n': case 'N': cycleTheme(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'b': case 'B': case 's': case 'S': callDc('triggerStandbyAction'); break;
      default: handled = false;
    }
    // Espaço NÃO é intercetado: continua a ser o GO global da Mesa DC
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  function handleAct(act, el) {
    switch (act) {
      case 'close':
        if (ov && ov.classList.contains('embedded')) {
          document.getElementById('dc-tab-script-text')?.click();
        } else {
          close();
        }
        break;
      case 'expand':
        if (ov.classList.contains('embedded')) {
          document.body.appendChild(ov);
          ov.classList.remove('embedded');
          document.documentElement.classList.add('dcsr-lock');
        } else {
          const slot = document.getElementById('dc-score-embed-slot');
          if (slot) {
            slot.appendChild(ov);
            ov.classList.add('embedded');
            document.documentElement.classList.remove('dcsr-lock');
          }
        }
        relayout();
        break;
      case 'prev': prevPage(); break;
      case 'next': nextPage(); break;
      case 'mark': setMarkMode(!markMode); break;
      case 'drawer': toggleDrawer(); break;
      case 'settings': toggleSettings(); break;
      case 'import': openImport(); break;
      case 'auto': toggleAuto(); break;
      case 'slower': changeSpeed(-1); break;
      case 'faster': changeSpeed(1); break;
      case 'standby': callDc('triggerStandbyAction'); break;
      case 'go': callDc('triggerGoAction'); break;
      case 'automark': autoMarkCues(); break;
      default: break;
    }
  }

  function callDc(fnName) {
    try {
      if (typeof window[fnName] === 'function') { window[fnName](); return; }
    } catch (err) { console.error(err); }
    toast('Ação indisponível neste ecrã');
  }

  // ─── Open / Close / Mount (Embedded) ────────────────────────────────
  async function mount(container) {
    build();
    if (container && ov.parentNode !== container) {
      container.innerHTML = '';
      container.appendChild(ov);
    }
    ov.classList.add('embedded', 'open');
    ov.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.remove('dcsr-lock');
    isOpen = true;
    requestWakeLock();
    const room = getRoom();
    if (room !== currentRoom || !doc) {
      await loadForRoom(room);
    } else {
      relayout();
      renderPins();
      renderCueList(true);
    }
    updateHud();
  }

  function unmount() {
    if (!built) return;
    if (ov.classList.contains('embedded')) {
      ov.classList.remove('open', 'embedded');
      ov.setAttribute('aria-hidden', 'true');
      isOpen = false;
      stopAuto();
      releaseWakeLock();
    }
  }

  async function open() {
    build();
    if (ov.parentNode !== document.body) {
      document.body.appendChild(ov);
    }
    ov.classList.remove('embedded');
    isOpen = true;
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('dcsr-lock');
    // Fecha o modal de guião em texto, se estiver aberto
    const legacy = document.getElementById('dc-modal-view-script');
    if (legacy) legacy.style.display = 'none';
    const impLegacy = document.getElementById('dc-modal-import-script');
    if (impLegacy) impLegacy.style.display = 'none';
    requestWakeLock();
    const room = getRoom();
    if (room !== currentRoom || !doc) {
      await loadForRoom(room);
    } else {
      relayout();
      renderPins();
      renderCueList(true);
    }
    updateHud();
  }

  function close() {
    if (!built) return;
    isOpen = false;
    stopAuto();
    setMarkMode(false);
    closePop(); closeSettings(); closeImport();
    ov.classList.remove('open', 'embedded');
    ov.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('dcsr-lock');
    releaseWakeLock();
    if (document.fullscreenElement === ov) { try { document.exitFullscreen(); } catch (_) {} }
    saveMetaSoon(0);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) {}
  }
  function releaseWakeLock() { try { wakeLock?.release(); } catch (_) {} wakeLock = null; }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (ov.requestFullscreen) ov.requestFullscreen();
      else toast('Ecrã inteiro não suportado neste browser');
    } catch (_) {}
  }

  // ─── Loading documents ──────────────────────────────────────────────
  function showLoading(on, text) {
    if (!loadingEl) return;
    loadingEl.classList.toggle('show', !!on);
    if (text) $('#dcsr-loading-text', ov).textContent = text;
  }

  async function loadForRoom(room) {
    currentRoom = room;
    teardownPages();
    doc = null;
    meta = { pins: [], lastPage: 0 };
    try {
      const [d, m] = await Promise.all([dbGet('docs', room), dbGet('meta', room)]);
      doc = d || null;
      if (m && typeof m === 'object') meta = { pins: Array.isArray(m.pins) ? m.pins : [], lastPage: m.lastPage || 0 };
    } catch (err) {
      console.warn('[Guião Original] IndexedDB', err);
    }
    await renderDoc();
  }

  function teardownPages() {
    if (io) { io.disconnect(); io = null; }
    pages.forEach(p => { if (p.canvas) { p.canvas.width = 0; p.canvas.height = 0; } });
    pages = [];
    if (pagesEl) pagesEl.innerHTML = '';
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (_) {} pdfDoc = null; }
    pdfText = null;
    urlsToRevoke.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    urlsToRevoke = [];
    const thumbs = ov && $('#dcsr-thumbs', ov);
    if (thumbs) thumbs.innerHTML = '';
  }

  async function renderDoc() {
    teardownPages();
    if (!doc) {
      titleEl.textContent = 'Sem guião carregado';
      emptyEl.classList.add('show');
      pageTotal.textContent = '0';
      pageInput.value = 0;
      renderCueList();
      return;
    }
    emptyEl.classList.remove('show');
    titleEl.textContent = doc.name || 'Guião';
    showLoading(true, 'A preparar o guião…');
    try {
      if (doc.type === 'pdf') await buildPdfPages(doc.data);
      else if (doc.type === 'images') await buildImagePages(doc.data);
      else if (doc.type === 'docx') await buildDocxPages(doc.data);
      else if (doc.type === 'html') await buildFlowPage(doc.data, true);
      else await buildFlowPage(doc.data, false);
    } catch (err) {
      console.error('[Guião Original] render', err);
      toast('Não foi possível abrir o guião: ' + (err.message || err));
    }
    showLoading(false);
    pageTotal.textContent = String(pages.length);
    pageInput.max = String(pages.length);
    setupObserver();
    relayout();
    goToPage(clamp(meta.lastPage || 0, 0, Math.max(0, pages.length - 1)), false);
    buildThumbs();
    renderPins();
    renderCueList();
  }

  function makePageEl(idx) {
    const el = document.createElement('div');
    el.className = 'dcsr-page';
    el.dataset.page = String(idx);
    el.innerHTML = `<div class="dcsr-page-content"></div><div class="dcsr-pin-layer"></div><div class="dcsr-page-num">${idx + 1}</div>`;
    pagesEl.appendChild(el);
    return el;
  }

  async function buildPdfPages(buffer) {
    if (typeof pdfjsLib === 'undefined') throw new Error('Leitor PDF indisponível (sem ligação para carregar o pdf.js)');
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; } catch (_) {}
    // Cópia para não "transferir" o buffer guardado
    const data = new Uint8Array(buffer.slice(0));
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    const n = pdfDoc.numPages;
    for (let i = 0; i < n; i++) {
      if (i % 10 === 0) showLoading(true, `A preparar página ${i + 1} de ${n}…`);
      const pg = await pdfDoc.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1 });
      const el = makePageEl(i);
      const canvas = document.createElement('canvas');
      el.querySelector('.dcsr-page-content').appendChild(canvas);
      pages.push({ idx: i, kind: 'pdf', w: vp.width, h: vp.height, el, canvas, renderedScale: 0, rendering: false });
    }
  }

  async function buildImagePages(list) {
    const blobs = Array.isArray(list) ? list : [];
    for (let i = 0; i < blobs.length; i++) {
      const url = URL.createObjectURL(blobs[i]);
      urlsToRevoke.push(url);
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      try { await img.decode(); } catch (_) { await new Promise(r => { img.onload = r; img.onerror = r; }); }
      const el = makePageEl(i);
      img.draggable = false;
      el.querySelector('.dcsr-page-content').appendChild(img);
      pages.push({ idx: i, kind: 'img', w: img.naturalWidth || 800, h: img.naturalHeight || 1100, el, url });
    }
  }

  // Mede um nó DOM fora do ecrã com largura base fixa
  function measureNode(node, baseW) {
    const holder = document.createElement('div');
    holder.className = 'dcsr-measure';
    holder.style.width = baseW ? baseW + 'px' : 'auto';
    holder.appendChild(node);
    document.body.appendChild(holder);
    const w = baseW || Math.ceil(node.scrollWidth || node.offsetWidth || 800);
    const h = Math.ceil(node.scrollHeight || node.offsetHeight || 1000);
    holder.remove();
    return { w, h };
  }

  function addDomPage(node, w, h) {
    const i = pages.length;
    const el = makePageEl(i);
    const content = el.querySelector('.dcsr-page-content');
    const inner = document.createElement('div');
    inner.className = 'dcsr-dom-inner';
    inner.style.width = w + 'px';
    inner.style.height = h + 'px';
    inner.appendChild(node);
    content.appendChild(inner);
    pages.push({ idx: i, kind: 'dom', w, h, el, node: inner });
  }

  async function buildFlowPage(data, isHtml) {
    const BASE_W = 820;
    const raw = String(data || '');
    // Texto: quebras de página manuais com form-feed (\f) ou linha "=== PÁGINA ==="
    const chunks = isHtml ? [raw] : raw.split(/\f|\n\s*={3,}\s*P[ÁA]GINA\s*={3,}\s*\n/i);
    chunks.forEach((chunk) => {
      const paper = document.createElement('div');
      paper.className = isHtml ? 'dcsr-paper dcsr-paper-html' : 'dcsr-paper dcsr-paper-text';
      if (isHtml) paper.innerHTML = sanitizeHtml(chunk);
      else paper.textContent = chunk.replace(/^\n+/, '');
      const { h } = measureNode(paper, BASE_W);
      addDomPage(paper, BASE_W, Math.max(h, 400));
    });
  }

  async function buildDocxPages(buffer) {
    let usedPreview = false;
    try {
      showLoading(true, 'A carregar motor Word…');
      if (typeof JSZip === 'undefined') await loadScript(JSZIP_SRC);
      if (typeof docx === 'undefined' || !docx.renderAsync) await loadScript(DOCX_SRC);
      if (typeof docx !== 'undefined' && docx.renderAsync) {
        showLoading(true, 'A desenhar páginas do Word…');
        const holder = document.createElement('div');
        holder.className = 'dcsr-measure dcsr-docx-holder';
        let styleHost = document.getElementById('dcsr-docx-styles');
        if (!styleHost) { styleHost = document.createElement('div'); styleHost.id = 'dcsr-docx-styles'; styleHost.style.display = 'none'; document.body.appendChild(styleHost); }
        styleHost.innerHTML = '';
        document.body.appendChild(holder);
        await docx.renderAsync(new Blob([buffer]), holder, styleHost, {
          className: 'docx', inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
          ignoreWidth: false, ignoreHeight: false, renderHeaders: true, renderFooters: true, renderFootnotes: true,
          experimental: true, useBase64URL: true
        });
        const sections = [...holder.querySelectorAll('section.docx')];
        const sizes = sections.map(s => ({ w: Math.ceil(s.offsetWidth), h: Math.ceil(s.offsetHeight) }));
        holder.remove();
        sections.forEach((s, i) => addDomPage(s, sizes[i].w || 794, sizes[i].h || 1123));
        usedPreview = sections.length > 0;
      }
    } catch (err) {
      console.warn('[Guião Original] docx-preview indisponível, a usar Mammoth', err);
    }
    if (usedPreview) return;
    if (typeof mammoth === 'undefined') throw new Error('Leitor Word indisponível');
    const res = await mammoth.convertToHtml({ arrayBuffer: buffer.slice(0) }, { styleMap: ['u => u', 'strike => s'] });
    await buildFlowPage(res.value || '', true);
    toast('Word aberto em modo simplificado. Para fidelidade total exporte em PDF.');
  }

  // ─── Sanitização de HTML colado (Notas, Word, Google Docs) ──────────
  const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'FONT', 'MARK', 'SUB', 'SUP', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR', 'IMG', 'SMALL', 'BIG', 'CENTER']);
  const ALLOWED_STYLE = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'font-size', 'font-family', 'margin-left', 'padding-left', 'text-indent', 'white-space', 'line-height', 'text-transform', 'letter-spacing', 'border', 'border-collapse', 'vertical-align', 'width'];
  function sanitizeHtml(html) {
    const docp = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = docp.body.firstElementChild || docp.body;
    const walk = (node) => {
      [...node.childNodes].forEach(ch => {
        if (ch.nodeType === 8) { ch.remove(); return; }
        if (ch.nodeType !== 1) return;
        const tag = ch.tagName;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE', 'svg', 'SVG', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(tag)) { ch.remove(); return; }
        walk(ch);
        if (!ALLOWED_TAGS.has(tag)) {
          // Desembrulha tags desconhecidas preservando o conteúdo
          const frag = docp.createDocumentFragment();
          while (ch.firstChild) frag.appendChild(ch.firstChild);
          ch.replaceWith(frag);
          return;
        }
        const keepStyle = [];
        const st = ch.style;
        if (st) ALLOWED_STYLE.forEach(p => { const v = st.getPropertyValue(p); if (v && !/url\(|expression/i.test(v)) keepStyle.push(`${p}:${v}`); });
        const src = tag === 'IMG' ? ch.getAttribute('src') : null;
        const color = tag === 'FONT' ? ch.getAttribute('color') : null;
        const colspan = ch.getAttribute('colspan'), rowspan = ch.getAttribute('rowspan');
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        if (keepStyle.length) ch.setAttribute('style', keepStyle.join(';'));
        if (color) ch.setAttribute('color', color);
        if (colspan) ch.setAttribute('colspan', colspan);
        if (rowspan) ch.setAttribute('rowspan', rowspan);
        if (tag === 'IMG') {
          if (src && /^data:image\//i.test(src)) ch.setAttribute('src', src); else ch.remove();
        }
      });
    };
    walk(root);
    return root.innerHTML;
  }

  // ─── Layout & Rendering ─────────────────────────────────────────────
  function stageInnerSize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { w: Math.max(200, stage.clientWidth - padX), h: Math.max(200, stage.clientHeight - padY) };
  }

  function pageScale(p) {
    const { w, h } = stageInnerSize();
    if (prefs.mode === 'scroll') {
      const fitW = Math.min(w, 1100) / p.w;
      return fitW * prefs.zoom;
    }
    const cols = prefs.mode === 'book' && w > 700 ? 2 : 1;
    const gap = cols === 2 ? 16 : 0;
    const fit = Math.min((w - gap) / cols / p.w, h / p.h);
    return fit * prefs.zoom;
  }

  function relayout() {
    if (!pages.length) { positionGuide(); return; }
    // Guarda posição relativa
    const anchor = captureAnchor();
    pagesEl.classList.toggle('mode-scroll', prefs.mode === 'scroll');
    pagesEl.classList.toggle('mode-page', prefs.mode !== 'scroll');
    const { w } = stageInnerSize();
    pagesEl.classList.toggle('mode-book', prefs.mode === 'book' && w > 700);
    pages.forEach(p => {
      const s = pageScale(p);
      p.cssScale = s;
      p.el.style.width = Math.round(p.w * s) + 'px';
      p.el.style.height = Math.round(p.h * s) + 'px';
      if (p.kind === 'dom') p.node.style.transform = `scale(${s})`;
    });
    updateVisibility();
    restoreAnchor(anchor);
    positionGuide();
    renderVisible();
  }

  function captureAnchor() {
    if (prefs.mode !== 'scroll' || !pages[currentPage]) return { page: currentPage, frac: 0 };
    const p = pages[currentPage];
    const top = p.el.offsetTop;
    const h = p.el.offsetHeight || 1;
    const refY = stage.scrollTop + stage.clientHeight * prefs.guideY;
    return { page: currentPage, frac: clamp((refY - top) / h, 0, 1) };
  }
  function restoreAnchor(a) {
    if (!a || !pages[a.page]) return;
    if (prefs.mode === 'scroll') {
      const p = pages[a.page];
      stage.scrollTop = p.el.offsetTop + p.el.offsetHeight * a.frac - stage.clientHeight * prefs.guideY;
    }
  }

  function updateVisibility() {
    if (prefs.mode === 'scroll') {
      pages.forEach(p => p.el.classList.remove('is-hidden'));
      return;
    }
    const book = pagesEl.classList.contains('mode-book');
    const bs = bookStart();
    pages.forEach((p, i) => {
      const vis = book ? (i === bs || i === bs + 1) : i === currentPage;
      p.el.classList.toggle('is-hidden', !vis);
    });
  }
  // Mostra temporariamente todas as páginas (medições de texto em páginas Word/Notas)
  function withAllVisible(fn) {
    const hidden = pages.filter(p => p.el.classList.contains('is-hidden'));
    hidden.forEach(p => p.el.classList.remove('is-hidden'));
    try { return fn(); } finally { if (hidden.length) updateVisibility(); }
  }
  // Livro: capa sozinha? Mantemos pares 0-1, 2-3… (simples e previsível)
  function bookStart() { return currentPage - (currentPage % 2); }

  function setupObserver() {
    if (io) io.disconnect();
    io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        const p = pages[parseInt(en.target.dataset.page, 10)];
        if (!p) return;
        p.visible = en.isIntersecting;
        if (en.isIntersecting) renderPage(p);
        else if (p.kind === 'pdf' && p.renderedScale) {
          // Liberta memória de páginas longe do ecrã
          const r = en.boundingClientRect;
          const far = r.bottom < -window.innerHeight * 3 || r.top > window.innerHeight * 4;
          if (far) { p.canvas.width = 0; p.canvas.height = 0; p.renderedScale = 0; }
        }
      });
    }, { root: stage, rootMargin: '150% 0px 150% 0px' });
    pages.forEach(p => io.observe(p.el));
  }

  function renderVisible() {
    pages.forEach(p => { if (p.visible || !p.el.classList.contains('is-hidden') && prefs.mode !== 'scroll') renderPage(p); });
    if (prefs.mode === 'scroll') {
      // força as páginas à volta da atual
      for (let i = currentPage - 1; i <= currentPage + 2; i++) if (pages[i]) renderPage(pages[i]);
    }
  }

  async function renderPage(p) {
    if (p.kind !== 'pdf' || !pdfDoc) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let target = (p.cssScale || 1) * dpr;
    // Limite de memória (~16 MP por página)
    const maxPx = 16e6;
    if (p.w * p.h * target * target > maxPx) target = Math.sqrt(maxPx / (p.w * p.h));
    if (p.rendering) { p.wantScale = target; return; }
    if (p.renderedScale && Math.abs(p.renderedScale - target) / target < 0.08) return;
    p.rendering = true;
    try {
      const pg = await pdfDoc.getPage(p.idx + 1);
      const vp = pg.getViewport({ scale: target });
      const off = document.createElement('canvas');
      off.width = Math.floor(vp.width);
      off.height = Math.floor(vp.height);
      const ctx = off.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, off.width, off.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      // Troca sem piscar
      p.canvas.width = off.width;
      p.canvas.height = off.height;
      p.canvas.getContext('2d').drawImage(off, 0, 0);
      off.width = 0; off.height = 0;
      p.renderedScale = target;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') console.warn('[Guião Original] página', p.idx + 1, err);
    }
    p.rendering = false;
    if (p.wantScale && Math.abs(p.wantScale - p.renderedScale) / p.wantScale > 0.08) { p.wantScale = 0; renderPage(p); }
  }

  // ─── Navigation ─────────────────────────────────────────────────────
  function setCurrentPage(i, fromScroll) {
    i = clamp(i, 0, Math.max(0, pages.length - 1));
    const changed = i !== currentPage;
    currentPage = i;
    if (document.activeElement !== pageInput) pageInput.value = pages.length ? String(i + 1) : '0';
    if (changed) {
      meta.lastPage = i;
      saveMetaSoon();
      highlightThumb();
    }
    if (!fromScroll && prefs.mode !== 'scroll') updateVisibility();
  }

  function goToPage(i, smooth, fracY) {
    if (!pages.length) return;
    i = clamp(i, 0, pages.length - 1);
    if (prefs.mode === 'scroll') {
      const p = pages[i];
      const y = fracY != null
        ? p.el.offsetTop + p.el.offsetHeight * fracY - stage.clientHeight * prefs.guideY
        : p.el.offsetTop - 12;
      stage.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
      setCurrentPage(i, true);
    } else {
      const dir = i > currentPage ? 'next' : i < currentPage ? 'prev' : '';
      setCurrentPage(i);
      updateVisibility();
      if (dir) {
        pagesEl.classList.remove('flip-next', 'flip-prev');
        void pagesEl.offsetWidth;
        pagesEl.classList.add('flip-' + dir);
      }
      if (fracY != null && stage.scrollHeight > stage.clientHeight) {
        const p = pages[i];
        stage.scrollTop = p.el.offsetTop + p.el.offsetHeight * fracY - stage.clientHeight * 0.4;
      } else {
        stage.scrollTop = 0;
      }
      renderVisible();
    }
  }

  function step() { return pagesEl.classList.contains('mode-book') ? 2 : 1; }
  function nextPage() {
    if (prefs.mode === 'scroll') {
      const next = pages[currentPage + 1];
      if (next) goToPage(currentPage + 1, true);
      else stage.scrollBy({ top: stage.clientHeight * 0.85, behavior: 'smooth' });
      return;
    }
    const base = pagesEl.classList.contains('mode-book') ? bookStart() : currentPage;
    if (base + step() < pages.length) goToPage(base + step(), true);
  }
  function prevPage() {
    if (prefs.mode === 'scroll') {
      const p = pages[currentPage];
      // Se estamos a meio da página, volta ao topo dela; senão vai para a anterior
      if (p && stage.scrollTop > p.el.offsetTop + 30) goToPage(currentPage, true);
      else goToPage(currentPage - 1, true);
      return;
    }
    const base = pagesEl.classList.contains('mode-book') ? bookStart() : currentPage;
    goToPage(Math.max(0, base - step()), true);
  }

  let isProgrammaticScoreScroll = false;
  let lastScoreScrollBroadcast = 0;
  let scrollRaf = null;

  function onStageScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (prefs.mode !== 'scroll' || !pages.length) return;
      const refY = stage.scrollTop + stage.clientHeight * prefs.guideY;
      let found = currentPage;
      for (let i = 0; i < pages.length; i++) {
        const el = pages[i].el;
        if (el.offsetTop <= refY) found = i; else break;
      }
      setCurrentPage(found, true);

      // Transmite scroll em tempo real se este ecrã for a DC ou quem está a comandar a rolagem
      if (!isProgrammaticScoreScroll) {
        const now = Date.now();
        if (now - lastScoreScrollBroadcast > 35) {
          lastScoreScrollBroadcast = now;
          const maxS = Math.max(1, stage.scrollHeight - stage.clientHeight);
          const ratio = Math.max(0, Math.min(1, stage.scrollTop / maxS));
          const c = getClient();
          if (c && typeof c.streamTheatreScriptScroll === 'function') {
            c.streamTheatreScriptScroll({
              activeIdx: found,
              scrollRatio: Number(ratio.toFixed(4)),
              guideY: prefs.guideY,
              pageIdx: found,
              isAuto: Boolean(autoScroll),
              isScoreDoc: true
            });
          }
        }
      }
    });
  }

  function applyExternalScoreScroll(data) {
    if (!stage || !pages.length || !data) return;
    isProgrammaticScoreScroll = true;
    if (typeof data.guideY === 'number' && Math.abs(prefs.guideY - data.guideY) > 0.01) {
      prefs.guideY = data.guideY;
      updateGuide();
    }
    if (typeof data.scrollRatio === 'number' && data.scrollRatio >= 0) {
      const maxS = Math.max(0, stage.scrollHeight - stage.clientHeight);
      stage.scrollTop = data.scrollRatio * maxS;
    } else if (typeof data.pageIdx === 'number' && data.pageIdx >= 0) {
      goToPage(data.pageIdx, false);
    }
    setTimeout(() => { isProgrammaticScoreScroll = false; }, 60);
  }

  // ─── Modes, zoom, theme ─────────────────────────────────────────────
  function setMode(mode) {
    if (!['scroll', 'page', 'book'].includes(mode)) return;
    const keep = currentPage;
    prefs.mode = mode;
    prefs.zoom = 1;
    if (mode !== 'scroll') stopAuto();
    savePrefs();
    applyPrefsUI();
    relayout();
    goToPage(keep, false);
  }

  function setZoom(z) {
    prefs.zoom = clamp(z, 0.35, 5);
    savePrefs();
    relayout();
    renderSettings();
  }

  const THEMES = [
    { id: 'paper', label: 'Papel' },
    { id: 'sepia', label: 'Sépia' },
    { id: 'night', label: 'Noite (bastidores)' },
    { id: 'red', label: 'Luz Vermelha' }
  ];
  function cycleTheme() {
    const i = THEMES.findIndex(t => t.id === prefs.theme);
    prefs.theme = THEMES[(i + 1) % THEMES.length].id;
    savePrefs();
    applyPrefsUI();
    toast('Tema: ' + THEMES.find(t => t.id === prefs.theme).label);
  }

  function applyPrefsUI() {
    if (!ov) return;
    THEMES.forEach(t => ov.classList.toggle('theme-' + t.id, prefs.theme === t.id));
    ov.style.setProperty('--dcsr-brightness', String(prefs.brightness));
    ov.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === prefs.mode));
    ov.classList.toggle('show-guide', !!prefs.guide && prefs.mode === 'scroll');
    ov.classList.toggle('drawer-open', !!prefs.drawer);
    $('#dcsr-speed', ov).textContent = String(prefs.speed);
    hud.classList.toggle('no-auto', prefs.mode !== 'scroll');
    positionGuide();
    renderSettings();
  }

  function positionGuide() {
    if (!guideEl || !stage) return;
    const r = stage.getBoundingClientRect();
    const body = stage.parentElement.getBoundingClientRect();
    guideEl.style.top = (r.top - body.top + r.height * prefs.guideY) + 'px';
    guideEl.style.left = (r.left - body.left) + 'px';
    guideEl.style.width = r.width + 'px';
  }

  function toggleDrawer(force) {
    prefs.drawer = typeof force === 'boolean' ? force : !prefs.drawer;
    savePrefs();
    applyPrefsUI();
    setTimeout(relayout, 260);
  }
  function setTab(tab) {
    ov.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ov.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
    if (tab === 'cues') renderCueList();
    if (tab === 'search') setTimeout(() => $('#dcsr-search-input', ov)?.focus(), 50);
  }

  // ─── Settings popover ───────────────────────────────────────────────
  function toggleSettings() {
    if (settingsEl.classList.contains('open')) { closeSettings(); return; }
    closePop();
    renderSettings();
    settingsEl.classList.add('open');
  }
  function closeSettings() { settingsEl?.classList.remove('open'); }
  function renderSettings() {
    if (!settingsEl) return;
    const z = Math.round(prefs.zoom * 100);
    settingsEl.innerHTML = `
      <div class="dcsr-set-head">Vista do Guião <button type="button" class="dcsr-btn dcsr-btn-sm" data-set="close">✕</button></div>
      <div class="dcsr-set-row"><span>Zoom</span>
        <div class="dcsr-set-ctrl"><button type="button" class="dcsr-btn" data-set="zoom-">−</button><b>${z}%</b><button type="button" class="dcsr-btn" data-set="zoom+">+</button><button type="button" class="dcsr-btn dcsr-btn-sm" data-set="zoom1">${prefs.mode === 'scroll' ? 'Ajustar largura' : 'Ajustar página'}</button></div></div>
      <div class="dcsr-set-row"><span>Tema</span>
        <div class="dcsr-set-ctrl dcsr-themes">${THEMES.map(t => `<button type="button" class="dcsr-theme-chip t-${t.id} ${prefs.theme === t.id ? 'active' : ''}" data-set="theme" data-val="${t.id}">${t.label}</button>`).join('')}</div></div>
      <div class="dcsr-set-row"><span>Brilho</span>
        <div class="dcsr-set-ctrl"><input type="range" min="0.35" max="1.15" step="0.05" value="${prefs.brightness}" data-set="bright"></div></div>
      <label class="dcsr-set-row dcsr-set-check"><span>Linha de leitura <small>(modo contínuo)</small></span><input type="checkbox" data-set="guide" ${prefs.guide ? 'checked' : ''}></label>
      <label class="dcsr-set-row dcsr-set-check"><span>Seguir deixas automaticamente <small>(salta para a marca em STANDBY/GO)</small></span><input type="checkbox" data-set="follow" ${prefs.follow ? 'checked' : ''}></label>
      <div class="dcsr-set-row"><span>Ecrã</span><div class="dcsr-set-ctrl"><button type="button" class="dcsr-btn" data-set="fs">⛶ Ecrã inteiro</button></div></div>
      ${doc ? `<div class="dcsr-set-row dcsr-set-danger"><span>Guião: <small>${esc(doc.name)}</small></span><div class="dcsr-set-ctrl"><button type="button" class="dcsr-btn dcsr-btn-danger" data-set="remove">Remover guião</button></div></div>` : ''}
      <div class="dcsr-set-keys">Atalhos: <b>←/→</b> páginas (compatível com pedais Bluetooth) • <b>Espaço</b> GO • <b>B</b> Standby • <b>P</b> rolar • <b>[ ]</b> velocidade • <b>+/−</b> zoom • <b>M</b> marcar • <b>N</b> tema • <b>F</b> ecrã inteiro</div>
    `;
    if (!settingsEl.dataset.bound) {
      settingsEl.dataset.bound = '1';
      settingsEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = e.target.closest('[data-set]');
        if (!b) return;
        const k = b.dataset.set;
        if (k === 'close') closeSettings();
        else if (k === 'zoom-') setZoom(prefs.zoom / 1.12);
        else if (k === 'zoom+') setZoom(prefs.zoom * 1.12);
        else if (k === 'zoom1') setZoom(1);
        else if (k === 'theme') { prefs.theme = b.dataset.val; savePrefs(); applyPrefsUI(); }
        else if (k === 'fs') toggleFullscreen();
        else if (k === 'remove') removeDoc();
      });
      settingsEl.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.set === 'bright') { prefs.brightness = parseFloat(t.value); ov.style.setProperty('--dcsr-brightness', t.value); savePrefs(); }
      });
      settingsEl.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.set === 'guide') { prefs.guide = t.checked; savePrefs(); applyPrefsUI(); }
        if (t.dataset.set === 'follow') { prefs.follow = t.checked; savePrefs(); }
      });
    }
  }

  async function removeDoc() {
    if (!confirm('Remover o guião original deste palco neste dispositivo? As marcas de deixas também serão apagadas.')) return;
    try { await dbDel('docs', currentRoom); await dbDel('meta', currentRoom); } catch (_) {}
    doc = null; meta = { pins: [], lastPage: 0 };
    closeSettings();
    await renderDoc();
    toast('Guião removido');
  }

  // ─── Auto-scroll (teleprompter) ─────────────────────────────────────
  function toggleAuto() { if (autoScroll) stopAuto(); else startAuto(); }
  function startAuto() {
    if (!pages.length) return;
    if (prefs.mode !== 'scroll') setMode('scroll');
    autoScroll = true;
    autoLastTs = 0;
    const b = $('.dcsr-auto-btn', ov);
    b.textContent = '⏸ Pausar';
    b.classList.add('active');
    ov.classList.add('auto-on');
    let carry = 0;
    const loop = (ts) => {
      if (!autoScroll) return;
      if (autoLastTs && !holdPause) {
        const dt = Math.min(0.1, (ts - autoLastTs) / 1000);
        carry += prefs.speed * dt;
        const whole = Math.floor(carry);
        if (whole >= 1) { stage.scrollTop += whole; carry -= whole; }
        if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2) { stopAuto(); toast('Fim do guião'); return; }
      }
      autoLastTs = ts;
      autoRaf = requestAnimationFrame(loop);
    };
    autoRaf = requestAnimationFrame(loop);
  }
  function stopAuto() {
    autoScroll = false;
    if (autoRaf) cancelAnimationFrame(autoRaf);
    autoRaf = null;
    if (!ov) return;
    const b = $('.dcsr-auto-btn', ov);
    if (b) { b.textContent = '▶ Rolar'; b.classList.remove('active'); }
    ov.classList.remove('auto-on');
  }
  const SPEEDS = [8, 12, 16, 20, 25, 30, 35, 40, 50, 60, 75, 90, 110, 140, 180, 240];
  function changeSpeed(dir) {
    let i = SPEEDS.findIndex(s => s >= prefs.speed);
    if (i < 0) i = SPEEDS.length - 1;
    i = clamp(i + dir, 0, SPEEDS.length - 1);
    prefs.speed = SPEEDS[i];
    savePrefs();
    $('#dcsr-speed', ov).textContent = String(prefs.speed);
  }

  // ─── Pins (marcas de deixas no papel) ───────────────────────────────
  function cues() { return Array.isArray(theatreState?.cues) ? theatreState.cues : []; }
  function cueById(id) { return cues().find(c => c.id === id) || null; }
  function nextPendingCue() { return cues().find(c => c.status === 'pending') || null; }

  function cueStatusClass(cue) {
    if (!cue) return 'orphan';
    const th = theatreState || {};
    if (cue.status === 'standby' || th.standbyCueId === cue.id) return 'standby';
    if (cue.status === 'fired' || cue.status === 'completed' || cue.status === 'done') return th.activeCueId === cue.id ? 'live' : 'fired';
    const np = nextPendingCue();
    if (np && np.id === cue.id) return 'next';
    return 'pending';
  }

  function deptShort(cue) {
    const d = (cue?.departments || [])[0];
    return d ? String(d).slice(0, 3).toUpperCase() : '';
  }

  function renderPins() {
    if (!pages.length) return;
    pages.forEach(p => { const layer = p.el.querySelector('.dcsr-pin-layer'); if (layer) layer.innerHTML = ''; });
    meta.pins.forEach(pin => {
      const p = pages[pin.page];
      if (!p) return;
      const layer = p.el.querySelector('.dcsr-pin-layer');
      const el = document.createElement('div');
      el.dataset.pin = pin.id;
      el.style.top = (pin.y * 100) + '%';
      if (pin.type === 'note') {
        el.className = 'dcsr-pin dcsr-pin-note';
        el.style.left = (pin.x * 100) + '%';
        el.innerHTML = `<div class="dcsr-note-body">${esc(pin.text || 'Nota')}</div>`;
      } else {
        const cue = cueById(pin.cueId);
        const st = cueStatusClass(cue);
        el.className = `dcsr-pin dcsr-pin-cue st-${st}`;
        el.innerHTML = `
          <div class="dcsr-pin-line"></div>
          <div class="dcsr-pin-flag" style="left:${clamp(pin.x * 100, 0, 92)}%">
            <b>${esc(cue ? cue.num : '?')}</b><span>${esc(cue ? (cue.name || '') : 'Deixa removida')}</span>${deptShort(cue) ? `<i>${esc(deptShort(cue))}</i>` : ''}
          </div>`;
      }
      layer.appendChild(el);
      bindPinDrag(el, pin, p);
    });
    updateThumbBadges();
  }

  // Atualiza apenas classes de estado (sem recriar DOM) a cada sync
  function refreshPinStates() {
    if (!pages.length) return;
    ov.querySelectorAll('.dcsr-pin-cue').forEach(el => {
      const pin = meta.pins.find(p => p.id === el.dataset.pin);
      if (!pin) return;
      const st = cueStatusClass(cueById(pin.cueId));
      const cls = `dcsr-pin dcsr-pin-cue st-${st}`;
      if (el.className !== cls) el.className = cls;
    });
  }

  function bindPinDrag(el, pin, page) {
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      if (!markMode) return;
      e.stopPropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, moved: false };
      delete el.dataset.dragged;
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 4) start.moved = true;
      if (!start.moved) return;
      const r = page.el.getBoundingClientRect();
      pin.x = clamp((e.clientX - r.left) / r.width, 0, 1);
      pin.y = clamp((e.clientY - r.top) / r.height, 0, 1);
      el.style.top = (pin.y * 100) + '%';
      if (pin.type === 'note') el.style.left = (pin.x * 100) + '%';
      else { const f = el.querySelector('.dcsr-pin-flag'); if (f) f.style.left = clamp(pin.x * 100, 0, 92) + '%'; }
    });
    el.addEventListener('pointerup', () => {
      if (start?.moved) { el.dataset.dragged = '1'; setTimeout(() => delete el.dataset.dragged, 50); saveMetaSoon(0); }
      start = null;
    });
  }

  function setMarkMode(on, cueId) {
    markMode = !!on;
    pendingPlaceCueId = on ? (cueId || null) : null;
    if (!ov) return;
    ov.classList.toggle('mark-mode', markMode);
    const btn = ov.querySelector('[data-act="mark"]');
    if (btn) btn.classList.toggle('active', markMode);
    if (markMode) {
      stopAuto();
      const cue = cueId ? cueById(cueId) : null;
      toast(cue ? `Toque no guião onde acontece a deixa ${cue.num}` : 'Modo marcação: toque no papel para colocar uma deixa ou nota. Arraste marcas para mover.', 3500);
    } else {
      closePop();
    }
  }

  function onPagePlace(pageEl, e) {
    const idx = parseInt(pageEl.dataset.page, 10);
    const r = pageEl.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    const y = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (pendingPlaceCueId) {
      placeCuePin(pendingPlaceCueId, idx, x, y);
      pendingPlaceCueId = null;
      setMarkMode(false);
      return;
    }
    openPlacePop(idx, x, y, e.clientX, e.clientY);
  }

  function placeCuePin(cueId, page, x, y) {
    meta.pins = meta.pins.filter(p => !(p.type !== 'note' && p.cueId === cueId));
    meta.pins.push({ id: uid(), type: 'cue', cueId, page, x, y });
    saveMetaSoon(0);
    renderPins();
    renderCueList();
    const cue = cueById(cueId);
    toast(`Deixa ${cue ? cue.num : ''} marcada na pág. ${page + 1}`);
  }

  function positionPop(cx, cy) {
    const vw = window.innerWidth, vh = window.innerHeight;
    popEl.style.left = '0px'; popEl.style.top = '0px';
    popEl.classList.add('open');
    const pr = popEl.getBoundingClientRect();
    popEl.style.left = clamp(cx - pr.width / 2, 8, vw - pr.width - 8) + 'px';
    popEl.style.top = clamp(cy + 14, 8, vh - pr.height - 8) + 'px';
  }
  function closePop() { popEl?.classList.remove('open'); }

  function openPlacePop(page, x, y, cx, cy) {
    closeSettings();
    const list = cues();
    const pinned = new Set(meta.pins.filter(p => p.type !== 'note').map(p => p.cueId));
    const firstUnpinned = list.find(c => !pinned.has(c.id));
    popEl.innerHTML = `
      <div class="dcsr-pop-head">Colocar na pág. ${page + 1}</div>
      <div class="dcsr-pop-list">
        ${list.length ? list.map(c => `
          <button type="button" class="dcsr-pop-cue ${pinned.has(c.id) ? 'is-pinned' : ''} ${firstUnpinned && firstUnpinned.id === c.id ? 'is-suggest' : ''}" data-place-cue="${esc(c.id)}">
            <b>${esc(c.num)}</b><span>${esc(c.name || '')}</span>${pinned.has(c.id) ? '<em>mover</em>' : ''}
          </button>`).join('') : '<div class="dcsr-hint">Ainda não há deixas. Crie-as na Mesa DC ou importe a folha de deixas.</div>'}
      </div>
      <div class="dcsr-pop-note"><input type="text" id="dcsr-note-input" placeholder="…ou escreva uma nota (ex.: atenção à entrada do ator)" maxlength="140"><button type="button" class="dcsr-btn dcsr-btn-gold" data-place-note>📝</button></div>
    `;
    positionPop(cx, cy);
    const sug = popEl.querySelector('.is-suggest');
    if (sug) sug.scrollIntoView({ block: 'nearest' });
    const ni = popEl.querySelector('#dcsr-note-input');
    ni.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') addNote(); });
    const addNote = () => {
      const t = ni.value.trim();
      if (!t) { ni.focus(); return; }
      meta.pins.push({ id: uid(), type: 'note', text: t, page, x, y });
      saveMetaSoon(0);
      renderPins();
      closePop();
    };
    popEl.onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-place-cue]');
      if (b) { placeCuePin(b.dataset.placeCue, page, x, y); closePop(); return; }
      if (e.target.closest('[data-place-note]')) addNote();
    };
  }

  function openPinPop(pinId, anchorEl) {
    const pin = meta.pins.find(p => p.id === pinId);
    if (!pin) return;
    closeSettings();
    const r = anchorEl.getBoundingClientRect();
    if (pin.type === 'note') {
      popEl.innerHTML = `
        <div class="dcsr-pop-head">📝 Nota · pág. ${pin.page + 1}</div>
        <textarea id="dcsr-note-edit" class="dcsr-note-edit" maxlength="280">${esc(pin.text || '')}</textarea>
        <div class="dcsr-pop-actions">
          <button type="button" class="dcsr-btn dcsr-btn-danger" data-pin-act="del">Apagar</button>
          <button type="button" class="dcsr-btn dcsr-btn-gold" data-pin-act="save">Guardar</button>
        </div>`;
      positionPop(r.left + 20, r.bottom - 10);
      popEl.querySelector('#dcsr-note-edit').addEventListener('keydown', e => e.stopPropagation());
    } else {
      const cue = cueById(pin.cueId);
      const st = cueStatusClass(cue);
      const stLabel = { standby: 'EM STANDBY', live: 'ÚLTIMO GO', fired: 'EXECUTADA', next: 'PRÓXIMA', pending: 'PENDENTE', orphan: 'DEIXA REMOVIDA' }[st];
      popEl.innerHTML = `
        <div class="dcsr-pop-head st-${st}"><b>${esc(cue ? cue.num : '?')}</b> ${esc(cue ? cue.name || '' : '')}<span class="dcsr-pop-st">${stLabel}</span></div>
        ${cue && (cue.departments || []).length ? `<div class="dcsr-pop-depts">${cue.departments.map(d => `<span>${esc(d)}</span>`).join('')}</div>` : ''}
        ${cue && cue.notes ? `<div class="dcsr-pop-notes">${esc(cue.notes)}</div>` : ''}
        <div class="dcsr-pop-actions">
          ${cue ? `<button type="button" class="dcsr-btn dcsr-standby" data-pin-act="standby">STANDBY</button>
          <button type="button" class="dcsr-btn dcsr-go" data-pin-act="go">GO</button>` : ''}
        </div>
        <div class="dcsr-pop-actions dcsr-pop-actions-sub">
          <button type="button" class="dcsr-btn dcsr-btn-sm" data-pin-act="move">↕ Mover</button>
          <button type="button" class="dcsr-btn dcsr-btn-sm dcsr-btn-danger" data-pin-act="del">Remover marca</button>
        </div>`;
      positionPop(r.left + 40, r.bottom - 6);
    }
    popEl.onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-pin-act]');
      if (!b) return;
      const act = b.dataset.pinAct;
      const c = getClient();
      if (act === 'del') {
        meta.pins = meta.pins.filter(p => p.id !== pin.id);
        saveMetaSoon(0); renderPins(); renderCueList(); closePop();
      } else if (act === 'save') {
        pin.text = popEl.querySelector('#dcsr-note-edit').value.trim() || pin.text;
        saveMetaSoon(0); renderPins(); closePop();
      } else if (act === 'move') {
        closePop();
        setMarkMode(true, pin.cueId);
      } else if (act === 'standby' && c) {
        c.standbyCue(pin.cueId); closePop();
      } else if (act === 'go' && c) {
        if (theatreState?.showState === 'pre' && typeof c.startTheatreShow === 'function') c.startTheatreShow();
        c.fireCue(pin.cueId); closePop();
      }
    };
  }

  function saveMetaSoon(delay = 600) {
    if (!currentRoom) return;
    clearTimeout(metaSaveTimer);
    metaSaveTimer = setTimeout(() => {
      dbPut('meta', currentRoom, { pins: meta.pins, lastPage: meta.lastPage, updatedAt: Date.now() }).catch(err => console.warn('[Guião Original] meta', err));
    }, delay);
  }

  // ─── Follow the show ────────────────────────────────────────────────
  function followCue() {
    if (!isOpen || !prefs.follow || !pages.length) return;
    const th = theatreState || {};
    const standby = th.standbyCueId ? cueById(th.standbyCueId) : cues().find(c => c.status === 'standby');
    const target = standby || nextPendingCue();
    if (!target) return;
    const key = target.id + ':' + (standby ? 'sb' : 'nx');
    if (key === lastFollowKey) return;
    lastFollowKey = key;
    const pin = meta.pins.find(p => p.type !== 'note' && p.cueId === target.id);
    if (!pin) return;
    if (markMode || autoScroll && !standby) return;
    goToPage(pin.page, true, pin.y);
    flashPin(pin.id);
  }
  function flashPin(id) {
    const el = ov.querySelector(`.dcsr-pin[data-pin="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ─── HUD ────────────────────────────────────────────────────────────
  function updateHud() {
    if (!ov) return;
    const th = theatreState || {};
    const list = cues();
    const standby = list.find(c => c.status === 'standby') || (th.standbyCueId ? cueById(th.standbyCueId) : null);
    const next = standby || nextPendingCue();
    const last = th.activeCueId ? cueById(th.activeCueId) : null;
    const tag = ov.querySelector('.dcsr-cue-line .dcsr-tag');
    const nx = $('#dcsr-cue-next', ov);
    const ls = $('#dcsr-cue-last', ov);
    const info = $('#dcsr-cue-info', ov);
    info.classList.toggle('is-standby', !!standby);
    tag.textContent = standby ? 'STANDBY' : 'PRÓXIMA';
    nx.textContent = next ? `${next.num} — ${next.name || ''}` : (list.length ? 'Todas as deixas executadas' : 'Sem deixas');
    const pinned = next && meta.pins.some(p => p.type !== 'note' && p.cueId === next.id);
    ls.innerHTML = (last ? `Último GO: <b>${esc(last.num)}</b> ${esc(last.name || '')} ${last.firedTimecode ? `<span class="dcsr-tc">${esc(last.firedTimecode)}</span>` : ''}` : '')
      + (next && !pinned && pages.length ? ` <span class="dcsr-unpinned">• sem marca no guião</span>` : '');
  }

  // ─── Drawer: thumbnails ─────────────────────────────────────────────
  let thumbIo = null;
  function buildThumbs() {
    const host = $('#dcsr-thumbs', ov);
    host.innerHTML = '';
    if (thumbIo) thumbIo.disconnect();
    if (!pages.length) { host.innerHTML = '<div class="dcsr-hint">Sem páginas.</div>'; return; }
    pages.forEach(p => {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'dcsr-thumb';
      t.dataset.thumb = String(p.idx);
      const ratio = p.h / p.w;
      t.innerHTML = `<div class="dcsr-thumb-img" style="aspect-ratio:${(1 / ratio).toFixed(4)}"></div><span>${p.idx + 1}</span><i class="dcsr-thumb-badge"></i>`;
      host.appendChild(t);
      p.thumb = t;
    });
    thumbIo = new IntersectionObserver((ents) => {
      ents.forEach(en => { if (en.isIntersecting) { renderThumb(pages[parseInt(en.target.dataset.thumb, 10)]); thumbIo.unobserve(en.target); } });
    }, { root: host, rootMargin: '200px' });
    pages.forEach(p => thumbIo.observe(p.thumb));
    highlightThumb();
    updateThumbBadges();
  }
  async function renderThumb(p) {
    if (!p) return;
    const box = p.thumb.querySelector('.dcsr-thumb-img');
    if (p.kind === 'img') {
      const im = new Image(); im.src = p.url; box.appendChild(im);
    } else if (p.kind === 'pdf' && pdfDoc) {
      try {
        const pg = await pdfDoc.getPage(p.idx + 1);
        const vp = pg.getViewport({ scale: 220 / p.w });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        box.appendChild(c);
      } catch (_) {}
    } else {
      box.innerHTML = `<div class="dcsr-thumb-txt">Pág. ${p.idx + 1}</div>`;
    }
  }
  function highlightThumb() {
    pages.forEach(p => p.thumb && p.thumb.classList.toggle('active', p.idx === currentPage));
    const cur = pages[currentPage]?.thumb;
    if (cur && prefs.drawer) cur.scrollIntoView({ block: 'nearest' });
  }
  function updateThumbBadges() {
    const count = {};
    meta.pins.forEach(p => { if (p.type !== 'note') count[p.page] = (count[p.page] || 0) + 1; });
    pages.forEach(p => {
      const b = p.thumb?.querySelector('.dcsr-thumb-badge');
      if (b) { b.textContent = count[p.idx] ? `${count[p.idx]} ⚑` : ''; b.style.display = count[p.idx] ? '' : 'none'; }
    });
  }

  // ─── Drawer: cue list ───────────────────────────────────────────────
  let lastCueListSig = '';
  function renderCueList(force) {
    if (!ov) return;
    const host = $('#dcsr-cue-list', ov);
    const list = cues();
    const sig = list.map(c => `${c.id}:${c.status}:${c.num}:${c.name}`).join('|') + '#' + meta.pins.map(p => p.cueId + p.page).join(',') + pages.length;
    if (!force && sig === lastCueListSig) return;
    lastCueListSig = sig;
    if (!list.length) { host.innerHTML = '<div class="dcsr-hint">Sem deixas nesta sala. Crie ou importe deixas na Mesa DC.</div>'; return; }
    const pinMap = {};
    meta.pins.forEach(p => { if (p.type !== 'note') pinMap[p.cueId] = p; });
    const total = list.length, done = list.filter(c => pinMap[c.id]).length;
    host.innerHTML = `<div class="dcsr-cue-progress"><div style="width:${total ? (done / total * 100) : 0}%"></div><span>${done} / ${total} deixas marcadas no guião</span></div>` +
      list.map(c => {
        const pin = pinMap[c.id];
        const st = cueStatusClass(c);
        return `<button type="button" class="dcsr-cue-item st-${st} ${pin ? 'has-pin' : ''}" data-cue-item="${esc(c.id)}">
          <b>${esc(c.num)}</b><span>${esc(c.name || '')}</span>
          <em>${pin ? `pág. ${pin.page + 1}` : '📍 marcar'}</em>
        </button>`;
      }).join('');
  }
  function onCueListClick(cueId) {
    const pin = meta.pins.find(p => p.type !== 'note' && p.cueId === cueId);
    if (!pages.length) { toast('Importe primeiro o guião'); return; }
    if (pin) {
      goToPage(pin.page, true, pin.y);
      flashPin(pin.id);
      if (window.innerWidth < 900) toggleDrawer(false);
    } else {
      if (window.innerWidth < 900) toggleDrawer(false);
      setMarkMode(true, cueId);
    }
  }

  // ─── Texto do PDF (pesquisa + auto-marcação) ────────────────────────
  async function ensurePdfText() {
    if (pdfText) return pdfText;
    if (!pdfDoc) return null;
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      if (i % 8 === 0) showLoading(true, `A ler texto da página ${i + 1} de ${pages.length}…`);
      try {
        const pg = await pdfDoc.getPage(i + 1);
        const vp = pg.getViewport({ scale: 1 });
        const tc = await pg.getTextContent();
        let str = '';
        const spans = [];
        tc.items.forEach(it => {
          if (!it.str) return;
          const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
          spans.push({ start: str.length, end: str.length + it.str.length, x: x / vp.width, y: clamp((y - (it.height || 10) * 0.6) / vp.height, 0, 1) });
          str += it.str + ' ';
        });
        out.push({ str, norm: norm(str), spans });
      } catch (_) { out.push({ str: '', norm: '', spans: [] }); }
    }
    showLoading(false);
    pdfText = out;
    return out;
  }
  function spanAt(pageText, offset) {
    const s = pageText.spans;
    for (let i = 0; i < s.length; i++) if (offset < s[i].end + 1) return s[i];
    return s[s.length - 1] || { x: 0.05, y: 0.1 };
  }

  // Texto de páginas DOM (Word / Notas)
  function domTextIndex() {
    return pages.map(p => {
      if (p.kind !== 'dom') return null;
      const walker = document.createTreeWalker(p.node, NodeFilter.SHOW_TEXT);
      let str = '';
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) { nodes.push({ node: n, start: str.length }); str += n.nodeValue + ' '; }
      return { str, norm: norm(str), nodes, page: p };
    });
  }
  function domPosAt(idx, offset) {
    const nodes = idx.nodes;
    let hit = nodes[0];
    for (const nd of nodes) { if (nd.start <= offset) hit = nd; else break; }
    if (!hit) return { x: 0.05, y: 0.1 };
    const pageEl = idx.page.el;
    const wasHidden = pageEl.classList.contains('is-hidden');
    if (wasHidden) pageEl.classList.remove('is-hidden');
    try {
      const range = document.createRange();
      const local = clamp(offset - hit.start, 0, hit.node.nodeValue.length);
      range.setStart(hit.node, local);
      range.setEnd(hit.node, Math.min(hit.node.nodeValue.length, local + 1));
      const rr = range.getBoundingClientRect();
      const pr = pageEl.getBoundingClientRect();
      if (pr.height > 0 && rr.height > 0) return { x: clamp((rr.left - pr.left) / pr.width, 0, 1), y: clamp((rr.top - pr.top) / pr.height, 0, 1) };
    } catch (_) {
    } finally {
      if (wasHidden) pageEl.classList.add('is-hidden');
    }
    return { x: 0.05, y: 0.1 };
  }

  async function getTextPages() {
    if (pdfDoc) return { kind: 'pdf', list: await ensurePdfText() };
    return { kind: 'dom', list: domTextIndex() };
  }

  // ─── Search ─────────────────────────────────────────────────────────
  async function runSearch(q) {
    const host = $('#dcsr-search-results', ov);
    q = q.trim();
    if (q.length < 2) { host.innerHTML = '<div class="dcsr-hint">Escreva pelo menos 2 letras.</div>'; return; }
    if (!pages.length) { host.innerHTML = '<div class="dcsr-hint">Sem guião carregado.</div>'; return; }
    if (doc?.type === 'images') { host.innerHTML = '<div class="dcsr-hint">Pesquisa indisponível em fotos de páginas.</div>'; return; }
    const { kind, list } = await getTextPages();
    const nq = norm(q);
    const results = [];
    (list || []).forEach((pt, pi) => {
      if (!pt) return;
      let from = 0, k;
      while ((k = pt.norm.indexOf(nq, from)) >= 0 && results.length < 200) {
        const snipStart = Math.max(0, k - 40);
        const snippet = pt.str.slice(snipStart, k + nq.length + 50);
        results.push({ page: pi, offset: k, snippet, hl: k - snipStart, len: q.length, kind });
        from = k + nq.length;
      }
    });
    if (!results.length) { host.innerHTML = '<div class="dcsr-hint">Sem resultados. (PDFs digitalizados como imagem não têm texto pesquisável.)</div>'; return; }
    host.innerHTML = `<div class="dcsr-hint">${results.length}${results.length >= 200 ? '+' : ''} resultado(s)</div>` + results.map(r => `
      <button type="button" class="dcsr-sres" data-sres="1" data-page="${r.page}" data-offset="${r.offset}">
        <b>Pág. ${r.page + 1}</b>
        <span>…${esc(r.snippet.slice(0, r.hl))}<mark>${esc(r.snippet.slice(r.hl, r.hl + r.len))}</mark>${esc(r.snippet.slice(r.hl + r.len))}…</span>
      </button>`).join('');
  }
  async function onSearchResultClick(el) {
    const page = parseInt(el.dataset.page, 10);
    const offset = parseInt(el.dataset.offset, 10);
    let pos = { y: 0.1 };
    if (pdfDoc && pdfText) pos = spanAt(pdfText[page], offset);
    else { const idx = domTextIndex()[page]; if (idx) pos = domPosAt(idx, offset); }
    goToPage(page, true, pos.y);
    showSearchMarker(page, pos.y);
    if (window.innerWidth < 900) toggleDrawer(false);
  }
  function showSearchMarker(page, y) {
    const p = pages[page];
    if (!p) return;
    p.el.querySelectorAll('.dcsr-search-hit').forEach(n => n.remove());
    const m = document.createElement('div');
    m.className = 'dcsr-search-hit';
    m.style.top = (y * 100) + '%';
    p.el.appendChild(m);
    setTimeout(() => m.remove(), 2600);
  }

  // ─── Auto-marcação de deixas a partir do texto ──────────────────────
  function cueRegex(cue) {
    const num = String(cue.num || '').trim();
    if (!num) return null;
    const numPart = (num.match(/\d+(?:[.,]\d+)?[a-z]?/i) || [num])[0];
    const escNum = numPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[.,]/, '[.,]');
    const escFull = norm(num).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const prefixes = '(?:cue|deixa|dx|q|lx|lq|sq|sx|snd|som|luz|luzes|video|vid|vq|fx|sfx|pir|pyro)';
    // Números "nus" (ex.: "12") só contam com prefixo, para não confundir com números de página
    const fullAlt = /[a-z]/i.test(num) ? escFull + '|' : '';
    return new RegExp(`(?:^|[^a-z0-9])(?:${fullAlt}${prefixes}\\s*[-–—.:#nº°]*\\s*${escNum})(?![\\d]|[.,]\\d)`, 'i');
  }

  async function autoMarkCues() {
    const list = cues();
    if (!pages.length) { toast('Importe primeiro o guião'); return; }
    if (!list.length) { toast('Não há deixas para marcar'); return; }
    if (doc?.type === 'images') { toast('Fotos não têm texto. Marque as deixas manualmente (📍).', 4000); return; }
    const already = new Set(meta.pins.filter(p => p.type !== 'note').map(p => p.cueId));
    const todo = list.filter(c => !already.has(c.id));
    if (!todo.length) { toast('Todas as deixas já estão marcadas'); return; }
    const { kind, list: tp } = await getTextPages();
    if (!tp || !tp.some(t => t && t.str.trim())) { toast('Este documento não tem texto pesquisável (digitalizado). Marque manualmente.', 4500); return; }
    // Pesquisa sequencial (respeita a ordem das deixas no guião)
    let cursor = { page: 0, offset: 0 };
    let found = 0;
    const dIdx = kind === 'dom' ? tp : null;
    for (const cue of list) {
      if (already.has(cue.id)) {
        const pin = meta.pins.find(p => p.cueId === cue.id);
        if (pin) cursor = { page: pin.page, offset: 0 };
        continue;
      }
      const re = cueRegex(cue);
      if (!re) continue;
      let hit = null;
      const tryRange = (fromPage, fromOff, toPage) => {
        for (let pi = fromPage; pi <= toPage && pi < tp.length; pi++) {
          const t = tp[pi];
          if (!t) continue;
          const sub = t.norm.slice(pi === fromPage ? fromOff : 0);
          const m = re.exec(sub);
          if (m) {
            const off = (pi === fromPage ? fromOff : 0) + m.index + (m[0].match(/^[^a-z0-9]/i) ? 1 : 0);
            return { page: pi, offset: off };
          }
        }
        return null;
      };
      hit = tryRange(cursor.page, cursor.offset, tp.length - 1) || tryRange(0, 0, cursor.page);
      if (!hit) continue;
      const pos = kind === 'pdf' ? spanAt(tp[hit.page], hit.offset) : domPosAt(dIdx[hit.page], hit.offset);
      meta.pins.push({ id: uid(), type: 'cue', cueId: cue.id, page: hit.page, x: clamp(pos.x, 0, 0.85), y: pos.y, auto: true });
      cursor = { page: hit.page, offset: hit.offset + 1 };
      found++;
    }
    saveMetaSoon(0);
    renderPins();
    renderCueList(true);
    toast(found ? `⚡ ${found} de ${todo.length} deixas marcadas automaticamente. Verifique e ajuste arrastando (📍).` : 'Não encontrei referências às deixas no texto. Marque manualmente.', 5000);
  }

  // ─── Import ─────────────────────────────────────────────────────────
  function openImport() {
    closePop(); closeSettings();
    importEl.innerHTML = `
      <div class="dcsr-import-card">
        <div class="dcsr-import-head"><h3>⤓ Importar Guião Original</h3><button type="button" class="dcsr-btn" data-imp="close">✕</button></div>
        <div class="dcsr-import-tabs">
          <button type="button" class="active" data-imp-tab="file">📄 Ficheiro</button>
          <button type="button" data-imp-tab="notes">📝 Colar das Notas / Word</button>
        </div>
        <div class="dcsr-imp-panel active" data-imp-panel="file">
          <label class="dcsr-drop" id="dcsr-drop">
            <input type="file" id="dcsr-file" accept=".pdf,.docx,.txt,.md,.rtf,image/*,application/pdf" multiple hidden>
            <div class="dcsr-drop-ico">📜</div>
            <div class="dcsr-drop-title">Toque para escolher ou arraste para aqui</div>
            <div class="dcsr-drop-sub"><b>PDF</b> (recomendado — 100% fiel) • <b>Word .docx</b> • <b>Texto .txt</b> • <b>Fotos</b> das páginas (várias de uma vez)</div>
          </label>
          <div class="dcsr-imp-info">🔒 O ficheiro fica guardado <b>apenas neste dispositivo</b> para o palco <b>${esc(getRoom())}</b> e funciona sem internet.</div>
        </div>
        <div class="dcsr-imp-panel" data-imp-panel="notes">
          <div class="dcsr-imp-info">Cole aqui o texto das <b>Notas do iPhone/Mac</b>, Word ou Google Docs — negritos, itálicos, espaços e quebras de linha são preservados.</div>
          <input type="text" id="dcsr-notes-name" class="dcsr-input" placeholder="Nome do guião (ex.: Ato I)" maxlength="80">
          <div id="dcsr-notes-editor" class="dcsr-notes-editor" contenteditable="true" spellcheck="false" data-ph="Cole aqui o guião (Cmd/Ctrl + V)…"></div>
          <div class="dcsr-imp-row">
            <label class="dcsr-check"><input type="checkbox" id="dcsr-notes-plain"> Texto simples (tipo máquina de escrever, alinhamento exato por espaços)</label>
            <button type="button" class="dcsr-btn dcsr-btn-gold" data-imp="save-notes">Guardar Guião</button>
          </div>
        </div>
      </div>`;
    importEl.classList.add('open');
    const fileInput = $('#dcsr-file', importEl);
    fileInput.addEventListener('change', () => { if (fileInput.files.length) importFiles([...fileInput.files]); });
    const ed = $('#dcsr-notes-editor', importEl);
    ['keydown', 'keyup', 'keypress'].forEach(t => ed.addEventListener(t, e => e.stopPropagation()));
    $('#dcsr-notes-name', importEl).addEventListener('keydown', e => e.stopPropagation());
    ed.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      e.preventDefault();
      const html = cd.getData('text/html');
      const plain = $('#dcsr-notes-plain', importEl).checked;
      if (html && !plain) {
        document.execCommand('insertHTML', false, sanitizeHtml(html));
      } else {
        document.execCommand('insertText', false, cd.getData('text/plain'));
      }
    });
    importEl.onclick = (e) => {
      const tabB = e.target.closest('[data-imp-tab]');
      if (tabB) {
        importEl.querySelectorAll('[data-imp-tab]').forEach(b => b.classList.toggle('active', b === tabB));
        importEl.querySelectorAll('[data-imp-panel]').forEach(p => p.classList.toggle('active', p.dataset.impPanel === tabB.dataset.impTab));
        if (tabB.dataset.impTab === 'notes') setTimeout(() => ed.focus(), 50);
        return;
      }
      const b = e.target.closest('[data-imp]');
      if (!b) { if (e.target === importEl) closeImport(); return; }
      if (b.dataset.imp === 'close') closeImport();
      if (b.dataset.imp === 'save-notes') saveNotes();
    };
  }
  function closeImport() { importEl?.classList.remove('open'); }

  async function saveNotes() {
    const ed = $('#dcsr-notes-editor', importEl);
    const plain = $('#dcsr-notes-plain', importEl).checked;
    const name = ($('#dcsr-notes-name', importEl).value || '').trim() || 'Guião (Notas)';
    const text = ed.innerText || '';
    if (!text.trim()) { toast('Cole primeiro o texto do guião'); return; }
    const rec = plain
      ? { type: 'text', name, data: text, size: text.length }
      : { type: 'html', name, data: sanitizeHtml(ed.innerHTML), size: ed.innerHTML.length };
    await storeDoc(rec);
  }

  async function importFiles(files) {
    if (!files.length) return;
    const imgs = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|heic)$/i.test(f.name));
    const first = files[0];
    try {
      if (imgs.length && imgs.length === files.length) {
        imgs.sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
        await storeDoc({ type: 'images', name: imgs.length > 1 ? `${imgs.length} páginas (fotos)` : imgs[0].name, data: imgs.map(f => f.slice(0, f.size, f.type)), size: imgs.reduce((s, f) => s + f.size, 0) });
        return;
      }
      const name = first.name || 'Guião';
      const buf = await first.arrayBuffer();
      if (/\.pdf$/i.test(name) || first.type === 'application/pdf') {
        await storeDoc({ type: 'pdf', name, data: buf, size: buf.byteLength });
      } else if (/\.docx$/i.test(name)) {
        await storeDoc({ type: 'docx', name, data: buf, size: buf.byteLength });
      } else if (/\.doc$/i.test(name)) {
        toast('Formato .doc antigo não suportado. Guarde como .docx ou PDF no Word.', 5000);
      } else {
        const text = new TextDecoder('utf-8').decode(buf);
        await storeDoc({ type: 'text', name, data: text, size: text.length });
      }
    } catch (err) {
      console.error(err);
      toast('Falha na importação: ' + (err.message || err), 5000);
    }
  }

  async function broadcastCurrentDoc() {
    if (!doc) {
      const room = getRoom();
      try {
        const d = await dbGet('docs', room);
        if (d) doc = d;
      } catch (_) {}
    }
    if (doc) {
      broadcastDocToRoom(doc, getRoom());
    }
  }
  async function broadcastDocToRoom(rec, room) {
    const c = getClient();
    if (!c || !rec) return;
    try {
      let payloadData = null;
      if (rec.data instanceof ArrayBuffer) {
        // Converte ArrayBuffer para Base64 para envio de rede
        let binary = '';
        const bytes = new Uint8Array(rec.data);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        payloadData = btoa(binary);
      } else if (typeof rec.data === 'string') {
        payloadData = rec.data;
      }

      if (payloadData) {
        const transferMsg = {
          action: 'theatre_doc_sync',
          room: room,
          doc: {
            name: rec.name,
            type: rec.type,
            size: rec.size,
            isBase64: rec.data instanceof ArrayBuffer,
            data: payloadData,
            meta: { pins: meta.pins || [], lastPage: meta.lastPage || 0 }
          }
        };

        if (typeof c.sendRoomCommand === 'function') {
          c.sendRoomCommand(room, transferMsg);
        }
        if (c.channel) {
          try {
            c.channel.postMessage({
              type: 'theatre-doc-sync',
              sender: c.clientId,
              room: room,
              doc: transferMsg.doc
            });
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[dc-score] broadcastDocToRoom erro:', e);
    }
  }

  async function handleIncomingDocSync(incomingDoc, incomingRoom) {
    if (!incomingDoc || !incomingDoc.data) return;
    const room = incomingRoom || getRoom();
    try {
      let finalData = incomingDoc.data;
      if (incomingDoc.isBase64 && typeof incomingDoc.data === 'string') {
        const binary = atob(incomingDoc.data);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        finalData = bytes.buffer;
      }

      const rec = {
        name: incomingDoc.name || 'Guião da Peça',
        type: incomingDoc.type || 'pdf',
        size: incomingDoc.size || 0,
        data: finalData,
        importedAt: Date.now(),
        room: room
      };

      await dbPut('docs', room, rec);
      if (incomingDoc.meta) {
        await dbPut('meta', room, { ...incomingDoc.meta, updatedAt: Date.now() });
      }

      if (room === getRoom()) {
        currentRoom = room;
        doc = rec;
        if (incomingDoc.meta) {
          meta = { pins: incomingDoc.meta.pins || [], lastPage: incomingDoc.meta.lastPage || 0 };
        }
        if (isOpen) {
          await renderDoc();
        }
      }
    } catch (err) {
      console.warn('[dc-score] Falha a aplicar doc sincronizado:', err);
    }
  }

  async function storeDoc(rec) {
    const room = getRoom();
    rec.importedAt = Date.now();
    rec.room = room;
    const hadPins = meta.pins.length > 0 && currentRoom === room;
    let keepPins = false;
    if (hadPins) keepPins = confirm('Manter as marcas de deixas existentes no novo guião?\n(OK = manter • Cancelar = começar sem marcas)');
    showLoading(true, 'A guardar no dispositivo…');
    try {
      await dbPut('docs', room, rec);
      meta = { pins: keepPins ? meta.pins : [], lastPage: 0 };
      await dbPut('meta', room, { ...meta, updatedAt: Date.now() });
      broadcastDocToRoom(rec, room);
    } catch (err) {
      showLoading(false);
      toast('Não foi possível guardar (espaço insuficiente?): ' + (err.message || err), 6000);
      return;
    }
    currentRoom = room;
    doc = rec;
    closeImport();
    await renderDoc();
    const cueCount = cues().length;
    toast(`✅ "${rec.name}" carregado — ${pages.length} página(s).` + (cueCount && !keepPins && rec.type !== 'images' ? ' Use ⚡ Auto-marcar no Painel → Deixas.' : ''), 5000);
  }

  // ─── Toast ──────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    if (!toastEl) { console.log('[Guião Original]', msg); return; }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  // ─── Sync hook (apenas leitura do state) ────────────────────────────
  let lastPinSig = '';
  function onRoomState(newState) {
    if (!newState) return;
    theatreState = newState.theatre || null;
    if (!isOpen) return;
    const room = getRoom();
    if (room !== currentRoom) { loadForRoom(room); return; }
    const sig = cues().map(c => `${c.id}:${c.num}:${c.name}:${(c.departments || [])[0] || ''}`).join('|');
    if (sig !== lastPinSig) { lastPinSig = sig; renderPins(); } else refreshPinStates();
    updateHud();
    renderCueList();
    followCue();
  }

  function attach() {
    const c = getClient();
    if (c && typeof c.on === 'function') {
      c.on('room-state', onRoomState);
      c.on('theatre-scroll-sync', (scrollData) => {
        applyExternalScoreScroll(scrollData);
      });
      c.on('theatre-doc-sync', (incoming) => {
        handleIncomingDocSync(incoming.doc, incoming.room);
      });
      try { if (c._state) theatreState = c._state.theatre || null; } catch (_) {}
    }
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open-score]');
      if (b) { e.preventDefault(); open(); }
    });
  }

  window.DCScoreReader = {
    open,
    close,
    mount,
    unmount,
    isOpen: () => isOpen,
    loadForRoom,
    broadcastCurrentDoc,
    applyExternalScoreScroll,
    handleIncomingDocSync
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
