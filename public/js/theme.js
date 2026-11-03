/* =============================================
   Freemail 主题切换
   风格：calm / warm / tech    模式：light / dark
   API: window.FreemailTheme = { get, set, init }
   ============================================= */

(function () {
  var STORAGE_KEY = 'mf:ui-theme';
  var STYLES = ['calm', 'warm', 'tech'];
  var MODES = ['light', 'dark'];
  var STYLE_LABELS = { calm: 'Calm', warm: 'Warm', tech: 'Tech' };
  var SWATCHES = {
    calm: ['#f7f7f8', '#4f46e5', '#18181b'],
    warm: ['#f7f2ea', '#ea580c', '#3d3226'],
    tech: ['#0a0e14', '#22d3ee', '#e6edf3']
  };

  function readSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function systemMode() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function resolve() {
    var saved = readSaved() || {};
    var style = STYLES.indexOf(saved.style) !== -1 ? saved.style : 'calm';
    var mode = MODES.indexOf(saved.mode) !== -1 ? saved.mode : systemMode();
    return { style: style, mode: mode };
  }

  function apply(style, mode) {
    document.documentElement.setAttribute('data-style', style);
    document.documentElement.setAttribute('data-mode', mode);
  }

  function save(style, mode) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ style: style, mode: mode }));
    } catch (_) {}
  }

  function get() {
    return resolve();
  }

  function set(style, mode) {
    var current = resolve();
    var nextStyle = STYLES.indexOf(style) !== -1 ? style : current.style;
    var nextMode = MODES.indexOf(mode) !== -1 ? mode : current.mode;
    apply(nextStyle, nextMode);
    save(nextStyle, nextMode);
    renderPanel();
  }

  var panel = null;
  var button = null;

  function closePanel() {
    if (panel) panel.style.display = 'none';
  }

  function renderPanel() {
    if (!panel) return;
    var current = resolve();
    var styleCards = STYLES.map(function (style) {
      var active = style === current.style ? ' is-active' : '';
      var swatch = SWATCHES[style].map(function (color) {
        return '<span class="theme-swatch" style="background:' + color + '"></span>';
      }).join('');
      return '<button type="button" class="theme-style-card' + active + '" data-theme-style="' + style + '">' +
        '<span class="theme-swatches">' + swatch + '</span>' +
        '<span class="theme-style-name">' + STYLE_LABELS[style] + '</span>' +
        '</button>';
    }).join('');
    var modeButtons = MODES.map(function (mode) {
      var active = mode === current.mode ? ' is-active' : '';
      var label = mode === 'light' ? '浅色' : '深色';
      return '<button type="button" class="theme-mode-btn' + active + '" data-theme-mode="' + mode + '">' + label + '</button>';
    }).join('');
    panel.innerHTML =
      '<div class="theme-panel-title">风格</div>' +
      '<div class="theme-style-grid">' + styleCards + '</div>' +
      '<div class="theme-panel-title">明暗</div>' +
      '<div class="theme-mode-row">' + modeButtons + '</div>';
    panel.querySelectorAll('[data-theme-style]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.stopPropagation();
        set(el.getAttribute('data-theme-style'), resolve().mode);
      });
    });
    panel.querySelectorAll('[data-theme-mode]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.stopPropagation();
        set(resolve().style, el.getAttribute('data-theme-mode'));
      });
    });
  }

  function buildUI() {
    if (button || !document.body) return;
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'theme-switcher-btn';
    button.className = 'theme-switcher-btn';
    button.setAttribute('aria-label', '切换主题');
    button.title = '切换主题';
    button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="14.5" r="2.5"/><circle cx="8.5" cy="9.5" r="2.5"/>' +
      '<path d="M12 2a10 10 0 1 0 10 10c0-1.1-.9-2-2-2h-2a3 3 0 0 1-3-3V4a2 2 0 0 0-2-2z"/></svg>';

    panel = document.createElement('div');
    panel.id = 'theme-switcher-panel';
    panel.className = 'theme-switcher-panel';
    panel.style.display = 'none';

    var anchor = document.querySelector('.nav-actions');
    if (anchor) {
      var wrap = document.createElement('div');
      wrap.className = 'theme-switcher-anchor';
      wrap.appendChild(button);
      wrap.appendChild(panel);
      anchor.appendChild(wrap);
    } else {
      button.classList.add('theme-switcher-fixed');
      document.body.appendChild(button);
      panel.classList.add('theme-switcher-panel-fixed');
      document.body.appendChild(panel);

      if (window.MutationObserver) {
        var observer = new window.MutationObserver(function () {
          var lateAnchor = document.querySelector('.nav-actions');
          if (!lateAnchor) return;
          observer.disconnect();
          button.classList.remove('theme-switcher-fixed');
          panel.classList.remove('theme-switcher-panel-fixed');
          var lateWrap = document.createElement('div');
          lateWrap.className = 'theme-switcher-anchor';
          lateWrap.appendChild(button);
          lateWrap.appendChild(panel);
          lateAnchor.appendChild(lateWrap);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', function (event) {
      if (panel && panel.style.display !== 'none' && !panel.contains(event.target)) {
        closePanel();
      }
    });

    renderPanel();
  }

  function init() {
    apply(resolve().style, resolve().mode);
    buildUI();
  }

  window.FreemailTheme = { get: get, set: set, init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
