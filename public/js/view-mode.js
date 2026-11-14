/* StageTimer — Seletor de Modo (Auto / Telemóvel / PC)
   Guarda em localStorage['stagetimer_view_mode']. Autónomo, sem dependências. */
(function () {
  'use strict';
  var KEY = 'stagetimer_view_mode';
  var MODES = ['auto', 'phone', 'pc'];
  var LABELS = { auto: 'Auto', phone: 'Telemóvel', pc: 'PC' };
  var ICONS = { auto: '🔄', phone: '📱', pc: '🖥️' };
  var root = document.documentElement;
  var isViewer = /viewer(\.html)?$/i.test(location.pathname);

  function get() {
    try { var v = localStorage.getItem(KEY); return MODES.indexOf(v) > -1 ? v : 'auto'; }
    catch (e) { return 'auto'; }
  }
  function apply(mode) {
    root.setAttribute('data-view-mode', mode);
    var btns = document.querySelectorAll('.vm-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-mode') === mode;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function set(mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply(mode);
  }

  // Aplicar o mais cedo possível (evita flash)
  apply(get());

  function build() {
    if (document.getElementById('vm-switch')) return;
    var box = document.createElement('div');
    box.id = 'vm-switch';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Modo de visualização');
    if (isViewer) box.classList.add('vm-hidden');
    MODES.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'vm-btn';
      b.setAttribute('data-mode', m);
      b.title = 'Modo ' + LABELS[m];
      b.innerHTML = '<span aria-hidden="true">' + ICONS[m] + '</span><span class="vm-lbl">' + LABELS[m] + '</span>';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); set(m); });
      box.appendChild(b);
    });
    document.body.appendChild(box);
    if (isViewer) {
      // Escondido por defeito: toque no canto inferior direito mostra durante 5s
      var hot = document.createElement('div');
      hot.id = 'vm-hotzone';
      hot.addEventListener('click', function () {
        box.classList.remove('vm-hidden');
        clearTimeout(build._t);
        build._t = setTimeout(function () { box.classList.add('vm-hidden'); }, 5000);
      });
      document.body.appendChild(hot);
    }
    apply(get());
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);

  window.StageTimerViewMode = { get: get, set: set };
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(get()); });
})();
