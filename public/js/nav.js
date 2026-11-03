/* =============================================
   Freemail 统一导航
   - 按角色显示/隐藏管理入口（[data-nav-admin]）
   - 高亮当前页面入口（is-active）
   ============================================= */

(function () {
  var ADMIN_SELECTOR = '[data-nav-admin]';
  var sessionCache = null;
  var sessionLoaded = false;
  var observer = null;

  function isPrivileged(session) {
    return !!session && (session.strictAdmin === true || session.role === 'guest');
  }

  function applyVisibility(session) {
    var privileged = isPrivileged(session);
    var nodes = document.querySelectorAll(ADMIN_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.display = privileged ? 'inline-flex' : 'none';
    }
  }

  function currentPath() {
    var path = window.location.pathname || '/';
    if (path.length > 1 && path.charAt(path.length - 1) === '/') {
      path = path.slice(0, -1);
    }
    return path;
  }

  function highlightCurrent() {
    var path = currentPath();
    var links = document.querySelectorAll('.nav-actions a[href]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.getAttribute('href') || '';
      var linkPath = href.split('?')[0].split('#')[0];
      if (linkPath.length > 1 && linkPath.charAt(linkPath.length - 1) === '/') {
        linkPath = linkPath.slice(0, -1);
      }
      if (linkPath && linkPath === path) {
        link.classList.add('is-active');
      } else {
        link.classList.remove('is-active');
      }
    }
  }

  function applyAll(session) {
    applyVisibility(session);
    highlightCurrent();
  }

  function loadSession() {
    try {
      return fetch('/api/session', { headers: { 'Cache-Control': 'no-cache' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function init() {
    applyAll(null);
    loadSession().then(function (session) {
      sessionCache = session;
      sessionLoaded = true;
      applyAll(session);
    });
    if (window.MutationObserver) {
      observer = new window.MutationObserver(function () {
        if (document.querySelector(ADMIN_SELECTOR)) {
          applyAll(sessionLoaded ? sessionCache : null);
          if (sessionLoaded && observer) {
            observer.disconnect();
            observer = null;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
