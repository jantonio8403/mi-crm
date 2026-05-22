// ── Mayúsculas globales ──────────────────────────────────────────────
(function () {
  var EXCLUIR_TIPOS = { email:1, password:1, hidden:1, date:1, file:1, checkbox:1, radio:1, number:1 };
  var EXCLUIR_NOMBRES = { username:1 };

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    if (EXCLUIR_TIPOS[el.type]) return;
    if (EXCLUIR_NOMBRES[el.name]) return;
    if (el.dataset.noUpper !== undefined) return;
    var pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    try { el.setSelectionRange(pos, pos); } catch (_) {}
  });
}());

// ── PWA: manifest + service worker ─────────────────────────────────
(function () {
  // Inyectar etiquetas PWA en <head>
  var head = document.head;

  function addMeta(name, content) {
    var m = document.createElement('meta');
    m.name = name; m.content = content;
    head.appendChild(m);
  }
  function addLink(rel, href, extra) {
    var l = document.createElement('link');
    l.rel = rel; l.href = href;
    if (extra) Object.assign(l, extra);
    head.appendChild(l);
  }

  addLink('manifest', '/manifest.json');
  addMeta('theme-color', '#1a7a4a');
  addMeta('apple-mobile-web-app-capable', 'yes');
  addMeta('apple-mobile-web-app-title', 'AGORA');
  addMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  addLink('apple-touch-icon', '/img/icon-192.svg');

  // Registrar service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
}());

// ── Sidebar hamburger ───────────────────────────────────────────────
(function () {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  document.body.appendChild(overlay);

  const sidebar = document.querySelector('.sidebar');
  const topbar  = document.querySelector('.topbar');
  if (!sidebar || !topbar) return;

  const btn = document.createElement('button');
  btn.className = 'hamburger';
  btn.setAttribute('aria-label', 'Abrir menú');
  btn.innerHTML = '&#9776;';
  topbar.insertBefore(btn, topbar.firstChild);

  function openSidebar()  { sidebar.classList.add('open');    overlay.classList.add('visible'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }

  btn.addEventListener('click', function () {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
  sidebar.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', closeSidebar);
  });
}());

// ── Sidebar: secciones colapsables ─────────────────────────────
(function () {
  var STORAGE_KEY = 'agora-sb-v1';

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  var path = window.location.pathname;
  var sections = document.querySelectorAll('.sidebar-section[id]');

  sections.forEach(function (sec) {
    var id = sec.id.replace('sec-', '');
    var hasActive = !!sec.querySelector('a.activo');
    var state = loadState();
    // Active section is always expanded; others use stored state (default: expanded)
    if (!hasActive && state[id] === true) {
      sec.classList.add('collapsed');
    }
  });

  window.sidebarToggle = function (id) {
    var sec = document.getElementById('sec-' + id);
    if (!sec) return;
    var wasCollapsed = sec.classList.contains('collapsed');
    var s = loadState();
    // Colapsar todas las secciones (acordeón)
    document.querySelectorAll('.sidebar-section[id]').forEach(function (other) {
      other.classList.add('collapsed');
      s[other.id.replace('sec-', '')] = true;
    });
    // Si la sección estaba cerrada, abrirla
    if (wasCollapsed) {
      sec.classList.remove('collapsed');
      s[id] = false;
    }
    saveState(s);
  };
}());

